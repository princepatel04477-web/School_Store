from rest_framework import mixins, viewsets

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin

from .models import StockBalance, StockMovement
from .serializers import (
    StockBalanceSerializer,
    StockMovementCreateSerializer,
    StockMovementSerializer,
)


class StockBalancePagination(BoundedCursorPagination):
    ordering = ("-updated_at", "-id")


class StockBalanceViewSet(ScopedQuerysetMixin, viewsets.ReadOnlyModelViewSet):
    queryset = StockBalance.objects.select_related(
        "city", "variant", "variant__product"
    ).order_by("-updated_at")
    serializer_class = StockBalanceSerializer
    pagination_class = StockBalancePagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN")
    write_roles = ()
    scope_city_field = "city_id"
    scope_school_field = None
    scope_parent_field = None


class StockMovementViewSet(
    ScopedQuerysetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    queryset = StockMovement.objects.select_related(
        "city", "school", "variant", "reference_order", "created_by"
    ).order_by("-created_at")
    pagination_class = BoundedCursorPagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN")
    write_roles = ("BOSS", "ADMIN")
    scope_city_field = "city_id"
    scope_school_field = None
    scope_parent_field = None

    def get_serializer_class(self):
        if self.action == "create":
            return StockMovementCreateSerializer
        return StockMovementSerializer

    def perform_create(self, serializer):
        serializer.save()
