"""
Fulfilment service: claim, release claim, report issue, pack, dispatch,
correct article number, ready-for-pickup, deliver.

Reuses change_order_status helpers from status.py for audit and push.
Does not copy them, and does not change record_payment or _restock.
Packing must NOT write stock or StockMovement rows.
"""

from typing import Any
import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from common.audit import log_audit_event
from common.models import AuditLog

from . import fulfilment_gate
from .fulfilment_gate import PackingDecision
from .models import (
    Order,
    OrderPacking,
    OrderStatusEvent,
    Shipment,
    ShipmentCorrection,
    normalize_article_key,
)
from .tasks import refresh_order_summary, send_order_status_push

S = Order.Status


class PackingRuleNotWired(Exception):
    """Raised when the Day 2 packing rule is not merged."""

    pass


class FulfilmentError(Exception):
    """Raised for business logic errors in fulfilment."""

    def __init__(
        self,
        code: str,
        detail: str,
        status_code: int = 400,
        reason: str | None = None,
    ):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status_code = status_code
        self.reason = reason


def claim_order(order_id: Any, user: Any) -> dict[str, Any]:
    """Claim an order for packing.

    Only CONFIRMED or PROCESSING orders can be claimed.
    The gate rule is enforced.
    A second claimant receives ALREADY_CLAIMED (409) naming who.
    A repeat claim by the same user returns changed=False.
    """
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.status not in (S.CONFIRMED, S.PROCESSING):
            raise FulfilmentError(
                code="ORDER_NOT_CLAIMABLE",
                detail=f"Order is in {order.status} status and cannot be claimed.",
                status_code=409,
            )

        decision = fulfilment_gate.get_packing_decision(order)
        if decision.reason == "PACKING_RULE_NOT_WIRED":
            raise PackingRuleNotWired(decision.message)
        if not decision.allowed:
            raise FulfilmentError(
                code="PACKING_BLOCKED",
                detail=decision.message,
                status_code=409,
                reason=decision.reason,
            )

        packing, _ = OrderPacking.objects.get_or_create(order=order)
        if packing.claimed_by_id:
            if packing.claimed_by_id == user.id:
                return {
                    "changed": False,
                    "order_id": str(order.id),
                    "claimed_by": str(user.id),
                    "claimed_by_name": user.get_full_name() or user.username,
                    "claimed_at": packing.claimed_at,
                }
            other_name = (
                packing.claimed_by.get_full_name() or packing.claimed_by.username
                if packing.claimed_by
                else "another staff member"
            )
            raise FulfilmentError(
                code="ALREADY_CLAIMED",
                detail=f"Order is already claimed by {other_name}.",
                status_code=409,
            )

        now = timezone.now()
        packing.claimed_by = user
        packing.claimed_at = now
        packing.save(update_fields=["claimed_by", "claimed_at"])

        return {
            "changed": True,
            "order_id": str(order.id),
            "claimed_by": str(user.id),
            "claimed_by_name": user.get_full_name() or user.username,
            "claimed_at": now,
        }


def release_claim(order_id: Any, user: Any) -> dict[str, Any]:
    """Release a packing claim. Only the claimer or a BOSS may release it."""
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        packing = OrderPacking.objects.filter(order=order).first()
        if not packing or not packing.claimed_by_id:
            return {"released": False, "order_id": str(order.id)}

        is_boss = getattr(user, "role", "") == "BOSS" or getattr(
            user, "is_superuser", False
        )
        if not is_boss and packing.claimed_by_id != user.id:
            raise FulfilmentError(
                code="PERMISSION_DENIED",
                detail="Only the claimer or a boss can release this claim.",
                status_code=403,
            )

        packing.claimed_by = None
        packing.claimed_at = None
        packing.save(update_fields=["claimed_by", "claimed_at"])
        return {"released": True, "order_id": str(order.id)}


def report_issue(order_id: Any, user: Any, note: str) -> dict[str, Any]:
    """Report an issue on an order. The order stays open; packing is blocked until cleared."""
    cleaned_note = (note or "").strip()
    if not cleaned_note:
        raise FulfilmentError(
            code="BLANK_ISSUE_NOTE",
            detail="An issue note is required.",
            status_code=400,
        )

    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        packing, _ = OrderPacking.objects.get_or_create(order=order)
        now = timezone.now()
        packing.issue_note = cleaned_note
        packing.issue_reported_by = user
        packing.issue_reported_at = now
        packing.save(
            update_fields=[
                "issue_note",
                "issue_reported_by",
                "issue_reported_at",
            ]
        )

        return {
            "issue_reported": True,
            "order_id": str(order.id),
            "note": cleaned_note,
        }


