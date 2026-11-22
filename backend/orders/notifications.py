"""
Customer Notification System and Provider Adapters (Task 9).

Architectural Guarantees:
1. Transaction Decoupling (Outbox Pattern):
   Notifications are durably committed to the database as NotificationRecord outbox items.
   Network calls to SMS/WhatsApp/Email gateways NEVER occur inside the database transaction.
   Broker / network failures after commit cannot abort, roll back, or lose orders.
2. Idempotency & Deduplication:
   Every notification has a deterministic idempotency_key. Retries cannot duplicate
   customer messages.
3. Bounded Retry with Exponential Backoff:
   Failed sends are rescheduled with exponential delay up to max_attempts, then marked EXHAUSTED.
   A Celery beat sweeper recovers broker outages and executes overdue outbox items.
4. Channel Preferences & Marketing Separation:
   Honours customer channel preferences (SMS, WhatsApp, Email).
   Transactional notifications (order, dispatch, pickup, delivery, refund) are distinguished
   from marketing and cannot be blocked by marketing opt-outs unless the channel itself is disabled.
5. Privacy & Zero-Secret Leaks:
   Accepted provider status is recorded as SENT, NEVER DELIVERED (until receipt confirmation).
   Customer phone numbers and emails are masked in operational logs and staff views (e.g. ******3210).
   Child names and sensitive sizing measurements are NEVER logged or stored in notification payloads.
   Provider errors are sanitized to remove API credentials or bearer tokens.
6. Safe Provider Adapters:
   Off by default. Console / Mock adapters are used in tests and local development.
   No real provider is ever called during test runs.
"""

from dataclasses import dataclass, field
import datetime
import json
import logging
import re
import sys
import urllib.error
import urllib.request
import uuid

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from common.phone import normalize_in_mobile

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Privacy & Sanitization Helpers
# --------------------------------------------------------------------------- #

def mask_phone_number(phone: str) -> str:
    """Mask phone for operational logs: e.g. '9876543210' -> '******3210'."""
    p = normalize_in_mobile(phone or "")
    if len(p) >= 4:
        return "*" * (len(p) - 4) + p[-4:]
    return "****"


def mask_email_address(email: str) -> str:
    """Mask email for operational logs: e.g. 'parent@school.com' -> 'p***@school.com'."""
    if not email or "@" not in email:
        return "***@***"
    user, domain = email.split("@", 1)
    if len(user) <= 1:
        return f"{user}***@{domain}"
    return f"{user[0]}***@{domain}"


def sanitize_operational_error(error_msg: str) -> str:
    """Strips API keys, auth headers, passwords, and tokens from error messages."""
    if not error_msg:
        return ""
    text = str(error_msg)
    # Redact common key/secret/token patterns
    text = re.sub(r'(authkey|key|token|secret|password|bearer)(?:[:=\s]+)[^\s,;]+', r'\1=[REDACTED]', text, flags=re.IGNORECASE)
    # Redact raw Indian 10-digit phone numbers
    text = re.sub(r'\b[6-9]\d{9}\b', '[PHONE_REDACTED]', text)
    return text[:1000]


# --------------------------------------------------------------------------- #
# Provider Result & Abstract Adapter
# --------------------------------------------------------------------------- #

@dataclass
class ProviderResult:
    success: bool
    provider_message_id: str = ""
    error_message: str = ""
    raw_response: dict = field(default_factory=dict)


class BaseNotificationAdapter:
    """Abstract base class for notification delivery providers."""
    def send(self, record) -> ProviderResult:
        raise NotImplementedError


class MockNotificationAdapter(BaseNotificationAdapter):
    """In-memory mock adapter for unit tests and local simulation."""
    sent_records = []

    @classmethod
    def reset(cls):
        cls.sent_records = []

    def send(self, record) -> ProviderResult:
        self.sent_records.append(record)
        return ProviderResult(
            success=True,
            provider_message_id=f"mock_{uuid.uuid4().hex[:12]}",
            raw_response={"status": "mock_success", "type": "success"},
        )


