from datetime import timedelta
from functools import wraps

from django.contrib.auth import get_user_model, logout
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_POST

from .forms import MessageForm, PlanForm, ProfileForm, ReportForm
from .models import Call, Connection, LikeEvent, Message, Plan, Profile, Report

User = get_user_model()


def member_view(view):
    @never_cache
    @login_required
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_staff and not Profile.objects.filter(user=request.user).exists():
            raise Http404
        return view(request, *args, **kwargs)
    return wrapped


def pair_ids(user, peer):
    if user == peer:
        raise Http404
    return dict(zip(("low_id", "high_id"), sorted((user, peer))))


def paired(user):
    return Connection.objects.filter(Q(low_id=user) | Q(high_id=user))


def compatible(profile):
    return Profile.objects.filter(
        visible=True, user__is_active=True, intention=profile.intention,
        community=profile.community,
    ).exclude(user=profile.user)


@member_view
def discover(request):
    profile = getattr(request.user, "profile", None)
    candidates = []
    if profile and profile.visible:
        uid = request.user.pk
        exclusions = paired(uid).filter(
            Q(blocked=True) | Q(closed=True)
            | Q(low_id=uid, low_likes=True) | Q(high_id=uid, high_likes=True)
            | Q(low_id=uid, low_passed=True) | Q(high_id=uid, high_passed=True)
        )
        candidates = compatible(profile).exclude(
            user_id__in=exclusions.filter(low_id=uid).values("high_id")
        ).exclude(user_id__in=exclusions.filter(high_id=uid).values("low_id"))[:30]
    return render(request, "discover.html", {"profiles": candidates, "profile": profile})


@member_view
def edit_profile(request):
    profile = get_object_or_404(Profile, user=request.user)
    form = ProfileForm(request.POST if request.method == "POST" else None, instance=profile)
    if request.method == "POST" and form.is_valid():
        # Limit the write to editable fields so a concurrent tier change is preserved.
        form.save(commit=False).save(update_fields=list(form.fields))
        return redirect("discover")
    return render(request, "form.html", {"title": "Your profile", "form": form})


@member_view
@require_POST
@transaction.atomic
def react(request, peer, action):
    if action not in {"like", "pass", "block", "unmatch"}:
        raise Http404
    uid = request.user.pk
    ids = pair_ids(uid, peer)
    # Lock both users in canonical order, including when their pair is first created.
    users = list(User.objects.select_for_update().filter(
        pk__in=(uid, peer), is_active=True
    ).order_by("pk"))
    if len(users) != 2:
        raise Http404
    profile = get_object_or_404(Profile, user_id=uid)
    pair = Connection.objects.select_for_update().filter(**ids).first()
    if action in {"like", "pass"}:
        if not profile.visible or not compatible(profile).filter(user_id=peer).exists():
            raise Http404
        if pair and (pair.closed or pair.blocked):
            raise Http404
    elif not pair and (action == "unmatch" or not compatible(profile).filter(user_id=peer).exists()):
        raise Http404
    if pair is None:
        pair = Connection.objects.create(**ids)

    side = "low" if pair.low_id == uid else "high"
    liked = f"{side}_likes"
    passed = f"{side}_passed"
    if action == "like" and not (getattr(pair, liked) or getattr(pair, passed)):
        recent = LikeEvent.objects.filter(sender_id=uid, created__gte=timezone.now()-timedelta(days=1))
        if recent.count() >= profile.daily_likes:
            transaction.set_rollback(True)
            return HttpResponse("Daily like limit reached.", status=429)
        LikeEvent.objects.create(sender_id=uid)
        setattr(pair, liked, True)
    elif action == "pass" and not getattr(pair, liked):
        setattr(pair, passed, True)
    elif action == "block":
        pair.blocked = True
    elif action == "unmatch" and pair.matched:
        pair.closed = True
    pair.save()
    if pair.blocked or pair.closed:
        Call.objects.filter(connection=pair).delete()
    return redirect("thread", peer=peer) if pair.matched else redirect("discover")


@member_view
def matches(request):
    uid = request.user.pk
    pairs = paired(uid).filter(
        blocked=False, closed=False, low_likes=True, high_likes=True,
        low__is_active=True, high__is_active=True,
    ).select_related("low__profile", "high__profile")
    unread = set(Message.objects.filter(connection__in=pairs, read=False)
                 .exclude(sender_id=uid).values_list("connection_id", flat=True))
    rows = [(pair.high.profile if pair.low_id == uid else pair.low.profile, pair.pk in unread)
            for pair in pairs]
    return render(request, "matches.html", {"rows": rows})


def get_pair(request, peer, lock=False):
    pairs = Connection.objects.filter(low__is_active=True, high__is_active=True)
    if lock:
        pairs = pairs.select_for_update(of=("self",))
    pair = get_object_or_404(pairs, **pair_ids(request.user.pk, peer))
    if not pair.matched:
        raise Http404
    return pair


