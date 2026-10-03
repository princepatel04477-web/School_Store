from django.conf import settings
from django.db import models, transaction
from django.db.models import Q
from common.models import UUIDModel
from common.cache_utils import invalidate_school_cache


class City(UUIDModel):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=20, unique=True)
    state = models.CharField(max_length=100, blank=True, default="Gujarat")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Cities"
        ordering = ["name"]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        invalidate_school_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        invalidate_school_cache()

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class School(UUIDModel):
    city = models.ForeignKey(
        City,
        on_delete=models.PROTECT,
        related_name="schools",
    )
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=40, unique=True)
    active = models.BooleanField(default=True)
    commission_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Optional commission percentage for the school (e.g. 10.00)",
    )
    home_delivery_enabled = models.BooleanField(
        default=True,
        help_text="Whether parents may choose home delivery at checkout.",
    )
    school_pickup_enabled = models.BooleanField(
        default=True,
        help_text="Whether parents may choose pickup at this school at checkout.",
    )
    address = models.TextField(blank=True, default="")
    contact_email = models.EmailField(blank=True, default="")
    contact_phone = models.CharField(max_length=20, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(
                condition=Q(home_delivery_enabled=True) | Q(school_pickup_enabled=True),
                name="school_has_fulfillment_option",
            ),
        ]
        indexes = [
            models.Index(fields=["city", "active"], name="idx_school_city_active"),
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        invalidate_school_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        invalidate_school_cache()

    def __str__(self) -> str:
        return f"{self.name} [{self.code}]"


class Student(UUIDModel):
    class Gender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"
        OTHER = "OTHER", "Other"

    class ApprovalStatus(models.TextChoices):
        PENDING = "PENDING", "Pending School Admin approval"
        APPROVED = "APPROVED", "Approved"

    class Source(models.TextChoices):
        STAFF = "STAFF", "Added by school staff"
        IMPORT = "IMPORT", "Bulk import"
        PARENT_MANUAL = "PARENT_MANUAL", "Added manually by parent"

    name = models.CharField(max_length=150)
    gr_number = models.CharField(max_length=50)
    class_name = models.CharField(max_length=30, db_column="class")
    section = models.CharField(max_length=20)
    gender = models.CharField(
        max_length=16,
        choices=Gender.choices,
        default=Gender.MALE,
    )
    date_of_birth = models.DateField(
        null=True,
        blank=True,
        help_text="Optional. Used as the second check when a parent claims a child.",
    )
    school = models.ForeignKey(
        School,
        on_delete=models.CASCADE,
        related_name="students",
    )
    # Denormalised city_id so Admin scope filter is a single WHERE on Student.city_id
    city = models.ForeignKey(
        City,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="students",
    )
    parent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )
    approval_status = models.CharField(
        max_length=16,
        choices=ApprovalStatus.choices,
        default=ApprovalStatus.APPROVED,
    )
    source = models.CharField(
        max_length=24,
        choices=Source.choices,
        default=Source.STAFF,
    )
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["school_id", "class_name", "section", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "gr_number"],
                name="uniq_student_school_gr",
            ),
        ]
        indexes = [
            models.Index(
                fields=["school", "class_name", "section"],
                name="idx_student_school_cls_sec",
            ),
            models.Index(
                fields=["parent"],
                name="idx_student_parent",
            ),
            models.Index(
                fields=["city", "school"],
                name="idx_student_city_school",
            ),
            models.Index(
                fields=["school", "approval_status"],
                name="idx_student_school_approval",
            ),
        ]

    @property
    def student_class(self) -> str:
        return self.class_name

    @student_class.setter
    def student_class(self, value: str) -> None:
        self.class_name = value

    def save(self, *args, **kwargs):
        if self.school_id:
            self.city_id = self.school.city_id
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {"city"}

        update_fields = kwargs.get("update_fields")
        parent_may_have_changed = update_fields is None or bool(
            {"parent", "parent_id"} & set(update_fields)
        )
        with transaction.atomic():
            super().save(*args, **kwargs)
            if self.pk and parent_may_have_changed:
                # Parent-scoped order lists use a denormalized indexed FK. Keep
                # earlier teacher orders visible if a parent link is added later.
                from orders.models import Order

                Order.objects.filter(student_id=self.pk).exclude(
                    parent_id=self.parent_id
                ).update(parent_id=self.parent_id)

    def __str__(self) -> str:
        return f"{self.name} (GR: {self.gr_number} - {self.school.code})"
