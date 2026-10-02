import secrets
from django.conf import settings
from django.core.cache import cache
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from common.permissions import RoleScopedPermission
from common.scoping import ScopedQuerysetMixin
from .models import User
from .serializers import (
    CustomTokenObtainPairSerializer,
    ManagedUserWriteSerializer,
    ParentRegistrationSerializer,
    UserSerializer,
    build_tokens_for_user,
)


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = User.objects.select_related("city", "school").get(pk=request.user.id)
        return Response(UserSerializer(user).data)


class SendOTPView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        phone = (request.data.get("phone") or "").strip()
        if not phone:
            return Response(
                {"phone": ["Phone number is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        otp_code = f"{secrets.randbelow(900000) + 100000}"
        cache.set(f"otp:{phone}", otp_code, timeout=300)
        payload = {"detail": "OTP sent successfully.", "phone": phone}
        if settings.DEBUG:
            payload["otp_debug"] = otp_code
        return Response(payload, status=status.HTTP_200_OK)


class ParentRegistrationView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = ParentRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        tokens = build_tokens_for_user(user)
        return Response(
            {
                "user": UserSerializer(user).data,
                "access": tokens["access"],
                "refresh": tokens["refresh"],
            },
            status=status.HTTP_201_CREATED,
        )


class UserViewSet(ScopedQuerysetMixin, viewsets.ModelViewSet):
    """
    Role-scoped User management ViewSet.
    - Boss sees all users and creates Admins (or any role).
    - Admin sees users in their city (`WHERE city_id = user.city_id`) and creates School Admins in their city.
    - School Admin sees users in their school (`WHERE school_id = user.school_id`) and creates Teachers in their school.
    - Teacher & Parent see only their own user row (`WHERE id = user.id`) and cannot create/modify staff accounts.
    """

    queryset = User.objects.select_related("city", "school").order_by("-created_at")
    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN", "TEACHER", "PARENT")
    write_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN")

    scope_city_field = "city_id"
    scope_school_field = "school_id"
    scope_parent_field = "id"

    def scope_queryset(self, qs):
        user = self.request.user
        if not user or not user.is_authenticated:
            return qs.none()
        if user.role == "TEACHER":
            return qs.filter(id=user.id)
        return super().scope_queryset(qs)

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return ManagedUserWriteSerializer
        return UserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        user = User.objects.select_related("city", "school").get(pk=user.pk)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)
