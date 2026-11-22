"""
Day 4: Size exchange business domain logic and service workflows.

Covers:
- Parent size exchange eligibility, delivery window validation, and holding calculations.
- Request creation with atomic stock reservation (EXCHANGE_RESERVE).
- Hold maintenance and replacement securing before original receipt.
- Staff workflow: APPROVE, CONFIRM_WINDOW, SET_HANDOVER, RECEIVE, RETURN_ORIGINAL, COMPLETE, REJECT, REVERSE_RECEIPT.
- Atomic stock movements and locking guarantees preventing regression cases.
"""

from decimal import Decimal
import datetime as dt
import uuid
import zoneinfo
from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from catalog.models import ProductVariant
from inventory.models import StockMovement
from inventory.services import apply_stock_movement, stock_flags, InsufficientStockError
from .models import (
    Order,
    OrderItem,
    OrderItemExchange,
    OrderStatusEvent,
    SizeExchangeRequest,
    size_holdings,
)

IST = zoneinfo.ZoneInfo("Asia/Kolkata")


class SizeSoldOutError(ValidationError):
    """Raised when the requested replacement size has no stock left."""
    def __init__(self, sizes_data, message="The requested size has just sold out."):
        super().__init__({"code": "SIZE_SOLD_OUT", "message": message, "sizes": sizes_data})
        self.sizes_data = sizes_data


class ActiveRequestError(ValidationError):
    """Raised when an active exchange request already exists on this line."""
    def __init__(self, active_request, message="An active exchange request already exists for this item."):
        super().__init__({
            "code": "ACTIVE_REQUEST",
            "message": message,
            "request_id": str(active_request.id),
            "status": active_request.status,
        })
        self.active_request = active_request


class ReplacementNotSecuredError(ValidationError):
    """Raised when staff attempt to receive the original item but the replacement is not secured."""
    def __init__(self, message="Replacement unit is not secured in stock. Do not take the shirt. Offer another size or reject."):
        super().__init__({"code": "REPLACEMENT_NOT_SECURED", "message": message})


def get_order_delivery_window(order: Order) -> tuple[dt.datetime | None, dt.datetime | None, bool, str]:
    """
    Computes delivery window start, end, whether currently within window, and reason string.
    TODO(O1): Published policy: 'within 7 days of delivery'. Default: delivery day is day 0, open until 23:59:59 IST on day 7.
    TODO(O2): Delivery start is first DELIVERED OrderStatusEvent. No event -> staff review (NO_DELIVERY_RECORD).
    """
    delivered_event = (
        order.status_events.filter(status=Order.Status.DELIVERED)
        .order_by("timestamp")
        .first()
    )

    window_starts_at = None
    window_ends_at = None
    within_window = False
    reason = ""

    if delivered_event:
        window_starts_at = delivered_event.timestamp
        # Delivery date in IST
        delivery_local_date = timezone.localtime(delivered_event.timestamp, IST).date()
        # Day 0 is delivery day; day 7 ends at 23:59:59.999999 IST
        end_date = delivery_local_date + dt.timedelta(days=7)
        end_dt_naive = dt.datetime.combine(end_date, dt.time.max)
        window_ends_at = end_dt_naive.replace(tzinfo=IST)
        now = timezone.now()
        within_window = now <= window_ends_at
        if within_window:
            reason = "Within 7-day exchange window."
        else:
            reason = f"Exchange window expired on {end_date.strftime('%d %b %Y')}."
    else:
        # Check if confirmed by staff on any request
        existing_req = order.size_exchange_requests.filter(window_confirmed_start__isnull=False).first()
        if existing_req and existing_req.window_confirmed_start:
            window_starts_at = existing_req.window_confirmed_start
            confirmed_date = timezone.localtime(existing_req.window_confirmed_start, IST).date()
            end_date = confirmed_date + dt.timedelta(days=7)
            end_dt_naive = dt.datetime.combine(end_date, dt.time.max)
            window_ends_at = end_dt_naive.replace(tzinfo=IST)
            now = timezone.now()
            within_window = now <= window_ends_at
            reason = "Confirmed by staff delivery record."
        else:
            within_window = False
            reason = "No recorded delivery date. Requires staff confirmation."

    return window_starts_at, window_ends_at, within_window, reason


