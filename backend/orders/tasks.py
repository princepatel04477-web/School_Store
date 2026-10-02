from datetime import timedelta
from celery import shared_task
from django.db import transaction
from django.utils import timezone
from catalog.models import ProductVariant, StockMovement
from .models import Order


@shared_task
def send_order_confirmation(order_id):
    # Adapter boundary for SMS/email providers; deliberately no network call in checkout.
    return order_id


@shared_task
def refresh_order_summary(order_id):
    from analytics.tasks import refresh_daily_sales_summary
    order = Order.objects.get(pk=order_id)
    return refresh_daily_sales_summary(order.created_at.date().isoformat())


@shared_task
def release_expired_reservation(order_id):
    """Release unpaid stock exactly once after the 15 minute reservation window."""
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.payment_status == Order.PaymentStatus.PAID or order.status in (
            Order.Status.CANCELLED, Order.Status.RETURNED,
        ):
            return False
        if order.created_at > timezone.now() - timedelta(minutes=15):
            return False
        items = list(order.items.order_by("variant_id"))
        variant_ids = sorted({item.variant_id for item in items}, key=str)
        variants = {v.id: v for v in ProductVariant.objects.select_for_update().filter(id__in=variant_ids).order_by("id")}
        movements = []
        for item in items:
            v = variants[item.variant_id]
            v.stock_quantity += item.quantity
            v.save(update_fields=["stock_quantity", "updated_at"])
            movements.append(StockMovement(
                variant=v, school_id=v.school_id, city_id=v.city_id,
                quantity_change=item.quantity, reason=StockMovement.Reason.ORDER_CANCELLED,
                reference_order=order,
            ))
        StockMovement.objects.bulk_create(movements)
        order.status = Order.Status.CANCELLED
        order.save(update_fields=["status", "updated_at"])
        from .models import OrderStatusEvent
        OrderStatusEvent.objects.create(order=order, status=order.status, note="Payment reservation expired.")
        return True
