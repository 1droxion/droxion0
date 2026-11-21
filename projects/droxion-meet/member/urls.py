from django.conf import settings
from django.contrib import admin
from django.contrib.auth import views as auth
from django.http import FileResponse, Http404
from django.shortcuts import render
from django.urls import path

from . import views


def demo(request, asset="index.html"):
    allowed = {
        "index.html": "text/html; charset=utf-8",
        "styles.css": "text/css; charset=utf-8",
        "profiles.js": "text/javascript; charset=utf-8",
        "bot-engine.js": "text/javascript; charset=utf-8",
        "app.js": "text/javascript; charset=utf-8",
    }
    if asset not in allowed:
        raise Http404
    return FileResponse((settings.BASE / asset).open("rb"), content_type=allowed[asset])


urlpatterns = [
    path("", lambda request: render(request, "home.html"), name="home"),
    path("demo/", demo, name="demo"),
    path("demo/<str:asset>", demo),
    path("theme.css", lambda request: demo(request, "styles.css")),
    path("login/", auth.LoginView.as_view(template_name="login.html"), name="login"),
    path("logout/", auth.LogoutView.as_view(), name="logout"),
    path("admin/", admin.site.urls),
    path("members/", views.discover, name="discover"),
    path("members/profile/", views.edit_profile, name="edit_profile"),
    path("members/matches/", views.matches, name="matches"),
    path("members/preferences/", views.member_view(
        lambda request: render(request, "settings.html")), name="preferences"),
    path("members/delete/", views.delete_account, name="delete_account"),
    path("members/<int:peer>/react/<str:action>/", views.react, name="react"),
    path("members/<int:peer>/report/", views.report, name="report"),
    path("members/<int:peer>/chat/", views.thread, name="thread"),
    path("members/<int:peer>/inbox/", views.inbox, name="inbox"),
    path("members/<int:peer>/send/", views.send, name="send"),
    path("members/<int:peer>/plan/", views.propose, name="propose"),
    path("members/<int:peer>/plan/<int:plan_id>/<str:action>/", views.plan_status, name="plan_status"),
]
