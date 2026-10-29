from django.conf import settings
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone
from common.models import UUIDModel
from common.scoping import ScopedManager
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


class Grade(UUIDModel):
    """
    Fixed, ordered list of grades (sort_order):
    Nursery, Junior KG, Senior KG, Class 1 to Class 12.
    Always sorted by sort_order, never alphabetically.
    """
    name = models.CharField(max_length=50, unique=True)
    sort_order = models.PositiveSmallIntegerField(unique=True, db_index=True)

    class Meta:
        ordering = ["sort_order"]

    def __str__(self) -> str:
        return self.name


class Board(models.TextChoices):
    CBSE = "CBSE", "CBSE"
    ICSE = "ICSE", "ICSE"
    GSEB = "GSEB", "GSEB (Gujarat Board)"
    OTHER = "OTHER", "Other"


class School(UUIDModel):
    city = models.ForeignKey(
        City,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
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
    udise_code = models.CharField(
        max_length=11,
        unique=True,
        null=True,
        blank=True,
        help_text="The school's 11-digit UDISE+ code from the government register. Empty for schools added before it was asked.",
    )
    board = models.CharField(max_length=10, choices=Board.choices, blank=True, default="")
    pincode = models.CharField(max_length=6, blank=True, default="")
    logo = models.ImageField(upload_to="school-logos/%Y/%m/", blank=True, default="")
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


class SchoolBranch(UUIDModel):
    """
    Branch linking a school to a city:
    School unique (school, city) and indexed on (city).
    """
    school = models.ForeignKey(
        School,
        on_delete=models.CASCADE,
        related_name="branches",
    )
    city = models.ForeignKey(
        City,
        on_delete=models.PROTECT,
        related_name="school_branches",
    )
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "School Branches"
        ordering = ["school", "city"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "city"],
                name="uniq_schoolbranch_school_city",
            ),
        ]
        indexes = [
            models.Index(fields=["city"], name="idx_schoolbranch_city"),
        ]

    def __str__(self) -> str:
        return f"{self.school.name} - {self.city.name}"