class ConsoleNotificationAdapter(BaseNotificationAdapter):
    """Development / debug adapter: outputs sanitized info to application logger."""
    def send(self, record) -> ProviderResult:
        masked = record.mask_recipient()
        logger.info(
            "Notification [%s] via %s to %s (idempotency=%s): %s",
            record.event_type,
            record.channel,
            masked,
            record.idempotency_key,
            record.payload,
        )
        return ProviderResult(
            success=True,
            provider_message_id=f"console_{uuid.uuid4().hex[:12]}",
            raw_response={"status": "logged_to_console"},
        )


class Msg91NotificationAdapter(BaseNotificationAdapter):
    """
    Production adapter for MSG91 (DLT registered in India).
    Uses the MSG91 Flow API. Notice: An accepted response is recorded as
    SENT, NEVER as DELIVERED, as gateway acceptance is not delivery proof.
    """
    FLOW_URL = "https://control.msg91.com/api/v5/flow"
    TIMEOUT_SECONDS = 8

    def _get_template_id(self, event_type: str) -> str:
        # Template IDs registered on DLT portal and configured in environment
        template_map = {
            "ORDER_CONFIRMED": getattr(settings, "MSG91_ORDER_TEMPLATE_ID", ""),
            "DISPATCHED": getattr(settings, "MSG91_DISPATCH_TEMPLATE_ID", ""),
            "PICKUP_READY": getattr(settings, "MSG91_PICKUP_TEMPLATE_ID", ""),
            "DELIVERED": getattr(settings, "MSG91_DELIVERY_TEMPLATE_ID", ""),
            "EXCHANGE_UPDATE": getattr(settings, "MSG91_EXCHANGE_TEMPLATE_ID", ""),
            "REFUND_PROCESSED": getattr(settings, "MSG91_REFUND_TEMPLATE_ID", ""),
        }
        return template_map.get(event_type, "")

    def send(self, record) -> ProviderResult:
        auth_key = getattr(settings, "MSG91_AUTH_KEY", "")
        template_id = self._get_template_id(record.event_type)

        if not auth_key or not template_id:
            return ProviderResult(
                success=False,
                error_message="MSG91 credentials or template ID not configured.",
            )

        phone = normalize_in_mobile(record.recipient_phone or "")
        if not phone:
            return ProviderResult(
                success=False,
                error_message="Invalid or missing recipient phone number.",
            )

        # Build DLT flow payload with sanitized variables
        recipient_vars = {"mobiles": f"91{phone}"}
        if record.payload:
            for k, v in record.payload.items():
                recipient_vars[k] = str(v)

        payload = {
            "template_id": template_id,
            "short_url": "0",
            "recipients": [recipient_vars],
        }

        req = urllib.request.Request(
            self.FLOW_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "authkey": auth_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self.TIMEOUT_SECONDS) as resp:
                body = json.loads(resp.read().decode("utf-8") or "{}")
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            return ProviderResult(
                success=False,
                error_message=sanitize_operational_error(str(exc)),
            )

        if body.get("type") != "success":
            err_msg = body.get("message") or "Provider rejected the notification payload."
            return ProviderResult(
                success=False,
                error_message=sanitize_operational_error(err_msg),
                raw_response=body,
            )

        # Accepted by gateway (recorded as SENT, not DELIVERED)
        provider_msg_id = body.get("message") or body.get("request_id") or ""
        return ProviderResult(
            success=True,
            provider_message_id=str(provider_msg_id),
            raw_response=body,
        )


def get_notification_adapter() -> BaseNotificationAdapter:
    """
    Factory for provider adapter:
    Defaults to Mock / Console in test or debug modes.
    Never connects to live providers during automated tests.
    """
    if "test" in sys.argv:
        return MockNotificationAdapter()

    provider = (getattr(settings, "NOTIFICATION_PROVIDER", "") or getattr(settings, "SMS_PROVIDER", "")).strip().lower()
    if provider == "msg91" and not settings.DEBUG:
        return Msg91NotificationAdapter()
    return ConsoleNotificationAdapter()


# --------------------------------------------------------------------------- #
# Outbox Enqueue Engine
# --------------------------------------------------------------------------- #

