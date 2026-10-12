"""
Text messages to parents: sign-in codes (OTP) and order confirmations.

India only delivers business SMS sent from a DLT-registered sender with a
registered template, so messages go through MSG91, which holds those
registrations. Settings (environment variables):

    SMS_PROVIDER=msg91
    MSG91_AUTH_KEY=...                 # MSG91 dashboard > API
    MSG91_OTP_TEMPLATE_ID=...          # DLT-approved OTP template, uses ##OTP##
    MSG91_ORDER_TEMPLATE_ID=...        # optional: order confirmation flow,
                                       # variables ##order## and ##amount##

With no provider in production, sending raises SmsNotConfigured so the site
can say sign-in is unavailable instead of pretending a code was sent.
SMS_PROVIDER=console (or DEBUG) only logs the message, for development.
"""

import json
import logging
import urllib.error
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)

MSG91_OTP_URL = "https://control.msg91.com/api/v5/otp"
MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow"
TIMEOUT_SECONDS = 8


class SmsNotConfigured(Exception):
    """No SMS provider is set up, so nothing can be sent."""


class SmsSendFailed(Exception):
    """The provider was reached but did not accept the message."""


def _provider():
    provider = (getattr(settings, "SMS_PROVIDER", "") or "").strip().lower()
    if provider:
        return provider
    return "console" if settings.DEBUG else ""


def _post_json(url, payload, auth_key):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"authkey": auth_key, "Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode() or "{}")
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise SmsSendFailed(str(exc)) from exc
    if body.get("type") != "success":
        raise SmsSendFailed(body.get("message") or "SMS provider rejected the message")
    return body


def send_otp(phone, code):
    """Sends a 6-digit sign-in code to a 10-digit Indian mobile number."""
    provider = _provider()
    if provider == "console":
        logger.info("OTP for %s: %s", phone, code)
        return
    if provider != "msg91":
        raise SmsNotConfigured("SMS_PROVIDER is not set")
    auth_key = getattr(settings, "MSG91_AUTH_KEY", "")
    template_id = getattr(settings, "MSG91_OTP_TEMPLATE_ID", "")
    if not auth_key or not template_id:
        raise SmsNotConfigured("MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are required")
    url = f"{MSG91_OTP_URL}?template_id={template_id}&mobile=91{phone}&otp={code}"
    _post_json(url, {}, auth_key)


def send_order_confirmation(phone, order_number, amount):
    """Best effort: an order must never fail because its confirmation text did."""
    provider = _provider()
    if provider == "console":
        logger.info("Order SMS to %s: %s, Rs %s", phone, order_number, amount)
        return False
    template_id = getattr(settings, "MSG91_ORDER_TEMPLATE_ID", "")
    auth_key = getattr(settings, "MSG91_AUTH_KEY", "")
    if provider != "msg91" or not template_id or not auth_key or not phone:
        return False
    payload = {
        "template_id": template_id,
        "short_url": "0",
        "recipients": [{"mobiles": f"91{phone}", "order": order_number, "amount": str(amount)}],
    }
    try:
        _post_json(MSG91_FLOW_URL, payload, auth_key)
    except SmsSendFailed:
        logger.warning("Order confirmation SMS failed for %s", order_number, exc_info=True)
        return False
    return True