def clear_issue(order_id: Any, user: Any) -> dict[str, Any]:
    """Clear an open packing issue on an order."""
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        packing = OrderPacking.objects.filter(order=order).first()
        if packing:
            packing.issue_note = ""
            packing.issue_reported_by = None
            packing.issue_reported_at = None
            packing.save(
                update_fields=[
                    "issue_note",
                    "issue_reported_by",
                    "issue_reported_at",
                ]
            )
        return {"issue_cleared": True, "order_id": str(order.id)}


def pack_order(
    order_id: Any,
    user: Any,
    confirmed_item_ids: list[Any],
    note: str = "",
) -> dict[str, Any]:
    """Pack an order after all line items are confirmed.

    Must be claimed by the caller.
    Every order line id must be confirmed, no more and no fewer (400 LINES_NOT_CONFIRMED).
    Gate checked again at pack time.
    Writes PACKED once with one OrderStatusEvent, one audit entry, sets packed_by and packed_at.
    A repeat by the same user on an already packed order returns changed=False and writes nothing.
    Never touches stock.
    """
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        packing = OrderPacking.objects.filter(order=order).first()

        # Check repeat by the same user on an already packed order
        if order.status == S.PACKED:
            if packing and packing.packed_by_id == user.id:
                return {"changed": False, "order_id": str(order.id)}
            raise FulfilmentError(
                code="ALREADY_PACKED",
                detail="Order is already packed.",
                status_code=409,
            )

        if order.status not in (S.CONFIRMED, S.PROCESSING):
            raise FulfilmentError(
                code="ORDER_NOT_PACKABLE",
                detail=f"Order is in {order.status} status and cannot be packed.",
                status_code=409,
            )

        # Must be claimed by caller
        if not packing or packing.claimed_by_id != user.id:
            raise FulfilmentError(
                code="NOT_CLAIMED_BY_YOU",
                detail="Order must be claimed by you before packing.",
                status_code=409,
            )

        # Packing refused with OPEN_ISSUE until cleared
        if packing.issue_note:
            raise FulfilmentError(
                code="OPEN_ISSUE",
                detail=f"Order has an open issue: {packing.issue_note}",
                status_code=409,
            )

        # Line confirmation check
        order_line_ids = set(order.items.values_list("id", flat=True))
        try:
            confirmed_set = {
                uuid.UUID(str(iid))
                for iid in (confirmed_item_ids or [])
            }
        except (ValueError, TypeError, AttributeError):
            raise FulfilmentError(
                code="LINES_NOT_CONFIRMED",
                detail="Every order line id must be confirmed, no more and no fewer.",
                status_code=400,
            )

        if confirmed_set != order_line_ids:
            raise FulfilmentError(
                code="LINES_NOT_CONFIRMED",
                detail="Every order line id must be confirmed, no more and no fewer.",
                status_code=400,
            )

        # Re-check gate at pack time
        decision = fulfilment_gate.get_packing_decision(order)
        if decision.reason == "PACKING_RULE_NOT_WIRED":
            raise PackingRuleNotWired(decision.message)
        if not decision.allowed:
            raise FulfilmentError(
                code="PACKING_BLOCKED",
                detail=decision.message,
                status_code=409,
                reason=decision.reason,
            )

        old_status = order.status
        order.status = S.PACKED
        order.save(update_fields=["status", "updated_at"])

        now = timezone.now()
        packing.packed_by = user
        packing.packed_at = now
        packing.save(update_fields=["packed_by", "packed_at"])

        OrderStatusEvent.objects.create(
            order=order,
            status=S.PACKED,
            changed_by_id=user.id,
            note=note or "Packed for dispatch.",
        )

        log_audit_event(
            action=AuditLog.Action.ORDER_STATUS_CHANGED,
            target_type="Order",
            target_id=order.id,
            actor=user,
            details={
                "old_status": old_status,
                "new_status": S.PACKED,
                "note": note,
            },
        )

        transaction.on_commit(
            lambda oid=str(order.id): refresh_order_summary.delay(oid)
        )
        transaction.on_commit(
            lambda oid=str(order.id): send_order_status_push.delay(
                oid, S.PACKED
            )
        )

        return {"changed": True, "order_id": str(order.id)}


