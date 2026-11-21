from datetime import timedelta

from django.utils import timezone

from .models import Order, PaymentAttempt, PaymentReview
from .payment import RazorpayGateway


HOLD_DURATION = timedelta(minutes=15)
CREATED_GRACE = timedelta(minutes=15)
MINIMUM_HOLD = timedelta(minutes=2)
CHECK_FRESHNESS = timedelta(seconds=60)


def payment_view(order, now=None):
    now = now or timezone.now()
    online = order.payment_method == Order.PaymentMethod.ONLINE
    cancelled = order.status == Order.Status.CANCELLED
    amount = int(order.total * 100)
    hold = (order.hold_expires_at or order.created_at + HOLD_DURATION) if online else None
    attempts = list(order.payment_attempts.all())
    # The winning reference is set only when apply_provider_payment validates the provider order.
    capture = next((a for a in attempts if order.razorpay_payment_id
                    and a.razorpay_payment_id == order.razorpay_payment_id
                    and a.status == PaymentAttempt.Status.CAPTURED
                    and a.amount_paise == amount and a.currency == "INR"), None)
    failed = next((a for a in attempts if a.status == PaymentAttempt.Status.FAILED), None)
    in_progress = any(
        a.status == PaymentAttempt.Status.AUTHORIZED
        or (a.status == PaymentAttempt.Status.CREATED and a.first_seen_at > now - CREATED_GRACE)
        for a in attempts
    )
    unsettled = any(a.status in (PaymentAttempt.Status.CAPTURED, PaymentAttempt.Status.REFUNDED) for a in attempts)
    stale = not order.payment_checked_at or order.payment_checked_at < now - CHECK_FRESHNESS
    receipt = None
    if capture:
        receipt = {
            "order_number": order.order_number,
            "amount_paise": capture.amount_paise,
            "paid_at": capture.updated_at,
            "method": capture.method,
            "payment_ref_last4": capture.razorpay_payment_id[-4:],
        }
        state = "REFUND_DUE" if cancelled else "PAID" if online else "PAID_DO_NOT_COLLECT"
    elif not online:
        state = "COD_DUE"
    elif cancelled:
        state = "RELEASED" if order.cancel_reason == "PAYMENT_EXPIRED" else "NOT_PAID"
    elif (in_progress or unsettled or order.payment_check_ok is False
          or (order.razorpay_order_id and (stale or order.payment_check_ok is not True))
          or order.payment_status == Order.PaymentStatus.PAID or hold <= now):
        state = "CHECKING"
    else:
        state = "NOT_PAID"

    can_pay = state == "NOT_PAID" and not cancelled and hold >= now + MINIMUM_HOLD
    return {
        "state": state,
        "amount_due_paise": amount if state in ("COD_DUE", "CHECKING", "NOT_PAID") and not cancelled else 0,
        "amount_paid_paise": capture.amount_paise if capture else 0,
        "currency": "INR",
        "hold_expires_at": hold if not capture and not cancelled else None,
        "last_checked_at": order.payment_checked_at,
        "last_check_ok": order.payment_check_ok,
        "in_progress": in_progress,
        "last_failure_reason": (failed.error_reason or failed.error_code or None) if failed else None,
        "can_pay_now": can_pay,
        "can_switch_to_cod": can_pay,
        "can_refresh": state == "CHECKING",
        "receipt": receipt,
    }


def check_provider(order, source, user=None):
    """Reconcile under the caller's order row lock. Only gateway failures are recoverable."""
    from .status import apply_provider_payment

    if not order.razorpay_order_id:
        if order.payment_check_ok is False:
            order.payment_check_ok = None
            order.payment_checked_at = None
            order.payment_check_failed_since = None
            order.save(update_fields=["payment_check_ok", "payment_checked_at", "payment_check_failed_since", "updated_at"])
        return True
    try:
        payments = RazorpayGateway().fetch_order_payments(order.razorpay_order_id)
        if any(not isinstance(payment, dict) or not payment.get("id") for payment in payments):
            raise ValueError("Invalid payment provider response")
    except Exception:
        ok = False
    else:
        for payment in payments:
            apply_provider_payment(order, payment, source, changed_by=user)
        ok = True

    order.refresh_from_db()
    now = timezone.now()
    order.payment_check_ok = ok
    order.payment_checked_at = now
    order.payment_check_failed_since = None if ok else (order.payment_check_failed_since or now)
    order.save(update_fields=["payment_check_ok", "payment_checked_at", "payment_check_failed_since", "updated_at"])
    if ok and order.payment_attempts.filter(
        status=PaymentAttempt.Status.CREATED, first_seen_at__lte=now - CREATED_GRACE
    ).exists():
        PaymentReview.objects.get_or_create(order=order, reason=PaymentReview.Reason.RECONCILE_STUCK)
    return ok


def reconcile_order(order_id, user):
    from django.core.cache import cache
    from django.db import transaction

    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        checked = cache.add(f"rate_limit_reconcile_{order.id}", "1", timeout=5)
        if checked and (order.payment_method == Order.PaymentMethod.ONLINE or order.razorpay_order_id):
            checked = check_provider(order, PaymentAttempt.Source.RECONCILE, user)
        view = payment_view(order)
        if not checked and view["state"] == "NOT_PAID" and view["hold_expires_at"]:
            view.update(state="CHECKING", can_refresh=True, can_pay_now=False, can_switch_to_cod=False)
        return {"checked": checked, "retry_after_seconds": 5, "payment_view": view}
