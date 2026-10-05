"""
Boss panel API.

Every dashboard number is read from the analytics rollups (never the order
tables), and every response is cached in Redis for 60 seconds keyed by the
exact filter combination (see boss.services.cached_dashboard).

| Endpoint | Purpose |
|---|---|
| GET /api/boss/kpis/                      | all 7 KPI cards in one small response |
| GET /api/boss/charts/revenue-trend/      | revenue + profit per day |
| GET /api/boss/charts/category-sales/     | sales by category |
| GET /api/boss/charts/city-sales/         | sales by city |
| GET /api/boss/charts/top-schools/        | top schools by revenue |
| GET /api/boss/charts/top-products/       | top products by units |
| GET /api/boss/charts/stock-by-category/  | current stock level by category |
| GET /api/boss/filters/                   | cities / schools / categories for the dropdowns |
| GET/POST/PATCH /api/boss/admins/         | create Admins and assign them to cities |

Cities and schools (management requirement 8) reuse the existing Boss-level
CRUD endpoints: `/api/cities/` and `/api/schools/` (commission rate is
`School.commission_rate`).
"""

from rest_framework import mixins, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from common.permissions import IsBoss

from . import services
from .serializers import BossAdminSerializer


class BossAPIView(APIView):
    """Base for every dashboard endpoint: Boss-only, filters from the query string."""

    permission_classes = [IsBoss]

    def get_filters(self, request) -> services.BossFilters:
        return services.BossFilters.from_params(request.query_params)


class KpisView(BossAPIView):
    """
    Requirement 1 + 6: revenue, cost, gross profit, gross margin %, orders,
    units sold and current stock value - one endpoint, one small response.
    """

    def get(self, request):
        filters = self.get_filters(request)
        payload = services.cached_dashboard(
            "kpis", filters, lambda: services.kpi_payload(filters)
        )
        return Response(payload)


class RevenueTrendView(BossAPIView):
    def get(self, request):
        filters = self.get_filters(request)
        payload = services.cached_dashboard(
            "chart:revenue-trend",
            filters,
            lambda: {
                "filters": filters.as_dict(),
                "points": services.revenue_trend(filters),
            },
        )
        return Response(payload)


class CategorySalesView(BossAPIView):
    def get(self, request):
        filters = self.get_filters(request)
        payload = services.cached_dashboard(
            "chart:category-sales",
            filters,
            lambda: {
                "filters": filters.as_dict(),
                "points": services.sales_by_category(filters),
            },
        )
        return Response(payload)


class CitySalesView(BossAPIView):
    def get(self, request):
        filters = self.get_filters(request)
        payload = services.cached_dashboard(
            "chart:city-sales",
            filters,
            lambda: {
                "filters": filters.as_dict(),
                "points": services.sales_by_city(filters),
            },
        )
        return Response(payload)


class TopSchoolsView(BossAPIView):
    def get(self, request):
        filters = self.get_filters(request)
        payload = services.cached_dashboard(
            "chart:top-schools",
            filters,
            lambda: {
                "filters": filters.as_dict(),
                "points": services.top_schools(filters),
            },
        )
        return Response(payload)


class TopProductsView(BossAPIView):
    def get(self, request):
        filters = self.get_filters(request)
        payload = services.cached_dashboard(
            "chart:top-products",
            filters,
            lambda: {
                "filters": filters.as_dict(),
                "points": services.top_products(filters),
            },
        )
        return Response(payload)


class StockByCategoryView(BossAPIView):
    def get(self, request):
        filters = self.get_filters(request)
        payload = services.cached_dashboard(
            "chart:stock-by-category",
            filters,
            lambda: {
                "filters": filters.as_dict(),
                "points": services.stock_by_category(filters),
            },
        )
        return Response(payload)


class BossFilterOptionsView(BossAPIView):
    """Dropdown values for the filter bar (and the View-as pickers)."""

    def get(self, request):
        return Response(services.filter_options())


class BossAdminViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """
    Requirement 8: the Boss creates Admins, assigns each one to a city, and
    can reassign or deactivate them later.
    """

    permission_classes = [IsBoss]
    serializer_class = BossAdminSerializer

    def get_queryset(self):
        return (
            User.objects.filter(role=User.Role.ADMIN)
            .select_related("city")
            .order_by("username")
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        admin = serializer.save()
        return Response(
            self.get_serializer(admin).data, status=status.HTTP_201_CREATED
        )
