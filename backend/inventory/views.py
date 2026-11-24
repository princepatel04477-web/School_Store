from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.decorators import action

from common.pagination import BoundedCursorPagination
from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin

from .models import StockBalance, StockMovement
from .services import INDIA_STOCK_ID
from .serializers import (
    BulkStockReceiptSerializer,
    StockBalanceSerializer,
    StockMovementCreateSerializer,
    StockMovementSerializer,
)


class StockBalancePagination(BoundedCursorPagination):
    ordering = ("-updated_at", "-id")
    # One city's stock grid: every size of every item. At 50 rows, adding stock to
    # one size pushed an older size off the page and it showed as 0.
    city_grid_max = 2000

    def get_page_size(self, request):
        if request.query_params.get("city") or request.query_params.get("scope") == "india":
            return self.city_grid_max
        return super().get_page_size(request)


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

    def get_queryset(self):
        qs = super().get_queryset()
        city_id = self.request.query_params.get("city")
        variant_id = self.request.query_params.get("variant")
        school_id = self.request.query_params.get("school")
        product_id = self.request.query_params.get("product")
        if self.request.query_params.get("scope") == "india":
            if self.request.user.role != "BOSS":
                raise PermissionDenied("Only the Boss can view India stock.")
            qs = qs.filter(city_id=INDIA_STOCK_ID)
        else:
            qs = qs.exclude(city_id=INDIA_STOCK_ID)
            if city_id:
                qs = qs.filter(city_id=city_id)
        if variant_id:
            qs = qs.filter(variant_id=variant_id)
        if school_id:
            qs = qs.filter(variant__product__school_id=school_id)
        if product_id:
            qs = qs.filter(variant__product_id=product_id)
        return qs

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

    def create(self, request, *args, **kwargs):
        """Refusals carry a plain `detail` sentence, which the staff screens show."""
        try:
            return super().create(request, *args, **kwargs)
        except ValidationError as exc:
            data = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
            body = dict(data)
            body["detail"] = _first_message(data) or "This stock change was refused."
            return Response(body, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["post"], url_path="bulk-receipt")
    def bulk_receipt(self, request):
        if request.user.role != "BOSS":
            raise PermissionDenied("Only the Boss can change India stock.")
        receipt = BulkStockReceiptSerializer(data=request.data, context=self.get_serializer_context())
        receipt.is_valid(raise_exception=True)
        movements = receipt.save()
        return Response(StockMovementSerializer(movements, many=True).data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        serializer.save()


def _first_message(data):
    for value in data.values():
        while isinstance(value, (list, tuple)) and value:
            value = value[0]
        if isinstance(value, dict):
            found = _first_message(value)
            if found:
                return found
        elif value:
            return str(value)
    return None
