from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .consent_views import PhotoConsentCreateView, PhotoConsentDeleteView
from .upload_views import (
    PresignedUploadUrlView,
    local_storage_download_view,
    local_storage_upload_view,
)
from .views import OrderViewSet
from .webhooks import razorpay_webhook

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")

urlpatterns = [
    path("orders/customisation-upload-url/", PresignedUploadUrlView.as_view(), name="customisation-upload-url"),
    path("orders/photo-consent/", PhotoConsentCreateView.as_view(), name="photo-consent-create"),
    path("orders/photo-consent/delete/", PhotoConsentDeleteView.as_view(), name="photo-consent-delete"),
    path("storage/local-upload/", local_storage_upload_view, name="local-storage-upload"),
    path("storage/local-download/", local_storage_download_view, name="local-storage-download"),
    path("", include(router.urls)),
    path("payments/razorpay/webhook/", razorpay_webhook, name="razorpay-webhook"),
]