def get_line_exchangeable_units(item: OrderItem, size: str) -> int:
    """
    Returns how many units of `size` on this line are currently eligible to be exchanged.
    Calculated as total held units of that size minus units in any active request on this item.
    """
    holdings = size_holdings(item)
    held = holdings.get(size, 0)
    if held <= 0:
        return 0

    active_req = item.size_exchange_requests.filter(
        status__in=[
            SizeExchangeRequest.Status.REQUESTED,
            SizeExchangeRequest.Status.APPROVED,
            SizeExchangeRequest.Status.RECEIVED,
            SizeExchangeRequest.Status.INSPECTION_FAILED,
        ],
        from_size=size,
    ).first()

    locked = active_req.quantity if active_req else 0
    return max(0, held - locked)


def get_order_exchange_summary(order: Order, user) -> dict:
    """
    Detailed exchange context for a parent or staff member viewing /orders/<id>/exchange/.
    """
    is_staff = user.role in ("BOSS", "ADMIN", "SCHOOL_ADMIN")
    if not is_staff and order.parent_id != user.id and order.placed_by_id != user.id:
        raise PermissionDenied("You do not have permission to view exchanges for this order.")

    window_starts_at, window_ends_at, within_window, window_reason = get_order_delivery_window(order)
    delivered_event_exists = order.status_events.filter(status=Order.Status.DELIVERED).exists()

    # Collect items
    items_summary = []
    order_items = (
        order.items.select_related("variant", "variant__product", "category")
        .prefetch_related("exchanges", "size_exchange_requests")
        .all()
    )

    for item in order_items:
        holdings = size_holdings(item)
        product = item.variant.product

        # Eligible garments:
        # TODO(O3): Confirm personalised and non-sized items excluded.
        is_personalised = bool(item.customisation_data)
        has_custom_photos = bool(getattr(item, "customisation_print_photo", ""))
        active_variants = list(product.variants.filter(active=True).order_by("size"))
        is_multi_size = len(active_variants) >= 2

        eligible_for_exchange = (
            order.status == Order.Status.DELIVERED
            and not is_personalised
            and not has_custom_photos
            and is_multi_size
            and (within_window or not delivered_event_exists)  # If no delivery record, accepted into review
        )

        ineligibility_reason = ""
        if order.status != Order.Status.DELIVERED:
            ineligibility_reason = "Order is not yet delivered."
        elif is_personalised or has_custom_photos:
            ineligibility_reason = "Personalised garments made to order cannot be exchanged."
        elif not is_multi_size:
            ineligibility_reason = "This garment is only available in one size."
        elif delivered_event_exists and not within_window:
            ineligibility_reason = window_reason

        # Active request on this line if any
        active_req = item.size_exchange_requests.filter(
            status__in=[
                SizeExchangeRequest.Status.REQUESTED,
                SizeExchangeRequest.Status.APPROVED,
                SizeExchangeRequest.Status.RECEIVED,
                SizeExchangeRequest.Status.INSPECTION_FAILED,
            ]
        ).first()

        # Available sibling variants with stock flags
        variant_ids = [v.id for v in active_variants]
        flags = stock_flags(order.city_id, variant_ids)

        sizes_info = []
        for v in active_variants:
            flag = flags.get(str(v.id), "OUT_OF_STOCK")
            sizes_info.append({
                "variant_id": str(v.id),
                "size": v.size,
                "sku": v.sku,
                "active": v.active,
                "availability": flag,
                "available": flag in ("IN_STOCK", "LOW_STOCK"),
            })

        exchangeable_map = {
            s: get_line_exchangeable_units(item, s) for s in holdings.keys()
        }

        items_summary.append({
            "order_item_id": str(item.id),
            "product_id": str(product.id),
            "product_name": product.name,
            "category": item.category.name if item.category else "",
            "chosen_size": item.chosen_size or item.variant.size,
            "quantity": item.quantity,
            "holdings": holdings,
            "exchangeable_units": exchangeable_map,
            "is_personalised": is_personalised,
            "eligible": eligible_for_exchange,
            "ineligibility_reason": ineligibility_reason,
            "available_sizes": sizes_info,
            "active_request": {
                "id": str(active_req.id),
                "status": active_req.status,
                "reason": active_req.reason,
                "from_size": active_req.from_size,
                "target_size": active_req.target_variant.size,
                "quantity": active_req.quantity,
                "reservation": active_req.reservation,
                "condition": active_req.condition,
                "review_reasons": active_req.review_reasons,
                "created_at": active_req.created_at.isoformat(),
            } if active_req else None,
        })

    # Requests on this order
    all_requests = []
    for req in order.size_exchange_requests.select_related("order_item", "target_variant", "created_by").order_by("-created_at"):
        all_requests.append({
            "id": str(req.id),
            "order_item_id": str(req.order_item_id),
            "status": req.status,
            "reason": req.reason,
            "from_size": req.from_size,
            "target_size": req.target_variant.size,
            "quantity": req.quantity,
            "reservation": req.reservation,
            "condition": req.condition,
            "condition_note": req.condition_note,
            "review_reasons": req.review_reasons,
            "handover_method": req.handover_method,
            "original_disposition": req.original_disposition,
            "charge_paise": req.charge_paise,
            "created_at": req.created_at.isoformat(),
            "updated_at": req.updated_at.isoformat(),
        })

    return {
        "order_id": str(order.id),
        "order_number": order.order_number,
        "fulfillment_type": order.fulfillment_type,
        "status": order.status,
        "window_starts_at": window_starts_at.isoformat() if window_starts_at else None,
        "window_ends_at": window_ends_at.isoformat() if window_ends_at else None,
        "within_window": within_window,
        "window_reason": window_reason,
        "delivered_event_exists": delivered_event_exists,
        "items": items_summary,
        "requests": all_requests,
    }


