from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
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
    path("", include(router.urls)),
]