class Student(UUIDModel):
    class Gender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"

    class ApprovalStatus(models.TextChoices):
        PENDING = "PENDING", "Pending School Admin approval"
        APPROVED = "APPROVED", "Approved"

    class Source(models.TextChoices):
        STAFF = "STAFF", "Added by school staff"
        IMPORT = "IMPORT", "Bulk import"
        PARENT_MANUAL = "PARENT_MANUAL", "Added manually by parent"

    name = models.CharField(max_length=150)
    gr_number = models.CharField(max_length=50)
    grade = models.ForeignKey(
        Grade,
        on_delete=models.PROTECT,
        related_name="students",
        null=True,
        blank=True,
    )
    class_name = models.CharField(max_length=30, db_column="class", blank=True, default="")
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
    branch = models.ForeignKey(
        SchoolBranch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
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
    roster_phone = models.CharField(
        max_length=10,
        blank=True,
        default="",
        db_index=True,
        help_text="Parent's mobile number from the school's records (10 digits). "
        "A parent who verifies this number by OTP is linked automatically.",
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
        # Columns on this row only: ordering through grade__sort_order would add
        # a JOIN to every scoped Student query (Rule 3 / Prompt 3 Requirement 2).
        ordering = ["school_id", "class_name", "section", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "gr_number"],
                name="uniq_student_school_gr",
            ),
        ]
        indexes = [
            models.Index(
                fields=["school", "grade", "gender"],
                name="idx_stud_sch_grd_gen",
            ),
            models.Index(
                fields=["school", "class_name", "gender"],
                name="idx_stud_sch_cls_gen",
            ),
            # Student list: WHERE school, class, section ORDER BY name, streamed
            # straight from the index with no sort node (Rule P3).
            models.Index(
                fields=["school", "class_name", "section", "name", "id"],
                name="idx_student_school_roster",
            ),
            models.Index(
                fields=["school", "grade", "section"],
                name="idx_student_school_grd_sec",
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
            models.Index(
                fields=["branch"],
                name="idx_student_branch",
            ),
        ]

    @property
    def student_class(self) -> str:
        if self.grade:
            return self.grade.name
        return self.class_name

    @student_class.setter
    def student_class(self, value: str) -> None:
        self.class_name = value

    def save(self, *args, **kwargs):
        if self.branch_id:
            self.city_id = self.branch.city_id
            self.school_id = self.branch.school_id
        elif self.school_id and not self.city_id:
            self.city_id = self.school.city_id

        if self.grade and not self.class_name:
            self.class_name = self.grade.name
        elif self.class_name and not self.grade_id:
            # Match existing grade by name or normalized name if available
            from common.constants import normalize_class_name
            norm_name = normalize_class_name(self.class_name) or self.class_name
            gr = Grade.objects.filter(Q(name__iexact=self.class_name) | Q(name__iexact=norm_name)).first()
            if gr:
                self.grade = gr
                self.class_name = gr.name

        update_fields = kwargs.get("update_fields")
        parent_may_have_changed = update_fields is None or bool(
            {"parent", "parent_id"} & set(update_fields)
        )
        with transaction.atomic():
            super().save(*args, **kwargs)
            if self.pk:
                from orders.models import Order

                if parent_may_have_changed:
                    Order.objects.filter(student_id=self.pk).exclude(
                        parent_id=self.parent_id
                    ).update(parent_id=self.parent_id)
                    # A new parent sees the child's measurements; the old one no longer does.
                    StudentMeasurement.objects.filter(student_id=self.pk).exclude(
                        parent_id=self.parent_id
                    ).update(parent_id=self.parent_id)
                effective_class = self.grade.name if self.grade else self.class_name
                Order.objects.filter(student_id=self.pk).exclude(
                    student_class=effective_class
                ).update(student_class=effective_class)

    def __str__(self) -> str:
        return f"{self.name} (GR: {self.gr_number} - {self.school.code})"


class StudentMeasurement(UUIDModel):
    """
    One measurement of a child for uniform sizing (Prompt 20).

    History is kept: every measurement is a new row and the newest one is the
    child's current measurement. Rows are never edited; a parent who corrects a
    number saves a new row. Order lines copy the numbers they were sized from,
    so a later measurement never changes a past order.

    school, city and parent are copied from the student (and kept in step by
    Student.save) so each role's scope is one WHERE on an indexed column of
    this row. Deleted MEASUREMENT_RETENTION_DAYS after they were taken
    (`manage.py clear_fit_data`).
    """

    class Source(models.TextChoices):
        CAMERA = "CAMERA", "Camera"
        MANUAL = "MANUAL", "Entered by hand"

    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name="measurements",
    )
    school = models.ForeignKey(
        School,
        on_delete=models.CASCADE,
        related_name="+",
    )
    city = models.ForeignKey(
        City,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    parent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    height_cm = models.DecimalField(max_digits=4, decimal_places=1)
    weight_kg = models.DecimalField(max_digits=4, decimal_places=1)
    shoulder_cm = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    shoulder_confidence = models.DecimalField(
        max_digits=4,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="How sure the phone was of the camera shoulder width, 0 to 1.",
    )
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    shoulder_edited = models.BooleanField(
        default=False,
        help_text="The parent changed the shoulder width the camera measured.",
    )
    measured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    measured_by_role = models.CharField(max_length=20, blank=True, default="")
    measured_at = models.DateTimeField(default=timezone.now)

    objects = ScopedManager()
    SCOPE_FIELDS = {"city_field": "city_id", "school_field": "school_id", "parent_field": "parent_id"}

    class Meta:
        ordering = ["-measured_at"]
        indexes = [
            models.Index(fields=["student", "measured_at"], name="idx_measure_student_at"),
            models.Index(fields=["school", "measured_at"], name="idx_measure_school_at"),
            models.Index(fields=["parent"], name="idx_measure_parent"),
            models.Index(fields=["measured_at"], name="idx_measure_at"),
        ]

    def save(self, *args, **kwargs):
        student = self.student
        self.school_id = student.school_id
        self.city_id = student.city_id or student.school.city_id
        self.parent_id = student.parent_id
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.student.name}: {self.height_cm} cm, {self.weight_kg} kg ({self.measured_at:%Y-%m-%d})"
