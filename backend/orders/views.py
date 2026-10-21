import json
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from .payment import RazorpayGateway

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin
from .models import Order, OrderStatusEvent
from .status import change_order_status, record_payment
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
        if order.payment_status == Order.PaymentStatus.PAID:
            raise ValidationError({"detail": "This order is already paid."})
        if order.status == Order.Status.CANCELLED:
            raise ValidationError({"detail": "This order was cancelled. Please place it again."})
        if order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
            raise ValidationError({"detail": "This order is paid in cash on delivery."})
        gateway = RazorpayGateway()
        with transaction.atomic():
            order = Order.objects.select_for_update().get(pk=order.pk)
            # Reuse one Razorpay order per store order: a retry must not create a
            # second gateway order whose webhook would not match this row.
            if not order.razorpay_order_id:
                order.razorpay_order_id = gateway.create_order(order)["id"]
                order.save(update_fields=["razorpay_order_id", "updated_at"])
        return Response({"order_id": order.razorpay_order_id, "amount": int(order.total * 100), "currency": "INR", "key_id": gateway.key_id})

    @action(detail=True, methods=["post"], url_path="verify-payment")
    def verify_payment(self, request, pk=None):
        order = self.get_object()
        if (
            request.user.role != "BOSS"
            and not getattr(request.user, "is_superuser", False)
            and order.payer_id != request.user.id
        ):
            raise PermissionDenied("Only the assigned payer may verify payment.")
        razorpay_order_id = order.razorpay_order_id
        payment_id = request.data.get("razorpay_payment_id", "")
        signature = request.data.get("razorpay_signature", "")
        # The signature must be for THIS order's Razorpay order id, never one the
        # client sends: a valid signature from a cheaper order must not pay this one.
        if (
            not razorpay_order_id
            or request.data.get("razorpay_order_id", razorpay_order_id) != razorpay_order_id
            or not RazorpayGateway().verify_signature(razorpay_order_id, payment_id, signature)
        ):
            return Response({"detail": "Invalid payment signature."}, status=status.HTTP_400_BAD_REQUEST)
        record_payment(
            Order.objects.filter(pk=order.pk),
            payment_id=payment_id,
            signature=signature,
            changed_by=request.user,
            note="Payment verified.",
        )
        return Response({"status": "paid"})

    def _change_status(self, request, queryset):
        user = request.user
        if user.role in ("PARENT", "TEACHER"):
            raise PermissionDenied("Only Boss, Admin, or School Admin may modify order statuses.")
        new_status = request.data.get("status")
        if not new_status or new_status not in Order.Status.values:
            raise ValidationError({"status": [f"Invalid status '{new_status}'."]})
        note = (request.data.get("note") or "").strip()
        return new_status, change_order_status(queryset, new_status, user, note)

    def update(self, request, *args, **kwargs):
        # The only thing staff edit on a placed order is its status.
        if request.user.role == "PARENT":
            raise PermissionDenied("Parents cannot edit or cancel an order after it is placed.")
        order = self.get_object()
        new_status, changed = self._change_status(request, self.get_queryset().filter(pk=order.pk))
        if not changed and order.status != new_status:
            raise ValidationError(
                {"status": [f"An order that is {order.status} cannot move to {new_status}."]}
            )
        order = self.get_queryset().prefetch_related(
            "items__variant__product", "status_events"
        ).get(pk=order.pk)
        return Response(OrderDetailSerializer(order).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="bulk-status")
    def bulk_status(self, request):
        """One request: one bulk UPDATE + one bulk_create of status events."""
        order_ids = request.data.get("order_ids")
        if not order_ids or not isinstance(order_ids, list):
            return Response(
                {"order_ids": ["A non-empty list of order IDs is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(order_ids) > 500:
            return Response(
                {"order_ids": ["At most 500 orders per request."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_status, changed = self._change_status(
            request, self.get_queryset().filter(id__in=order_ids)
        )
        changed_ids = {str(oid) for oid in changed}
        return Response({
            "updated_count": len(changed),
            "status": new_status,
            "order_ids": sorted(changed_ids),
            # In scope but not allowed to move (e.g. already cancelled), or out of scope.
            "skipped_ids": sorted({str(oid) for oid in order_ids} - changed_ids),
        })

    def perform_destroy(self, instance):
        user = self.request.user
        if user.role != "BOSS" and not getattr(user, "is_superuser", False):
            raise PermissionDenied("Only Boss may delete orders.")
        instance.delete()
