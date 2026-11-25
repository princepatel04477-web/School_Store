from django.core.cache import cache
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from schools.models import City, School, SchoolBranch
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
    city_state = serializers.CharField(source="city.state", read_only=True, default=None)
    school_name = serializers.CharField(source="school.name", read_only=True, default=None)
    school_code = serializers.CharField(source="school.code", read_only=True, default=None)
    branch_name = serializers.CharField(source="branch.display_name", read_only=True, default=None)
    issued_password = serializers.SerializerMethodField()

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
            "all_schools_access",
            "city",
            "city_name",
            "city_state",
            "school",
            "school_name",
            "school_code",
            "branch",
            "branch_name",
            "issued_password",
            "is_active",
            "created_at",
        )
        read_only_fields = (
            "id",
            "must_change_password",
            "phone_verified",
            "city_name",
            "city_state",
            "school_name",
            "school_code",
            "branch_name",
            "issued_password",
            "created_at",
        )

    def get_issued_password(self, obj):
        request = self.context.get("request")
        actor = getattr(request, "user", None)
        if not actor or not getattr(actor, "is_authenticated", False):
            return None
        if obj.role != User.Role.TEACHER:
            return None
        if actor.role in (User.Role.BOSS, User.Role.ADMIN, User.Role.SCHOOL_ADMIN) or getattr(actor, "is_superuser", False):
            return obj.get_issued_password() or None
        return None


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
    branch = serializers.PrimaryKeyRelatedField(
        queryset=SchoolBranch.objects.select_related("school", "city").all(),
        required=False,
        allow_null=True,
    )
    all_schools_access = serializers.BooleanField(required=False, default=False)

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
            "branch",
            "all_schools_access",
            "is_active",
        )
        read_only_fields = ("id",)

    def validate(self, attrs):
        request = self.context["request"]
        actor = request.user
        inst = self.instance

        target_role = attrs.get("role", getattr(inst, "role", None))
        target_city = attrs.get("city", getattr(inst, "city", None))
        target_school = attrs.get("school", getattr(inst, "school", None))
        target_branch = attrs.get("branch", getattr(inst, "branch", None))
        target_all_schools = attrs.get(
            "all_schools_access", getattr(inst, "all_schools_access", False)
        )

        if actor.role == User.Role.BOSS or getattr(actor, "is_superuser", False):
            if not target_role:
                target_role = User.Role.ADMIN
                attrs["role"] = target_role
            if target_role == User.Role.ADMIN and not target_city:
                raise serializers.ValidationError(
                    {"city": "City is required when creating an Admin."}
                )
            if target_role == User.Role.SCHOOL_ADMIN and not target_school:
                raise serializers.ValidationError(
                    {"school": "School is required for School Admin."}
                )
            if target_role == User.Role.TEACHER:
                if not target_school and not target_all_schools:
                    raise serializers.ValidationError(
                        {"school": "Select a school or enable All Schools access for a Teacher."}
                    )
                if target_branch and not target_school:
                    attrs["school"] = target_branch.school
                    target_school = attrs["school"]
                if target_branch and target_branch.city_id:
                    attrs["city"] = target_branch.city
                elif target_school and target_school.city_id:
                    attrs["city"] = target_school.city
                return attrs
            if target_school:
                attrs["city"] = target_school.city
            return attrs

        if actor.role == User.Role.ADMIN:
            if target_role and target_role not in (User.Role.SCHOOL_ADMIN, User.Role.TEACHER):
                raise PermissionDenied(
                    "Admins can only create School Admin or Teacher accounts."
                )
            target_role = target_role or User.Role.SCHOOL_ADMIN
            attrs["role"] = target_role
            if target_role == User.Role.TEACHER and target_all_schools and not actor.city_id:
                return attrs
            if not target_school:
                raise serializers.ValidationError(
                    {"school": "School is required."}
                )
            if actor.city_id and target_school.city_id != actor.city_id:
                raise PermissionDenied(
                    "Admins can only create staff for schools in their own city."
                )
            attrs["city"] = target_branch.city if target_branch else target_school.city
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
        token["all_schools_access"] = bool(user.all_schools_access)
        token["must_change_password"] = bool(user.must_change_password)
        return token

    def validate(self, attrs):
        login_ident = (attrs.get(self.username_field) or "").strip()
        if login_ident:
            digits_only = "".join(ch for ch in login_ident if ch.isdigit())
            # Mobile-number parent profiles have no password ("!" prefix), so a
            # phone number here always means the password account for it
            by_phone = User.objects.exclude(password__startswith="!").order_by("created_at")
            user = (
                User.objects.filter(username__iexact=login_ident).first()
                or by_phone.filter(phone=login_ident).first()
                or (by_phone.filter(phone=digits_only).first() if digits_only else None)
                or (by_phone.filter(phone=digits_only[-10:]).first() if len(digits_only) >= 10 else None)
            )
            if user:
                attrs[self.username_field] = user.username

        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
