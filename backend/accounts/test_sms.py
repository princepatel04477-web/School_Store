import json
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
PHONE = "9876001122"


class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@override_settings(CACHES=LOCMEM)
class SendOtpBySmsTests(TestCase):
    def setUp(self):
        cache.clear()

    def _send(self):
        return APIClient().post("/api/auth/otp/send/", {"phone": f"+91 {PHONE}"}, format="json")

    @override_settings(DEBUG=False, SMS_PROVIDER="")
    def test_without_a_provider_it_says_so_instead_of_pretending(self):
        res = self._send()
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["code"], "sms_unavailable")
        self.assertIsNone(cache.get(f"otp:{PHONE}"))

    @override_settings(DEBUG=False, SMS_PROVIDER="msg91", MSG91_AUTH_KEY="key", MSG91_OTP_TEMPLATE_ID="tpl")
    def test_msg91_receives_the_same_code_the_server_checks(self):
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse({"type": "success"})) as urlopen:
            res = self._send()
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("otp_debug", res.data)
        request = urlopen.call_args.args[0]
        code = cache.get(f"otp:{PHONE}")
        self.assertIn("template_id=tpl", request.full_url)
        self.assertIn(f"mobile=91{PHONE}", request.full_url)
        self.assertIn(f"otp={code}", request.full_url)
        self.assertEqual(request.headers["Authkey"], "key")

    @override_settings(DEBUG=False, SMS_PROVIDER="msg91", MSG91_AUTH_KEY="key", MSG91_OTP_TEMPLATE_ID="tpl")
    def test_a_rejected_sms_is_reported_and_no_code_is_kept(self):
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse({"type": "error", "message": "bad"})):
            res = self._send()
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data["code"], "sms_failed")
        self.assertIsNone(cache.get(f"otp:{PHONE}"))

    @override_settings(DEBUG=True, SMS_PROVIDER="")
    def test_development_logs_the_code_and_returns_it(self):
        res = self._send()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["otp_debug"], cache.get(f"otp:{PHONE}"))
