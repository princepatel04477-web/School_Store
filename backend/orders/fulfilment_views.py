"""
Fulfilment endpoints for the City Admin packing queue.

Registered under /api/fulfilment/. BOSS and ADMIN only, city-scoped.
"""

from typing import Any
import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import Count
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin

from . import fulfilment_gate
from .fulfilment import (
    FulfilmentError,
    PackingRuleNotWired,
    claim_order,
    clear_issue,
    correct_article_number,
    dispatch_order,
    mark_delivered,
    mark_ready_for_pickup,
    pack_order,
    release_claim,
    report_issue,
)
from .fulfilment_gate import get_packing_decision
from .models import Order, OrderItem
from .serializers import OrderItemSerializer


def handle_fulfilment_exception(exc: Exception) -> Response:
    """Map fulfilment exceptions to unified JSON error responses."""
    if isinstance(exc, PackingRuleNotWired):
        return Response(
            {
                "code": "PACKING_RULE_NOT_WIRED",
                "detail": str(exc),
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if isinstance(exc, FulfilmentError):
        payload: dict[str, Any] = {
            "code": exc.code,
            "detail": exc.detail,
        }
        if exc.reason is not None:
            payload["reason"] = exc.reason
        return Response(payload, status=exc.status_code)
    if isinstance(exc, DjangoValidationError):
        if hasattr(exc, "message_dict"):
            first_msgs = next(iter(exc.message_dict.values()), [])
            detail = first_msgs[0] if first_msgs else str(exc)
        elif hasattr(exc, "messages") and exc.messages:
            detail = exc.messages[0]
        else:
            detail = str(exc)
        return Response(
            {
                "code": "VALIDATION_ERROR",
                "detail": detail,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if isinstance(exc, IntegrityError):
        return Response(
            {
                "code": "ARTICLE_NUMBER_IN_USE",
                "detail": "This article number is already in use by another parcel.",
            },
            status=status.HTTP_409_CONFLICT,
        )
    raise exc


def get_serializer_error_response(serializer: serializers.Serializer) -> Response:
    """Extract first error into {code, detail} structure with HTTP 400."""
    for field_name, errors in serializer.errors.items():
        if isinstance(errors, list) and errors:
            first_err = errors[0]
            err_code = getattr(first_err, "code", None)
            detail = str(first_err)
            if err_code == "RECEIPT_NOT_CONFIRMED" or field_name == "receipt_confirmed":
                return Response(
                    {
                        "code": "RECEIPT_NOT_CONFIRMED",
                        "detail": "You must confirm you checked the number against the India Post receipt.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if field_name == "article_number":
                if err_code in ("blank", "required"):
                    return Response(
                        {
                            "code": "BLANK_ARTICLE_NUMBER",
                            "detail": "Article number cannot be blank.",
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                return Response(
                    {"code": "VALIDATION_ERROR", "detail": detail},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            code_str = str(err_code).upper() if err_code else "VALIDATION_ERROR"
            return Response(
                {"code": code_str, "detail": detail},
                status=status.HTTP_400_BAD_REQUEST,
            )
    return Response(
        {"code": "VALIDATION_ERROR", "detail": "Invalid input."},
        status=status.HTTP_400_BAD_REQUEST,
    )


class StrictReceiptConfirmedField(serializers.Field):
    """Boolean field requiring JSON boolean true strictly; rejects non-booleans, false, null, missing."""

    default_error_messages = {
        "invalid": "You must confirm you checked the number against the India Post receipt.",
        "required": "You must confirm you checked the number against the India Post receipt.",
        "null": "You must confirm you checked the number against the India Post receipt.",
    }

    def to_internal_value(self, data):
        if data is not True:
            raise serializers.ValidationError(
                self.error_messages["invalid"],
                code="RECEIPT_NOT_CONFIRMED",
            )
        return True

    def run_validation(self, data=serializers.empty):
        if data is serializers.empty or data is None or data is not True:
            raise serializers.ValidationError(
                self.error_messages["invalid"],
                code="RECEIPT_NOT_CONFIRMED",
            )
        return True


class DispatchSerializer(serializers.Serializer):
    article_number = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=40,
        trim_whitespace=True,
    )
    receipt_confirmed = StrictReceiptConfirmedField(required=True)


class CorrectArticleNumberSerializer(serializers.Serializer):
    article_number = serializers.CharField(
        required=True,
        allow_blank=False,
        max_length=40,
        trim_whitespace=True,
    )
    reason = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=500,
        trim_whitespace=True,
        default="",
    )


class OrderIdsSerializer(serializers.Serializer):
    order_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        max_length=200,
    )


class FulfilmentQueueSerializer(serializers.ModelSerializer):
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_code = serializers.CharField(source="school.code", read_only=True)
    student_name = serializers.CharField(source="student.name", read_only=True)
    student_gr = serializers.CharField(source="student.gr_number", read_only=True)
    items_count = serializers.IntegerField(read_only=True)

    can_pack = serializers.BooleanField(read_only=True, default=None)
    blocked_reason = serializers.CharField(
        read_only=True, default=None, allow_null=True
    )
    blocked_message = serializers.CharField(
        read_only=True, default=None, allow_null=True
    )

    claimed_by_name = serializers.SerializerMethodField()
    claimed_by_me = serializers.SerializerMethodField()
    claimed_at = serializers.SerializerMethodField()
    packed_by_name = serializers.SerializerMethodField()
    packed_at = serializers.SerializerMethodField()
    issue_note = serializers.SerializerMethodField()

    consignment_number = serializers.SerializerMethodField()
    dispatched_at = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "school_name",
            "school_code",
            "student_name",
            "student_gr",
            "fulfillment_type",
            "payment_status",
            "payment_method",
            "status",
            "items_count",
            "total",
            "created_at",
            "can_pack",
            "blocked_reason",
            "blocked_message",
            "claimed_by_name",
            "claimed_by_me",
            "claimed_at",
            "packed_by_name",
            "packed_at",
            "issue_note",
            "consignment_number",
            "dispatched_at",
        )
        read_only_fields = fields

    def _get_packing(self, obj):
        try:
            return getattr(obj, "packing", None)
        except Exception:
            return None

    def _get_shipment(self, obj):
        try:
            return getattr(obj, "shipment", None)
        except Exception:
            return None

    def get_claimed_by_name(self, obj):
        packing = self._get_packing(obj)
        if packing and packing.claimed_by:
            return packing.claimed_by.get_full_name() or packing.claimed_by.username
        return None

    def get_claimed_by_me(self, obj):
        request = self.context.get("request")
        if not request or not request.user:
            return False
        packing = self._get_packing(obj)
        return bool(packing and packing.claimed_by_id == request.user.id)

    def get_claimed_at(self, obj):
        packing = self._get_packing(obj)
        return packing.claimed_at if packing else None

    def get_packed_by_name(self, obj):
        packing = self._get_packing(obj)
        if packing and packing.packed_by:
            return packing.packed_by.get_full_name() or packing.packed_by.username
        return None

    def get_packed_at(self, obj):
        packing = self._get_packing(obj)
        return packing.packed_at if packing else None

    def get_issue_note(self, obj):
        packing = self._get_packing(obj)
        return packing.issue_note if packing else ""

    def get_consignment_number(self, obj):
        shipment = self._get_shipment(obj)
        return shipment.consignment_number if shipment else None

    def get_dispatched_at(self, obj):
        shipment = self._get_shipment(obj)
        return shipment.booked_at if shipment else None


class FulfilmentViewSet(ScopedQuerysetMixin, viewsets.GenericViewSet):
    # Joins only on the read-only queryset for flat query count
    queryset = Order.objects.select_related(
        "school",
        "student",
        "shipment",
        "packing",
        "packing__claimed_by",
        "packing__packed_by",
    ).order_by("-created_at")

    pagination_class = BoundedCursorPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN")
    write_roles = ("BOSS", "ADMIN")
    serializer_class = FulfilmentQueueSerializer

    scope_city_field = "city_id"
    scope_school_field = None
    scope_parent_field = None

    def _get_scoped_order(self, pk):
        try:
            return self.get_queryset().get(pk=pk)
        except (Order.DoesNotExist, ValueError):
            raise FulfilmentError(
                code="NOT_FOUND",
                detail="Order not found.",
                status_code=404,
            )

    def _scoped_ids(self, order_ids):
        """Return the subset of order_ids visible to this user."""
        return set(
            self.get_queryset()
            .filter(id__in=order_ids)
            .values_list("id", flat=True)
        )

    @action(detail=False, methods=["get"], url_path="queue")
    def queue(self, request):
        stage = request.query_params.get("stage", "to_pack")
        qs = self.get_queryset().annotate(items_count=Count("items"))

        school = request.query_params.get("school")
        if school:
            qs = qs.filter(school_id=school)

        ft = request.query_params.get("fulfillment_type")
        if ft:
            qs = qs.filter(fulfillment_type=ft)

        if stage == "to_pack":
            qs = qs.filter(
                status__in=[Order.Status.CONFIRMED, Order.Status.PROCESSING]
            )
        elif stage == "to_dispatch":
            qs = qs.filter(status=Order.Status.PACKED)
        elif stage == "dispatched":
            # Includes legacy SHIPPED orders (Defect A5)
            qs = qs.filter(
                status__in=[Order.Status.DISPATCHED, Order.Status.SHIPPED]
            )
        else:
            return Response(
                {"stage": ["Must be to_pack, to_dispatch, or dispatched."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        page = self.paginate_queryset(qs)
        if page is None:
            page = list(qs[:50])

        # Compute gate decisions for to_pack rows on this page only
        if stage == "to_pack":
            for order in page:
                decision = fulfilment_gate.get_packing_decision(order)
                order.can_pack = decision.allowed
                order.blocked_reason = decision.reason
                order.blocked_message = decision.message
        else:
            for order in page:
                order.can_pack = None
                order.blocked_reason = None
                order.blocked_message = None

        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"], url_path="packing-list")
    def packing_list(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

        # Lines list with product name, sku, size, quantity, multiple, personalisation
        # Never include a child's measurements
        items = (
            order.items.select_related("variant", "variant__product")
            .all()
            .order_by("id")
        )
        dummy_serializer = OrderItemSerializer()

        lines = []
        for item in items:
            product = item.variant.product
            customisation = dummy_serializer.get_customisation_display(item)
            lines.append(
                {
                    "id": str(item.id),
                    "product_name": product.name,
                    "sku": item.variant.sku,
                    "size": item.current_size,
                    "quantity": item.quantity,
                    "multiple": item.quantity > 1,
                    "personalisation": customisation,
                }
            )

        packing = getattr(order, "packing", None)
        return Response(
            {
                "order_id": str(order.id),
                "order_number": order.order_number,
                "status": order.status,
                "is_claimed_by_me": bool(
                    packing and packing.claimed_by_id == request.user.id
                ),
                "claimed_by_name": (
                    packing.claimed_by.get_full_name()
                    or packing.claimed_by.username
                    if packing and packing.claimed_by
                    else None
                ),
                "issue_note": packing.issue_note if packing else "",
                "lines": lines,
            }
        )

    @action(detail=True, methods=["post"], url_path="claim")
    def claim(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
            result = claim_order(order.id, request.user)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

    @action(detail=True, methods=["post"], url_path="release")
    def release(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
            result = release_claim(order.id, request.user)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

    @action(detail=True, methods=["post"], url_path="issue")
    def issue(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
            note = request.data.get("note", "")
            result = report_issue(order.id, request.user, note)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

    @action(detail=True, methods=["post"], url_path="issue/clear")
    def clear_issue(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
            result = clear_issue(order.id, request.user)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

    @action(detail=True, methods=["post"], url_path="pack")
    def pack(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
            confirmed_item_ids = request.data.get("confirmed_item_ids", [])
            note = (request.data.get("note") or "").strip()
            result = pack_order(
                order.id,
                request.user,
                confirmed_item_ids=confirmed_item_ids,
                note=note,
            )
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_shipment(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
            ser = DispatchSerializer(data=request.data)
            if not ser.is_valid():
                return get_serializer_error_response(ser)
            result = dispatch_order(
                order_id=order.id,
                user=request.user,
                article_number=ser.validated_data["article_number"],
                receipt_confirmed=ser.validated_data["receipt_confirmed"],
            )
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

    @action(detail=True, methods=["post"], url_path="correct-article-number")
    def correct_number(self, request, pk=None):
        try:
            order = self._get_scoped_order(pk)
            ser = CorrectArticleNumberSerializer(data=request.data)
            if not ser.is_valid():
                return get_serializer_error_response(ser)
            result = correct_article_number(
                order_id=order.id,
                user=request.user,
                article_number=ser.validated_data["article_number"],
                reason=ser.validated_data.get("reason", ""),
            )
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            return handle_fulfilment_exception(exc)

    @action(detail=False, methods=["post"], url_path="ready-for-pickup")
    def ready_for_pickup(self, request):
        ser = OrderIdsSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        order_ids = ser.validated_data["order_ids"]
        scoped = self._scoped_ids(order_ids)
        skipped = [
            str(oid)
            for oid in order_ids
            if str(oid) not in {str(s) for s in scoped}
        ]
        changed = mark_ready_for_pickup(list(scoped), request.user)
        return Response(
            {
                "updated_ids": changed,
                "skipped_ids": skipped,
            }
        )

    @action(detail=False, methods=["post"], url_path="delivered")
    def delivered(self, request):
        ser = OrderIdsSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        order_ids = ser.validated_data["order_ids"]
        scoped = self._scoped_ids(order_ids)
        skipped = [
            str(oid)
            for oid in order_ids
            if str(oid) not in {str(s) for s in scoped}
        ]
        changed = mark_delivered(list(scoped), request.user)
        return Response(
            {
                "updated_ids": changed,
                "skipped_ids": skipped,
            }
        )
