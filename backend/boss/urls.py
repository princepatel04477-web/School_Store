from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BossAdminViewSet,
    BossFilterOptionsView,
    CategorySalesView,
    CitySalesView,
    KpisView,
    RevenueTrendView,
    StockByCategoryView,
    TopProductsView,
    TopSchoolsView,
)

router = DefaultRouter()
router.register("admins", BossAdminViewSet, basename="boss-admins")

urlpatterns = [
    path("kpis/", KpisView.as_view(), name="boss-kpis"),
    path("charts/revenue-trend/", RevenueTrendView.as_view(), name="boss-chart-revenue-trend"),
    path("charts/category-sales/", CategorySalesView.as_view(), name="boss-chart-category-sales"),
    path("charts/city-sales/", CitySalesView.as_view(), name="boss-chart-city-sales"),
    path("charts/top-schools/", TopSchoolsView.as_view(), name="boss-chart-top-schools"),
    path("charts/top-products/", TopProductsView.as_view(), name="boss-chart-top-products"),
    path("charts/stock-by-category/", StockByCategoryView.as_view(), name="boss-chart-stock-by-category"),
    path("filters/", BossFilterOptionsView.as_view(), name="boss-filters"),
    path("", include(router.urls)),
]
