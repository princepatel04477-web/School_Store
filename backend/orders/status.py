"""
Order status changes and payment state management (Sections 2, 3, 5).

One code path for payment processing and status transitions:
  - apply_provider_payment is the single entry point for all gateway payment updates.
  - change_order_status enforces legal transitions and the ONLINE packing rule.
  - cancelling returns the order's stock through atomic F() updates and
    ORDER_CANCELLED StockMovement rows, inside the same transaction.
"""

from collections import defaultdict
from decimal import Decimal
from datetime import datetime, timezone as utc_timezone

from django.utils import timezone
from django.db import IntegrityError, transaction
from django.db.models import F
from django.db.models.functions import Now

from inventory.models import StockBalance, StockMovement

from .models import Order, OrderItem, OrderStatusEvent, PaymentAttempt, PaymentReview
from .payment_rules import packing_decision

S = Order.Status

_BEFORE_DISPATCH = (S.CONFIRMED, S.PROCESSING, S.PACKED, S.CANCELLED)

# from-status -> statuses it may move to. CANCELLED, RETURNED and REFUNDED are final.
ALLOWED_TRANSITIONS = {
    S.PLACED: _BEFORE_DISPATCH,
    S.PENDING: _BEFORE_DISPATCH,
    S.CONFIRMED: (S.PROCESSING, S.PACKED, S.CANCELLED),
    S.PROCESSING: (S.PACKED, S.CANCELLED),
    S.PACKED: (S.DISPATCHED, S.DELIVERED, S.CANCELLED),
    S.DISPATCHED: (S.DELIVERED, S.RETURNED),
    S.SHIPPED: (S.DELIVERED, S.RETURNED),
    S.DELIVERED: (S.RETURNED,),
}

PACKING_STATUSES = (S.CONFIRMED, S.PROCESSING, S.PACKED, S.DISPATCHED, S.DELIVERED)


def allowed_from(new_status) -> list[str]:
    """Every status an order may be in to move to `new_status`."""
    return [old for old, targets in ALLOWED_TRANSITIONS.items() if new_status in targets]