def create_size_exchange_request(
    order: Order,
    user,
    data: dict,
    idempotency_key: str = "",
) -> tuple[SizeExchangeRequest, bool]:
    """
    Submits a size exchange request for an eligible delivered order item.
    Atomically decrements target variant stock with EXCHANGE_RESERVE.
    Idempotent on (order, idempotency_key).
    Returns (request_obj, created).
    """
    idempotency_key = (idempotency_key or "").strip()

    with transaction.atomic():
        # Lock order row
        locked_order = Order.objects.select_for_update().get(pk=order.pk)
        if user.role == "PARENT" and locked_order.parent_id != user.id and locked_order.placed_by_id != user.id:
            raise PermissionDenied("You can only request size exchanges for your own orders.")

        # Check existing idempotency
        if idempotency_key:
            existing = SizeExchangeRequest.objects.filter(
                order=locked_order, idempotency_key=idempotency_key
            ).first()
            if existing:
                return existing, False

        order_item_id = data.get("order_item")
        if not order_item_id:
            raise ValidationError({"order_item": ["Order item is required."]})

        try:
            item = OrderItem.objects.select_for_update().get(pk=order_item_id, order=locked_order)
        except OrderItem.DoesNotExist:
            raise ValidationError({"order_item": ["Order item not found on this order."]})

        # Check for active request on this line (Unique constraint enforcement)
        active_req = SizeExchangeRequest.objects.filter(
            order_item=item,
            status__in=[
                SizeExchangeRequest.Status.REQUESTED,
                SizeExchangeRequest.Status.APPROVED,
                SizeExchangeRequest.Status.RECEIVED,
                SizeExchangeRequest.Status.INSPECTION_FAILED,
            ],
        ).first()
        if active_req:
            raise ActiveRequestError(active_req)

        # Validate order delivered
        if locked_order.status != Order.Status.DELIVERED:
            raise ValidationError({"order": ["Only delivered orders are eligible for size exchanges."]})

        # Validate delivery window
        # TODO(O1): Day 0 is delivery day, open until 23:59 IST on day 7.
        # TODO(O2): First DELIVERED OrderStatusEvent starts window. No event -> staff review (NO_DELIVERY_RECORD).
        window_starts_at, window_ends_at, within_window, window_reason = get_order_delivery_window(locked_order)
        delivered_event_exists = locked_order.status_events.filter(status=Order.Status.DELIVERED).exists()

        review_reasons = []
        if delivered_event_exists:
            if not within_window:
                raise ValidationError({"window": [window_reason]})
        else:
            # Accepted and held, but flagged for staff confirmation
            review_reasons.append("NO_DELIVERY_RECORD")

        # Personalised exclusion
        # TODO(O3): Personalised items cannot be cancelled or exchanged.
        if item.customisation_data or getattr(item, "customisation_print_photo", ""):
            raise ValidationError({"order_item": ["Personalised items made to order cannot be exchanged."]})

        # Holdings & from_size determination
        # Regression case 3: from_size is server-derived from holdings.
        # Regression case 7: never invent units.
        holdings = size_holdings(item)
        if not holdings:
            raise ValidationError({"order_item": ["No units are currently held for this item."]})

        req_from_size = data.get("from_size")
        if req_from_size and req_from_size in holdings and holdings[req_from_size] > 0:
            from_size = req_from_size
        else:
            # If from_size not specified or invalid, default to the held size with positive units
            held_sizes = [s for s, count in holdings.items() if count > 0]
            if not held_sizes:
                raise ValidationError({"order_item": ["No units are currently held for this item."]})
            from_size = held_sizes[0]

        available_units = get_line_exchangeable_units(item, from_size)
        if available_units <= 0:
            raise ValidationError({"quantity": [f"No exchangeable units remain for size '{from_size}'."]})

        # Quantity validation
        try:
            quantity = int(data.get("quantity", 1))
        except (ValueError, TypeError):
            raise ValidationError({"quantity": ["Quantity must be a valid integer."]})

        if quantity < 1:
            raise ValidationError({"quantity": ["Quantity must be at least 1."]})
        if quantity > available_units:
            raise ValidationError({"quantity": [f"Requested quantity ({quantity}) exceeds available units ({available_units})."]})

        # Target variant validation
        target_variant_id = data.get("target_variant")
        target_size = data.get("target_size")
        product = item.variant.product

        if target_variant_id:
            target_variant = ProductVariant.objects.filter(pk=target_variant_id, product=product).first()
        elif target_size:
            target_variant = ProductVariant.objects.filter(product=product, size=target_size).first()
        else:
            raise ValidationError({"target_variant": ["Target variant or size is required."]})

        if not target_variant:
            raise ValidationError({"target_variant": ["Target variant does not exist for this product."]})

        if not target_variant.active:
            raise ValidationError({"target_variant": ["Requested variant is not active."]})

        # Regression case 9: Exchanging back to the originally ordered size IS permitted if currently holding a different size.
        if target_variant.size == from_size:
            raise ValidationError({"target_variant": [f"Cannot exchange size '{from_size}' for the same size."]})

        # Reason validation
        reason = data.get("reason")
        if reason not in SizeExchangeRequest.Reason.values:
            raise ValidationError({"reason": [f"Invalid exchange reason. Choices are: {SizeExchangeRequest.Reason.values}"]})

        # Owner decision O4: First exchange is free; later exchange goes to review with charge_paise = 0
        prior_requests_exist = SizeExchangeRequest.objects.filter(
            order=locked_order
        ).exclude(status=SizeExchangeRequest.Status.WITHDRAWN).exists()
        if prior_requests_exist:
            # TODO(O4): Later exchange sent to staff review with charge_paise = 0 and no payment step.
            review_reasons.append("LATER_EXCHANGE")

        # Owner decision O5: Home delivery swap routes to staff review until arrangement set
        if locked_order.fulfillment_type == Order.FulfillmentType.HOME_DELIVERY:
            # TODO(O5): Home swap routes to staff review (HOME_SWAP).
            review_reasons.append("HOME_SWAP")

        # Server-derived from_variant
        from_variant = ProductVariant.objects.filter(product=product, size=from_size).first()

        # Atomic reservation via apply_stock_movement
        try:
            apply_stock_movement(
                variant=target_variant,
                city_id=locked_order.city_id,
                quantity_change=-quantity,
                reason=StockMovement.Reason.EXCHANGE_RESERVE,
                reference_order=locked_order,
                created_by=user,
            )
        except InsufficientStockError:
            # Sells out while submitting: 409 {code: "SIZE_SOLD_OUT", sizes: [...]}
            active_variants = list(product.variants.filter(active=True))
            flags = stock_flags(locked_order.city_id, [v.id for v in active_variants])
            sizes_data = [
                {
                    "variant_id": str(v.id),
                    "size": v.size,
                    "available": flags.get(str(v.id)) in ("IN_STOCK", "LOW_STOCK"),
                    "availability": flags.get(str(v.id), "OUT_OF_STOCK"),
                }
                for v in active_variants
            ]
            raise SizeSoldOutError(sizes_data)

        # Create SizeExchangeRequest record
        # TODO(O6): Hold duration has no automatic expiry. Shows 'held since' and age in queue.
        req_obj = SizeExchangeRequest.objects.create(
            order=locked_order,
            order_item=item,
            status=SizeExchangeRequest.Status.REQUESTED,
            reason=reason,
            from_size=from_size,
            from_variant=from_variant,
            target_variant=target_variant,
            quantity=quantity,
            reservation=SizeExchangeRequest.Reservation.HELD,
            reserved_at=timezone.now(),
            review_reasons=review_reasons,
            window_starts_at=window_starts_at,
            window_ends_at=window_ends_at,
            charge_paise=0,
            idempotency_key=idempotency_key,
            created_by=user,
        )

        return req_obj, True


