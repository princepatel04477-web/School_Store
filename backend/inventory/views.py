from rest_framework import mixins, viewsets
from rest_framework.decorators import action

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
        "city", "variant", "variant__product", "variant__product__category"
    ).order_by("-updated_at")
    serializer_class = StockBalanceSerializer
    pagination_class = StockBalancePagination
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN")
    write_roles = ()
    scope_city_field = "city_id"
    scope_school_field = None
    scope_parent_field = None

    @action(detail=False, methods=["get"], url_path="low")
    def low(self, request):
        """Low-stock list.

        `is_low_stock` is a stored generated column backed by a partial
        index (idx_stockbalance_low), so this is an index lookup — never a
        scan of all variants.
        """
        queryset = self.get_queryset().filter(is_low_stock=True)
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)


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

    def get_queryset(self):
        qs = super().get_queryset()
        variant_param = self.request.query_params.get("variant")
        if variant_param:
            qs = qs.filter(variant_id=variant_param)
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return StockMovementCreateSerializer
        return StockMovementSerializer

    def perform_create(self, serializer):
        serializer.save()
