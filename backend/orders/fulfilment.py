"""Staff fulfilment endpoints. The order row serializes payment and packing changes."""

import unicodedata

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from common.pagination import BoundedCursorPagination
from common.scoping import apply_user_scope

from .models import Order, OrderPacking, Shipment, ShipmentCorrection
from .payment_rules import packing_decision
from .status import change_order_status

S = Order.Status
MANAGED_STATUSES = (S.PROCESSING, S.PACKED, S.DISPATCHED, S.DELIVERED)
QUEUE_STATUSES = (S.PLACED, S.PENDING, S.CONFIRMED, *MANAGED_STATUSES, S.SHIPPED)


class Conflict(APIException):
    status_code = 409


class PackingUpdate(serializers.Serializer):
    item_id = serializers.UUIDField()
    confirmed = serializers.BooleanField()


class Issue(serializers.Serializer):
    issue = serializers.CharField(allow_blank=True, max_length=500)


class ArticleNumber(serializers.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class Handover(serializers.Serializer):
    article_number = ArticleNumber(max_length=40)
    receipt_confirmed = serializers.JSONField()

    def validate_receipt_confirmed(self, value):
        if value is not True:
            raise serializers.ValidationError("Confirm receipt of the postal booking.")
        return value

    def validate(self, attrs):
        if "booked_at" in self.initial_data:
            raise serializers.ValidationError({"booked_at": "Booking time is set by the server."})
        return attrs


class Correction(serializers.Serializer):
    article_number = ArticleNumber(max_length=40)
    reason = serializers.CharField(max_length=500)


INPUTS = {"confirm": PackingUpdate, "issue": Issue, "handover": Handover, "correct": Correction}
COMMANDS = ("claim", "pack", "pickup", "deliver", *INPUTS)


def scoped_orders(user):
    if user.role not in ("ADMIN", "BOSS") and not user.is_superuser:
        raise PermissionDenied("Fulfilment is restricted to City Admin and Boss.")
    if user.role == "ADMIN" and not user.city_id and not user.is_superuser:
        return Order.objects.none()
    return apply_user_scope(Order.objects.all(), user)


def order_payload(order, user):
    packing = getattr(order, "packing", None)
    shipment = getattr(order, "shipment", None)
    active = order.status in (S.PLACED, S.PENDING, S.CONFIRMED, S.PROCESSING, S.PACKED)
    decision = packing_decision(order) if active else None
    return {
        "id": order.pk,
        "order_number": order.order_number,
        "status": order.status,
        "fulfillment_type": order.fulfillment_type,
        "blocked_reason": decision.reason_code if decision else "",
        "claimed": packing is not None,
        "claimed_by_me": packing is not None and packing.claimed_by_id == user.pk,
        "issue": packing.issue if packing else "",
        "confirmed_items": packing.confirmed_items if packing else [],
        "items": [
            {"id": item.pk, "name": item.variant.product.name, "size": item.variant.size, "quantity": item.quantity}
            for item in order.items.all()
        ],
        "article_number": shipment.article_number if shipment else None,
        "booked_at": shipment.booked_at if shipment else None,
        "corrections": [
            {
                "previous_number": change.previous_number,
                "article_number": change.article_number,
                "reason": change.reason,
                "changed_at": change.changed_at,
            }
            for change in shipment.corrections.all()
        ] if shipment else [],
    }


def article_key(number):
    key = "".join(
        char for char in unicodedata.normalize("NFKC", number).casefold()
        if not char.isspace() and unicodedata.category(char) != "Pd"
    )
    if not key or len(key) > 120:
        raise ValidationError({"article_number": "Enter a valid article number from the receipt."})
    return key


def require_eligible(order):
    decision = packing_decision(order)
    if not decision.allowed:
        raise Conflict({"code": decision.reason_code, "detail": "Resolve payment before fulfilment."})


def move(order, user, target):
    if not change_order_status(Order.objects.filter(pk=order.pk), target, user):
        raise Conflict("The order cannot make this transition.")
    order.status = target


def save_article(order, shipment, user, values):
    number = values["article_number"]
    key = article_key(number)
    try:
        with transaction.atomic():
            if shipment is None:
                Shipment.objects.create(order=order, article_number=number, article_key=key, booked_by=user)
            elif shipment.article_number != number:
                ShipmentCorrection.objects.create(
                    shipment=shipment, previous_number=shipment.article_number,
                    article_number=number, reason=values["reason"], changed_by=user,
                )
                shipment.article_number = number
                shipment.article_key = key
                shipment.save(update_fields=("article_number", "article_key"))
    except IntegrityError:
        duplicates = Shipment.objects.filter(article_key=key).exclude(order=order)
        if not duplicates.exists():
            raise
        raise Conflict({"code": "DUPLICATE_ARTICLE_NUMBER", "detail": "That article number is already assigned."})


class FulfilmentQueue(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = scoped_orders(request.user).filter(status__in=QUEUE_STATUSES)
        tab = request.query_params.get("tab", "packing")
        if tab == "sent":
            qs = qs.filter(status__in=(S.DISPATCHED, S.SHIPPED, S.DELIVERED))
        elif tab == "packing":
            qs = qs.exclude(status__in=(S.DISPATCHED, S.SHIPPED, S.DELIVERED))
        else:
            raise ValidationError({"tab": "Choose packing or sent."})
        pager = BoundedCursorPagination()
        orders = pager.paginate_queryset(qs.select_related("packing", "shipment").prefetch_related(
            "items__variant__product", "shipment__corrections",
        ), request, view=self)
        return pager.get_paginated_response([order_payload(order, request.user) for order in orders])


class FulfilmentOrder(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, order_id, command=None):
        if command is not None:
            return self.http_method_not_allowed(request)
        return Response(order_payload(get_object_or_404(scoped_orders(request.user), pk=order_id), request.user))

    @transaction.atomic
    def post(self, request, order_id, command=None):
        if command is None:
            return self.http_method_not_allowed(request)
        user = request.user
        order = get_object_or_404(scoped_orders(user).select_for_update(), pk=order_id)
        if command not in COMMANDS:
            raise ValidationError({"command": "Unknown fulfilment action."})
        values = {}
        if command in INPUTS:
            serializer = INPUTS[command](data=request.data)
            serializer.is_valid(raise_exception=True)
            values = serializer.validated_data

        packing = getattr(order, "packing", None)
        shipment = getattr(order, "shipment", None)
        if command == "claim":
            require_eligible(order)
            if order.status not in (S.PLACED, S.PENDING, S.CONFIRMED, S.PROCESSING, S.PACKED):
                raise Conflict("This order is outside the packing queue.")
            if packing is None:
                if order.status not in (S.PROCESSING, S.PACKED):
                    move(order, user, S.PROCESSING)
                OrderPacking.objects.create(order=order, claimed_by=user)
            elif packing.claimed_by_id != user.pk:
                raise Conflict("Another staff member has claimed this order.")
        elif command == "correct":
            if shipment is None:
                raise Conflict("This order has no postal booking to correct.")
            save_article(order, shipment, user, values)
        elif command == "deliver":
            if order.fulfillment_type != Order.FulfillmentType.HOME_DELIVERY:
                raise Conflict("Use the pickup action for school orders.")
            if order.status != S.DELIVERED:
                require_eligible(order)
                move(order, user, S.DELIVERED)
        else:
            if packing is None or packing.claimed_by_id != user.pk:
                raise Conflict("Claim the order before making this change.")
            require_eligible(order)
            if command in ("confirm", "issue") and order.status != S.PROCESSING:
                raise Conflict("Only orders being packed can be edited.")
            if command == "confirm":
                if not order.items.filter(pk=values["item_id"]).exists():
                    raise ValidationError({"item_id": "Select an item from this order."})
                confirmed = set(packing.confirmed_items)
                item_id = str(values["item_id"])
                if values["confirmed"]:
                    confirmed.add(item_id)
                else:
                    confirmed.discard(item_id)
                packing.confirmed_items = sorted(confirmed)
                packing.save(update_fields=("confirmed_items",))
            elif command == "issue":
                packing.issue = values["issue"]
                packing.save(update_fields=("issue",))
            elif command == "pack" and order.status != S.PACKED:
                actual = {str(item.pk) for item in order.items.all()}
                if not actual or actual != set(packing.confirmed_items) or packing.issue:
                    raise Conflict("Confirm all items and resolve packing issues first.")
                move(order, user, S.PACKED)
            elif command == "handover":
                if order.fulfillment_type != Order.FulfillmentType.HOME_DELIVERY:
                    raise Conflict("School pickup orders do not have postal bookings.")
                if shipment is None:
                    if order.status != S.PACKED:
                        raise Conflict("Pack the order before postal handover.")
                    save_article(order, None, user, values)
                    move(order, user, S.DISPATCHED)
                elif shipment.article_number != values["article_number"]:
                    raise Conflict("Use the correction action to change a booked article number.")
            elif command == "pickup":
                if order.fulfillment_type != Order.FulfillmentType.SCHOOL_PICKUP:
                    raise Conflict("Use postal handover for home delivery.")
                if order.status != S.DELIVERED:
                    if order.status != S.PACKED:
                        raise Conflict("Pack the order before pickup.")
                    move(order, user, S.DELIVERED)
        return Response(order_payload(Order.objects.get(pk=order.pk), user))