@member_view
@transaction.atomic
def thread(request, peer):
    from .calls import enabled
    pair = get_pair(request, peer)
    return render(request, "thread.html", {
        "peer": get_object_or_404(Profile, user_id=peer),
        "calling_enabled": enabled(),
        "plans": Plan.objects.filter(connection=pair).order_by("-id")[:25],
        "message_form": MessageForm(), "plan_form": PlanForm(),
    })


@member_view
@require_POST
@transaction.atomic
def inbox(request, peer):
    pair = get_pair(request, peer, lock=True)
    messages = list(Message.objects.filter(connection=pair).order_by("-id")[:100])
    Message.objects.filter(pk__in=[m.pk for m in messages], sender_id=peer).update(read=True)
    return JsonResponse({"messages": [
        {"id": m.pk, "mine": m.sender_id != peer, "body": m.body,
         "created": m.created.isoformat(), "read": m.read} for m in reversed(messages)
    ]})


@member_view
@require_POST
@transaction.atomic
def send(request, peer):
    uid = request.user.pk
    # Serialize per-sender rate limits across conversations.
    get_object_or_404(User.objects.select_for_update(), pk=uid, is_active=True)
    pair = get_pair(request, peer, lock=True)
    if Message.objects.filter(sender_id=uid, created__gte=timezone.now()-timedelta(minutes=1)).count() >= 12:
        return HttpResponse("Messaging limit reached. Try again in a minute.", status=429)
    form = MessageForm(request.POST)
    if not form.is_valid():
        return render(request, "form.html", {"title": "Send message", "form": form}, status=400)
    message = form.save(commit=False)
    message.connection, message.sender_id = pair, uid
    message.save()
    return redirect("thread", peer=peer)


@member_view
@require_POST
@transaction.atomic
def propose(request, peer):
    pair = get_pair(request, peer, lock=True)
    if Plan.objects.filter(connection=pair, status=Plan.Status.PROPOSED).count() >= 5:
        return HttpResponse("Resolve a pending plan before proposing another.", status=429)
    form = PlanForm(request.POST)
    if not form.is_valid():
        return render(request, "form.html", {"title": "Propose a plan", "form": form}, status=400)
    plan = form.save(commit=False)
    plan.connection, plan.sender = pair, request.user
    plan.save()
    return redirect("thread", peer=peer)


@member_view
@require_POST
@transaction.atomic
def plan_status(request, peer, plan_id, action):
    pair = get_pair(request, peer, lock=True)
    plan = get_object_or_404(Plan, pk=plan_id, connection=pair)
    if action == "cancel" and plan.status in {Plan.Status.PROPOSED, Plan.Status.ACCEPTED}:
        plan.status = Plan.Status.CANCELED
    elif (action in {"accept", "decline"} and plan.status == Plan.Status.PROPOSED
          and plan.sender_id != request.user.pk):
        if action == "accept" and plan.when <= timezone.now():
            return HttpResponse("This proposed time has passed.", status=409)
        plan.status = Plan.Status.ACCEPTED if action == "accept" else Plan.Status.DECLINED
    else:
        return HttpResponse("This plan cannot be changed that way.", status=409)
    plan.save(update_fields=["status"])
    return redirect("thread", peer=peer)


@member_view
@transaction.atomic
def report(request, peer):
    uid = request.user.pk
    ids = pair_ids(uid, peer)
    profile = get_object_or_404(Profile, user_id=uid)
    pair = Connection.objects.filter(**ids).first()
    if not pair and not compatible(profile).filter(user_id=peer).exists():
        raise Http404
    form = ReportForm(request.POST if request.method == "POST" else None,
                      initial={"message": request.GET.get("message")})
    if request.method == "POST" and form.is_valid():
        get_object_or_404(User.objects.select_for_update(), pk=uid)
        if Report.objects.filter(reporter_id=uid, created__gte=timezone.now()-timedelta(hours=1)).count() >= 5:
            return HttpResponse("Report limit reached. Try again later.", status=429)
        incident = form.save(commit=False)
        incident.reporter_id, incident.subject_id = uid, peer
        if form.cleaned_data["message"]:
            if not pair:
                raise Http404
            message = get_object_or_404(Message, pk=form.cleaned_data["message"], connection=pair, sender_id=peer)
            incident.evidence = message.body
        incident.save()
        return render(request, "reported.html")
    return render(request, "form.html", {"title": "Report a safety issue", "form": form})


@member_view
@require_POST
@transaction.atomic
def delete_account(request):
    if request.user.is_staff or not request.user.check_password(request.POST.get("password", "")):
        return HttpResponse("Could not confirm account deletion.", status=403)
    user = request.user
    logout(request)
    user.delete()
    return redirect("home")
