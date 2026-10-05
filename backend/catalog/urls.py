from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .public import (
    PublicGradeListView,
    PublicProductList,
    PublicSchoolCitiesView,
    PublicSchoolListView,
)
from .storefront import StudentCatalogueView, StudentProductDetailView
from .views import CategoryViewSet, ProductVariantViewSet, ProductViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("variants", ProductVariantViewSet, basename="variant")

urlpatterns = [
    path("public/schools/", PublicSchoolListView.as_view(), name="public-schools"),
    path("public/schools/<uuid:school_id>/cities/", PublicSchoolCitiesView.as_view(), name="public-school-cities"),
    path("public/grades/", PublicGradeListView.as_view(), name="public-grades"),
    path("public/products/", PublicProductList.as_view(), name="public-products"),
    # Ordering read path: catalogue valid for one student (school + class +
    # gender targeted items plus shared items), with fresh stock flags.
    path(
        "catalog/students/<uuid:student_id>/products/",
        StudentCatalogueView.as_view(),
        name="student-catalogue",
    ),
    path(
        "catalog/students/<uuid:student_id>/products/<uuid:product_id>/",
        StudentProductDetailView.as_view(),
        name="student-product-detail",
    ),
    path("", include(router.urls)),
]
