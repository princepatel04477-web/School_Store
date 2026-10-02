from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import OrderViewSet
from .webhooks import razorpay_webhook

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")

urlpatterns = [
    path("", include(router.urls)),
    path("payments/razorpay/webhook/", razorpay_webhook, name="razorpay-webhook"),
]
