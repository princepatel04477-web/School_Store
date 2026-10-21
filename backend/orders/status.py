"""
Order status changes (Prompt 6 requirement 7, Prompt 9 requirements 3 and 4).

One code path for the single-order PATCH and the bulk endpoint:
  - only legal transitions are applied (a cancelled order is never revived),
  - one bulk UPDATE + one bulk_create of OrderStatusEvent rows,
  - cancelling returns the order's stock through atomic F() updates and
    ORDER_CANCELLED StockMovement rows, inside the same transaction (Rule P6).
"""

from collections import defaultdict

from django.db import transaction
from django.db.models import F
from django.db.models.functions import Now

from inventory.models import StockBalance, StockMovement

from .models import Order, OrderItem, OrderStatusEvent

S = Order.Status

_BEFORE_DISPATCH = (S.CONFIRMED, S.PROCESSING, S.PACKED, S.CANCELLED)

# from-status -> statuses it may move to. CANCELLED, RETURNED and REFUNDED are final.
ALLOWED_TRANSITIONS = {
    S.PLACED: _BEFORE_DISPATCH,
    S.PENDING: _BEFORE_DISPATCH,
    S.CONFIRMED: (S.PROCESSING, S.PACKED, S.CANCELLED),
    S.PROCESSING: (S.PACKED, S.CANCELLED),
    S.PACKED: (S.DISPATCHED, S.CANCELLED),
    S.DISPATCHED: (S.DELIVERED, S.RETURNED),
    S.SHIPPED: (S.DELIVERED, S.RETURNED),
    S.DELIVERED: (S.RETURNED,),
}


def allowed_from(new_status) -> list[str]:
    """Every status an order may be in to move to `new_status`."""
    return [old for old, targets in ALLOWED_TRANSITIONS.items() if new_status in targets]


def _restock(order_ids, user) -> None:
    """Return the stock of cancelled orders, one F() update per (city, variant)."""
    items = OrderItem.objects.filter(order_id__in=order_ids).values_list(
        "order_id", "order__city_id", "order__school_id", "variant_id", "quantity"
    )
    totals = defaultdict(int)
    movements = []
    for order_id, city_id, school_id, variant_id, quantity in items:
        totals[(city_id, variant_id)] += quantity
        movements.append(
            StockMovement(
                variant_id=variant_id,
                city_id=city_id,
                school_id=school_id,
                quantity_change=quantity,
                reason=StockMovement.Reason.ORDER_CANCELLED,
                reference_order_id=order_id,
                created_by_id=user.id,
            )
        )
    # Same lock order as checkout (sorted), so the two can never deadlock.
    for (city_id, variant_id), quantity in sorted(totals.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        StockBalance.objects.filter(city_id=city_id, variant_id=variant_id).update(
            stock_quantity=F("stock_quantity") + quantity, updated_at=Now()
        )
    StockMovement.objects.bulk_create(movements)


def record_payment(queryset, *, payment_id, signature="", changed_by=None, note="") -> bool:
    """Mark one order paid. Idempotent: the browser and the webhook both call it.

    A payment that lands after the 15-minute reservation was released must not
    revive the order: its stock has already gone back on sale. The money is
    recorded and the order stays cancelled, flagged for a refund.
    """
    from common.audit import log_audit_event
    from common.models import AuditLog

    from .tasks import refresh_order_summary

    with transaction.atomic():
        order = queryset.select_for_update().first()
        if order is None or order.payment_status == Order.PaymentStatus.PAID:
            return False

        order.payment_status = Order.PaymentStatus.PAID
        order.razorpay_payment_id = payment_id
        fields = ["payment_status", "razorpay_payment_id", "updated_at"]
        if signature:
            order.razorpay_signature = signature
            fields.append("razorpay_signature")
        if order.status in (S.PLACED, S.PENDING):
            order.status = S.CONFIRMED
            fields.append("status")
        elif order.status == S.CANCELLED:
            note = "Payment received after the order was cancelled. Refund needed."
            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="Order",
                target_id=order.id,
                actor=changed_by,
                details={"refund_needed": True, "razorpay_payment_id": payment_id},
            )
        order.save(update_fields=fields)
        OrderStatusEvent.objects.create(
            order=order,
            status=order.status,
            changed_by_id=getattr(changed_by, "id", None),
            note=note,
        )
        transaction.on_commit(lambda: refresh_order_summary.delay(str(order.id)))
    return True


def change_order_status(queryset, new_status, user, note="") -> list:
    """Move every order in `queryset` that may legally reach `new_status`.

    `queryset` must already be scoped to the user. Returns the ids changed;
    orders whose current status does not allow the move are left untouched.
    """
    from common.audit import log_audit_event
    from common.models import AuditLog

    from .tasks import refresh_order_summary

    with transaction.atomic():
        changed = list(
            queryset.select_for_update()
            .filter(status__in=allowed_from(new_status))
            .order_by("id")
            .values_list("id", "status")
        )
        if not changed:
            return []
        ids = [order_id for order_id, _ in changed]

        Order.objects.filter(id__in=ids).update(status=new_status, updated_at=Now())
        OrderStatusEvent.objects.bulk_create(
            [
                OrderStatusEvent(
                    order_id=order_id,
                    status=new_status,
                    changed_by_id=user.id,
                    note=note or f"Status updated from {old} to {new_status}",
                )
                for order_id, old in changed
            ]
        )
        if new_status == S.CANCELLED:
            _restock(ids, user)

        for order_id, old in changed:
            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="Order",
                target_id=order_id,
                actor=user,
                details={"old_status": old, "new_status": new_status, "note": note},
            )
        for order_id in ids:
            transaction.on_commit(lambda o=order_id: refresh_order_summary.delay(str(o)))
    return ids
