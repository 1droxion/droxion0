import base64
import hashlib
import hmac
import json
from datetime import timedelta
from ipaddress import ip_address

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .models import Call
from .views import get_pair, member_view


def enabled():
    return settings.MEET_LOCAL or bool(settings.MEET_TURN_URL and settings.MEET_TURN_SECRET)


@member_view
@require_POST
@transaction.atomic
def signal(request, peer):
    pair = get_pair(request, peer, lock=True)
    if not enabled():
        return HttpResponse(status=503)
    uid = request.user.pk
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return HttpResponse(status=400)
    if not isinstance(data, dict):
        return HttpResponse(status=400)
    action = data.get("action")
    call = Call.objects.filter(connection=pair).first()
    if call and call.updated < timezone.now() - timedelta(minutes=2):
        call.delete()
        call = None

    if action == "config":
        ice = []
        if settings.MEET_TURN_SECRET:
            expires = int((timezone.now() + timedelta(hours=1)).timestamp())
            username = f"{expires}:{uid}"
            mac = hmac.new(settings.MEET_TURN_SECRET.encode(), username.encode(), hashlib.sha1)
            ice.append({"urls": [settings.MEET_TURN_URL], "username": username,
                        "credential": base64.b64encode(mac.digest()).decode()})
        return JsonResponse({"iceServers": ice, "iceTransportPolicy": "relay" if ice else "all"})
    if action == "start":
        sdp = data.get("sdp")
        mode = data.get("mode")
        if mode not in ("voice", "video") or not valid_sdp(sdp):
            return HttpResponse(status=400)
        if call:
            return HttpResponse(status=409)
        call = Call.objects.create(connection=pair, caller_id=uid, offer=sdp, mode=mode)
    elif action in ("answer", "end", "touch"):
        if not call or data.get("id") != call.pk:
            return HttpResponse(status=409)
        if action == "end":
            call.delete()
            call = None
        elif action == "touch":
            if call.answer:
                call.save(update_fields=["updated"])
        else:
            if call.caller_id == uid or call.answer or not valid_sdp(data.get("sdp")):
                return HttpResponse(status=400)
            call.answer = data["sdp"]
            call.save(update_fields=["answer", "updated"])
    elif action != "status":
        return HttpResponse(status=400)

    if not call:
        return JsonResponse({"call": None})
    outgoing = call.caller_id == uid
    return JsonResponse({"call": {
        "id": call.pk, "outgoing": outgoing, "mode": call.mode,
        "offer": "" if outgoing else call.offer,
        "answer": call.answer if outgoing else "",
        "accepted": bool(call.answer),
    }})


def valid_sdp(value):
    if not isinstance(value, str) or not value.startswith("v=0") or len(value) > 20_000:
        return False
    if settings.MEET_LOCAL:
        return True
    # Prevent relayed signaling from forwarding host or reflexive ICE addresses.
    for line in value.splitlines():
        if line.startswith("a=candidate:"):
            parts = line.split()
            if len(parts) < 8 or parts[7] != "relay":
                return False
            # Browsers may include a related address. Require redaction.
            if "raddr" in parts:
                address = parts[parts.index("raddr") + 1:][:1]
                try:
                    if not address or not ip_address(address[0]).is_unspecified:
                        return False
                except ValueError:
                    return False
    return True
