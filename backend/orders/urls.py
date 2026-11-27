from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .consent_views import PhotoConsentCreateView, PhotoConsentDeleteView
from .device_views import DeviceTokenDetailView, DeviceTokenView
from .feedback_views import OrderItemFitFeedbackView
from .upload_views import (
    PresignedUploadUrlView,
    StudentPhotoCustomisationView,
    local_storage_download_view,
    local_storage_upload_view,
)
from .views import OrderViewSet
from .webhooks import razorpay_webhook

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")

urlpatterns = [
    path("orders/customisation-upload-url/", PresignedUploadUrlView.as_view(), name="customisation-upload-url"),
    path(
        "orders/customisation-from-student-photo/",
        StudentPhotoCustomisationView.as_view(),
        name="customisation-from-student-photo",
    ),
    path("orders/photo-consent/", PhotoConsentCreateView.as_view(), name="photo-consent-create"),
    path("orders/photo-consent/delete/", PhotoConsentDeleteView.as_view(), name="photo-consent-delete"),
    path("storage/local-upload/", local_storage_upload_view, name="local-storage-upload"),
    path("storage/local-download/", local_storage_download_view, name="local-storage-download"),
    path(
        "orders/<uuid:order_id>/items/<uuid:item_id>/fit-feedback/",
        OrderItemFitFeedbackView.as_view(),
        name="order-item-fit-feedback",
    ),
    path("", include(router.urls)),
    path("devices/", DeviceTokenView.as_view(), name="device-token-create"),
    path("devices/<path:token>/", DeviceTokenDetailView.as_view(), name="device-token-detail"),
    path("payments/razorpay/webhook/", razorpay_webhook, name="razorpay-webhook"),
]
