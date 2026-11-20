import json
from unittest import mock
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from accounts.models import User

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@override_settings(CACHES=LOCMEM, SMS_PROVIDER="console", DEBUG=True)
class OTPLoginBackendTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _send(self, phone):
        return self.client.post("/api/auth/otp/send/", {"phone": phone}, format="json")

    def _verify(self, phone, otp):
        return self.client.post("/api/auth/otp/verify/", {"phone": phone, "otp": otp}, format="json")

    def test_first_time_number_creates_parent_account(self):
        phone = "9876500010"
        send_res = self._send(phone)
        self.assertEqual(send_res.status_code, 200)
        code = cache.get(f"otp:{phone}")
        self.assertTrue(code)

        verify_res = self._verify(phone, code)
        self.assertEqual(verify_res.status_code, 200)
        self.assertTrue(verify_res.data["created"])
        self.assertEqual(verify_res.data["user"]["role"], "PARENT")
        self.assertTrue(verify_res.data["access"])
        self.assertTrue(verify_res.data["refresh"])

    def test_same_number_again_returns_existing_parent(self):
        phone = "9876500011"
        self._send(phone)
        code1 = cache.get(f"otp:{phone}")
        res1 = self._verify(phone, code1)
        self.assertEqual(res1.status_code, 200)
        user_id = res1.data["user"]["id"]

        # Send again & verify again
        self._send(phone)
        code2 = cache.get(f"otp:{phone}")
        res2 = self._verify(phone, code2)
        self.assertEqual(res2.status_code, 200)
        self.assertFalse(res2.data["created"])
        self.assertEqual(res2.data["user"]["id"], user_id)
        self.assertEqual(res2.data["user"]["role"], "PARENT")

    def test_wrong_code_returns_400_otp_wrong(self):
        phone = "9876500012"
        self._send(phone)
        res = self._verify(phone, "000000")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "otp_wrong")

    def test_after_five_wrong_tries_right_code_returns_otp_expired(self):
        phone = "9876500013"
        self._send(phone)
        code = cache.get(f"otp:{phone}")

        # Bypass the IP rate limit so we test the OTP attempt burn logic
        with mock.patch("accounts.views.OTPRateThrottle.allow_request", return_value=True):
            for _ in range(5):
                res = self._verify(phone, "999999")
                self.assertEqual(res.status_code, 400)
                self.assertEqual(res.data["code"], "otp_wrong")

            # Now attempting with the original code fails with otp_expired
            res = self._verify(phone, code)
            self.assertEqual(res.status_code, 400)
            self.assertEqual(res.data["code"], "otp_expired")

    def test_code_older_than_ttl_returns_otp_expired(self):
        phone = "9876500014"
        self._send(phone)
        # Simulate expiration by deleting the cache key
        cache.delete(f"otp:{phone}")

        res = self._verify(phone, "123456")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "otp_expired")

    def test_resend_replaces_code(self):
        phone = "9876500015"
        self._send(phone)
        code1 = cache.get(f"otp:{phone}")

        self._send(phone)
        code2 = cache.get(f"otp:{phone}")
        self.assertNotEqual(code1, code2)

        # Old code fails
        res_old = self._verify(phone, code1)
        self.assertEqual(res_old.status_code, 400)
        self.assertEqual(res_old.data["code"], "otp_wrong")

        # New code succeeds
        res_new = self._verify(phone, code2)
        self.assertEqual(res_new.status_code, 200)

    def test_staff_number_returns_400_staff_account_and_no_tokens(self):
        phone = "9876500016"
        # Seed a staff account (TEACHER)
        staff = User.objects.create(
            username="teacher_test",
            phone=phone,
            role=User.Role.TEACHER,
            is_active=True,
        )
        self._send(phone)
        code = cache.get(f"otp:{phone}")

        res = self._verify(phone, code)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "staff_account")
        self.assertNotIn("access", res.data)
        self.assertNotIn("refresh", res.data)

    @override_settings(DEBUG=False, SMS_PROVIDER="")
    def test_provider_unset_with_debug_off_returns_503(self):
        phone = "9876500017"
        res = self._send(phone)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["code"], "sms_unavailable")

    @override_settings(DEBUG=False, SMS_PROVIDER="msg91", MSG91_AUTH_KEY="k", MSG91_OTP_TEMPLATE_ID="t")
    def test_msg91_rejecting_returns_502_and_stores_no_code(self):
        phone = "9876500018"
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse({"type": "error", "message": "fail"})):
            res = self._send(phone)
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data["code"], "sms_failed")
        self.assertIsNone(cache.get(f"otp:{phone}"))

    def test_throttle_after_rate_limit(self):
        phone = "9876500019"
        # The OTPRateThrottle is 5/min per IP
        # 5 allowed requests
        for i in range(5):
            res = self._send(f"987650002{i}")
            self.assertEqual(res.status_code, 200)

        # 6th request is throttled
        res = self._send(phone)
        self.assertEqual(res.status_code, 429)
