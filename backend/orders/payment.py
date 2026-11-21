import hashlib
import hmac
import json
from decimal import Decimal
from django.conf import settings


class RazorpayGateway:
    """Single gateway boundary; swap this class without changing order code."""
    def __init__(self):
        self.key_id = getattr(settings, "RAZORPAY_KEY_ID", "")
        self.secret = getattr(settings, "RAZORPAY_KEY_SECRET", "")
        self.webhook_secret = getattr(settings, "RAZORPAY_WEBHOOK_SECRET", "")

    def is_usable(self) -> bool:
        """ONLINE payment is available only when gateway credentials and SDK are available."""
        if not (self.key_id and self.secret and (self.webhook_secret or settings.DEBUG)):
            return False
        try:
            import razorpay  # noqa: F401
            return True
        except Exception:
            return False

    def create_order(self, order):
        if not self.key_id or not self.secret:
            return {"id": f"local_{order.id}", "amount": int(order.total * 100), "currency": "INR"}
        import requests
        resp = requests.post(
            "https://api.razorpay.com/v1/orders",
            auth=(self.key_id, self.secret),
            json={
                "amount": int(Decimal(order.total) * 100),
                "currency": "INR",
                "receipt": order.order_number,
                "notes": {"store_order_id": str(order.id)},
            },
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()

    def fetch_payment(self, payment_id: str) -> dict:
        """Fetch payment entity from Razorpay (5s timeout)."""
        if not (self.key_id and self.secret):
            return {
                "id": payment_id,
                "status": "captured",
                "amount": 0,
                "currency": "INR",
                "method": "test",
            }
        import requests
        resp = requests.get(
            f"https://api.razorpay.com/v1/payments/{payment_id}",
            auth=(self.key_id, self.secret),
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()

    def fetch_order_payments(self, razorpay_order_id: str) -> list[dict]:
        """Fetch all payments for a Razorpay order from Razorpay (5s timeout)."""
        if not razorpay_order_id or not (self.key_id and self.secret):
            return []
        import requests
        resp = requests.get(
            f"https://api.razorpay.com/v1/orders/{razorpay_order_id}/payments",
            auth=(self.key_id, self.secret),
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("items", []) if isinstance(data, dict) else []

    def create_refund(self, payment_id: str, amount_paise: int, receipt: str = "", notes: dict = None) -> dict:
        """
        Initiate an idempotent refund through Razorpay (5s timeout).
        When gateway credentials are not configured (e.g. test environments),
        returns a simulated processed refund entity.
        """
        if not payment_id:
            raise ValueError("Payment ID is required to process refund.")
        if amount_paise <= 0:
            raise ValueError("Refund amount must be positive.")

        if not self._has_real_keys():
            # Never pretend money went back in production: without keys a
            # refund fails unless simulation is explicitly on (local dev/tests).
            if not getattr(settings, "RAZORPAY_SIMULATE_REFUNDS", False):
                raise RuntimeError("Razorpay is not configured; the refund was not sent.")
            import uuid
            from django.utils import timezone
            return {
                "id": f"rfnd_sim_{uuid.uuid4().hex[:14]}",
                "payment_id": payment_id,
                "amount": amount_paise,
                "currency": "INR",
                "status": "processed",
                "receipt": receipt or "",
                "notes": notes or {},
                "created_at": int(timezone.now().timestamp()),
            }

        import requests
        payload = {
            "amount": amount_paise,
            "speed": "normal",
            "notes": notes or {},
        }
        if receipt:
            payload["receipt"] = receipt

        resp = requests.post(
            f"https://api.razorpay.com/v1/payments/{payment_id}/refund",
            auth=(self.key_id, self.secret),
            json=payload,
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json()

    def find_refund_by_note(self, payment_id: str, refund_id: str) -> dict | None:
        """Return the Razorpay refund for this payment tagged with our refund id, if one exists.

        Used before retrying a refund whose first attempt failed or timed out, so a
        retry never sends the money back twice.
        """
        if not self._has_real_keys() or not payment_id:
            return None
        import requests
        resp = requests.get(
            f"https://api.razorpay.com/v1/payments/{payment_id}/refunds",
            auth=(self.key_id, self.secret),
            params={"count": 100},
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items", []) if isinstance(data, dict) else []:
            notes = item.get("notes") or {}
            if isinstance(notes, dict) and str(notes.get("refund_id", "")) == str(refund_id):
                return item
        return None

    def _has_real_keys(self) -> bool:
        return bool(
            self.key_id and self.secret
            and "placeholder" not in str(self.key_id)
            and "placeholder" not in str(self.secret)
        )

    def _can_verify(self) -> bool:
        # Without a secret every HMAC is forgeable (the key is ""), so refuse
        # outright in production. Local development may run without keys.
        return bool(self.secret) or settings.DEBUG

    def verify_signature(self, order_id, payment_id, signature):
        if not self._can_verify():
            return False
        expected = hmac.new(self.secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook(self, payload, signature):
        secret = self.webhook_secret or (self.secret if settings.DEBUG else "")
        if not secret:
            return False
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)
