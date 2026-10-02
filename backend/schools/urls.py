from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CityViewSet, SchoolViewSet, StudentViewSet

router = DefaultRouter()
router.register("cities", CityViewSet, basename="city")
router.register("schools", SchoolViewSet, basename="school")
router.register("students", StudentViewSet, basename="student")

urlpatterns = [
    path("", include(router.urls)),
]
