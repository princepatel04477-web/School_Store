from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .public import PublicProductList
from .views import (
    CategoryViewSet,
    ProductVariantViewSet,
    ProductViewSet,
    StockMovementViewSet,
)

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("variants", ProductVariantViewSet, basename="variant")
router.register("stock-movements", StockMovementViewSet, basename="stock-movement")

urlpatterns = [
    path("public/products/", PublicProductList.as_view(), name="public-products"),
    path("", include(router.urls)),
]