def can_transition_order(order: Order, new_status: str) -> tuple[bool, str]:
    """
    Check whether an order can transition to new_status.
    Enforces ALLOWED_TRANSITIONS and the ONLINE packing rule (Section 5).
    """
    if new_status not in ALLOWED_TRANSITIONS.get(order.status, ()):
        return False, f"An order that is {order.status} cannot move to {new_status}."

    if order.status == S.PACKED and new_status == S.DELIVERED and (
        order.fulfillment_type != Order.FulfillmentType.SCHOOL_PICKUP
    ):
        return False, "Home delivery orders must be dispatched first."

    if new_status in PACKING_STATUSES:
        decision = packing_decision(order)
        if decision.reason_code == "PAYMENT_NOT_PAID":
            return False, f"Online orders must be PAID before moving to {new_status} (currently {order.payment_status})."
        if decision.reason_code == "PAYMENT_REFUNDED":
            return False, "A refunded order cannot move through fulfilment."
        if not decision.allowed:
            return False, f"Order {order.order_number} has an open review item and cannot move to {new_status}."

    return True, ""


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
                created_by_id=getattr(user, "id", None),
            )
        )
    for (city_id, variant_id), quantity in sorted(totals.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        StockBalance.objects.filter(city_id=city_id, variant_id=variant_id).update(
            stock_quantity=F("stock_quantity") + quantity, updated_at=Now()
        )
    StockMovement.objects.bulk_create(movements)


def apply_provider_payment(
    order_or_id,
    payment_entity: dict = None,
    source: str = PaymentAttempt.Source.WEBHOOK,
    changed_by=None,
    **kwargs,
) -> PaymentAttempt:
    """
    Single source of truth for payment state (Section 3).
    Locks the order row (select_for_update), upserts the PaymentAttempt,
    and re-derives order.payment_status and order.status under strict financial rules.
    """
    from common.audit import log_audit_event
    from common.models import AuditLog
    from .tasks import refresh_order_summary

    if payment_entity is None:
        payment_entity = {}
    elif not isinstance(payment_entity, dict):
        payment_entity = {"id": str(payment_entity)}

    payment_id = kwargs.get("payment_id") or kwargs.get("razorpay_payment_id") or payment_entity.get("id", "")
    p_order_id = kwargs.get("order_id") or kwargs.get("razorpay_order_id") or payment_entity.get("order_id", "")
    p_status_raw = (kwargs.get("status") or payment_entity.get("status") or "").lower()
    p_amount = int(kwargs.get("amount") or kwargs.get("amount_paise") or payment_entity.get("amount") or 0)
    p_currency = kwargs.get("currency") or payment_entity.get("currency") or "INR"
    p_method = kwargs.get("method") or payment_entity.get("method") or ""
    error_code = kwargs.get("error_code") or payment_entity.get("error_code") or ""
    error_reason = kwargs.get("error_reason") or payment_entity.get("error_description") or payment_entity.get("error_reason") or ""
    source = kwargs.get("source") or source

    status_map = {
        "captured": PaymentAttempt.Status.CAPTURED,
        "authorized": PaymentAttempt.Status.AUTHORIZED,
        "failed": PaymentAttempt.Status.FAILED,
        "refunded": PaymentAttempt.Status.REFUNDED,
    }
    new_attempt_status = status_map.get(p_status_raw, PaymentAttempt.Status.CREATED)

    order_pk = order_or_id.pk if isinstance(order_or_id, Order) else order_or_id

    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_pk)
        if not payment_id:
            return None
        if p_order_id and p_order_id != order.razorpay_order_id:
            PaymentReview.objects.get_or_create(
                order=order, reason=PaymentReview.Reason.AMOUNT_MISMATCH, payment_id=payment_id,
            )
            return None
        if not p_order_id:
            p_order_id = order.razorpay_order_id or ""

        # 1. Upsert attempt by payment id
        attempt = PaymentAttempt.objects.select_for_update().filter(razorpay_payment_id=payment_id).first()
        if attempt:
            if attempt.order_id != order.id:
                PaymentReview.objects.get_or_create(
                    order=order,
                    reason=PaymentReview.Reason.AMOUNT_MISMATCH,
                    payment_id=payment_id,
                    defaults={"notes": f"Payment ID {payment_id} already attached to order {attempt.order_id}"},
                )
                return attempt
            # A captured attempt never goes back. CAPTURED can change only to REFUNDED.
            if attempt.status == PaymentAttempt.Status.CAPTURED and new_attempt_status != PaymentAttempt.Status.REFUNDED:
                # Do not downgrade captured attempt
                pass
            else:
                attempt.status = new_attempt_status
                attempt.method = p_method or attempt.method
                attempt.amount_paise = p_amount
                attempt.currency = p_currency
                attempt.error_code = error_code
                attempt.error_reason = error_reason
                attempt.last_source = source
                attempt.save()
        else:
            first_seen = timezone.now()
            provider_created_at = payment_entity.get("created_at")
            if isinstance(provider_created_at, (int, float)):
                try:
                    first_seen = min(first_seen, datetime.fromtimestamp(provider_created_at, utc_timezone.utc))
                except (OverflowError, OSError, ValueError):
                    pass
            attempt = PaymentAttempt.objects.create(
                order=order,
                razorpay_payment_id=payment_id,
                status=new_attempt_status,
                method=p_method,
                amount_paise=p_amount,
                currency=p_currency,
                error_code=error_code,
                error_reason=error_reason,
                last_source=source,
                first_seen_at=first_seen,
            )

        # 2. Check matching criteria
        order_total_paise = int(Decimal(order.total) * 100)
        is_matching = (
            p_order_id == order.razorpay_order_id
            and p_amount == order_total_paise
            and p_currency == "INR"
        )

        if not is_matching:
            if (
                p_amount != order_total_paise
                or p_currency != "INR"
                or (p_order_id and p_order_id != order.razorpay_order_id)
            ):
                PaymentReview.objects.get_or_create(
                    order=order,
                    reason=PaymentReview.Reason.AMOUNT_MISMATCH,
                    payment_id=payment_id,
                )

        # 3. State update
        if order.payment_status == Order.PaymentStatus.PAID:
            # Nothing ever moves an order from PAID to a lower state.
            if (
                is_matching
                and attempt.status == PaymentAttempt.Status.CAPTURED
                and order.razorpay_payment_id
                and order.razorpay_payment_id != payment_id
            ):
                PaymentReview.objects.get_or_create(
                    order=order,
                    reason=PaymentReview.Reason.DUPLICATE_PAYMENT,
                    payment_id=payment_id,
                )
        else:
            # Order is not currently PAID
            if is_matching and attempt.status == PaymentAttempt.Status.CAPTURED:
                order.payment_status = Order.PaymentStatus.PAID
                order.razorpay_payment_id = payment_id
                fields_to_update = ["payment_status", "razorpay_payment_id", "updated_at"]

                if order.status == Order.Status.CANCELLED:
                    order.save(update_fields=fields_to_update)
                    PaymentReview.objects.get_or_create(
                        order=order,
                        reason=PaymentReview.Reason.REFUND_AFTER_RELEASE,
                        payment_id=payment_id,
                    )
                    OrderStatusEvent.objects.create(
                        order=order,
                        status=Order.Status.CANCELLED,
                        changed_by=changed_by,
                        note="Payment received after the order was cancelled. Refund needed.",
                    )
                    log_audit_event(
                        action=AuditLog.Action.ORDER_STATUS_CHANGED,
                        target_type="Order",
                        target_id=order.id,
                        actor=changed_by,
                        details={"refund_needed": True, "razorpay_payment_id": payment_id},
                    )
                elif order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
                    order.save(update_fields=fields_to_update)
                    PaymentReview.objects.get_or_create(
                        order=order,
                        reason=PaymentReview.Reason.PAID_AFTER_COD_SWITCH,
                        payment_id=payment_id,
                        defaults={"notes": "paid online, do not collect cash"},
                    )
                    OrderStatusEvent.objects.create(
                        order=order,
                        status=order.status,
                        changed_by=changed_by,
                        note="Online payment received for COD order. Do not collect cash.",
                    )
                elif order.status in (S.PLACED, S.PENDING):
                    order.status = S.CONFIRMED
                    fields_to_update.append("status")
                    order.save(update_fields=fields_to_update)
                    OrderStatusEvent.objects.create(
                        order=order,
                        status=Order.Status.CONFIRMED,
                        changed_by=changed_by,
                        note="Payment received.",
                    )
                    transaction.on_commit(lambda o=order.id: refresh_order_summary.delay(str(o)))
                else:
                    order.save(update_fields=fields_to_update)
                    OrderStatusEvent.objects.create(
                        order=order,
                        status=order.status,
                        changed_by=changed_by,
                        note="Payment received.",
                    )
                    transaction.on_commit(lambda o=order.id: refresh_order_summary.delay(str(o)))
            else:
                has_authorized = order.payment_attempts.filter(
                    status=PaymentAttempt.Status.AUTHORIZED
                ).exists()
                if has_authorized:
                    order.payment_status = Order.PaymentStatus.AUTHORIZED
                else:
                    order.payment_status = Order.PaymentStatus.PENDING
                order.save(update_fields=["payment_status", "updated_at"])

        return attempt


