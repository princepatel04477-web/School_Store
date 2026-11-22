"""Payment eligibility shared by order transitions and staff fulfilment."""

from dataclasses import dataclass

from .models import Order


@dataclass(frozen=True)
class PackingDecision:
    allowed: bool
    reason_code: str = ""


def packing_decision(order: Order) -> PackingDecision:
    """Apply the payment recovery branch's eligibility policy."""
    if order.payment_status == Order.PaymentStatus.REFUNDED:
        return PackingDecision(False, "PAYMENT_REFUNDED")
    if order.payment_method == Order.PaymentMethod.ONLINE:
        if order.payment_status != Order.PaymentStatus.PAID:
            return PackingDecision(False, "PAYMENT_NOT_PAID")
        if order.payment_reviews.filter(resolved_at__isnull=True).exists():
            return PackingDecision(False, "PAYMENT_REVIEW_OPEN")
    return PackingDecision(True)
