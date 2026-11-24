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


@override_settings(CACHES=LOCMEM, DEBUG=False, SMS_PROVIDER="", OTP_DEMO_MODE=True)
class DemoOtpModeTests(TestCase):
    """No SMS yet: every mobile number can sign in or create a parent profile."""

    def setUp(self):
        cache.clear()

    def _sign_in(self, phone):
        client = APIClient()
        sent = client.post("/api/auth/otp/send/", {"phone": phone}, format="json")
        self.assertEqual(sent.status_code, 200, sent.data)
        self.assertTrue(sent.data["demo"])
        return client.post(
            "/api/auth/otp/verify/", {"phone": phone, "otp": sent.data["otp_debug"]}, format="json"
        )

    def test_a_new_number_creates_a_parent_profile(self):
        from accounts.models import User

        res = self._sign_in("9123400011")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["created"])
        self.assertEqual(res.data["user"]["role"], "PARENT")
        user = User.objects.get(phone="9123400011")
        self.assertFalse(user.phone_verified)
        self.assertEqual(res.data["children_linked"], 0)

    def test_the_same_number_signs_back_in_to_the_same_profile(self):
        first = self._sign_in("9123400012")
        again = self._sign_in("9123400012")
        self.assertEqual(again.status_code, 200, again.data)
        self.assertFalse(again.data["created"])
        self.assertEqual(again.data["user"]["id"], first.data["user"]["id"])

    def test_a_staff_number_gets_its_own_parent_profile_and_staff_login_still_works(self):
        from accounts.models import User

        staff = User.objects.create_user(
            username="boss_test", password="Secret@123", phone="9123400013", role=User.Role.BOSS
        )
        res = self._sign_in("9123400013")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["user"]["role"], "PARENT")
        self.assertNotEqual(res.data["user"]["id"], str(staff.id))

        login = APIClient().post(
            "/api/auth/token/", {"username": "9123400013", "password": "Secret@123"}, format="json"
        )
        self.assertEqual(login.status_code, 200, login.data)
        self.assertEqual(login.data["user"]["role"], "BOSS")

    def test_a_wrong_code_is_refused(self):
        client = APIClient()
        client.post("/api/auth/otp/send/", {"phone": "9123400014"}, format="json")
        res = client.post("/api/auth/otp/verify/", {"phone": "9123400014", "otp": "000000"}, format="json")
        self.assertEqual(res.status_code, 400)

    @override_settings(OTP_DEMO_MODE=False)
    def test_off_by_default_without_sms(self):
        res = APIClient().post("/api/auth/otp/send/", {"phone": "9123400015"}, format="json")
        self.assertEqual(res.status_code, 503)
