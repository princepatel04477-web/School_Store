from datetime import timedelta

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from orders.models import Order, PaymentEvent, PaymentReview
from orders.payment_view import HOLD_DURATION, payment_view


def with_payment_events(qs):
    retries = PaymentEvent.objects.filter(
        razorpay_order_id=OuterRef("razorpay_order_id"), state=PaymentEvent.State.RETRY,
    ).exclude(razorpay_order_id="")
    return qs.annotate(payment_event_retry=Exists(retries))


def reconciliation_candidates(qs, now):
    open_reviews = PaymentReview.objects.filter(order_id=OuterRef("pk"), resolved_at__isnull=True)
    expired = Q(hold_expires_at__lte=now) | Q(hold_expires_at__isnull=True, created_at__lte=now - HOLD_DURATION)
    return qs.filter(
        Exists(open_reviews)
        | Q(payment_event_retry=True)
        | Q(payment_check_ok=False, payment_check_failed_since__lte=now - timedelta(minutes=10))
        | (Q(payment_method=Order.PaymentMethod.ONLINE) & ~Q(status=Order.Status.CANCELLED) & expired)
    )


def reconciliation_reasons(order, now=None):
    now = now or timezone.now()
    reasons = {review.reason for review in order.payment_reviews.all() if not review.resolved_at}
    view = payment_view(order, now)
    if view["state"] == "CHECKING" and view["hold_expires_at"] <= now:
        reasons.add("HOLD_EXPIRED")
    failed_since = order.payment_check_failed_since or order.payment_checked_at
    if view["last_check_ok"] is False and failed_since and failed_since <= now - timedelta(minutes=10):
        reasons.add("PROVIDER_UNREACHABLE")
    retry = getattr(order, "payment_event_retry", None)
    if retry is None and order.razorpay_order_id:
        retry = PaymentEvent.objects.filter(
            razorpay_order_id=order.razorpay_order_id, state=PaymentEvent.State.RETRY,
        ).exists()
    if retry:
        reasons.add("EVENT_RETRY")
    return sorted(reasons)
