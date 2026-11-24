import secrets
from django.conf import settings
from django.core.cache import cache
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from common.permissions import RoleScopedPermission
from common.phone import normalize_in_mobile
from common.scoping import ScopedQuerysetMixin
from . import sms
from .models import User
from .serializers import (
    CustomTokenObtainPairSerializer,
    ManagedUserWriteSerializer,
    ParentRegistrationSerializer,
    UserSerializer,
    build_tokens_for_user,
)


from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle


class LoginRateThrottle(AnonRateThrottle):
    scope = "login"


class OTPRateThrottle(AnonRateThrottle):
    scope = "otp"


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [LoginRateThrottle]


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = User.objects.select_related("city", "school").get(pk=request.user.id)
        return Response(UserSerializer(user).data)


class SendOTPView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [OTPRateThrottle]

    def post(self, request):
        phone = normalize_in_mobile(request.data.get("phone"))
        if not phone:
            return Response(
                {"phone": ["Enter a valid 10-digit mobile number."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        previous_code = cache.get(f"otp:{phone}")
        code = secrets.randbelow(900000) + 100000
        if previous_code is not None and code == int(previous_code):
            code = 100000 + (code - 100000 + 1 + secrets.randbelow(899999)) % 900000
        otp_code = str(code)
        try:
            sms.send_otp(phone, otp_code)
        except sms.SmsNotConfigured:
            if settings.OTP_DEMO_MODE:
                # No SMS yet: hand the code to the screen so every number works
                cache.set(f"otp:{phone}", otp_code, timeout=OTP_TTL_SECONDS)
                cache.set(f"otp_screen:{phone}", True, timeout=OTP_TTL_SECONDS)
                cache.delete(f"otp_attempts:{phone}")
                return Response(
                    {
                        "detail": "Demo mode: use the code shown on screen.",
                        "phone": phone,
                        "otp_debug": otp_code,
                        "demo": True,
                    },
                    status=status.HTTP_200_OK,
                )
            if cache.get(f"otp_demo:{phone}"):
                return Response({"detail": "Use the demo code provided to you.", "phone": phone})
            return Response(
                {"detail": "Sign-in by mobile number is not available yet.", "code": "sms_unavailable"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except sms.SmsSendFailed:
            return Response(
                {"detail": "We could not send the code. Please try again in a minute.", "code": "sms_failed"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        cache.set(f"otp:{phone}", otp_code, timeout=OTP_TTL_SECONDS)
        cache.delete(f"otp_screen:{phone}")
        cache.delete(f"otp_attempts:{phone}")
        payload = {"detail": "OTP sent successfully.", "phone": phone}
        if settings.DEBUG:
            payload["otp_debug"] = otp_code
        return Response(payload, status=status.HTTP_200_OK)


OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5


class OTPLoginView(APIView):
    """
    Parent sign-in with mobile number + OTP. Signs in an existing parent or
    creates the account on first use, so there is no separate sign-up step.
    The number becomes verified, and any roster children whose school record
    carries this number are linked straight away.

    POST /api/auth/otp/verify/  {"phone": "...", "otp": "123456"}
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [OTPRateThrottle]

    def post(self, request):
        phone = normalize_in_mobile(request.data.get("phone"))
        otp = str(request.data.get("otp") or "").strip()
        if not phone or not otp:
            return Response(
                {"detail": "Enter your mobile number and the OTP we sent."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        demo_key = f"otp_demo:{phone}"
        cached = cache.get(f"otp:{phone}")
        # A code that was shown on screen (demo mode) proves nothing about who
        # owns the number, so it never marks the number verified or links children
        shown_on_screen = bool(cached) and bool(cache.get(f"otp_screen:{phone}"))
        is_demo = False
        if not cached:
            cached = cache.get(demo_key)
            is_demo = bool(cached)
        if not cached or str(cached) != otp:
            # Burn the code after a few wrong tries so it can't be guessed
            attempts_key = f"otp_attempts:{phone}"
            attempts = (cache.get(attempts_key) or 0) + 1
            cache.set(attempts_key, attempts, timeout=OTP_TTL_SECONDS)
            if attempts >= OTP_MAX_ATTEMPTS:
                cache.delete(f"otp:{phone}")
                cache.delete(demo_key)
            return Response(
                {"detail": "That OTP is wrong or has expired. Request a new one."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if is_demo and not cache.delete(demo_key):
            return Response(
                {"detail": "That demo code has already been used."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cache.delete(f"otp:{phone}")
        cache.delete(f"otp_screen:{phone}")
        cache.delete(f"otp_attempts:{phone}")
        unverified = is_demo or shown_on_screen

        # Only parent profiles sign in here. A staff member's number gets its own
        # parent profile; their staff account keeps its username and password.
        user = (
            User.objects.filter(phone__endswith=phone, is_active=True, role=User.Role.PARENT)
            .order_by("created_at")
            .first()
        )
        if is_demo and user is not None:
            return Response(
                {"detail": "This demo code is only for creating a new profile."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        created = False
        if user is None:
            username = f"parent_{phone}"
            if User.objects.filter(username=username).exists():
                username = f"parent_{phone}_{secrets.token_hex(3)}"
            user = User(
                username=username,
                phone=phone,
                role=User.Role.PARENT,
                is_active=True,
                phone_verified=not unverified,
            )
            user.set_unusable_password()
            user.save()
            created = True
        elif not user.phone_verified and not unverified:
            user.phone_verified = True
            user.save(update_fields=["phone_verified", "updated_at"])

        from schools.linking import link_children_by_phone

        linked = 0 if unverified else link_children_by_phone(user)
        tokens = build_tokens_for_user(user)
        return Response(
            {
                "user": UserSerializer(user).data,
                "access": tokens["access"],
                "refresh": tokens["refresh"],
                "created": created,
                "children_linked": linked,
            },
            status=status.HTTP_200_OK,
        )


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
        from common.audit import log_audit_event
        from common.models import AuditLog
        log_audit_event(
            action=AuditLog.Action.LOGIN_CREATED,
            target_type="User",
            target_id=user.id,
            request=request,
            details={"username": user.username, "role": user.role, "school_id": str(user.school_id) if user.school_id else None},
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        target_user = self.get_object()
        actor = request.user

        # Scope permissions check
        if actor.role == User.Role.BOSS or getattr(actor, "is_superuser", False):
            pass
        elif actor.role == User.Role.ADMIN:
            if target_user.city_id != actor.city_id or target_user.role != User.Role.SCHOOL_ADMIN:
                raise PermissionDenied("Admins can only reset passwords for School Admins in their city.")
        elif actor.role == User.Role.SCHOOL_ADMIN:
            if target_user.school_id != actor.school_id or target_user.role != User.Role.TEACHER:
                raise PermissionDenied("School Admins can only reset passwords for Teachers in their school.")
        else:
            raise PermissionDenied("You do not have permission to reset passwords.")

        new_password = request.data.get("password")
        if not new_password or len(str(new_password).strip()) < 6:
            return Response(
                {"password": ["Password must be at least 6 characters long."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_user.set_password(str(new_password).strip())
        target_user.must_change_password = True
        target_user.save(update_fields=["password", "must_change_password", "updated_at"])
        return Response({"detail": f"Password reset successfully for {target_user.username}."})
