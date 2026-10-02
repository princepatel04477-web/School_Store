from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CityViewSet, SchoolViewSet, StudentImportViewSet, StudentViewSet

router = DefaultRouter()
router.register("cities", CityViewSet, basename="city")
router.register("schools", SchoolViewSet, basename="school")
router.register("students", StudentViewSet, basename="student")
router.register("student-imports", StudentImportViewSet, basename="student-import")

urlpatterns = [
    # Convenience alias: upload straight to /api/students/import/
    path(
        "students/import/",
        StudentImportViewSet.as_view({"post": "create"}),
        name="student-import-upload",
    ),
    path("", include(router.urls)),
]
