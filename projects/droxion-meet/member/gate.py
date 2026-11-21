import base64
import binascii
import secrets

from django.conf import settings
from django.http import HttpResponse


class PrivateBeta:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.MEET_LOCAL:
            return self.get_response(request)
        scheme, _, token = request.headers.get("Authorization", "").partition(" ")
        if scheme.lower() == "basic":
            try:
                value = base64.b64decode(token, validate=True)
                if secrets.compare_digest(value, b"beta:" + settings.BETA_PASSWORD.encode()):
                    return self.get_response(request)
            except (ValueError, binascii.Error):
                pass
        return HttpResponse("Private QA beta", status=401, headers={
            "WWW-Authenticate": 'Basic realm="Droxion Meet private QA"',
            "Cache-Control": "no-store",
        })
