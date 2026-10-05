from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import StockBalanceViewSet, StockMovementViewSet

router = DefaultRouter()
router.register("stock-balances", StockBalanceViewSet, basename="stock-balance")
router.register("stock-movements", StockMovementViewSet, basename="stock-movement")

urlpatterns = [path("", include(router.urls))]
