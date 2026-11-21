import getpass
import re

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import ValidationError
from django.db import transaction

from member.models import Profile


class Command(BaseCommand):
    help = "Provision an internal QA account using synthetic data."

    def add_arguments(self, parser):
        parser.add_argument("username")

    @transaction.atomic
    def handle(self, *args, **options):
        username = options["username"]
        if not re.fullmatch(r"qa-[a-z0-9-]{1,32}", username):
            raise CommandError("Use qa- followed by 1–32 lowercase letters, digits or hyphens.")
        user = get_user_model()(username=username)
        password = getpass.getpass("QA password: ")
        try:
            validate_password(password, user)
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages)) from exc
        user.set_password(password)
        user.save()
        Profile.objects.create(
            user=user, name=username, community="qa sandbox",
            intention=Profile.Intent.FRIENDSHIP,
        )
