from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

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

    queryset = Order.objects.select_related("student", "school", "city").order_by(
        "-created_at"
    )
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
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        order = (
            Order.objects.select_related("student", "school", "city")
            .prefetch_related("items__variant__product", "status_events")
            .get(pk=order.pk)
        )
        return Response(
            OrderDetailSerializer(order).data,
            status=status.HTTP_201_CREATED,
        )

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
