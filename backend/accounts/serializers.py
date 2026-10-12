from django.core.cache import cache
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from schools.models import City, School
from common.phone import normalize_in_mobile
from .models import User


def build_tokens_for_user(user: User) -> dict:
    refresh = CustomTokenObtainPairSerializer.get_token(user)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
    }


class UserSerializer(serializers.ModelSerializer):
    city_name = serializers.CharField(source="city.name", read_only=True, default=None)
    school_name = serializers.CharField(source="school.name", read_only=True, default=None)
    school_code = serializers.CharField(source="school.code", read_only=True, default=None)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "role",
            "phone",
            "phone_verified",
            "must_change_password",
            "city",
            "city_name",
            "school",
            "school_name",
            "school_code",
            "is_active",
            "created_at",
        )
        read_only_fields = (
            "id",
            "must_change_password",
            "phone_verified",
            "city_name",
            "school_name",
            "school_code",
            "created_at",
        )


class ManagedUserWriteSerializer(serializers.ModelSerializer):
    """
    Prompt 3 Requirement 6:
    - Boss creates Admins (and can create any role).
    - Admins create School Admin logins for schools in their city.
    - School Admins create Teacher logins for their own school.
    """

    password = serializers.CharField(write_only=True, required=False, min_length=6, allow_blank=True)
    role = serializers.ChoiceField(choices=User.Role.choices, required=False)
    city = serializers.PrimaryKeyRelatedField(
        queryset=City.objects.all(), required=False, allow_null=True
    )
    school = serializers.PrimaryKeyRelatedField(
        queryset=School.objects.select_related("city").all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "password",
            "email",
            "first_name",
            "last_name",
            "role",
            "phone",
            "city",
            "school",
            "is_active",
        )
        read_only_fields = ("id",)

    def validate(self, attrs):
        request = self.context["request"]
        actor = request.user

        target_role = attrs.get("role")
        target_city = attrs.get("city")
        target_school = attrs.get("school")

        if actor.role == User.Role.BOSS or getattr(actor, "is_superuser", False):
            if not target_role:
                target_role = User.Role.ADMIN
                attrs["role"] = target_role
            if target_role == User.Role.ADMIN and not target_city:
                raise serializers.ValidationError(
                    {"city": "City is required when creating an Admin."}
                )
            if target_role in (User.Role.SCHOOL_ADMIN, User.Role.TEACHER):
                if not target_school:
                    raise serializers.ValidationError(
                        {"school": "School is required for School Admin or Teacher."}
                    )
                attrs["city"] = target_school.city
            return attrs

        if actor.role == User.Role.ADMIN:
            if target_role and target_role != User.Role.SCHOOL_ADMIN:
                raise PermissionDenied(
                    "Admins can only create School Admin accounts."
                )
            attrs["role"] = User.Role.SCHOOL_ADMIN
            if not target_school:
                raise serializers.ValidationError(
                    {"school": "School is required when creating a School Admin."}
                )
            if target_school.city_id != actor.city_id:
                raise PermissionDenied(
                    "Admins can only create School Admins for schools in their own city."
                )
            attrs["city"] = target_school.city
            return attrs

        if actor.role == User.Role.SCHOOL_ADMIN:
            if target_role and target_role != User.Role.TEACHER:
                raise PermissionDenied(
                    "School Admins can only create Teacher accounts."
                )
            if target_school and target_school.id != actor.school_id:
                raise PermissionDenied(
                    "School Admins can only create Teachers for their own school."
                )
            attrs["role"] = User.Role.TEACHER
            attrs["school_id"] = actor.school_id
            attrs["city_id"] = actor.city_id
            attrs.pop("school", None)
            attrs.pop("city", None)
            return attrs

        raise PermissionDenied("You do not have permission to create staff accounts.")

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        if not password:
            raise serializers.ValidationError({"password": "Password is required when creating an account."})
        role = validated_data.get("role")
        validated_data["is_staff"] = role in (User.Role.BOSS, User.Role.ADMIN)
        validated_data["is_superuser"] = role == User.Role.BOSS
        user = User(**validated_data)
        user.set_password(password)
        user.must_change_password = True
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        if password:
            instance.set_password(password)
            instance.must_change_password = True
        instance.save()
        return instance


class ParentRegistrationSerializer(serializers.Serializer):
    """
    Prompt 3 Requirement 6:
    Parents self-register with phone number and OTP or password.
    """

    phone = serializers.CharField(max_length=20)
    username = serializers.CharField(max_length=150, required=False, allow_blank=True)
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, min_length=6
    )
    otp = serializers.CharField(write_only=True, required=False, allow_blank=True)
    first_name = serializers.CharField(max_length=150, required=False, default="")
    last_name = serializers.CharField(max_length=150, required=False, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    school = serializers.PrimaryKeyRelatedField(
        queryset=School.objects.select_related("city").all(),
        required=False,
        allow_null=True,
    )

    def validate_phone(self, value):
        phone = value.strip()
        if not phone:
            raise serializers.ValidationError("Phone number is required.")
        if User.objects.filter(phone=phone).exists():
            raise serializers.ValidationError(
                "An account with this phone number already exists."
            )
        return phone

    def validate(self, attrs):
        phone = attrs["phone"]
        password = attrs.get("password")
        otp = attrs.get("otp")

        if not password and not otp:
            raise serializers.ValidationError(
                "Provide either a password or a valid OTP to register."
            )

        if otp:
            cached_otp = cache.get(f"otp:{phone}") or cache.get(
                f"otp:{normalize_in_mobile(phone)}"
            )
            if not cached_otp or str(cached_otp) != str(otp).strip():
                raise serializers.ValidationError({"otp": "Invalid or expired OTP."})

        username = (attrs.get("username") or "").strip() or f"parent_{phone}"
        if User.objects.filter(username=username).exists():
            raise serializers.ValidationError(
                {"username": "Username is already taken."}
            )
        attrs["username"] = username
        return attrs

    def create(self, validated_data):
        phone = validated_data["phone"]
        password = validated_data.get("password")
        otp = validated_data.get("otp")
        school = validated_data.get("school")

        if otp:
            cache.delete(f"otp:{phone}")
            cache.delete(f"otp:{normalize_in_mobile(phone)}")

        user = User(
            username=validated_data["username"],
            phone=phone,
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
            email=validated_data.get("email", ""),
            role=User.Role.PARENT,
            school=school,
            city=school.city if school else None,
            is_active=True,
            is_staff=False,
            is_superuser=False,
            # A number confirmed by OTP can be trusted to link roster children
            phone_verified=bool(otp),
        )
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        if user.phone_verified:
            from schools.linking import link_children_by_phone

            link_children_by_phone(user)
        return user


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["role"] = user.role
        token["city_id"] = str(user.city_id) if user.city_id else None
        token["school_id"] = str(user.school_id) if user.school_id else None
        token["must_change_password"] = bool(user.must_change_password)
        return token

    def validate(self, attrs):
        login_ident = (attrs.get(self.username_field) or "").strip()
        if login_ident:
            digits_only = "".join(ch for ch in login_ident if ch.isdigit())
            user = (
                User.objects.filter(username__iexact=login_ident).first()
                or User.objects.filter(phone=login_ident).first()
                or (User.objects.filter(phone=digits_only).first() if digits_only else None)
                or (User.objects.filter(phone=digits_only[-10:]).first() if len(digits_only) >= 10 else None)
            )
            if user:
                attrs[self.username_field] = user.username

        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
