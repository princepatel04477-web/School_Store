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

    def update(self, request, *args, **kwargs):
        if request.user.role == "PARENT":
            raise PermissionDenied("Parents cannot edit or cancel an order after it is placed.")
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if request.user.role == "PARENT":
            raise PermissionDenied("Parents cannot edit or cancel an order after it is placed.")
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if request.user.role == "PARENT":
            raise PermissionDenied("Parents cannot edit or cancel an order after it is placed.")
        return super().destroy(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            qs = qs.prefetch_related("items__variant__product", "status_events")

        status_param = self.request.query_params.get("status")
        school_param = self.request.query_params.get("school")
        city_param = self.request.query_params.get("city")
        student_param = self.request.query_params.get("student")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        updated_since = self.request.query_params.get("updated_since")

        if status_param:
            qs = qs.filter(status=status_param)
        if school_param:
            qs = qs.filter(school_id=school_param)
        if city_param:
            qs = qs.filter(city_id=city_param)
        if student_param:
            qs = qs.filter(student_id=student_param)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        if updated_since:
            qs = qs.filter(updated_at__gt=updated_since)
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
            from common.audit import log_audit_event
            from common.models import AuditLog
            log_audit_event(
                action=AuditLog.Action.ORDER_STATUS_CHANGED,
                target_type="Order",
                target_id=order.id,
                actor=user,
                details={"old_status": old_status, "new_status": order.status, "order_number": order.order_number},
            )
            from .tasks import refresh_order_summary
            transaction.on_commit(lambda: refresh_order_summary.delay(str(order.id)))

    @action(detail=False, methods=["post"], url_path="bulk-status")
    def bulk_status(self, request):
        user = request.user
        if user.role in ("PARENT", "TEACHER"):
            raise PermissionDenied("Only Boss, Admin, or School Admin may modify order statuses.")

        order_ids = request.data.get("order_ids")
        new_status = request.data.get("status")
        note = (request.data.get("note") or f"Bulk status updated to {new_status}").strip()

        if not order_ids or not isinstance(order_ids, list):
            return Response(
                {"order_ids": ["A non-empty list of order IDs is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not new_status or new_status not in Order.Status.values:
            return Response(
                {"status": [f"Invalid status '{new_status}'."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Scope check: only update orders within the user's scoped queryset
        qs = self.get_queryset().filter(id__in=order_ids)
        valid_ids = list(qs.values_list("id", flat=True))

        if not valid_ids:
            return Response({"detail": "No matching orders found in your scope."}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        with transaction.atomic():
            # One bulk UPDATE query
            updated_count = Order.objects.filter(id__in=valid_ids).update(
                status=new_status,
                updated_at=now,
            )
            # One bulk_create query of status events
            events = [
                OrderStatusEvent(
                    order_id=o_id,
                    status=new_status,
                    changed_by=user,
                    note=note,
                )
                for o_id in valid_ids
            ]
            OrderStatusEvent.objects.bulk_create(events)

            from common.audit import log_audit_event
            from common.models import AuditLog
            for oid in valid_ids:
                log_audit_event(
                    action=AuditLog.Action.ORDER_STATUS_CHANGED,
                    target_type="Order",
                    target_id=oid,
                    actor=user,
                    details={"new_status": new_status, "bulk": True, "note": note},
                )

            # Trigger background rollup refresh for changed orders
            from .tasks import refresh_order_summary
            for oid in valid_ids:
                transaction.on_commit(lambda o=oid: refresh_order_summary.delay(str(o)))

        return Response({
            "updated_count": updated_count,
            "status": new_status,
            "order_ids": [str(oid) for oid in valid_ids],
        })

    def perform_destroy(self, instance):
        user = self.request.user
        if user.role != "BOSS" and not getattr(user, "is_superuser", False):
            raise PermissionDenied("Only Boss may delete orders.")
        instance.delete()
