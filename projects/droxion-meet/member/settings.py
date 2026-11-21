import os
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict

BASE = Path(__file__).resolve().parents[1]
MEET_LOCAL = os.getenv("MEET_LOCAL") == "1"
DEBUG = MEET_LOCAL
SECRET_KEY = "local-only-meet-development-key" if DEBUG else os.environ["SECRET_KEY"]
ALLOWED_HOSTS = ["localhost", "127.0.0.1"] if DEBUG else [os.environ["MEET_HOST"]]
ROOT_URLCONF = "member.urls"
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "member",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware", "member.gate.PrivateBeta", "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware", "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE / "member" / "templates"],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request", "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
if MEET_LOCAL:
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.sqlite3", "NAME": BASE / "local.sqlite3",
    }}
else:
    pg = conninfo_to_dict(os.environ["DATABASE_URL"])
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": pg["dbname"], "USER": pg["user"], "PASSWORD": pg["password"],
        "HOST": pg["host"], "PORT": pg.get("port", "5432"),
        "OPTIONS": {"sslmode": "require", "connect_timeout": 10},
    }}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": f"django.contrib.auth.password_validation.{name}"} for name in (
        "UserAttributeSimilarityValidator", "MinimumLengthValidator",
        "CommonPasswordValidator", "NumericPasswordValidator",
    )
]
STATIC_URL = "/static/"
STATIC_ROOT = BASE / "collected-static"
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/members/"
LOGOUT_REDIRECT_URL = "/"
USE_TZ = True
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = SECURE_SSL_REDIRECT = not DEBUG
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_HSTS_SECONDS = 3600
DATA_UPLOAD_MAX_MEMORY_SIZE = 32_768
BETA_PASSWORD = "" if DEBUG else os.environ["MEET_BETA_PASSWORD"]
if not DEBUG and len(BETA_PASSWORD) < 32:
    raise ValueError("Set MEET_BETA_PASSWORD to a random secret of at least 32 characters")

# Hosted calls require a relay to avoid sharing member IP addresses.
MEET_TURN_URL = os.getenv("MEET_TURN_URL", "")
MEET_TURN_SECRET = os.getenv("MEET_TURN_SECRET", "")
