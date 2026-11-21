from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import F
from django.db.models.functions import Now
from django.utils import timezone

from inventory.models import StockBalance, StockMovement

from .models import Order, OrderStatusEvent


@shared_task
def send_order_confirmation(order_id):
    """Texts the parent their order number. Runs after commit, never inside checkout."""
    from accounts.sms import send_order_confirmation as send_sms
    from common.phone import normalize_in_mobile

    order = (
        Order.objects.select_related("parent", "payer")
        .only("order_number", "total", "parent__phone", "payer__phone")
        .get(pk=order_id)
    )
    recipient = order.parent or order.payer
    phone = normalize_in_mobile(recipient.phone if recipient else "")
    return send_sms(phone, order.order_number, order.total)


@shared_task
def refresh_order_summary(order_id):
    from analytics.tasks import refresh_daily_sales_summary

    order = Order.objects.only("created_at").get(pk=order_id)
    local_date = timezone.localtime(order.created_at).date()
    return refresh_daily_sales_summary(local_date.isoformat())


@shared_task
def release_expired_reservation(order_id):
    """Release unpaid city stock exactly once after the 15-minute reservation window."""
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
            return False
        if order.payment_status == Order.PaymentStatus.PAID or order.status in (
            Order.Status.CANCELLED,
            Order.Status.RETURNED,
        ):
            return False
        if order.created_at > timezone.now() - timedelta(minutes=15):
            return False

        items = list(order.items.only("variant_id", "quantity").order_by("variant_id"))

        movements = []
        for item in items:
            # Atomic UPDATE ... SET stock_quantity = stock_quantity + qty;
            # never read-modify-write in Python.
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
        transaction.on_commit(lambda o=str(order.id): send_order_status_push.delay(o, Order.Status.CANCELLED))
        return True


@shared_task(name="orders.clear_fit_data")
def clear_old_fit_data():
    """Daily: clear height and weight from finished orders (see orders/fit_retention.py)."""
    from .fit_retention import clear_fit_data

    return clear_fit_data()


@shared_task(name="orders.send_order_status_push")
def send_order_status_push(order_id, status_or_event):
    """Sends FCM push notification to parent devices. Runs after commit."""
    from .fcm import send_order_push

    return send_order_push(str(order_id), status_or_event)


@shared_task(name="orders.send_post_delivery_fit_prompts")
def send_post_delivery_fit_prompts():
    """
    Daily task (Prompt 9):
    5 days after an order with a fitted item is delivered (or picked up),
    send one push notification asking 'How did size {size} fit?'.
    Respects opt-out via send_fit_feedback_push.
    """
    from datetime import timedelta
    from .fcm import send_fit_feedback_push

    now = timezone.now()
    window_start = now - timedelta(days=6)
    window_end = now - timedelta(days=5)

    delivered_events = OrderStatusEvent.objects.filter(
        status=Order.Status.DELIVERED,
        timestamp__gte=window_start,
        timestamp__lte=window_end,
    ).select_related("order", "order__parent")

    count = 0
    for event in delivered_events:
        order = event.order
        fitted_items = order.items.filter(
            fit_feedback="",
        ).exclude(recommended_size="").exclude(chosen_size="")

        if not fitted_items.exists():
            continue

        item = fitted_items.first()
        size = item.chosen_size or item.recommended_size or (item.variant.size if item.variant else "")
        res = send_fit_feedback_push(order, size)
        if res.get("status") in ("sent", "simulated"):
            count += 1

    return count


