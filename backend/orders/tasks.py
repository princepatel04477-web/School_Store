from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import F, Q
from django.db.models.functions import Now
from django.utils import timezone

from inventory.models import StockBalance, StockMovement

from .models import Order, OrderStatusEvent, PaymentAttempt, PaymentEvent, PaymentReview
from .payment import RazorpayGateway
from .status import apply_provider_payment


@shared_task(name="orders.deliver_notification_task")
def deliver_notification_task(notification_id):
    """
    Executes an outbox notification delivery attempt with row locking,
    idempotency checks, provider adapter invocation, bounded retry backoff,
    and sanitized error logging.
    """
    from .models import NotificationRecord
    from .notifications import get_notification_adapter, sanitize_operational_error

    with transaction.atomic():
        try:
            record = NotificationRecord.objects.select_for_update().get(pk=notification_id)
        except NotificationRecord.DoesNotExist:
            return False

        # Idempotency check: if already sent, delivered or cancelled, never resend
        if record.status in (
            NotificationRecord.Status.SENT,
            NotificationRecord.Status.DELIVERED,
            NotificationRecord.Status.CANCELLED,
        ):
            return True

        if record.status == NotificationRecord.Status.EXHAUSTED:
            return False

        record.status = NotificationRecord.Status.SENDING
        record.attempt_count += 1
        record.last_attempt_at = timezone.now()
        record.save(update_fields=["status", "attempt_count", "last_attempt_at", "updated_at"])

    # Outside lock: call provider adapter
    adapter = get_notification_adapter()
    try:
        result = adapter.send(record)
    except Exception as exc:
        from .notifications import ProviderResult
        result = ProviderResult(success=False, error_message=str(exc))

    with transaction.atomic():
        record = NotificationRecord.objects.select_for_update().get(pk=notification_id)
        record.provider = adapter.__class__.__name__
        record.provider_response = result.raw_response or {}

        if result.success:
            # Accepted provider request is marked SENT, NOT DELIVERED
            record.status = NotificationRecord.Status.SENT
            record.sent_at = timezone.now()
            record.provider_message_id = result.provider_message_id
            record.error_message = ""
        else:
            sanitized_err = sanitize_operational_error(result.error_message)
            record.error_message = sanitized_err
            if record.attempt_count >= record.max_attempts:
                record.status = NotificationRecord.Status.EXHAUSTED
            else:
                record.status = NotificationRecord.Status.FAILED
                backoff_delay = min(300, 30 * (2 ** (record.attempt_count - 1)))
                record.next_attempt_at = timezone.now() + timedelta(seconds=backoff_delay)

        record.save(update_fields=[
            "status", "provider", "provider_message_id",
            "provider_response", "error_message", "next_attempt_at",
            "sent_at", "updated_at",
        ])

    return result.success


@shared_task(name="orders.sweep_pending_notifications")
def sweep_pending_notifications():
    """
    Celery beat periodic task: sweeps overdue PENDING or FAILED notifications
    from the outbox.
    Recovers from broker outages, transient worker crashes, or delayed commits.
    """
    from .models import NotificationRecord

    now = timezone.now()
    pending_records = list(
        NotificationRecord.objects.filter(
            status__in=[NotificationRecord.Status.PENDING, NotificationRecord.Status.FAILED],
            attempt_count__lt=F("max_attempts"),
            next_attempt_at__lte=now,
        )
        .order_by("created_at")
        .values_list("id", flat=True)[:50]
    )

    results = []
    for notif_id in pending_records:
        results.append(deliver_notification_task(str(notif_id)))
    return results


@shared_task
def send_order_confirmation(order_id):
    """Texts the parent their order confirmation via durable outbox. Runs after commit."""
    from .notifications import enqueue_notification
    from .models import NotificationRecord

    try:
        order = (
            Order.objects.select_related("parent", "payer")
            .only("order_number", "total", "parent__phone", "payer__phone")
            .get(pk=order_id)
        )
    except Order.DoesNotExist:
        return False

    rec = enqueue_notification(order, NotificationRecord.EventType.ORDER_CONFIRMED)
    if rec and rec.status == NotificationRecord.Status.PENDING:
        deliver_notification_task(str(rec.id))
    return True


