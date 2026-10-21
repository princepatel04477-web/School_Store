"""
Clears a child's height, weight and shoulder width from order lines once they are no longer
needed (plan A1, "store the least").

An order line keeps its height and weight until FIT_DATA_RETENTION_DAYS after
the order was delivered, cancelled or returned (the latest of those events),
or FIT_DATA_BACKSTOP_DAYS after it was placed if it never got there. Then:

  1. the numbers, class, suggested / chosen / final size and exchange reason
     are copied into a SizingSample, which has no link to the student, order
     or any user, and only the month;
  2. height and weight on the order line are blanked. The suggested and chosen
     sizes stay on the order line.

Runs in batches, each in one transaction, with the rows locked so two runs at
once never copy the same line twice. Running it again finds nothing to do.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import OuterRef, Prefetch, Q, Subquery
from django.utils import timezone

from catalog.models import SizingSample

from .models import Order, OrderItem, OrderItemExchange, OrderStatusEvent

ENDED = (
    Order.Status.DELIVERED,
    Order.Status.CANCELLED,
    Order.Status.RETURNED,
    Order.Status.REFUNDED,
)
SIZE_REASONS = (OrderItemExchange.Reason.TOO_SMALL, OrderItemExchange.Reason.TOO_BIG)
BATCH_SIZE = 500


def due_items(now=None):
    """Order lines whose height and weight should be cleared now."""
    now = now or timezone.now()
    ended_at = Subquery(
        OrderStatusEvent.objects.filter(order_id=OuterRef("order_id"), status__in=ENDED)
        .order_by("-timestamp")
        .values("timestamp")[:1]
    )
    return (
        OrderItem.objects.filter(
            Q(fit_height_cm__isnull=False)
            | Q(fit_weight_kg__isnull=False)
            | Q(fit_shoulder_cm__isnull=False)
        )
        .annotate(ended_at=ended_at)
        .filter(
            Q(ended_at__lte=now - timedelta(days=settings.FIT_DATA_RETENTION_DAYS))
            | Q(order__created_at__lte=now - timedelta(days=settings.FIT_DATA_BACKSTOP_DAYS))
        )
    )


def _sample(item: OrderItem) -> SizingSample:
    exchanges = list(item.exchanges.all())  # prefetched, oldest first
    size_exchanges = [e for e in exchanges if e.reason in SIZE_REASONS]
    if size_exchanges:
        reason = size_exchanges[-1].reason
    elif exchanges:
        reason = OrderItemExchange.Reason.NOT_SIZE
    else:
        reason = ""
    placed = timezone.localdate(item.order.created_at)
    return SizingSample(
        product_id=item.variant.product_id,
        month=placed.replace(day=1),
        student_class=item.order.student_class,
        height_cm=item.fit_height_cm,
        weight_kg=item.fit_weight_kg,
        shoulder_cm=item.fit_shoulder_cm,
        shoulder_confidence=item.fit_shoulder_confidence,
        recommended_size=item.recommended_size,
        recommended_alt_size=item.recommended_alt_size,
        recommendation_status=item.recommendation_status,
        chosen_size=item.chosen_size,
        final_size=exchanges[-1].to_size if exchanges else (item.chosen_size or item.variant.size),
        exchange_reason=reason,
    )


def clear_fit_data(now=None, dry_run: bool = False) -> dict:
    now = now or timezone.now()
    if dry_run:
        return {"due": due_items(now).count(), "cleared": 0, "dry_run": True}

    cleared = 0
    while True:
        with transaction.atomic():
            batch = list(
                due_items(now)
                .select_related("order", "variant")
                .prefetch_related(
                    Prefetch("exchanges", queryset=OrderItemExchange.objects.order_by("created_at"))
                )
                .select_for_update(skip_locked=True, of=("self",))
                .order_by("id")[:BATCH_SIZE]
            )
            if not batch:
                break
            # A line with only a weight has nothing worth keeping as a sample.
            SizingSample.objects.bulk_create(
                [_sample(item) for item in batch if item.fit_height_cm is not None]
            )
            OrderItem.objects.filter(id__in=[item.id for item in batch]).update(
                fit_height_cm=None,
                fit_weight_kg=None,
                fit_shoulder_cm=None,
                fit_shoulder_confidence=None,
            )
            cleared += len(batch)
    return {"due": cleared, "cleared": cleared, "dry_run": False}


def purge_old_measurements(now=None, dry_run: bool = False) -> int:
    """
    Deletes children's saved measurements older than MEASUREMENT_RETENTION_DAYS,
    through the measured_at index. Order lines keep their own copy of the
    numbers, which clear_fit_data handles above.
    """
    from schools.models import StudentMeasurement

    now = now or timezone.now()
    old = StudentMeasurement.objects.filter(
        measured_at__lt=now - timedelta(days=settings.MEASUREMENT_RETENTION_DAYS)
    )
    if dry_run:
        return old.count()
    deleted, _ = old.delete()
    return deleted
