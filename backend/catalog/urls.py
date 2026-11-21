from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .public import (
    PublicCityBranchesView,
    PublicGradeListView,
    PublicStateCitiesView,
    PublicStateListView,
    PublicMeasureConfigView,
    PublicProductList,
    PublicSchoolCitiesView,
    PublicSchoolListView,
    PublicDeliveredSchoolListView,
    PublicSizeFitView,
)
from .size_chart_views import SizeChartImportViewSet, SizeChartViewSet
from .storefront import StudentCatalogueView, StudentProductDetailView
from .views import (
    CartValidateView,
    CategoryViewSet,
    ProductCityPriceViewSet,
    ProductVariantViewSet,
    ProductViewSet,
    ProductRequirementViewSet,
)

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("variants", ProductVariantViewSet, basename="variant")
router.register("city-prices", ProductCityPriceViewSet, basename="city-price")
router.register("requirements", ProductRequirementViewSet, basename="requirement")
router.register("size-chart-imports", SizeChartImportViewSet, basename="size-chart-import")
router.register("size-charts", SizeChartViewSet, basename="size-chart")

urlpatterns = [
    path("public/schools/", PublicSchoolListView.as_view(), name="public-schools"),
    path("public/schools/delivered/", PublicDeliveredSchoolListView.as_view(), name="public-schools-delivered"),
    path("public/schools/logos/", PublicDeliveredSchoolListView.as_view(), name="public-schools-logos"),
    path("public/schools/<uuid:school_id>/cities/", PublicSchoolCitiesView.as_view(), name="public-school-cities"),
    path("public/states/", PublicStateListView.as_view(), name="public-states"),
    path("public/cities/", PublicStateCitiesView.as_view(), name="public-state-cities"),
    path("public/cities/<uuid:city_id>/branches/", PublicCityBranchesView.as_view(), name="public-city-branches"),
    path("public/grades/",PublicGradeListView.as_view(), name="public-grades"),
    path("public/products/", PublicProductList.as_view(), name="public-products"),
    path("public/size-fit/", PublicSizeFitView.as_view(), name="public-size-fit"),
    path("public/measure-config/", PublicMeasureConfigView.as_view(), name="public-measure-config"),
    path("cart/validate/", CartValidateView.as_view(), name="cart-validate"),
    path("cart/add/", CartValidateView.as_view(), name="cart-add"),
    path("catalog/cart/validate/", CartValidateView.as_view(), name="catalog-cart-validate"),
    path("catalog/cart/add/", CartValidateView.as_view(), name="catalog-cart-add"),
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
