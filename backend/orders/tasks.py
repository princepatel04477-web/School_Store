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
    # Adapter boundary for SMS/email providers; deliberately no network call in checkout.
    return order_id


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
        # Cancellation changes revenue: refresh the rollups for this order's
        # day once the transaction commits.
        order_id = str(order.id)
        transaction.on_commit(lambda: refresh_order_summary.delay(order_id))
        return True
