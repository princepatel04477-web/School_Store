"""
Fulfilment endpoints for the City Admin packing queue.

Registered under /api/fulfilment/. BOSS and ADMIN only, city-scoped.
"""

from django.db import IntegrityError
from django.db.models import Count
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin, apply_user_scope

from .fulfilment import (
    PackingRuleNotWired,
    dispatch_order,
    mark_delivered,
    mark_ready_for_pickup,
    pack_orders,
)
from .fulfilment_gate import get_packing_decision
from .models import Order


class FulfilmentQueueSerializer(serializers.ModelSerializer):
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_code = serializers.CharField(source="school.code", read_only=True)
    student_name = serializers.CharField(source="student.name", read_only=True)
    student_gr = serializers.CharField(source="student.gr_number", read_only=True)
    items_count = serializers.IntegerField(read_only=True)
    # Gate fields: set dynamically for to_pack stage.
    can_pack = serializers.BooleanField(read_only=True, default=None)
    blocked_reason = serializers.CharField(read_only=True, default=None, allow_null=True)
    blocked_message = serializers.CharField(read_only=True, default=None, allow_null=True)
    # Shipment fields for dispatched stage.
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
            "consignment_number",
            "dispatched_at",
        )
        read_only_fields = fields

    def get_consignment_number(self, obj):
        try:
            shipment = getattr(obj, "shipment", None)
            return shipment.consignment_number if shipment else None
        except Exception:
            return None

    def get_dispatched_at(self, obj):
        try:
            shipment = getattr(obj, "shipment", None)
            return shipment.booked_at if shipment else None
        except Exception:
            return None


class FulfilmentViewSet(ScopedQuerysetMixin, viewsets.GenericViewSet):
    queryset = Order.objects.select_related(
        "school", "student", "shipment"
    ).order_by("-created_at")
    pagination_class = BoundedCursorPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN")
    write_roles = ("BOSS", "ADMIN")
    serializer_class = FulfilmentQueueSerializer

    scope_city_field = "city_id"
    scope_school_field = None
    scope_parent_field = None

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
            qs = qs.filter(status__in=[Order.Status.CONFIRMED, Order.Status.PROCESSING])
        elif stage == "to_dispatch":
            qs = qs.filter(status=Order.Status.PACKED)
        elif stage == "dispatched":
            qs = qs.filter(status=Order.Status.DISPATCHED)
        else:
            return Response(
                {"stage": ["Must be to_pack, to_dispatch, or dispatched."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        page = self.paginate_queryset(qs)
        if page is None:
            page = list(qs[:50])

        # Compute gate decisions for to_pack rows on this page only.
        if stage == "to_pack":
            for order in page:
                decision = get_packing_decision(order)
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

    @action(detail=False, methods=["post"], url_path="pack")
    def pack(self, request):
        order_ids = request.data.get("order_ids", [])
        if not order_ids or not isinstance(order_ids, list):
            return Response(
                {"order_ids": ["A non-empty list of order IDs is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(order_ids) > 200:
            return Response(
                {"order_ids": ["At most 200 orders per request."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        scoped = self._scoped_ids(order_ids)
        skipped = [str(oid) for oid in order_ids if str(oid) not in {str(s) for s in scoped}]
        note = (request.data.get("note") or "").strip()

        try:
            result = pack_orders(
                Order.objects.filter(id__in=scoped),
                request.user,
                note=note,
            )
        except PackingRuleNotWired as exc:
            return Response(
                {
                    "code": "PACKING_RULE_NOT_WIRED",
                    "detail": str(exc),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({
            "packed_ids": result.packed_ids,
            "blocked": result.blocked,
            "skipped_ids": skipped,
        })

    @action(detail=True, methods=["post"], url_path="dispatch")
    def dispatch_shipment(self, request, pk=None):
        # Check the order is in scope.
        try:
            order = self.get_queryset().get(pk=pk)
        except Order.DoesNotExist:
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        consignment_number = request.data.get("consignment_number", "")
        booked_at = request.data.get("booked_at")

        try:
            shipment = dispatch_order(
                order_id=order.id,
                user=request.user,
                consignment_number=consignment_number,
                booked_at=booked_at,
            )
        except IntegrityError:
            return Response(
                {"consignment_number": ["This consignment number is already in use."]},
                status=status.HTTP_409_CONFLICT,
            )
        except (ValueError, Exception) as exc:
            from django.core.exceptions import ValidationError as DjangoValidationError

            if isinstance(exc, DjangoValidationError):
                msg_dict = exc.message_dict if hasattr(exc, "message_dict") else {}
                if "consignment_number" in msg_dict:
                    msgs = " ".join(str(m) for m in msg_dict["consignment_number"])
                    if "already exists" in msgs.lower():
                        return Response(
                            {"consignment_number": ["This consignment number is already in use."]},
                            status=status.HTTP_409_CONFLICT,
                        )
                return Response(
                    {"detail": msg_dict if msg_dict else str(exc)},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if isinstance(exc, ValueError):
                return Response(
                    {"detail": str(exc)},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            raise

        return Response({
            "order_id": str(order.id),
            "consignment_number": shipment.consignment_number,
            "carrier": shipment.carrier,
            "booked_at": shipment.booked_at,
        })

    @action(detail=False, methods=["post"], url_path="ready-for-pickup")
    def ready_for_pickup(self, request):
        order_ids = request.data.get("order_ids", [])
        if not order_ids or not isinstance(order_ids, list):
            return Response(
                {"order_ids": ["A non-empty list of order IDs is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        scoped = self._scoped_ids(order_ids)
        skipped = [str(oid) for oid in order_ids if str(oid) not in {str(s) for s in scoped}]
        changed = mark_ready_for_pickup(list(scoped), request.user)
        return Response({
            "updated_ids": changed,
            "skipped_ids": skipped,
        })

    @action(detail=False, methods=["post"], url_path="delivered")
    def delivered(self, request):
        order_ids = request.data.get("order_ids", [])
        if not order_ids or not isinstance(order_ids, list):
            return Response(
                {"order_ids": ["A non-empty list of order IDs is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        scoped = self._scoped_ids(order_ids)
        skipped = [str(oid) for oid in order_ids if str(oid) not in {str(s) for s in scoped}]
        changed = mark_delivered(list(scoped), request.user)
        return Response({
            "updated_ids": changed,
            "skipped_ids": skipped,
        })