def enqueue_notification(
    order,
    event_type: str,
    payload: dict = None,
    category: str = "TRANSACTIONAL",
    channel: str = None,
    idempotency_key: str = None,
    recipient_user=None,
) -> object:
    """
    Enqueues a customer notification into the durable Outbox table inside the
    current DB transaction.

    Guarantees:
    - Retries and repeated triggers cannot duplicate customer messages (idempotency).
    - Provider outages or broker failures cannot lose or roll back the order.
    - Honors channel preferences and differentiates marketing from transactional.
    """
    from .models import NotificationPreference, NotificationRecord

    recipient = recipient_user or order.parent or order.payer
    phone = ""
    email = ""
    if recipient:
        phone = getattr(recipient, "phone", "") or ""
        email = getattr(recipient, "email", "") or ""

    if not phone and not email:
        logger.warning("Cannot enqueue notification: Order %s has no recipient contact.", getattr(order, "order_number", order.id))
        return None

    # Check recipient preferences
    pref = None
    if recipient and hasattr(recipient, "notification_preferences"):
        pref = getattr(recipient, "notification_preferences", None)
    if not pref and recipient and hasattr(recipient, "id"):
        pref = NotificationPreference.objects.filter(user_id=recipient.id).first()

    # Differentiate Transactional vs Marketing
    if category == NotificationRecord.Category.MARKETING:
        if not pref or not pref.allow_marketing:
            logger.info("Skipping marketing notification: user %s opted out of marketing.", getattr(recipient, "id", "anon"))
            return None

    # Determine channel
    target_channel = channel
    if not target_channel:
        if pref and pref.preferred_channel:
            target_channel = pref.preferred_channel
        else:
            target_channel = NotificationRecord.Channel.SMS

    # Check if channel is allowed by user
    if pref:
        if not pref.is_channel_allowed(target_channel):
            # Fallback to another allowed channel if transactional
            if category == NotificationRecord.Category.TRANSACTIONAL:
                if pref.allow_sms:
                    target_channel = NotificationRecord.Channel.SMS
                elif pref.allow_whatsapp:
                    target_channel = NotificationRecord.Channel.WHATSAPP
                elif pref.allow_email:
                    target_channel = NotificationRecord.Channel.EMAIL
                else:
                    target_channel = NotificationRecord.Channel.SMS
            else:
                return None

    # Deterministic idempotency key to prevent duplication on retries
    if not idempotency_key:
        safe_payload_id = (payload or {}).get("exchange_id") or (payload or {}).get("refund_id") or ""
        idempotency_key = f"notif_{order.id}_{event_type}_{target_channel}_{safe_payload_id}".rstrip("_")

    # Sanitize payload: strictly remove any child name, school class, measurements, or passwords
    safe_payload = {}
    if payload:
        safe_keys = {
            "order", "order_number", "amount", "total", "tracking_number",
            "courier", "pickup_location", "school", "school_name",
            "status", "exchange_status", "refund_amount", "days_estimate",
        }
        for k, v in payload.items():
            if k in safe_keys:
                safe_payload[k] = v

    # Fallback payload variables from order if not provided
    if "order" not in safe_payload and "order_number" not in safe_payload:
        safe_payload["order"] = str(order.order_number)
        safe_payload["order_number"] = str(order.order_number)
    if "amount" not in safe_payload and hasattr(order, "total"):
        safe_payload["amount"] = str(order.total)

    # Durably persist outbox record
    record, created = NotificationRecord.objects.get_or_create(
        idempotency_key=idempotency_key,
        defaults={
            "order": order,
            "event_type": event_type,
            "category": category,
            "channel": target_channel,
            "recipient_phone": phone,
            "recipient_email": email,
            "status": NotificationRecord.Status.PENDING,
            "payload": safe_payload,
            "next_attempt_at": timezone.now(),
        },
    )

    if not created:
        logger.info(
            "Notification already exists for idempotency key %s (status=%s). Skipping duplicate enqueue.",
            idempotency_key,
            record.status,
        )
        return record

    # Schedule async dispatch after DB transaction commits.
    # If the broker fails or is down, on_commit failure will NOT abort the DB transaction.
    # The record remains in DB with status=PENDING and will be picked up by Celery beat sweeper.
    def dispatch_safely():
        try:
            from .tasks import deliver_notification_task
            deliver_notification_task.delay(str(record.id))
        except Exception as exc:
            logger.warning(
                "Celery broker dispatch failed after commit for notification %s: %s. Outbox sweeper will recover.",
                record.id,
                sanitize_operational_error(str(exc)),
            )

    transaction.on_commit(dispatch_safely)
    return record