@shared_task
def refresh_order_summary(order_id):
    from analytics.tasks import refresh_daily_sales_summary

    order = Order.objects.only("created_at").get(pk=order_id)
    local_date = timezone.localtime(order.created_at).date()
    return refresh_daily_sales_summary(local_date.isoformat())


@shared_task
def release_expired_reservation(order_id):
    """
    Release unpaid city stock exactly once after the 15-minute reservation window (Section 6).
    Locks the order row. While holding lock, fetches payments from Razorpay and decides.
    """
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)

        # COD orders never expire unpaid
        if order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
            return False

        # Already paid or final status
        if order.payment_status == Order.PaymentStatus.PAID or order.status in (
            Order.Status.CANCELLED,
            Order.Status.RETURNED,
            Order.Status.CONFIRMED,
            Order.Status.PROCESSING,
            Order.Status.PACKED,
            Order.Status.DISPATCHED,
            Order.Status.DELIVERED,
        ):
            return False

        # Only process if 15-minute hold has elapsed
        if order.created_at > timezone.now() - timedelta(minutes=15):
            return False

        gateway = RazorpayGateway()

        # While holding the lock, fetch this Razorpay order's payments from Razorpay (5s timeout)
        if order.razorpay_order_id and gateway.is_usable():
            try:
                payments = gateway.fetch_order_payments(order.razorpay_order_id)
                for p in payments:
                    apply_provider_payment(order, p, PaymentAttempt.Source.EXPIRY_CHECK)
            except Exception:
                # Razorpay unreachable or timed out: the result is unknown. Release nothing.
                # After 2 hours unknown, open one RECONCILE_STUCK review item.
                if order.created_at <= timezone.now() - timedelta(hours=2):
                    PaymentReview.objects.get_or_create(
                        order=order,
                        reason=PaymentReview.Reason.RECONCILE_STUCK,
                        payment_id="",
                    )
                return False

        order.refresh_from_db()
        if order.payment_status == Order.PaymentStatus.PAID:
            # Captured and matching: the order is PAID. Release nothing.
            return False

        # Check if authorized or attempt still in progress
        has_in_progress = order.payment_attempts.filter(
            status__in=[PaymentAttempt.Status.AUTHORIZED, PaymentAttempt.Status.CREATED]
        ).exists()
        if has_in_progress:
            # Keep the hold and check again later. Release nothing.
            return False

        # No attempts, or only failed ones: release stock exactly as today
        items = list(order.items.only("variant_id", "quantity").order_by("variant_id"))
        movements = []
        for item in items:
            restored = StockBalance.objects.filter(
                city_id=order.city_id, variant_id=item.variant_id
            ).update(
                stock_quantity=F("stock_quantity") + item.quantity,
                updated_at=Now(),
            )
            if not restored:
                raise StockBalance.DoesNotExist(
                    "Cannot release reservation because a city stock balance is missing."
                )
            movements.append(
                StockMovement(
                    variant_id=item.variant_id,
                    city_id=order.city_id,
                    school_id=order.school_id,
                    quantity_change=item.quantity,
                    reason=StockMovement.Reason.ORDER_CANCELLED,
                    reference_order=order,
                )
            )
        StockMovement.objects.bulk_create(movements)
        order.status = Order.Status.CANCELLED
        order.save(update_fields=["status", "updated_at"])
        OrderStatusEvent.objects.create(
            order=order,
            status=order.status,
            note="Payment reservation expired.",
        )
        return True


@shared_task(name="orders.sweep_expired_reservations")
def sweep_expired_reservations():
    """Runs every 5 minutes via Celery beat: sweeps unpaid ONLINE orders past their 15-minute hold."""
    cutoff = timezone.now() - timedelta(minutes=15)
    expired_orders = list(
        Order.objects.filter(
            payment_method=Order.PaymentMethod.ONLINE,
            status__in=[Order.Status.PLACED, Order.Status.PENDING],
            created_at__lte=cutoff,
        )
        .exclude(payment_status=Order.PaymentStatus.PAID)
        .values_list("id", flat=True)
    )
    results = []
    for oid in expired_orders:
        results.append(release_expired_reservation(str(oid)))
    return results