def withdraw_size_exchange_request(request_obj: SizeExchangeRequest, user) -> SizeExchangeRequest:
    """
    Parent withdraws an exchange request while REQUESTED or APPROVED.
    Atomically releases the reserved target variant stock once.
    Regression case 8: Withdrawing twice is idempotent and does not release stock twice.
    """
    with transaction.atomic():
        req = SizeExchangeRequest.objects.select_for_update().get(pk=request_obj.pk)
        if user.role == "PARENT" and req.order.parent_id != user.id and req.order.placed_by_id != user.id:
            raise PermissionDenied("You can only withdraw requests for your own orders.")

        # Idempotent return if already withdrawn
        if req.status == SizeExchangeRequest.Status.WITHDRAWN:
            return req

        if req.status not in (SizeExchangeRequest.Status.REQUESTED, SizeExchangeRequest.Status.APPROVED):
            raise ValidationError({"status": [f"Cannot withdraw a request that is {req.get_status_display().lower()}."]})

        # Release reservation if HELD
        if req.reservation == SizeExchangeRequest.Reservation.HELD:
            apply_stock_movement(
                variant=req.target_variant,
                city_id=req.order.city_id,
                quantity_change=req.quantity,
                reason=StockMovement.Reason.EXCHANGE_RELEASE,
                reference_order=req.order,
                created_by=user,
            )
            req.reservation = SizeExchangeRequest.Reservation.RELEASED
            req.released_at = timezone.now()

        req.status = SizeExchangeRequest.Status.WITHDRAWN
        req.save()
        return req