def dispatch_order(
    order_id: Any,
    user: Any,
    article_number: str,
    receipt_confirmed: bool = False,
    booked_at: Any = None,
) -> dict[str, Any]:
    """Dispatch a home delivery order with carrier India Post.

    HOME_DELIVERY only (pickup gets 400 NOT_HOME_DELIVERY).
    Status must be PACKED.
    Article number non-blank, receipt_confirmed must be True.
    Number not already used by another parcel (409 ARTICLE_NUMBER_IN_USE, case, spaces and hyphens ignored).
    The same number again on the same order is a repeat (changed=False, nothing written).
    A different number on an already handed over order is 409 ALREADY_HANDED_OVER.
    IntegrityError caught and returned as 409.
    """
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)

        if order.fulfillment_type != Order.FulfillmentType.HOME_DELIVERY:
            raise FulfilmentError(
                code="NOT_HOME_DELIVERY",
                detail="Only home-delivery orders can be dispatched via postal carrier.",
                status_code=400,
            )

        cleaned_number = (article_number or "").strip()
        if not cleaned_number:
            raise FulfilmentError(
                code="BLANK_ARTICLE_NUMBER",
                detail="Article number cannot be blank.",
                status_code=400,
            )
        new_key = normalize_article_key(cleaned_number)

        # Check if order is already handed over
        shipment = Shipment.objects.filter(order=order).first()
        if order.status in (S.DISPATCHED, S.SHIPPED, S.DELIVERED) or shipment:
            if shipment and shipment.article_key == new_key:
                return {
                    "changed": False,
                    "order_id": str(order.id),
                    "consignment_number": shipment.consignment_number,
                    "carrier": shipment.carrier,
                    "booked_at": shipment.booked_at,
                }
            raise FulfilmentError(
                code="ALREADY_HANDED_OVER",
                detail="This order has already been handed over with a different article number.",
                status_code=409,
            )

        if order.status != S.PACKED:
            raise FulfilmentError(
                code="ORDER_NOT_PACKED",
                detail=f"Order must be PACKED to dispatch, but is {order.status}.",
                status_code=400,
            )

        if not receipt_confirmed:
            raise FulfilmentError(
                code="RECEIPT_NOT_CONFIRMED",
                detail="You must confirm you checked the number against the India Post receipt.",
                status_code=400,
            )

        # Check reuse across other parcels
        if Shipment.objects.filter(article_key=new_key).exclude(order=order).exists():
            raise FulfilmentError(
                code="ARTICLE_NUMBER_IN_USE",
                detail="This article number is already in use by another parcel.",
                status_code=409,
            )

        handover_time = booked_at or timezone.now()
        try:
            shipment = Shipment(
                order=order,
                carrier=Shipment.Carrier.INDIA_POST,
                consignment_number=cleaned_number,
                article_key=new_key,
                booked_at=handover_time,
                created_by=user,
            )
            shipment.full_clean()
            shipment.save()
        except IntegrityError:
            raise FulfilmentError(
                code="ARTICLE_NUMBER_IN_USE",
                detail="This article number is already in use by another parcel.",
                status_code=409,
            )

        old_status = order.status
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
                "old_status": old_status,
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

        return {
            "changed": True,
            "order_id": str(order.id),
            "consignment_number": shipment.consignment_number,
            "carrier": shipment.carrier,
            "booked_at": shipment.booked_at,
        }