@shared_task(name="orders.reprocess_payment_events")
def reprocess_payment_events():
    """
    Runs every minute via Celery beat (Section 4).
    Reprocesses RETRY and UNMATCHED events whose next_try_at has passed, with backoff.
    An event still unmatched after 24 hours opens one UNMATCHED_EVENT review item.
    """
    now = timezone.now()
    events = list(
        PaymentEvent.objects.filter(
            state__in=[PaymentEvent.State.RETRY, PaymentEvent.State.UNMATCHED],
        ).filter(
            Q(next_try_at__isnull=True) | Q(next_try_at__lte=now)
        ).order_by("received_at")[:100]
    )

    backoff_delays = [1, 2, 5, 10, 30]

    for event in events:
        try:
            with transaction.atomic():
                ev = PaymentEvent.objects.select_for_update().get(pk=event.pk)
                if ev.state not in (PaymentEvent.State.RETRY, PaymentEvent.State.UNMATCHED):
                    continue

                # If unmatched for > 24 hours, open UNMATCHED_EVENT review item
                if ev.state == PaymentEvent.State.UNMATCHED and ev.received_at <= now - timedelta(hours=24):
                    PaymentReview.objects.get_or_create(
                        order=None,
                        reason=PaymentReview.Reason.UNMATCHED_EVENT,
                        payment_id=ev.razorpay_payment_id or ev.event_id,
                    )

                # Attempt to find store order
                store_order = None
                if ev.razorpay_order_id:
                    store_order = Order.objects.filter(razorpay_order_id=ev.razorpay_order_id).first()
                if not store_order and isinstance(ev.payload, dict):
                    notes = (
                        ev.payload.get("payload", {}).get("payment", {}).get("entity", {}).get("notes", {})
                        or ev.payload.get("payload", {}).get("order", {}).get("entity", {}).get("notes", {})
                    )
                    if isinstance(notes, dict) and notes.get("store_order_id"):
                        store_order = Order.objects.filter(id=notes["store_order_id"]).first()

                if not store_order:
                    # Still unmatched
                    ev.state = PaymentEvent.State.UNMATCHED
                    delay_min = backoff_delays[min(ev.tries, len(backoff_delays) - 1)]
                    ev.tries += 1
                    ev.next_try_at = now + timedelta(minutes=delay_min)
                    ev.save(update_fields=["state", "tries", "next_try_at"])
                    continue

                # Order matched! Process the event
                payload = ev.payload or {}
                p_entity = (
                    payload.get("payload", {}).get("payment", {}).get("entity", {})
                    if isinstance(payload, dict)
                    else {}
                )
                if not p_entity:
                    p_entity = {
                        "id": ev.razorpay_payment_id or f"pay_for_{ev.razorpay_order_id}",
                        "order_id": ev.razorpay_order_id,
                        "amount": ev.amount,
                        "currency": ev.currency,
                        "status": "captured" if ev.event_type in ("payment.captured", "order.paid") else "authorized",
                    }
                elif ev.event_type in ("payment.captured", "order.paid"):
                    p_entity.setdefault("status", "captured")
                elif ev.event_type == "payment.authorized":
                    p_entity.setdefault("status", "authorized")
                elif ev.event_type == "payment.failed":
                    p_entity.setdefault("status", "failed")

                apply_provider_payment(store_order, p_entity, PaymentAttempt.Source.WEBHOOK)
                ev.state = PaymentEvent.State.PROCESSED
                ev.save(update_fields=["state"])

        except Exception as exc:
            with transaction.atomic():
                ev = PaymentEvent.objects.select_for_update().get(pk=event.pk)
                ev.state = PaymentEvent.State.RETRY
                delay_min = backoff_delays[min(ev.tries, len(backoff_delays) - 1)]
                ev.tries += 1
                ev.last_error = str(exc)
                ev.next_try_at = now + timedelta(minutes=delay_min)
                ev.save(update_fields=["state", "tries", "last_error", "next_try_at"])


@shared_task(name="orders.clear_fit_data")
def clear_old_fit_data():
    """Daily: clear height and weight from finished orders (see orders/fit_retention.py)."""
    from .fit_retention import clear_fit_data

    return clear_fit_data()
