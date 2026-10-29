from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import MyStoreView, PublicSchoolLogoView, RetailCitiesView, RetailerViewSet, SchoolRequestViewSet

router = DefaultRouter()
router.register("retail/retailers", RetailerViewSet, basename="retailer")
router.register("retail/school-requests", SchoolRequestViewSet, basename="school-request")

urlpatterns = [
    path("retail/my-store/", MyStoreView.as_view(), name="retail-my-store"),
    path("retail/cities/", RetailCitiesView.as_view(), name="retail-cities"),
    path("public/schools/<uuid:school_id>/logo/", PublicSchoolLogoView.as_view(), name="public-school-logo"),
    path("", include(router.urls)),
]
