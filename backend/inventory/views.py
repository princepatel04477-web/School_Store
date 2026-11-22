from django.db.models import F, Max, Q, Sum
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

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

    def get_queryset(self):
        qs = super().get_queryset()
        city_id = self.request.query_params.get("city")
        variant_id = self.request.query_params.get("variant")
        school_id = self.request.query_params.get("school")
        product_id = self.request.query_params.get("product")
        size = self.request.query_params.get("size")
        severity = self.request.query_params.get("severity")
        search = self.request.query_params.get("search")

        if city_id:
            qs = qs.filter(city_id=city_id)
        if variant_id:
            qs = qs.filter(variant_id=variant_id)
        if school_id:
            qs = qs.filter(variant__school_id=school_id)
        if product_id:
            qs = qs.filter(variant__product_id=product_id)
        if size:
            qs = qs.filter(variant__size=size)
        if search:
            q = search.strip()
            qs = qs.filter(
                Q(variant__sku__icontains=q)
                | Q(variant__product__name__icontains=q)
                | Q(variant__size__iexact=q)
            )
        if severity:
            sev = severity.strip().upper()
            if sev == "OUT_OF_STOCK":
                qs = qs.filter(stock_quantity=0)
            elif sev == "CRITICAL":
                qs = qs.filter(
                    stock_quantity__gt=0,
                    stock_quantity__lte=F("low_stock_threshold") / 2,
                )
            elif sev == "LOW":
                qs = qs.filter(is_low_stock=True)
            elif sev == "NORMAL":
                qs = qs.filter(is_low_stock=False)

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

    @action(detail=False, methods=["get"], url_path="reconciliation")
    def reconciliation(self, request):
        """Reconciliation report comparing balances against movement ledger history.

        Does NOT silently correct discrepancies. Audits each variant's current
        balance against the sum of all recorded movements and flags deltas
        for staff review and physical audits.
        """
        queryset = self.get_queryset()
        discrepant_only = (
            request.query_params.get("discrepant_only", "false").lower()
            in ("true", "1")
        )

        balances = list(
            queryset.select_related("city", "variant", "variant__product")
        )

        balance_city_ids = {b.city_id for b in balances}
        balance_variant_ids = {b.variant_id for b in balances}

        movements = (
            StockMovement.objects.filter(
                city_id__in=balance_city_ids,
                variant_id__in=balance_variant_ids,
            )
            .values("city_id", "variant_id")
            .annotate(
                ledger_sum=Sum("quantity_change"),
                last_movement_at=Max("created_at"),
            )
        )
        movement_map = {
            (m["city_id"], m["variant_id"]): (
                m["ledger_sum"] or 0,
                m["last_movement_at"],
            )
            for m in movements
        }

        report_items = []
        discrepant_count = 0

        for b in balances:
            ledger_sum, last_movement = movement_map.get(
                (b.city_id, b.variant_id), (0, None)
            )
            discrepancy = b.stock_quantity - ledger_sum
            has_discrepancy = (discrepancy != 0)
            if has_discrepancy:
                discrepant_count += 1
            if discrepant_only and not has_discrepancy:
                continue

            report_items.append(
                {
                    "balance_id": str(b.id),
                    "city_id": str(b.city_id),
                    "city_code": b.city.code,
                    "city_name": b.city.name,
                    "variant_id": str(b.variant_id),
                    "sku": b.variant.sku,
                    "product_name": b.variant.product.name,
                    "size": b.variant.size,
                    "current_stock": b.stock_quantity,
                    "movement_ledger_sum": ledger_sum,
                    "discrepancy": discrepancy,
                    "has_discrepancy": has_discrepancy,
                    "severity": b.severity,
                    "last_movement_at": (
                        last_movement.isoformat() if last_movement else None
                    ),
                }
            )

        return Response(
            {
                "total_balances_checked": len(balances),
                "discrepant_count": discrepant_count,
                "perfect_match_count": len(balances) - discrepant_count,
                "discrepancies": report_items,
            }
        )


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
        city_param = self.request.query_params.get("city")
        reason_param = self.request.query_params.get("reason")
        school_param = self.request.query_params.get("school")
        order_param = self.request.query_params.get("order")

        if variant_param:
            qs = qs.filter(variant_id=variant_param)
        if city_param:
            qs = qs.filter(city_id=city_param)
        if reason_param:
            qs = qs.filter(reason=reason_param)
        if school_param:
            qs = qs.filter(school_id=school_param)
        if order_param:
            qs = qs.filter(reference_order_id=order_param)
        return qs

    def get_serializer_class(self):
        if self.action == "create":
            return StockMovementCreateSerializer
        return StockMovementSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()
        read_serializer = StockMovementSerializer(instance, context=self.get_serializer_context())
        return Response(read_serializer.data, status=status.HTTP_201_CREATED)
