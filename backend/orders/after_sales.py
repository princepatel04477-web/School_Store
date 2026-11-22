"""
After-sales services: cancellation, size exchange, damaged/incorrect item handling,
and refund workflows (Task 5).

Key architectural guarantees:
1. Server-owned eligibility aligned with legal policies:
   - Cancellation permitted before dispatch, subject to customisation production cutoff.
   - Size exchange permitted within 7 days of delivery/collection for unworn items with alternative sizes.
     First size exchange is free.
   - Damaged/defective/incorrect items reportable within 7 days with photo/notes.
2. Atomic inventory management:
   - Replacement variant stock reserved atomically via apply_stock_movement (prevents overselling).
   - Returned items restocked ONLY when condition is RESTOCKABLE (damaged goods written off).
   - Double-restock, double-reserve, and double-refund strictly blocked via row locks.
3. Decoupled lifecycles:
   - Physical return status and financial refund status are independent.
   - A status change alone NEVER marks funds refunded.
   - Idempotent provider refund engine with test-mode simulation and explicit COD handling.
"""

from decimal import Decimal
import datetime as dt
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from common.audit import log_audit_event
from common.models import AuditLog
from inventory.models import StockBalance, StockMovement
from inventory.services import apply_stock_movement, stock_flags

from .models import Order, OrderItem, OrderItemExchange, OrderAfterSaleRequest, OrderRefund, PaymentAttempt, OrderStatusEvent
from .payment import RazorpayGateway
from .status import can_transition_order, change_order_status


def check_customisation_production_started(order_item: OrderItem, order: Order = None) -> tuple[bool, str]:
    """
    Evaluates whether a personalised/customised item has passed the production cutoff.
    Once production starts, personalised items cannot be cancelled for change of mind.
    """
    cdata = order_item.customisation_data or {}
    if not cdata:
        return False, ""

    ord_obj = order or getattr(order_item, "order", None)
    if ord_obj and ord_obj.status in (
        Order.Status.PACKED,
        Order.Status.READY_FOR_PICKUP,
        Order.Status.DISPATCHED,
        Order.Status.SHIPPED,
        Order.Status.DELIVERED,
        Order.Status.COLLECTED,
    ):
        return True, "Production and packing have already started for this order."

    # Check print key generation or status flags
    has_print = any(
        k.endswith(("_print", "_ready")) or k in ("cover_photo_print", "student_photo_print")
        for k in cdata.keys()
    )
    if has_print:
        return True, "Personalised print assets have already been prepared for production."

    for k, v in cdata.items():
        if k.endswith("_status") and str(v).upper() in ("PROCESSED", "PRINTED", "IN_PRODUCTION"):
            return True, "Personalised item is recorded as in production."

    return False, ""


def get_delivery_event_timestamp(order: Order):
    """Returns the timestamp when the order was marked DELIVERED or COLLECTED, if any."""
    event = order.status_events.filter(
        status__in=[Order.Status.DELIVERED, Order.Status.COLLECTED]
    ).order_by("timestamp").first()
    if event:
        return event.timestamp
    if order.status in (Order.Status.DELIVERED, Order.Status.COLLECTED):
        return order.updated_at
    return None


