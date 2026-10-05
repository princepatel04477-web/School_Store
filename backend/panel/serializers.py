from django.urls import reverse
from rest_framework import serializers

from accounts.models import User
from orders.models import Order

from .models import ExportJob
from .services import ITEM_PREVIEW_LIMIT, OrderFilters

PLACED_BY_LABELS = {
    "PARENT": "Parent",
    "TEACHER": "Teacher",
    "SCHOOL_ADMIN": "School admin",
    "ADMIN": "City admin",
    "BOSS": "Boss",
}


def placed_by_label(role: str) -> str:
    return PLACED_BY_LABELS.get(role, role.replace("_", " ").title())


# --------------------------------------------------------------------------- #
# Orders table (requirement 2)
# --------------------------------------------------------------------------- #
class PanelOrderItemSerializer(serializers.Serializer):
    product = serializers.CharField()
    variant = serializers.CharField()
    quantity = serializers.IntegerField()
    category = serializers.CharField()


class PanelOrderSerializer(serializers.ModelSerializer):
    """
    One row of the School Admin orders table.

    Item lines are capped at ITEM_PREVIEW_LIMIT per row (Rule P2): the units /
    amount columns are still totals for the whole order.
    """

    student_name = serializers.CharField(source="student.name", read_only=True)
    student_gr = serializers.CharField(source="student.gr_number", read_only=True)
    student_class = serializers.CharField(source="student.class_name", read_only=True)
    student_section = serializers.CharField(source="student.section", read_only=True)
    placed_by_name = serializers.SerializerMethodField()
    placed_by_role_label = serializers.SerializerMethodField()
    units = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    amount = serializers.DecimalField(
        source="total", max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        model = Order
        fields = (
            "id",
            "order_number",
            "student",
            "student_name",
            "student_gr",
            "student_class",
            "student_section",
            "items",
            "item_count",
            "units",
            "amount",
            "status",
            "payment_status",
            "fulfillment_type",
            "created_at",
            "placed_by",
            "placed_by_name",
            "placed_by_role",
            "placed_by_role_label",
        )
        read_only_fields = fields

    def get_placed_by_name(self, obj) -> str:
        user = obj.placed_by
        if not user:
            return ""
        return user.get_full_name() or user.username

    def get_placed_by_role_label(self, obj) -> str:
        return placed_by_label(obj.placed_by_role)

    def get_units(self, obj) -> int:
        return sum(item.quantity for item in obj.items.all())

    def get_item_count(self, obj) -> int:
        return len(list(obj.items.all()))

    def get_items(self, obj) -> list[dict]:
        lines = []
        for item in obj.items.all():
            variant = item.variant
            product = getattr(variant, "product", None)
            lines.append(
                {
                    "product": getattr(product, "name", "") if product else "",
                    "variant": getattr(variant, "size", "") or "",
                    "quantity": item.quantity,
                    "category": getattr(item.category, "name", "") if item.category_id else "",
                }
            )
        lines.sort(key=lambda row: (-row["quantity"], row["product"]))
        return lines[:ITEM_PREVIEW_LIMIT]


# --------------------------------------------------------------------------- #
# Dashboard / commission (requirements 1 & 7)
# --------------------------------------------------------------------------- #
class SchoolBriefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    code = serializers.CharField()
    city_name = serializers.CharField(source="city.name", required=False)
    commission_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True, required=False
    )


class DashboardTotalsSerializer(serializers.Serializer):
    """Headline figures - read from DailySchoolTotal, never from orders."""

    orders = serializers.IntegerField()
    units = serializers.IntegerField()
    gross_sales = serializers.DecimalField(max_digits=16, decimal_places=2)
    cost = serializers.DecimalField(max_digits=16, decimal_places=2)
    margin = serializers.DecimalField(max_digits=16, decimal_places=2)
    average_order_value = serializers.DecimalField(max_digits=16, decimal_places=2)


class CategoryBreakdownSerializer(serializers.Serializer):
    category_id = serializers.UUIDField()
    category = serializers.CharField()
    orders = serializers.IntegerField()
    units = serializers.IntegerField()
    gross_sales = serializers.DecimalField(max_digits=16, decimal_places=2)
    share_pct = serializers.DecimalField(max_digits=5, decimal_places=1)


class DashboardDailySerializer(serializers.Serializer):
    date = serializers.DateField()
    orders = serializers.IntegerField()
    units = serializers.IntegerField()
    gross_sales = serializers.DecimalField(max_digits=16, decimal_places=2)


class CommissionSectionSerializer(serializers.Serializer):
    """
    Requirement 7: the rate comes from `School.commission_rate`.

    `rate_set` is false and `rate_display` reads "Not set" when the school
    has no rate - no default percentage is ever substituted.
    """

    rate_set = serializers.BooleanField()
    rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True, required=False
    )
    rate_display = serializers.CharField()
    basis = serializers.CharField()
    gross_sales = serializers.DecimalField(max_digits=16, decimal_places=2)
    commission_amount = serializers.DecimalField(
        max_digits=16, decimal_places=2, allow_null=True, required=False
    )
    currency = serializers.CharField()
    note = serializers.CharField(allow_null=True, required=False)


