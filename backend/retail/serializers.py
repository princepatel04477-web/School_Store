from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from accounts.models import User
from schools.models import City, School

from .models import RetailStore, SchoolRequest
from .services import matching_school
from .validators import validate_gst_number


class RetailStoreSerializer(serializers.ModelSerializer):
    city_name = serializers.CharField(source="city.name", read_only=True)
    username = serializers.CharField(source="owner.username", read_only=True)
    owner_name = serializers.SerializerMethodField()
    schools = serializers.SerializerMethodField()

    class Meta:
        model = RetailStore
        fields = (
            "id",
            "name",
            "address",
            "phone",
            "gst_number",
            "city",
            "city_name",
            "username",
            "owner_name",
            "schools",
            "active",
            "created_at",
        )
        read_only_fields = fields

    def get_owner_name(self, obj) -> str:
        return obj.owner.get_full_name()

    def get_schools(self, obj) -> list[dict]:
        return [
            {"id": str(s.id), "name": s.name, "udise_code": s.udise_code, "active": s.active}
            for s in obj.schools.all()
        ]


class RetailerCreateSerializer(serializers.Serializer):
    """Boss creates a retailer: their login and their shop, in one step."""

    username = serializers.CharField(max_length=150)
    password = serializers.CharField(min_length=8, write_only=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    store_name = serializers.CharField(max_length=200)
    address = serializers.CharField()
    phone = serializers.RegexField(r"^\+?\d{10,13}$", error_messages={"invalid": "Enter a 10-digit phone number."})
    gst_number = serializers.CharField(max_length=15, required=False, allow_blank=True)
    city = serializers.PrimaryKeyRelatedField(queryset=City.objects.filter(active=True))

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is taken.")
        return value

    def validate_gst_number(self, value):
        value = (value or "").strip().upper()
        try:
            validate_gst_number(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)
        return value

    @transaction.atomic
    def create(self, validated_data):
        user = User(
            username=validated_data["username"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
            email=validated_data.get("email", ""),
            phone=validated_data["phone"],
            role=User.Role.RETAILER,
            city=validated_data["city"],
            must_change_password=True,
        )
        user.set_password(validated_data["password"])
        user.save()
        return RetailStore.objects.create(
            owner=user,
            name=validated_data["store_name"],
            address=validated_data["address"],
            phone=validated_data["phone"],
            gst_number=validated_data.get("gst_number", ""),
            city=validated_data["city"],
        )


class SchoolRequestSerializer(serializers.ModelSerializer):
    store_name = serializers.CharField(source="store.name", read_only=True)
    city_name = serializers.CharField(source="city.name", read_only=True)
    board_label = serializers.CharField(source="get_board_display", read_only=True)
    school_name = serializers.CharField(source="school.name", read_only=True, default=None)
    reviewed_by_name = serializers.CharField(source="reviewed_by.username", read_only=True, default=None)
    existing_school = serializers.SerializerMethodField()

    class Meta:
        model = SchoolRequest
        fields = (
            "id",
            "store",
            "store_name",
            "name",
            "udise_code",
            "address",
            "city",
            "city_name",
            "board",
            "board_label",
            "pincode",
            "logo",
            "status",
            "school",
            "school_name",
            "reviewed_by_name",
            "reviewed_at",
            "reject_reason",
            "existing_school",
            "created_at",
        )
        read_only_fields = (
            "id",
            "store",
            "status",
            "school",
            "reviewed_at",
            "reject_reason",
            "created_at",
        )
        extra_kwargs = {"logo": {"write_only": True}}

    def get_existing_school(self, obj) -> dict | None:
        """For a pending request: the school with this UDISE code already on the store, if any."""
        if obj.status != SchoolRequest.Status.PENDING:
            return None
        by_udise = self.context.get("schools_by_udise")
        school = by_udise.get(obj.udise_code) if by_udise is not None else matching_school(obj)
        if school is None:
            return None
        return {"id": str(school.id), "name": school.name, "has_logo": bool(school.logo)}

    def validate_name(self, value):
        return " ".join(value.split())

    def validate(self, attrs):
        store = self.context["store"]
        udise = attrs["udise_code"]
        if SchoolRequest.objects.filter(store=store, udise_code=udise, status=SchoolRequest.Status.PENDING).exists():
            raise serializers.ValidationError({"udise_code": "You already sent a request for this school. Wait for the answer."})
        if store.schools.filter(udise_code=udise).exists():
            raise serializers.ValidationError({"udise_code": "This school is already approved for your shop."})
        return attrs

    def create(self, validated_data):
        return SchoolRequest.objects.create(store=self.context["store"], **validated_data)


class ApproveSerializer(serializers.Serializer):
    school = serializers.PrimaryKeyRelatedField(
        queryset=School.objects.all(),
        required=False,
        allow_null=True,
        help_text="Link to this older school (one without a UDISE code) instead of creating a new one.",
    )
    use_new_logo = serializers.BooleanField(default=True)


class RejectSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000)
