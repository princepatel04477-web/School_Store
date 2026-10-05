from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .boss_views import (
    BossCategorySalesView,
    BossCitySalesView,
    BossFilterOptionsView,
    BossKpisView,
    BossRevenueProfitTimeView,
    BossStockCategoryView,
    BossTopProductsView,
    BossTopSchoolsView,
)
from .views import (
    CityDailySalesView,
    CommissionView,
    DashboardView,
    ExportJobViewSet,
    PanelFilterOptionsView,
    PanelOrdersView,
    PanelSchoolsView,
    PanelStudentImportViewSet,
    PanelStudentViewSet,
    PanelTeacherViewSet,
)

router = DefaultRouter()
router.register("orders", PanelOrdersView, basename="panel-orders")
router.register("students", PanelStudentViewSet, basename="panel-student")
router.register("student-imports", PanelStudentImportViewSet, basename="panel-student-import")
router.register("teachers", PanelTeacherViewSet, basename="panel-teacher")
router.register("exports", ExportJobViewSet, basename="panel-export")

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="panel-dashboard"),
    path("commission/", CommissionView.as_view(), name="panel-commission"),
    path("schools/", PanelSchoolsView.as_view(), name="panel-schools"),
    path("filters/", PanelFilterOptionsView.as_view(), name="panel-filters"),
    path("city-daily-sales/", CityDailySalesView.as_view(), name="panel-city-daily-sales"),
    # Boss panel executive endpoints (Requirements 1, 2, 6, 7)
    path("boss/kpis/", BossKpisView.as_view(), name="boss-kpis"),
    path("boss/charts/revenue-profit/", BossRevenueProfitTimeView.as_view(), name="boss-chart-revenue-profit"),
    path("boss/charts/categories/", BossCategorySalesView.as_view(), name="boss-chart-categories"),
    path("boss/charts/cities/", BossCitySalesView.as_view(), name="boss-chart-cities"),
    path("boss/charts/top-schools/", BossTopSchoolsView.as_view(), name="boss-chart-top-schools"),
    path("boss/charts/top-products/", BossTopProductsView.as_view(), name="boss-chart-top-products"),
    path("boss/charts/stock-categories/", BossStockCategoryView.as_view(), name="boss-chart-stock-categories"),
    path("boss/filters/", BossFilterOptionsView.as_view(), name="boss-filter-options"),
    path("", include(router.urls)),
]
