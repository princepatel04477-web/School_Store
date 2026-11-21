"""
OTP sign-in limits for parents (ported from the website line, review 2026-11-21).

Sending a code and checking a code have separate allowances, so a parent's
typing mistakes no longer use up the 5/min send limit.
"""

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM, SMS_PROVIDER="console")
class OTPVerifyLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _send(self, phone):
        return self.client.post("/api/auth/otp/send/", {"phone": phone}, format="json")

    def _verify(self, phone, otp):
        return self.client.post("/api/auth/otp/verify/", {"phone": phone, "otp": otp}, format="json")

    def test_typing_mistakes_do_not_use_up_the_send_limit(self):
        # One send + 4 wrong codes used to return 429, because send and verify
        # shared one 5/min allowance.
        phone = "9876500030"
        self.assertEqual(self._send(phone).status_code, 200)
        code = cache.get(f"otp:{phone}")
        self.assertTrue(code)
        for wrong in ("000000", "111111", "222222", "333333"):
            self.assertEqual(self._verify(phone, wrong).status_code, 400)
        # The right code still works, and a resend is still allowed afterwards
        self.assertEqual(self._verify(phone, code).status_code, 200)
        self.assertEqual(self._send(phone).status_code, 200)

    def test_verify_has_its_own_limit(self):
        phone = "9876500031"
        self._send(phone)
        statuses = [self._verify(phone, "000000").status_code for _ in range(21)]
        self.assertEqual(statuses[:20], [400] * 20)
        self.assertEqual(statuses[20], 429)

    def test_code_is_burned_after_five_wrong_tries(self):
        phone = "9876500032"
        self._send(phone)
        code = cache.get(f"otp:{phone}")
        for _ in range(5):
            self._verify(phone, "000000")
        # The separate verify allowance does not make guessing easier
        self.assertEqual(self._verify(phone, code).status_code, 400)
