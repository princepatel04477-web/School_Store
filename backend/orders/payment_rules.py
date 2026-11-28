"""
Payment rules for order fulfilment packing decisions (Rule 5).

Built ONLY from main's existing rules (can_transition_order, payment_view, PaymentReview).
Never calls the payment provider. Runs under the caller's row lock.
"""

from .fulfilment_gate import PackingDecision
from .models import Order
from .payment_view import payment_view
from .status import can_transition_order


def packing_decision(order: Order) -> PackingDecision:
    """Return whether the order is eligible for packing based on payment state.

    Conservative rule:
    - Cancelled orders are blocked.
    - Orders with open payment reviews are blocked.
    - ONLINE orders are allowed only when verified PAID with no refund due.
    - CHECKING, NOT_PAID, RELEASED, REFUND_DUE are blocked with machine reason.
    - COD (COD_DUE) is allowed.
    - PAID_DO_NOT_COLLECT is allowed with a message saying not to collect cash.
    """
    if order.status == Order.Status.CANCELLED:
        return PackingDecision(
            allowed=False,
            reason="ORDER_CANCELLED",
            message="Order is cancelled.",
        )

    # Check for any open payment review items
    if order.payment_reviews.filter(resolved_at__isnull=True).exists():
        return PackingDecision(
            allowed=False,
            reason="OPEN_PAYMENT_REVIEW",
            message=f"Order {order.order_number} has an open review item and cannot be packed.",
        )

    # Reuse main's payment_view state determination
    view = payment_view(order)
    state = view.get("state")

    if state == "PAID":
        # Extra check: online order status must be legally allowed to pack
        if order.payment_method == Order.PaymentMethod.ONLINE:
            if order.payment_status != Order.PaymentStatus.PAID:
                return PackingDecision(
                    allowed=False,
                    reason="PAYMENT_NOT_PAID",
                    message="Online payment is not verified as paid.",
                )
        return PackingDecision(
            allowed=True,
            reason=None,
            message="Payment verified online.",
        )

    if state == "PAID_DO_NOT_COLLECT":
        return PackingDecision(
            allowed=True,
            reason=None,
            message="Order is prepaid. Do not collect cash.",
        )

    if state == "COD_DUE":
        return PackingDecision(
            allowed=True,
            reason=None,
            message="Cash on delivery: collect cash at delivery.",
        )

    if state == "CHECKING":
        return PackingDecision(
            allowed=False,
            reason="PAYMENT_CHECKING",
            message="Payment verification is still in progress.",
        )

    if state == "NOT_PAID":
        return PackingDecision(
            allowed=False,
            reason="PAYMENT_NOT_PAID",
            message="Order has not been paid.",
        )

    if state == "RELEASED":
        return PackingDecision(
            allowed=False,
            reason="PAYMENT_RELEASED",
            message="Order reservation was released because payment expired.",
        )

    if state == "REFUND_DUE":
        return PackingDecision(
            allowed=False,
            reason="PAYMENT_REFUND_DUE",
            message="Order is cancelled and a refund is due.",
        )

    # Fallback to can_transition_order if state is unknown
    can_move, reason = can_transition_order(order, Order.Status.PACKED)
    if can_move:
        return PackingDecision(
            allowed=True,
            reason=None,
            message="Packing allowed.",
        )
    return PackingDecision(
        allowed=False,
        reason="CANNOT_TRANSITION",
        message=reason or "Order cannot be transitioned to packed.",
    )