def get_order_after_sales_eligibility(order: Order, user=None) -> dict:
    """
    Calculates server-owned eligibility for cancellation, size exchange, and returns.
    """
    now = timezone.now()
    is_cancelled_or_final = order.status in (
        Order.Status.CANCELLED,
        Order.Status.REFUNDED,
        Order.Status.RETURNED,
    )

    # 1. Whole order cancellation eligibility
    can_cancel_order = False
    cancel_order_reason = ""
    if is_cancelled_or_final:
        can_cancel_order = False
        cancel_order_reason = f"Order is already {order.status.lower()}."
    elif order.status in (
        Order.Status.PLACED,
        Order.Status.PENDING,
        Order.Status.CONFIRMED,
        Order.Status.PROCESSING,
        Order.Status.PACKED,
    ):
        # Check if any line has customisation in production
        locked_item = None
        for item in order.items.all():
            in_prod, rsn = check_customisation_production_started(item, order)
            if in_prod:
                locked_item = item
                break

        if locked_item:
            can_cancel_order = False
            cancel_order_reason = (
                f"Personalised item '{locked_item.variant.product.name}' is already in production. "
                "Order cannot be cancelled online."
            )
        else:
            can_cancel_order = True
            cancel_order_reason = "Order can be cancelled before dispatch."
    else:
        can_cancel_order = False
        cancel_order_reason = f"Orders in '{order.status}' status cannot be cancelled online."

    # 2. Delivery milestone age (7-day policy)
    delivery_ts = get_delivery_event_timestamp(order)
    is_delivered = order.status in (Order.Status.DELIVERED, Order.Status.COLLECTED)
    days_since_delivery = (now - delivery_ts).total_seconds() / 86400 if delivery_ts else None
    within_7_days = is_delivered and days_since_delivery is not None and days_since_delivery <= 7.0

    # 3. Previous size exchange count
    exchange_count = order.after_sales_requests.filter(
        request_type=OrderAfterSaleRequest.RequestType.EXCHANGE,
        status__in=[
            OrderAfterSaleRequest.Status.REQUESTED,
            OrderAfterSaleRequest.Status.APPROVED,
            OrderAfterSaleRequest.Status.INSPECTED,
            OrderAfterSaleRequest.Status.COMPLETED,
        ],
    ).count() + order.items.filter(exchanges__isnull=False).distinct().count()

    # Pre-fetch active after-sales requests per item
    active_requests = list(order.after_sales_requests.all())
    active_by_item = {}
    for req in active_requests:
        if req.order_item_id and req.status not in (
            OrderAfterSaleRequest.Status.CANCELLED,
            OrderAfterSaleRequest.Status.REJECTED,
        ):
            active_by_item[req.order_item_id] = req

    # 4. Item-level eligibility
    items_eligibility = []
    for item in order.items.select_related("variant__product", "category").all():
        item_id_str = str(item.id)
        has_active_req = item.id in active_by_item
        active_req = active_by_item.get(item.id)

        # Cancellation for this line
        can_cancel_item = False
        cancel_item_reason = ""
        if is_cancelled_or_final or has_active_req:
            can_cancel_item = False
            cancel_item_reason = "An active request already exists for this line." if has_active_req else f"Order is {order.status}."
        elif order.status in (
            Order.Status.PLACED,
            Order.Status.PENDING,
            Order.Status.CONFIRMED,
            Order.Status.PROCESSING,
            Order.Status.PACKED,
        ):
            in_prod, prod_rsn = check_customisation_production_started(item, order)
            if in_prod:
                can_cancel_item = False
                cancel_item_reason = prod_rsn
            else:
                can_cancel_item = True
                cancel_item_reason = "Item can be cancelled before dispatch."
        else:
            can_cancel_item = False
            cancel_item_reason = f"Cannot cancel items once {order.status.lower()}."

        # Size Exchange for this line
        can_exchange = False
        exchange_reason = ""
        replacement_sizes = []
        is_customised = bool(item.customisation_data)

        if not is_delivered:
            can_exchange = False
            exchange_reason = "Size exchanges are available only after items are delivered or collected."
        elif not within_7_days:
            can_exchange = False
            exchange_reason = "Size exchange period (within 7 days of delivery) has expired."
        elif is_customised:
            can_exchange = False
            exchange_reason = "Personalised or made-to-order items cannot be exchanged for size."
        elif has_active_req:
            can_exchange = False
            exchange_reason = f"A request ({active_req.get_request_type_display()}) is already active for this line."
        else:
            # Query sibling variants
            product = item.variant.product
            sibling_variants = list(
                product.variants.exclude(pk=item.variant_id).values("id", "size", "sku")
            )
            if not sibling_variants:
                can_exchange = False
                exchange_reason = "No alternative sizes are manufactured for this product."
            else:
                # Stock flags for city
                var_ids = [v["id"] for v in sibling_variants]
                flags = stock_flags(order.city_id, var_ids)
                for var in sibling_variants:
                    flag = flags.get(str(var["id"]), "OUT_OF_STOCK")
                    replacement_sizes.append({
                        "variant_id": str(var["id"]),
                        "size": var["size"],
                        "sku": var["sku"],
                        "stock_flag": flag,
                        "available": flag in ("IN_STOCK", "LOW_STOCK"),
                    })
                can_exchange = True
                exchange_reason = "Eligible for size exchange within 7 days of delivery."

        # Return / Defect reporting
        can_return = False
        return_reason = ""
        if not is_delivered:
            can_return = False
            return_reason = "Issues can be reported after items are delivered or collected."
        elif not within_7_days:
            can_return = False
            return_reason = "Reporting window (within 7 days of delivery) has expired."
        elif has_active_req:
            can_return = False
            return_reason = f"A request ({active_req.get_request_type_display()}) is already active for this line."
        else:
            can_return = True
            return_reason = "Eligible to report damaged, defective, or incorrect items within 7 days."

        items_eligibility.append({
            "item_id": item_id_str,
            "product_name": item.variant.product.name,
            "variant_sku": item.variant.sku,
            "current_size": item.current_size,
            "quantity": item.quantity,
            "unit_price": str(item.unit_price_snapshot),
            "is_customised": is_customised,
            "has_active_request": has_active_req,
            "active_request_id": str(active_req.id) if active_req else None,
            "can_cancel": can_cancel_item,
            "cancel_reason": cancel_item_reason,
            "can_exchange": can_exchange,
            "exchange_reason": exchange_reason,
            "replacement_sizes": replacement_sizes,
            "can_return": can_return,
            "return_reason": return_reason,
        })

    # Summary of refunds already succeeded
    succeeded_refunds = order.refunds.filter(status=OrderRefund.Status.SUCCEEDED)
    total_refunded_paise = succeeded_refunds.aggregate(s=Sum("amount_paise"))["s"] or 0

    return {
        "order_id": str(order.id),
        "order_number": order.order_number,
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "is_delivered": is_delivered,
        "within_7_days": within_7_days,
        "days_since_delivery": round(days_since_delivery, 1) if days_since_delivery is not None else None,
        "first_exchange_free": exchange_count == 0,
        "can_cancel_order": can_cancel_order,
        "cancel_order_reason": cancel_order_reason,
        "items": items_eligibility,
        "total_refunded_paise": total_refunded_paise,
    }