# --------------------------------------------------------------------------- #
# Teachers (requirement 6)
# --------------------------------------------------------------------------- #
class CommissionSerializer(serializers.Serializer):
    """Requirement 7: gross sales + commission for one school over a range."""

    school = SchoolBriefSerializer()
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    orders = serializers.IntegerField()
    units = serializers.IntegerField()
    gross_sales = serializers.DecimalField(max_digits=16, decimal_places=2)
    cost = serializers.DecimalField(max_digits=16, decimal_places=2)
    margin = serializers.DecimalField(max_digits=16, decimal_places=2)
    commission = CommissionSectionSerializer()


class StudentOrderTotalsSerializer(serializers.Serializer):
    """Requirement 3: one child's order count, units and spend for a year."""

    orders = serializers.IntegerField()
    units = serializers.IntegerField()
    gross_sales = serializers.DecimalField(max_digits=16, decimal_places=2)


class TeacherSerializer(serializers.ModelSerializer):
    school_name = serializers.CharField(source="school.name", read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "phone",
            "role",
            "school",
            "school_name",
            "is_active",
            "must_change_password",
            "created_at",
        )
        read_only_fields = (
            "id",
            "username",
            "role",
            "school",
            "school_name",
            "must_change_password",
            "created_at",
        )


class TeacherCreateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    # No min_length here: DRF runs validators before validate_password,
    # so a blank (auto-generated) password would fail the length check.
    password = serializers.CharField(required=False, allow_blank=True)

    def validate_password(self, value: str) -> str:
        if value and len(value) < 8:
            raise serializers.ValidationError("Use at least 8 characters, or leave blank.")
        return value

    def validate_username(self, value: str) -> str:
        username = (value or "").strip()
        if username and User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError("That username is already taken.")
        return username

    def validate(self, attrs):
        school = self.context["school"]
        username = attrs.get("username")
        if not username:
            base = (
                (attrs.get("first_name") or "").strip().lower().replace(" ", ".")
                or school.code.lower().replace(" ", "")
            )
            candidate = f"teacher_{base}"
            index = 1
            while User.objects.filter(username__iexact=candidate).exists():
                index += 1
                candidate = f"teacher_{base}{index}"
            attrs["username"] = candidate
        return attrs


# --------------------------------------------------------------------------- #
# Export jobs (requirement 4)
# --------------------------------------------------------------------------- #
class ExportFiltersSerializer(serializers.Serializer):
    class_name = serializers.CharField(required=False, allow_blank=True)
    section = serializers.CharField(required=False, allow_blank=True)
    category_id = serializers.CharField(required=False, allow_blank=True)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    placed_by_role = serializers.ChoiceField(
        choices=[(role, role) for role in ("PARENT", "TEACHER", "SCHOOL_ADMIN", "ADMIN", "BOSS")],
        required=False,
        allow_blank=True,
    )
    status = serializers.ChoiceField(
        choices=Order.Status.choices, required=False, allow_blank=True
    )
    student_id = serializers.CharField(required=False, allow_blank=True)


class ExportJobCreateSerializer(serializers.Serializer):
    job_type = serializers.ChoiceField(
        choices=ExportJob.JobType.choices, default=ExportJob.JobType.ORDERS
    )
    filters = ExportFiltersSerializer(required=False, default=dict)

    def validate_filters(self, value):
        return OrderFilters.from_params(value or {}).as_dict()


class ExportJobSerializer(serializers.ModelSerializer):
    school_code = serializers.CharField(source="school.code", read_only=True, default=None)
    requested_by_name = serializers.CharField(
        source="requested_by.username", read_only=True, default=None
    )
    download_url = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    job_type_display = serializers.CharField(source="get_job_type_display", read_only=True)

    class Meta:
        model = ExportJob
        fields = (
            "id",
            "job_type",
            "job_type_display",
            "status",
            "status_display",
            "progress",
            "school",
            "school_code",
            "requested_by_name",
            "filters",
            "filename",
            "row_count",
            "result",
            "error_message",
            "download_url",
            "created_at",
            "completed_at",
            "expires_at",
        )
        read_only_fields = fields

    def get_download_url(self, obj) -> str | None:
        if obj.status == ExportJob.Status.READY and obj.file and not obj.is_expired:
            return reverse("panel-export-download", args=[obj.id])
        return None

    def get_progress(self, obj) -> int:
        return {
            "QUEUED": 5,
            "RUNNING": 50,
            "READY": 100,
            "FAILED": 100,
            "EXPIRED": 100,
        }.get(obj.effective_status, 0)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["status"] = instance.effective_status
        data["download_url"] = self.get_download_url(instance)
        return data
