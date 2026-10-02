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

    def create_order(self, order):
        if not self.key_id or not self.secret:
            return {"id": f"local_{order.id}", "amount": int(order.total * 100), "currency": "INR"}
        import razorpay
        return razorpay.Client(auth=(self.key_id, self.secret)).order.create({
            "amount": int(Decimal(order.total) * 100), "currency": "INR", "receipt": order.order_number,
        })

    def verify_signature(self, order_id, payment_id, signature):
        expected = hmac.new(self.secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook(self, payload, signature):
        expected = hmac.new(self.secret.encode(), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)
