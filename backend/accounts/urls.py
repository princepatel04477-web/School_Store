from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    CustomTokenObtainPairView,
    MeView,
    OTPLoginView,
    ParentRegistrationView,
    SendOTPView,
    UserViewSet,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="auth_me"),
    path("otp/send/", SendOTPView.as_view(), name="auth_otp_send"),
    path("otp/verify/", OTPLoginView.as_view(), name="auth_otp_verify"),
    path("register/", ParentRegistrationView.as_view(), name="auth_register"),
    path("", include(router.urls)),
]