def create_after_sale_request(order: Order, user, data: dict) -> OrderAfterSaleRequest:
    """
    Submits a parent request for cancellation, size exchange, or damaged/wrong item.
    Enforces atomic stock reservation and double-operation guards.
    """
    if (
        user.role == "PARENT"
        and order.parent_id != user.id
        and order.placed_by_id != user.id
    ):
        raise PermissionDenied("You can only submit after-sales requests for your own orders.")

    req_type = data.get("request_type")
    if req_type not in OrderAfterSaleRequest.RequestType.values:
        raise ValidationError({"request_type": [f"Invalid request type '{req_type}'."]})

    reason = data.get("reason")
    if reason not in OrderAfterSaleRequest.Reason.values:
        raise ValidationError({"reason": [f"Invalid reason '{reason}'."]})

    reason_details = (data.get("reason_details") or "").strip()
    photo_key = (data.get("photo_key") or "").strip()
    order_item_id = data.get("order_item")

    with transaction.atomic():
        # Lock the order to prevent race conditions
        locked_order = Order.objects.select_for_update().get(pk=order.pk)
        eligibility = get_order_after_sales_eligibility(locked_order, user)

        order_item = None
        if order_item_id:
            order_item = locked_order.items.select_for_update().filter(pk=order_item_id).first()
            if not order_item:
                raise ValidationError({"order_item": ["Order item does not belong to this order."]})

        # -------------------------------------------------------------
        # 1. CANCELLATION
        # -------------------------------------------------------------
        if req_type == OrderAfterSaleRequest.RequestType.CANCEL:
            if not order_item:
                # Whole order cancellation
                if not eligibility["can_cancel_order"]:
                    raise ValidationError({"detail": eligibility["cancel_order_reason"]})

                # Check transition validity
                can_move, trans_reason = can_transition_order(locked_order, Order.Status.CANCELLED)
                if not can_move:
                    raise ValidationError({"detail": trans_reason})

                # Execute order cancellation and restock
                change_order_status(
                    Order.objects.filter(pk=locked_order.pk),
                    Order.Status.CANCELLED,
                    user,
                    note="Order cancelled by parent request.",
                )
                locked_order.refresh_from_db()

                req_obj = OrderAfterSaleRequest.objects.create(
                    order=locked_order,
                    order_item=None,
                    request_type=req_type,
                    status=OrderAfterSaleRequest.Status.COMPLETED,
                    reason=reason,
                    reason_details=reason_details,
                    quantity=sum(it.quantity for it in locked_order.items.all()),
                    is_item_restocked=True,
                    restock_condition=OrderAfterSaleRequest.RestockCondition.RESTOCKABLE,
                    created_by=user,
                    reviewed_by=user,
                    reviewed_at=timezone.now(),
                    staff_notes="Auto-completed full order cancellation.",
                )

                # Process refund
                if locked_order.payment_method == Order.PaymentMethod.ONLINE and locked_order.payment_status == Order.PaymentStatus.PAID:
                    refund = OrderRefund.objects.create(
                        order=locked_order,
                        request=req_obj,
                        amount_paise=int(Decimal(locked_order.total) * 100),
                        payment_method=locked_order.payment_method,
                        repayment_channel=OrderRefund.RepaymentChannel.ORIGINAL_PAYMENT,
                        status=OrderRefund.Status.PENDING,
                        notes="Full refund on online order cancellation.",
                    )
                    process_order_refund(refund, actor=user)
                elif locked_order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
                    OrderRefund.objects.create(
                        order=locked_order,
                        request=req_obj,
                        amount_paise=int(Decimal(locked_order.total) * 100),
                        payment_method=locked_order.payment_method,
                        repayment_channel=OrderRefund.RepaymentChannel.NOT_APPLICABLE,
                        status=OrderRefund.Status.SUCCEEDED,
                        notes="COD order cancelled before delivery. No cash collected.",
                        processed_at=timezone.now(),
                        processed_by=user,
                    )

                log_audit_event(
                    action=AuditLog.Action.ORDER_STATUS_CHANGED,
                    target_type="Order",
                    target_id=locked_order.id,
                    actor=user,
                    details={"action": "parent_cancel_order", "request_id": str(req_obj.id)},
                )
                return req_obj
            else:
                # Line item cancellation
                item_elig = next((ie for ie in eligibility["items"] if ie["item_id"] == str(order_item.id)), None)
                if not item_elig or not item_elig["can_cancel"]:
                    raise ValidationError({"detail": item_elig["cancel_reason"] if item_elig else "Item cannot be cancelled."})

                # Restock the item
                apply_stock_movement(
                    variant=order_item.variant,
                    city_id=locked_order.city_id,
                    quantity_change=order_item.quantity,
                    reason=StockMovement.Reason.ORDER_CANCELLED,
                    reference_order=locked_order,
                    created_by=user,
                )

                req_obj = OrderAfterSaleRequest.objects.create(
                    order=locked_order,
                    order_item=order_item,
                    request_type=req_type,
                    status=OrderAfterSaleRequest.Status.COMPLETED,
                    reason=reason,
                    reason_details=reason_details,
                    quantity=order_item.quantity,
                    is_item_restocked=True,
                    restock_condition=OrderAfterSaleRequest.RestockCondition.RESTOCKABLE,
                    created_by=user,
                    reviewed_by=user,
                    reviewed_at=timezone.now(),
                    staff_notes="Auto-completed line item cancellation.",
                )

                if locked_order.payment_method == Order.PaymentMethod.ONLINE and locked_order.payment_status == Order.PaymentStatus.PAID:
                    line_paise = int(order_item.unit_price_snapshot * order_item.quantity * 100)
                    refund = OrderRefund.objects.create(
                        order=locked_order,
                        request=req_obj,
                        order_item=order_item,
                        amount_paise=line_paise,
                        payment_method=locked_order.payment_method,
                        repayment_channel=OrderRefund.RepaymentChannel.ORIGINAL_PAYMENT,
                        status=OrderRefund.Status.PENDING,
                        notes=f"Partial refund for cancelled line {order_item.variant.sku}.",
                    )
                    process_order_refund(refund, actor=user)

                log_audit_event(
                    action=AuditLog.Action.ORDER_STATUS_CHANGED,
                    target_type="OrderItem",
                    target_id=order_item.id,
                    actor=user,
                    details={"action": "parent_cancel_line", "request_id": str(req_obj.id)},
                )
                return req_obj

        # -------------------------------------------------------------
        # 2. SIZE EXCHANGE
        # -------------------------------------------------------------
        elif req_type == OrderAfterSaleRequest.RequestType.EXCHANGE:
            if not order_item:
                raise ValidationError({"order_item": ["A specific order line must be chosen for size exchange."]})

            item_elig = next((ie for ie in eligibility["items"] if ie["item_id"] == str(order_item.id)), None)
            if not item_elig or not item_elig["can_exchange"]:
                raise ValidationError({"detail": item_elig["exchange_reason"] if item_elig else "Item cannot be exchanged."})

            target_size = (data.get("target_size") or "").strip()
            target_variant_id = data.get("target_variant")
            target_variant = None

            product = order_item.variant.product
            if target_variant_id:
                target_variant = product.variants.filter(pk=target_variant_id).first()
            elif target_size:
                target_variant = product.variants.filter(size=target_size).first()

            if not target_variant:
                raise ValidationError({"target_size": [f"Invalid replacement size '{target_size}'."]})

            if target_variant.id == order_item.variant_id:
                raise ValidationError({"target_size": ["Replacement size must be different from the current size."]})

            # Check stock in order city
            sb = StockBalance.objects.filter(city_id=locked_order.city_id, variant_id=target_variant.id).first()
            avail_qty = sb.stock_quantity if sb else 0
            if avail_qty < order_item.quantity:
                raise ValidationError({"target_size": [f"Size '{target_variant.size}' is currently out of stock."]})

            # Atomically reserve replacement stock
            apply_stock_movement(
                variant=target_variant,
                city_id=locked_order.city_id,
                quantity_change=-order_item.quantity,
                reason=StockMovement.Reason.EXCHANGE_RESERVATION,
                reference_order=locked_order,
                created_by=user,
            )

            # First exchange is free; subsequent fee is zero or policy-dependent
            charge_paise = 0 if eligibility["first_exchange_free"] else 0

            req_obj = OrderAfterSaleRequest.objects.create(
                order=locked_order,
                order_item=order_item,
                request_type=req_type,
                status=OrderAfterSaleRequest.Status.REQUESTED,
                reason=reason,
                reason_details=reason_details,
                from_size=order_item.current_size,
                target_size=target_variant.size,
                target_variant=target_variant,
                quantity=order_item.quantity,
                charge_paise=charge_paise,
                is_stock_reserved=True,
                created_by=user,
            )

            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="OrderAfterSaleRequest",
                target_id=req_obj.id,
                actor=user,
                details={
                    "action": "parent_request_exchange",
                    "from_size": req_obj.from_size,
                    "target_size": req_obj.target_size,
                    "reserved_variant": str(target_variant.id),
                },
            )

            from .models import NotificationRecord
            from .notifications import enqueue_notification

            enqueue_notification(
                locked_order,
                NotificationRecord.EventType.EXCHANGE_UPDATE,
                payload={
                    "order_number": str(locked_order.order_number),
                    "exchange_id": str(req_obj.id),
                    "status": "REQUESTED",
                    "from_size": str(req_obj.from_size),
                    "target_size": str(req_obj.target_size),
                },
            )
            return req_obj

        # -------------------------------------------------------------
        # 3. DAMAGED / DEFECTIVE / WRONG ITEM (RETURN OR REPLACE)
        # -------------------------------------------------------------
        elif req_type in (OrderAfterSaleRequest.RequestType.RETURN, OrderAfterSaleRequest.RequestType.REPLACE):
            if not order_item:
                raise ValidationError({"order_item": ["A specific order line must be chosen."]})

            item_elig = next((ie for ie in eligibility["items"] if ie["item_id"] == str(order_item.id)), None)
            if not item_elig or not item_elig["can_return"]:
                raise ValidationError({"detail": item_elig["return_reason"] if item_elig else "Item cannot be returned."})

            is_reserved = False
            target_variant = None
            if req_type == OrderAfterSaleRequest.RequestType.REPLACE:
                target_variant = order_item.variant
                # Reserve identical replacement if in stock
                sb = StockBalance.objects.filter(city_id=locked_order.city_id, variant_id=target_variant.id).first()
                if sb and sb.stock_quantity >= order_item.quantity:
                    apply_stock_movement(
                        variant=target_variant,
                        city_id=locked_order.city_id,
                        quantity_change=-order_item.quantity,
                        reason=StockMovement.Reason.EXCHANGE_RESERVATION,
                        reference_order=locked_order,
                        created_by=user,
                    )
                    is_reserved = True

            req_obj = OrderAfterSaleRequest.objects.create(
                order=locked_order,
                order_item=order_item,
                request_type=req_type,
                status=OrderAfterSaleRequest.Status.REQUESTED,
                reason=reason,
                reason_details=reason_details,
                photo_key=photo_key,
                from_size=order_item.current_size,
                target_size=order_item.current_size,
                target_variant=target_variant,
                quantity=order_item.quantity,
                is_stock_reserved=is_reserved,
                created_by=user,
            )

            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="OrderAfterSaleRequest",
                target_id=req_obj.id,
                actor=user,
                details={
                    "action": "parent_report_issue",
                    "request_type": req_type,
                    "reason": reason,
                    "stock_reserved": is_reserved,
                },
            )
            return req_obj

        raise ValidationError({"request_type": ["Unsupported after-sales action."]})


