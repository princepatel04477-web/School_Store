"""
Fulfilment service: pack, dispatch, ready-for-pickup, deliver.

Reuses change_order_status helpers from status.py for audit and push.
Does not copy them, and does not change record_payment or _restock.
"""

from dataclasses import dataclass, field
from datetime import timezone as dt_tz

from django.db import IntegrityError, transaction
from django.db.models.functions import Now
from django.utils import timezone

from common.audit import log_audit_event
from common.models import AuditLog

from .fulfilment_gate import PackingDecision, get_packing_decision
from .models import Order, OrderStatusEvent, Shipment
from .tasks import refresh_order_summary, send_order_status_push

S = Order.Status


class PackingRuleNotWired(Exception):
    """Raised when the Day 2 packing rule is not merged."""

    pass


@dataclass
class PackResult:
    packed_ids: list = field(default_factory=list)
    blocked: list = field(default_factory=list)


def pack_orders(queryset, user, note="") -> PackResult:
    """Pack every order in `queryset` that the gate allows.

    Raises PackingRuleNotWired if the gate returns PACKING_RULE_NOT_WIRED
    for any order (all-or-nothing: no orders are changed).
    """
    result = PackResult()

    with transaction.atomic():
        orders = list(
            queryset.select_for_update()
            .filter(status__in=[S.CONFIRMED, S.PROCESSING])
            .order_by("id")
        )
        if not orders:
            return result

        to_pack = []
        for order in orders:
            decision = get_packing_decision(order)
            if decision.reason == "PACKING_RULE_NOT_WIRED":
                raise PackingRuleNotWired(decision.message)
            if not decision.allowed:
                result.blocked.append(
                    {
                        "order_id": str(order.id),
                        "reason": decision.reason,
                        "message": decision.message,
                    }
                )
            else:
                to_pack.append(order)

        if not to_pack:
            return result

        ids = [o.id for o in to_pack]
        Order.objects.filter(id__in=ids).update(
            status=S.PACKED, updated_at=Now()
        )
        OrderStatusEvent.objects.bulk_create(
            [
                OrderStatusEvent(
                    order_id=o.id,
                    status=S.PACKED,
                    changed_by_id=user.id,
                    note=note or "Packed for dispatch.",
                )
                for o in to_pack
            ]
        )
        for o in to_pack:
            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="Order",
                target_id=o.id,
                actor=user,
                details={
                    "old_status": o.status,
                    "new_status": S.PACKED,
                    "note": note,
                },
            )
        for o in to_pack:
            transaction.on_commit(
                lambda oid=str(o.id): refresh_order_summary.delay(oid)
            )
            transaction.on_commit(
                lambda oid=str(o.id): send_order_status_push.delay(oid, S.PACKED)
            )

        result.packed_ids = [str(o.id) for o in to_pack]

    return result


def dispatch_order(order_id, user, consignment_number, booked_at=None):
    """Dispatch a home-delivery order by India Post with a consignment number."""
    with transaction.atomic():
        order = (
            Order.objects.select_for_update()
            .select_related("shipment")
            .get(pk=order_id)
        )
        if order.fulfillment_type != Order.FulfillmentType.HOME_DELIVERY:
            raise ValueError("Only home-delivery orders can be dispatched with a consignment number.")
        if order.status != S.PACKED:
            raise ValueError(f"Order must be PACKED to dispatch, but is {order.status}.")

        consignment_number = (consignment_number or "").upper().strip()
        shipment = Shipment(
            order=order,
            carrier=Shipment.Carrier.INDIA_POST,
            consignment_number=consignment_number,
            booked_at=booked_at or timezone.now(),
            created_by=user,
        )
        shipment.full_clean()
        shipment.save()

        order.status = S.DISPATCHED
        order.save(update_fields=["status", "updated_at"])

        event_note = f"India Post {shipment.consignment_number}"
        OrderStatusEvent.objects.create(
            order=order,
            status=S.DISPATCHED,
            changed_by_id=user.id,
            note=event_note,
        )

        log_audit_event(
            action=AuditLog.Action.ORDER_STATUS_CHANGED,
            target_type="Order",
            target_id=order.id,
            actor=user,
            details={
                "old_status": S.PACKED,
                "new_status": S.DISPATCHED,
                "consignment_number": shipment.consignment_number,
            },
        )

        transaction.on_commit(
            lambda: refresh_order_summary.delay(str(order.id))
        )
        transaction.on_commit(
            lambda: send_order_status_push.delay(str(order.id), S.DISPATCHED)
        )

    return shipment


def mark_ready_for_pickup(order_ids, user):
    """Mark school-pickup orders as DISPATCHED (ready for pickup)."""
    with transaction.atomic():
        orders = list(
            Order.objects.select_for_update()
            .filter(
                id__in=order_ids,
                fulfillment_type=Order.FulfillmentType.SCHOOL_PICKUP,
                status=S.PACKED,
            )
            .order_by("id")
        )
        if not orders:
            return []

        ids = [o.id for o in orders]
        Order.objects.filter(id__in=ids).update(
            status=S.DISPATCHED, updated_at=Now()
        )
        OrderStatusEvent.objects.bulk_create(
            [
                OrderStatusEvent(
                    order_id=o.id,
                    status=S.DISPATCHED,
                    changed_by_id=user.id,
                    note="Ready at the school counter.",
                )
                for o in orders
            ]
        )
        for o in orders:
            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="Order",
                target_id=o.id,
                actor=user,
                details={
                    "old_status": S.PACKED,
                    "new_status": S.DISPATCHED,
                    "note": "Ready at the school counter.",
                },
            )
        for o in orders:
            transaction.on_commit(
                lambda oid=str(o.id): refresh_order_summary.delay(oid)
            )
            transaction.on_commit(
                lambda oid=str(o.id): send_order_status_push.delay(oid, S.DISPATCHED)
            )

    return [str(o.id) for o in orders]


def mark_delivered(order_ids, user):
    """Mark dispatched (or legacy shipped) orders as delivered."""
    with transaction.atomic():
        orders = list(
            Order.objects.select_for_update()
            .filter(
                id__in=order_ids,
                status__in=[S.DISPATCHED, S.SHIPPED],
            )
            .order_by("id")
        )
        if not orders:
            return []

        ids = [o.id for o in orders]
        Order.objects.filter(id__in=ids).update(
            status=S.DELIVERED, updated_at=Now()
        )
        OrderStatusEvent.objects.bulk_create(
            [
                OrderStatusEvent(
                    order_id=o.id,
                    status=S.DELIVERED,
                    changed_by_id=user.id,
                    note="Delivered.",
                )
                for o in orders
            ]
        )
        for o in orders:
            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="Order",
                target_id=o.id,
                actor=user,
                details={
                    "old_status": o.status,
                    "new_status": S.DELIVERED,
                    "note": "Delivered.",
                },
            )
        for o in orders:
            transaction.on_commit(
                lambda oid=str(o.id): refresh_order_summary.delay(oid)
            )
            transaction.on_commit(
                lambda oid=str(o.id): send_order_status_push.delay(oid, S.DELIVERED)
            )

    return [str(o.id) for o in orders]
