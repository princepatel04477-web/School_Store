import json
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from .payment import RazorpayGateway

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin
from .models import Order, OrderStatusEvent
from .serializers import (
    OrderCreateSerializer,
    OrderDetailSerializer,
    OrderListSerializer,
)


class OrderViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    """
    Scoped Order ViewSet:
    - BOSS: all orders
    - ADMIN: `WHERE city_id = user.city_id` (indexed by idx_order_city_created)
    - SCHOOL_ADMIN / TEACHER: `WHERE school_id = user.school_id` (indexed by idx_order_school_created)
    - PARENT: `WHERE parent_id = user.id` (indexed by idx_order_parent_created)
    """

    queryset = Order.objects.select_related(
        "student", "school", "city", "placed_by", "payer"
    ).order_by("-created_at")
    pagination_class = BoundedCursorPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = "parent_id"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            qs = qs.prefetch_related("items__variant__product", "status_events")

        status_param = self.request.query_params.get("status")
        school_param = self.request.query_params.get("school")
        city_param = self.request.query_params.get("city")
        student_param = self.request.query_params.get("student")

        if status_param:
            qs = qs.filter(status=status_param)
        if school_param:
            qs = qs.filter(school_id=school_param)
        if city_param:
            qs = qs.filter(city_id=city_param)
        if student_param:
            qs = qs.filter(student_id=student_param)
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return OrderCreateSerializer
        if self.action == "retrieve":
            return OrderDetailSerializer
        return OrderListSerializer

    def create(self, request, *args, **kwargs):
        payload = request.data.copy()
        payload.setdefault("idempotency_key", request.headers.get("Idempotency-Key", ""))
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        order = (
            Order.objects.select_related(
                "student", "school", "city", "placed_by", "payer"
            )
            .prefetch_related("items__variant__product", "status_events")
            .get(pk=order.pk)
        )
        return Response(
            OrderDetailSerializer(order).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="payment")
    def payment(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may start payment.")
        gateway = RazorpayGateway()
        razor_order = gateway.create_order(order)
        if not order.razorpay_order_id:
            order.razorpay_order_id = razor_order["id"]
            order.save(update_fields=["razorpay_order_id", "updated_at"])
        return Response({"order_id": razor_order["id"], "amount": razor_order.get("amount"), "currency": "INR", "key_id": gateway.key_id})

    @action(detail=True, methods=["post"], url_path="verify-payment")
    def verify_payment(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may verify payment.")
        gateway = RazorpayGateway()
        if not gateway.verify_signature(request.data.get("razorpay_order_id", order.razorpay_order_id), request.data.get("razorpay_payment_id", ""), request.data.get("razorpay_signature", "")):
            return Response({"detail": "Invalid payment signature."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            if order.payment_status != Order.PaymentStatus.PAID:
                order.payment_status = Order.PaymentStatus.PAID
                order.status = Order.Status.CONFIRMED
                order.razorpay_payment_id = request.data["razorpay_payment_id"]
                order.razorpay_signature = request.data["razorpay_signature"]
                order.save(update_fields=["payment_status", "status", "razorpay_payment_id", "razorpay_signature", "updated_at"])
                OrderStatusEvent.objects.create(order=order, status=order.status, changed_by=request.user, note="Payment verified.")
        return Response({"status": "paid"})

    def perform_update(self, serializer):
        user = self.request.user
        if user.role in ("PARENT", "TEACHER"):
            raise PermissionDenied("Only Boss, Admin, or School Admin may modify orders.")
        old_status = serializer.instance.status
        order = serializer.save()
        if order.status != old_status:
            OrderStatusEvent.objects.create(
                order=order,
                status=order.status,
                changed_by_id=user.id,
                note=f"Status updated from {old_status} to {order.status}",
            )

    def perform_destroy(self, instance):
        user = self.request.user
        if user.role != "BOSS" and not getattr(user, "is_superuser", False):
            raise PermissionDenied("Only Boss may delete orders.")
        instance.delete()