def review_after_sale_request(
    request_obj: OrderAfterSaleRequest,
    staff_user,
    action: str,
    notes: str = "",
    restock_condition: str = "",
) -> OrderAfterSaleRequest:
    """
    Staff approval/inspection workflow:
    - APPROVE: Staff confirms request. If return for refund, schedules OrderRefund.
    - REJECT: Staff rejects. If stock was reserved, it is atomically released back.
    - INSPECT: Staff inspects physical item. Restocks only if condition is RESTOCKABLE.
    - COMPLETE: Finalizes request. For size exchange, records OrderItemExchange.
    """
    if staff_user.role not in ("BOSS", "ADMIN", "SCHOOL_ADMIN"):
        raise PermissionDenied("Only authorized staff may review after-sales requests.")

    with transaction.atomic():
        req = OrderAfterSaleRequest.objects.select_for_update().get(pk=request_obj.pk)
        order = req.order

        # Each action is only valid from certain states, so a repeated click or a
        # replayed request cannot create a second refund or move stock twice.
        S = OrderAfterSaleRequest.Status
        allowed_from = {
            "APPROVE": {S.REQUESTED},
            "REJECT": {S.REQUESTED},
            "INSPECT": {S.REQUESTED, S.APPROVED},
            "COMPLETE": {S.APPROVED, S.INSPECTED},
        }
        if action in allowed_from and req.status not in allowed_from[action]:
            raise ValidationError(
                {"action": [f"Cannot {action.lower()} a request that is {req.get_status_display().lower()}."]}
            )

        if action == "APPROVE":
            req.status = OrderAfterSaleRequest.Status.APPROVED
            req.reviewed_by = staff_user
            req.reviewed_at = timezone.now()
            req.staff_notes = notes or req.staff_notes
            req.save()

            if req.request_type == OrderAfterSaleRequest.RequestType.RETURN:
                # Schedule refund for line
                item = req.order_item
                amount_paise = int(item.unit_price_snapshot * req.quantity * 100) if item else int(order.total * 100)
                refund = OrderRefund.objects.create(
                    order=order,
                    request=req,
                    order_item=item,
                    amount_paise=amount_paise,
                    payment_method=order.payment_method,
                    repayment_channel=(
                        OrderRefund.RepaymentChannel.ORIGINAL_PAYMENT
                        if order.payment_method == Order.PaymentMethod.ONLINE
                        else OrderRefund.RepaymentChannel.CASH
                    ),
                    status=OrderRefund.Status.PENDING,
                    notes=f"Approved return refund: {notes}",
                )
                process_order_refund(refund, actor=staff_user)

        elif action == "REJECT":
            # If stock was reserved, return it atomically
            if req.is_stock_reserved and req.target_variant:
                apply_stock_movement(
                    variant=req.target_variant,
                    city_id=order.city_id,
                    quantity_change=req.quantity,
                    reason=StockMovement.Reason.ORDER_CANCELLED,
                    reference_order=order,
                    created_by=staff_user,
                )
                req.is_stock_reserved = False

            req.status = OrderAfterSaleRequest.Status.REJECTED
            req.reviewed_by = staff_user
            req.reviewed_at = timezone.now()
            req.staff_notes = notes or "Request rejected by staff."
            req.save()

        elif action == "INSPECT":
            cond = restock_condition or OrderAfterSaleRequest.RestockCondition.RESTOCKABLE
            req.restock_condition = cond
            req.status = OrderAfterSaleRequest.Status.INSPECTED
            req.reviewed_by = staff_user
            req.reviewed_at = timezone.now()
            req.staff_notes = notes or req.staff_notes

            # Restock returned item only if RESTOCKABLE and not already restocked
            if cond == OrderAfterSaleRequest.RestockCondition.RESTOCKABLE and not req.is_item_restocked and req.order_item:
                apply_stock_movement(
                    variant=req.order_item.variant,
                    city_id=order.city_id,
                    quantity_change=req.quantity,
                    reason=StockMovement.Reason.RETURN,
                    reference_order=order,
                    created_by=staff_user,
                )
                req.is_item_restocked = True
            elif cond == OrderAfterSaleRequest.RestockCondition.DAMAGED_DISCARD:
                # Log damage movement without adding to sellable stock
                StockMovement.objects.create(
                    variant=req.order_item.variant,
                    city_id=order.city_id,
                    school_id=order.school_id,
                    quantity_change=0,
                    reason=StockMovement.Reason.DAMAGE,
                    reference_order=order,
                    created_by=staff_user,
                )

            req.save()

        elif action == "COMPLETE":
            # For size exchange: ensure OrderItemExchange is recorded
            if req.request_type == OrderAfterSaleRequest.RequestType.EXCHANGE and req.order_item:
                if not req.exchange_record:
                    reason_choice = (
                        OrderItemExchange.Reason.TOO_SMALL
                        if req.reason == OrderAfterSaleRequest.Reason.TOO_SMALL
                        else (
                            OrderItemExchange.Reason.TOO_BIG
                            if req.reason == OrderAfterSaleRequest.Reason.TOO_BIG
                            else OrderItemExchange.Reason.NOT_SIZE
                        )
                    )
                    ex = OrderItemExchange.objects.create(
                        order_item=req.order_item,
                        from_size=req.from_size or req.order_item.current_size,
                        to_size=req.target_size,
                        reason=reason_choice,
                        note=req.reason_details or notes,
                        created_by=staff_user,
                    )
                    req.exchange_record = ex

            req.status = OrderAfterSaleRequest.Status.COMPLETED
            req.reviewed_by = staff_user
            req.reviewed_at = timezone.now()
            req.staff_notes = notes or req.staff_notes
            req.save()

        else:
            raise ValidationError({"action": [f"Invalid review action '{action}'."]})

        log_audit_event(
            action=AuditLog.Action.ORDER_STATUS_CHANGED,
            target_type="OrderAfterSaleRequest",
            target_id=req.id,
            actor=staff_user,
            details={"action": action, "status": req.status, "notes": notes},
        )

        if req.request_type == OrderAfterSaleRequest.RequestType.EXCHANGE:
            from .models import NotificationRecord
            from .notifications import enqueue_notification

            enqueue_notification(
                order,
                NotificationRecord.EventType.EXCHANGE_UPDATE,
                payload={
                    "order_number": str(order.order_number),
                    "exchange_id": str(req.id),
                    "status": str(req.status),
                    "from_size": str(req.from_size),
                    "target_size": str(req.target_size),
                },
            )

        return req