def review_size_exchange_request(
    request_obj: SizeExchangeRequest,
    staff_user,
    action: str,
    data: dict = None,
) -> SizeExchangeRequest:
    """
    Staff review, inspection, and completion workflow.
    TODO(O7): City Admin (own city) and Boss act; School Admin is read-only; Teacher nothing.
    """
    data = data or {}
    action = action.upper().strip()

    if staff_user.role not in ("BOSS", "ADMIN", "SCHOOL_ADMIN"):
        raise PermissionDenied("Only authorized staff may review size exchange requests.")

    # School admin is read-only
    if staff_user.role == "SCHOOL_ADMIN":
        # TODO(O7): School admin read-only
        raise PermissionDenied("School administrators have read-only access to exchange requests.")

    with transaction.atomic():
        req = SizeExchangeRequest.objects.select_for_update().get(pk=request_obj.pk)
        order = req.order

        # City scoping: City Admin can only act on their own city
        if staff_user.role == "ADMIN" and staff_user.city_id and order.city_id != staff_user.city_id:
            raise PermissionDenied("City administrators can only review requests for their assigned city.")

        # Allowed action state transitions
        # Regression case 4: RECEIVE straight from REQUESTED is blocked; APPROVE requires window confirmation.
        if action == "CONFIRM_WINDOW":
            confirmed_start_str = data.get("window_confirmed_start")
            note = (data.get("note") or "").strip()
            if not note:
                raise ValidationError({"note": ["A confirmation note is required to verify the delivery date."]})

            confirmed_start = timezone.now()
            if confirmed_start_str:
                try:
                    confirmed_start = dt.datetime.fromisoformat(confirmed_start_str)
                    if timezone.is_naive(confirmed_start):
                        confirmed_start = timezone.make_aware(confirmed_start, IST)
                except Exception:
                    pass

            req.window_confirmed_start = confirmed_start
            req.window_confirmed_by = staff_user
            req.window_confirmed_at = timezone.now()
            req.window_confirmed_note = note

            # Recalculate window end
            confirmed_date = timezone.localtime(confirmed_start, IST).date()
            end_date = confirmed_date + dt.timedelta(days=7)
            end_dt_naive = dt.datetime.combine(end_date, dt.time.max)
            req.window_starts_at = confirmed_start
            req.window_ends_at = end_dt_naive.replace(tzinfo=IST)

            # Clear NO_DELIVERY_RECORD
            req.review_reasons = [r for r in req.review_reasons if r != "NO_DELIVERY_RECORD"]
            req.save()
            return req

        elif action == "SET_HANDOVER":
            method = data.get("handover_method")
            if method not in (
                SizeExchangeRequest.HandoverMethod.SCHOOL_COUNTER,
                SizeExchangeRequest.HandoverMethod.HOME_VISIT,
                SizeExchangeRequest.HandoverMethod.POSTAL,
            ):
                raise ValidationError({"handover_method": ["A valid handover arrangement method is required."]})

            req.handover_method = method
            req.handover_note = (data.get("note") or "").strip()
            # Clear HOME_SWAP
            req.review_reasons = [r for r in req.review_reasons if r != "HOME_SWAP"]
            req.save()
            return req

        elif action == "APPROVE":
            if req.status != SizeExchangeRequest.Status.REQUESTED:
                raise ValidationError({"status": [f"Cannot approve a request that is {req.get_status_display().lower()}."]})

            # Verify no blocking review reasons remain
            if "NO_DELIVERY_RECORD" in req.review_reasons:
                raise ValidationError({"review_reasons": ["Cannot approve without confirming delivery date record (CONFIRM_WINDOW)."]})
            if "HOME_SWAP" in req.review_reasons:
                raise ValidationError({"review_reasons": ["Cannot approve without setting home swap arrangement (SET_HANDOVER)."]})

            # Check window validity
            if req.window_ends_at and timezone.now() > req.window_ends_at:
                raise ValidationError({"window": ["The confirmed delivery window has expired. Cannot approve."]})

            req.status = SizeExchangeRequest.Status.APPROVED
            if not req.handover_method:
                req.handover_method = (
                    SizeExchangeRequest.HandoverMethod.HOME_VISIT
                    if order.fulfillment_type == Order.FulfillmentType.HOME_DELIVERY
                    else SizeExchangeRequest.HandoverMethod.SCHOOL_COUNTER
                )
            req.save()
            return req

        elif action == "RECEIVE":
            # Regression case 4: INSPECT/RECEIVE directly from REQUESTED is blocked
            if req.status != SizeExchangeRequest.Status.APPROVED:
                raise ValidationError({"status": ["Staff can only receive and inspect items after the request is APPROVED."]})

            # Secure check: Staff must tick that replacement is set aside
            set_aside = data.get("replacement_set_aside")
            if not set_aside:
                raise ValidationError({"replacement_set_aside": ["You must confirm that the replacement size is set aside before accepting the original."]})

            # Confirm reservation is HELD, or attempt re-reservation once
            if req.reservation != SizeExchangeRequest.Reservation.HELD:
                try:
                    apply_stock_movement(
                        variant=req.target_variant,
                        city_id=order.city_id,
                        quantity_change=-req.quantity,
                        reason=StockMovement.Reason.EXCHANGE_RESERVE,
                        reference_order=order,
                        created_by=staff_user,
                    )
                    req.reservation = SizeExchangeRequest.Reservation.HELD
                    req.reserved_at = timezone.now()
                except InsufficientStockError:
                    raise ReplacementNotSecuredError()

            req.replacement_set_aside_by = staff_user
            req.replacement_set_aside_at = timezone.now()

            condition = data.get("condition", SizeExchangeRequest.Condition.RESTOCKABLE)
            note = (data.get("condition_note") or "").strip()

            if condition == SizeExchangeRequest.Condition.RESTOCKABLE:
                req.condition = SizeExchangeRequest.Condition.RESTOCKABLE
                req.condition_note = note
                req.received_at = timezone.now()
                req.received_by = staff_user

                # Restock original variant (Regression 2: from_variant, not ordered variant)
                from_var = req.from_variant or ProductVariant.objects.filter(product=req.target_variant.product, size=req.from_size).first()
                if not req.is_restocked and from_var:
                    apply_stock_movement(
                        variant=from_var,
                        city_id=order.city_id,
                        quantity_change=req.quantity,
                        reason=StockMovement.Reason.RETURN,
                        reference_order=order,
                        created_by=staff_user,
                    )
                    req.is_restocked = True

                # Regression 1: Once accepted as RESTOCKABLE, reservation is LOCKED
                req.reservation = SizeExchangeRequest.Reservation.LOCKED
                req.status = SizeExchangeRequest.Status.RECEIVED
                req.save()
                return req

            elif condition == SizeExchangeRequest.Condition.NOT_RESTOCKABLE:
                if not note:
                    raise ValidationError({"condition_note": ["A reason note (worn, washed, tags missing) is required when marking as not restockable."]})

                req.condition = SizeExchangeRequest.Condition.NOT_RESTOCKABLE
                req.condition_note = note
                req.received_at = timezone.now()
                req.received_by = staff_user
                req.is_restocked = False

                # Release the replacement once
                apply_stock_movement(
                    variant=req.target_variant,
                    city_id=order.city_id,
                    quantity_change=req.quantity,
                    reason=StockMovement.Reason.EXCHANGE_RELEASE,
                    reference_order=order,
                    created_by=staff_user,
                )
                req.reservation = SizeExchangeRequest.Reservation.RELEASED
                req.released_at = timezone.now()

                # Audit damage movement without adding to sellable stock
                from_var = req.from_variant or ProductVariant.objects.filter(product=req.target_variant.product, size=req.from_size).first()
                if from_var:
                    StockMovement.objects.create(
                        variant=from_var,
                        city_id=order.city_id,
                        school_id=order.school_id,
                        quantity_change=0,
                        reason=StockMovement.Reason.DAMAGE,
                        reference_order=order,
                        created_by=staff_user,
                    )

                req.status = SizeExchangeRequest.Status.INSPECTION_FAILED
                req.original_disposition = SizeExchangeRequest.OriginalDisposition.HELD_AT_COUNTER
                # TODO(O8): Uncollected originals stay visible in queue with age.
                req.save()
                return req
            else:
                raise ValidationError({"condition": ["Condition must be RESTOCKABLE or NOT_RESTOCKABLE."]})

        elif action == "RETURN_ORIGINAL":
            if req.status != SizeExchangeRequest.Status.INSPECTION_FAILED or req.original_disposition != SizeExchangeRequest.OriginalDisposition.HELD_AT_COUNTER:
                raise ValidationError({"status": ["Can only record return of original for items marked INSPECTION_FAILED and HELD_AT_COUNTER."]})

            recipient = (data.get("received_by_name") or "").strip()
            if not recipient:
                raise ValidationError({"received_by_name": ["Name of the person who collected the rejected original is required."]})

            req.original_disposition = SizeExchangeRequest.OriginalDisposition.RETURNED_TO_PARENT
            req.original_returned_at = timezone.now()
            req.original_returned_by = staff_user
            req.status = SizeExchangeRequest.Status.REJECTED
            req.rejection_reason = f"Returned to {recipient}: {req.condition_note}"
            req.save()
            return req

        elif action == "COMPLETE":
            # Idempotency
            if req.status == SizeExchangeRequest.Status.COMPLETED:
                return req

            if req.status != SizeExchangeRequest.Status.RECEIVED:
                raise ValidationError({"status": ["Can only complete an exchange that is in RECEIVED status."]})
            if req.condition != SizeExchangeRequest.Condition.RESTOCKABLE:
                raise ValidationError({"condition": ["Cannot complete an exchange unless the returned item is RESTOCKABLE."]})
            if req.reservation != SizeExchangeRequest.Reservation.LOCKED:
                raise ValidationError({"reservation": ["Cannot complete an exchange without a LOCKED reservation."]})

            evidence = data.get("handover_evidence")
            if evidence not in (
                SizeExchangeRequest.HandoverEvidence.COUNTER_HANDOVER,
                SizeExchangeRequest.HandoverEvidence.HOME_VISIT,
                SizeExchangeRequest.HandoverEvidence.POSTAL_DELIVERED,
            ):
                raise ValidationError({"handover_evidence": ["Valid handover evidence is required to complete the exchange."]})

            # Postal cannot complete in Day 4 (waits for Day 3 integration)
            # TODO(O5), TODO(O11)
            if evidence == SizeExchangeRequest.HandoverEvidence.POSTAL_DELIVERED:
                article_no = (data.get("article_number") or "").strip()
                delivery_confirmed = data.get("delivery_confirmed")
                if not article_no or not delivery_confirmed:
                    raise ValidationError({"handover_evidence": ["Postal exchange completion requires article tracking number and confirmed delivery (Day 3 follow-up)."]})

            recipient_name = (data.get("received_by_name") or "").strip()
            if not recipient_name:
                raise ValidationError({"received_by_name": ["Recipient name is required."]})

            req.handover_evidence = evidence
            req.handed_over_at = timezone.now()
            req.handed_over_by = staff_user
            req.received_by_name = recipient_name
            req.handover_note = (data.get("handover_note") or "").strip()

            # Create exactly one OrderItemExchange record
            exchange_record = OrderItemExchange.objects.create(
                order_item=req.order_item,
                from_size=req.from_size,
                to_size=req.target_variant.size,
                quantity=req.quantity,
                reason=req.reason,
                note=f"Exchange completed ({evidence}): {req.handover_note}".strip(),
                created_by=staff_user,
            )

            req.exchange_record = exchange_record
            req.reservation = SizeExchangeRequest.Reservation.CONSUMED
            req.status = SizeExchangeRequest.Status.COMPLETED
            req.save()
            return req

        elif action == "REJECT":
            # Regression 1: Once LOCKED, reject is refused!
            if req.reservation == SizeExchangeRequest.Reservation.LOCKED:
                raise ValidationError({"reservation": ["Original item was already restocked into sellable inventory. Replacement is locked and cannot be rejected."]})

            if req.status not in (SizeExchangeRequest.Status.REQUESTED, SizeExchangeRequest.Status.APPROVED):
                raise ValidationError({"status": [f"Cannot reject a request that is {req.get_status_display().lower()}."]})

            # Release reservation if HELD
            if req.reservation == SizeExchangeRequest.Reservation.HELD:
                apply_stock_movement(
                    variant=req.target_variant,
                    city_id=order.city_id,
                    quantity_change=req.quantity,
                    reason=StockMovement.Reason.EXCHANGE_RELEASE,
                    reference_order=order,
                    created_by=staff_user,
                )
                req.reservation = SizeExchangeRequest.Reservation.RELEASED
                req.released_at = timezone.now()

            req.status = SizeExchangeRequest.Status.REJECTED
            req.rejection_reason = (data.get("note") or "Rejected by staff.").strip()
            req.save()
            return req

        elif action == "REVERSE_RECEIPT":
            # Boss-only action
            if staff_user.role != "BOSS":
                raise PermissionDenied("Only the BOSS role may reverse a recorded inspection receipt.")

            if req.status != SizeExchangeRequest.Status.RECEIVED or req.condition != SizeExchangeRequest.Condition.RESTOCKABLE:
                raise ValidationError({"status": ["Can only reverse receipt for items currently in RECEIVED status with RESTOCKABLE condition."]})

            # Reverse the restock: from_variant stock -quantity
            from_var = req.from_variant or ProductVariant.objects.filter(product=req.target_variant.product, size=req.from_size).first()
            if req.is_restocked and from_var:
                apply_stock_movement(
                    variant=from_var,
                    city_id=order.city_id,
                    quantity_change=-req.quantity,
                    reason=StockMovement.Reason.ADJUSTMENT,
                    reference_order=order,
                    created_by=staff_user,
                )
                req.is_restocked = False

            req.reservation = SizeExchangeRequest.Reservation.HELD
            req.condition = SizeExchangeRequest.Condition.UNCHECKED
            req.status = SizeExchangeRequest.Status.APPROVED
            req.save()
            return req

        else:
            raise ValidationError({"action": [f"Unknown review action '{action}'."]})