def correct_article_number(
    order_id: Any,
    user: Any,
    article_number: str,
    reason: str = "",
) -> dict[str, Any]:
    """Correct a typo in the article number of a dispatched order.

    Only allowed while DISPATCHED or SHIPPED.
    Same duplicate rule across case, spaces, hyphens.
    Writes a ShipmentCorrection with previous value, who, and when.
    Same value again is a no-op (changed=False).
    """
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.status not in (S.DISPATCHED, S.SHIPPED):
            raise FulfilmentError(
                code="INVALID_STATUS",
                detail="Article number can only be corrected while order is DISPATCHED or SHIPPED.",
                status_code=400,
            )

        shipment = Shipment.objects.filter(order=order).first()
        if not shipment:
            raise FulfilmentError(
                code="NO_SHIPMENT",
                detail="No shipment found for this order.",
                status_code=404,
            )

        cleaned_number = (article_number or "").strip()
        if not cleaned_number:
            raise FulfilmentError(
                code="BLANK_ARTICLE_NUMBER",
                detail="Article number cannot be blank.",
                status_code=400,
            )

        new_key = normalize_article_key(cleaned_number)

        # Same value again is a no-op
        if (
            cleaned_number == shipment.consignment_number
            or new_key == shipment.article_key
        ):
            return {
                "changed": False,
                "order_id": str(order.id),
                "consignment_number": shipment.consignment_number,
            }

        # Check duplicate against other parcels
        if (
            Shipment.objects.filter(article_key=new_key)
            .exclude(id=shipment.id)
            .exists()
        ):
            raise FulfilmentError(
                code="ARTICLE_NUMBER_IN_USE",
                detail="This article number is already in use by another parcel.",
                status_code=409,
            )

        prev_number = shipment.consignment_number
        now = timezone.now()

        ShipmentCorrection.objects.create(
            shipment=shipment,
            previous_number=prev_number,
            new_number=cleaned_number,
            reason=(reason or "").strip(),
            changed_by=user,
            changed_at=now,
        )

        shipment.consignment_number = cleaned_number
        shipment.article_key = new_key
        try:
            shipment.save(update_fields=["consignment_number", "article_key"])
        except IntegrityError:
            raise FulfilmentError(
                code="ARTICLE_NUMBER_IN_USE",
                detail="This article number is already in use by another parcel.",
                status_code=409,
            )

        return {
            "changed": True,
            "order_id": str(order.id),
            "consignment_number": shipment.consignment_number,
        }


def mark_ready_for_pickup(order_ids: list[Any], user: Any) -> list[str]:
    """Mark school-pickup orders as DISPATCHED (ready for pickup).

    No shipment row is written. Note is 'Ready at the school counter.'
    Safe to repeat (already DISPATCHED orders are no-ops).
    """
    with transaction.atomic():
        orders = list(
            Order.objects.select_for_update()
            .filter(
                id__in=order_ids,
                fulfillment_type=Order.FulfillmentType.SCHOOL_PICKUP,
            )
            .order_by("id")
        )
        if not orders:
            return []

        updated = []
        for o in orders:
            if o.status == S.PACKED:
                o.status = S.DISPATCHED
                o.save(update_fields=["status", "updated_at"])
                OrderStatusEvent.objects.create(
                    order=o,
                    status=S.DISPATCHED,
                    changed_by_id=user.id,
                    note="Ready at the school counter.",
                )
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
                transaction.on_commit(
                    lambda oid=str(o.id): refresh_order_summary.delay(oid)
                )
                transaction.on_commit(
                    lambda oid=str(o.id): send_order_status_push.delay(
                        oid, S.DISPATCHED
                    )
                )
                updated.append(str(o.id))
            elif o.status == S.DISPATCHED:
                # Safe repeat: no extra event or push, but reported as processed
                updated.append(str(o.id))

        return updated


def mark_delivered(order_ids: list[Any], user: Any) -> list[str]:
    """Mark dispatched or legacy shipped orders as DELIVERED.

    Safe to repeat (already DELIVERED orders are no-ops).
    """
    with transaction.atomic():
        orders = list(
            Order.objects.select_for_update()
            .filter(id__in=order_ids)
            .order_by("id")
        )
        if not orders:
            return []

        updated = []
        for o in orders:
            if o.status in (S.DISPATCHED, S.SHIPPED):
                old_status = o.status
                o.status = S.DELIVERED
                o.save(update_fields=["status", "updated_at"])
                OrderStatusEvent.objects.create(
                    order=o,
                    status=S.DELIVERED,
                    changed_by_id=user.id,
                    note="Delivered.",
                )
                log_audit_event(
                    action=AuditLog.Action.ORDER_STATUS_CHANGED,
                    target_type="Order",
                    target_id=o.id,
                    actor=user,
                    details={
                        "old_status": old_status,
                        "new_status": S.DELIVERED,
                        "note": "Delivered.",
                    },
                )
                transaction.on_commit(
                    lambda oid=str(o.id): refresh_order_summary.delay(oid)
                )
                transaction.on_commit(
                    lambda oid=str(o.id): send_order_status_push.delay(
                        oid, S.DELIVERED
                    )
                )
                updated.append(str(o.id))
            elif o.status == S.DELIVERED:
                # Safe repeat
                updated.append(str(o.id))

        return updated
