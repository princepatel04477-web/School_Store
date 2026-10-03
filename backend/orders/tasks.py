from datetime import timedelta

from celery import shared_task
from django.db import transaction
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
        variant_ids = sorted({item.variant_id for item in items}, key=str)
        balances = {
            balance.variant_id: balance
            for balance in StockBalance.objects.select_for_update()
            .filter(city_id=order.city_id, variant_id__in=variant_ids)
            .order_by("variant_id")
        }
        if len(balances) != len(variant_ids):
            raise StockBalance.DoesNotExist(
                "Cannot release reservation because a city stock balance is missing."
            )

        movements = []
        for item in items:
            balance = balances[item.variant_id]
            balance.stock_quantity += item.quantity
            balance.save(update_fields=["stock_quantity", "updated_at"])
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