def record_payment(queryset, *, payment_id, signature="", changed_by=None, note="") -> bool:
    """Mark one order paid. Kept for backwards compatibility, delegates to apply_provider_payment."""
    order = queryset.first()
    if order is None:
        return False

    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if signature:
            order.razorpay_signature = signature
            order.save(update_fields=["razorpay_signature", "updated_at"])

        payment_entity = {
            "id": payment_id,
            "order_id": order.razorpay_order_id,
            "amount": int(Decimal(order.total) * 100),
            "currency": "INR",
            "status": "captured",
        }
        apply_provider_payment(order, payment_entity, PaymentAttempt.Source.VERIFY, changed_by=changed_by)
    return True


def change_order_status(queryset, new_status, user, note="") -> list:
    """
    Move every order in `queryset` that may legally reach `new_status`.
    Enforces the packing rule: unpaid ONLINE orders or orders with open review items are blocked.
    Returns the list of order IDs changed.
    """
    from common.audit import log_audit_event
    from common.models import AuditLog
    from .tasks import refresh_order_summary

    with transaction.atomic():
        candidate_ids = list(
            queryset.filter(status__in=allowed_from(new_status)).values_list("id", flat=True)
        )
        if not candidate_ids:
            return []

        candidate_orders = list(
            Order.objects.filter(id__in=candidate_ids)
            .select_for_update()
            .prefetch_related("payment_reviews")
            .order_by("id")
        )

        allowed_orders = []
        for ord_obj in candidate_orders:
            can_move, _ = can_transition_order(ord_obj, new_status)
            if can_move:
                allowed_orders.append(ord_obj)

        if not allowed_orders:
            return []

        ids = [o.id for o in allowed_orders]
        old_statuses = {o.id: o.status for o in allowed_orders}

        Order.objects.filter(id__in=ids).update(status=new_status, updated_at=Now())

        OrderStatusEvent.objects.bulk_create(
            [
                OrderStatusEvent(
                    order_id=order_id,
                    status=new_status,
                    changed_by_id=getattr(user, "id", None),
                    note=note or f"Status updated from {old_statuses[order_id]} to {new_status}",
                )
                for order_id in ids
            ]
        )

        if new_status == S.CANCELLED:
            _restock(ids, user)

        for o in allowed_orders:
            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="Order",
                target_id=o.id,
                actor=user,
                details={"old_status": old_statuses[o.id], "new_status": new_status, "note": note},
            )

        for order_id in ids:
            transaction.on_commit(lambda oid=order_id: refresh_order_summary.delay(str(oid)))

    return ids