def process_order_refund(refund_obj: OrderRefund, actor=None) -> OrderRefund:
    """
    Idempotent refund executor:
    - Verifies financial bounds (cannot double-refund or exceed order total).
    - Calls Razorpay create_refund for online payments (test-mode safe).
    - Records cash repayment for COD orders.
    - Updates order.payment_status to REFUNDED only when all captured funds are refunded.
    """
    with transaction.atomic():
        refund = OrderRefund.objects.select_for_update().get(pk=refund_obj.pk)
        if refund.status == OrderRefund.Status.SUCCEEDED:
            return refund  # Idempotent: already succeeded

        order = Order.objects.select_for_update().get(pk=refund.order_id)
        order_total_paise = int(Decimal(order.total) * 100)

        # Check total refunds
        prior_succeeded = OrderRefund.objects.filter(
            order=order, status=OrderRefund.Status.SUCCEEDED
        ).exclude(pk=refund.pk).aggregate(s=Sum("amount_paise"))["s"] or 0

        if prior_succeeded + refund.amount_paise > order_total_paise:
            refund.status = OrderRefund.Status.FAILED
            refund.failure_reason = "Refund amount exceeds total paid amount."
            refund.save()
            raise ValidationError("Refund amount exceeds paid order total.")

        # ONLINE PAYMENT REFUND
        if order.payment_method == Order.PaymentMethod.ONLINE:
            attempt = order.payment_attempts.filter(status=PaymentAttempt.Status.CAPTURED).first()
            if not attempt and order.razorpay_payment_id:
                attempt = order.payment_attempts.filter(razorpay_payment_id=order.razorpay_payment_id).first()

            payment_id = attempt.razorpay_payment_id if attempt else order.razorpay_payment_id
            if not payment_id:
                refund.status = OrderRefund.Status.FAILED
                refund.failure_reason = "No captured payment ID available to refund."
                refund.save()
                return refund

            gateway = RazorpayGateway()
            try:
                # A retry after a failure or timeout may follow a refund Razorpay did
                # create: adopt it instead of sending the money a second time.
                resp = None
                if refund.status == OrderRefund.Status.FAILED or refund.failure_reason:
                    resp = gateway.find_refund_by_note(payment_id, refund.id)
                if resp is None:
                    resp = gateway.create_refund(
                        payment_id=payment_id,
                        amount_paise=refund.amount_paise,
                        receipt=str(refund.id),
                        notes={"store_order_id": str(order.id), "refund_id": str(refund.id)},
                    )
                refund.status = OrderRefund.Status.SUCCEEDED
                refund.razorpay_refund_id = resp.get("id", "")
                refund.razorpay_payment_id = payment_id
                refund.processed_at = timezone.now()
                refund.processed_by = actor
                refund.save()

                if prior_succeeded + refund.amount_paise >= order_total_paise:
                    order.payment_status = Order.PaymentStatus.REFUNDED
                    order.save(update_fields=["payment_status", "updated_at"])

                log_audit_event(
                    action=AuditLog.Action.ORDER_STATUS_CHANGED,
                    target_type="OrderRefund",
                    target_id=refund.id,
                    actor=actor,
                    details={
                        "status": "SUCCEEDED",
                        "amount_paise": refund.amount_paise,
                        "razorpay_refund_id": refund.razorpay_refund_id,
                    },
                )
            except Exception as exc:
                refund.status = OrderRefund.Status.FAILED
                refund.failure_reason = str(exc)
                refund.save()

        # COD PAYMENT REFUND
        elif order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
            # If not delivered, no money was collected
            if order.status not in (Order.Status.DELIVERED, Order.Status.COLLECTED):
                refund.repayment_channel = OrderRefund.RepaymentChannel.NOT_APPLICABLE
                refund.status = OrderRefund.Status.SUCCEEDED
                refund.processed_at = timezone.now()
                refund.processed_by = actor
                refund.notes = "COD order cancelled before delivery. Zero cash repayment required."
                refund.save()
            else:
                # Order was collected in cash; staff processes cash repayment
                refund.repayment_channel = OrderRefund.RepaymentChannel.CASH
                if actor and getattr(actor, "role", "") in ("BOSS", "ADMIN", "SCHOOL_ADMIN"):
                    refund.status = OrderRefund.Status.SUCCEEDED
                    refund.processed_at = timezone.now()
                    refund.processed_by = actor
                    refund.save()

                    if prior_succeeded + refund.amount_paise >= order_total_paise:
                        order.payment_status = Order.PaymentStatus.REFUNDED
                        order.save(update_fields=["payment_status", "updated_at"])
                else:
                    refund.status = OrderRefund.Status.PENDING
                    refund.notes = "Awaiting cash repayment at school collection counter."
                    refund.save()

        if refund.status == OrderRefund.Status.SUCCEEDED:
            from .models import NotificationRecord
            from .notifications import enqueue_notification

            enqueue_notification(
                order,
                NotificationRecord.EventType.REFUND_PROCESSED,
                payload={
                    "order_number": str(order.order_number),
                    "refund_id": str(refund.id),
                    "refund_amount": f"₹{refund.amount_paise / 100:.2f}",
                    "status": "REFUNDED",
                },
            )

        return refund
