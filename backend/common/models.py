import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class UUIDModel(models.Model):
    """
    Base model using application-generated UUID v4 primary key (Rule P4).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class ImportJob(UUIDModel):
    """
    Reusable background bulk-import job (Rule P5).

    Lifecycle:
        PENDING -> VALIDATING -> PREVIEW_READY -> IMPORTING -> COMPLETED
                             \\-> FAILED  <-----------------------/

    The uploaded file is parsed and validated in a Celery worker, never inside
    the HTTP request. The validated rows + a capped preview are stored on the
    job so the confirm step is a second background job that inserts with
    `bulk_create(batch_size=500, ignore_conflicts=True)`.
    """

    class JobType(models.TextChoices):
        STUDENT_IMPORT = "STUDENT_IMPORT", "Student import"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending validation"
        VALIDATING = "VALIDATING", "Validating"
        PREVIEW_READY = "PREVIEW_READY", "Preview ready - awaiting confirmation"
        IMPORTING = "IMPORTING", "Importing"
        COMPLETED = "COMPLETED", "Completed"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    job_type = models.CharField(
        max_length=40,
        choices=JobType.choices,
        default=JobType.STUDENT_IMPORT,
    )
    status = models.CharField(
        max_length=24,
        choices=Status.choices,
        default=Status.PENDING,
    )
    # Denormalised scope columns (single indexed WHERE for scoping, Rule P3)
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="import_jobs",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="import_jobs",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="import_jobs",
    )
    original_filename = models.CharField(max_length=255, blank=True, default="")
    file = models.FileField(upload_to="imports/%Y/%m/", null=True, blank=True)

    total_rows = models.PositiveIntegerField(default=0)
    valid_count = models.PositiveIntegerField(default=0)
    duplicate_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)

    # Capped preview for the UI (bounded payload, Rule P2)
    preview = models.JSONField(default=dict, blank=True)
    # Full validated rows used by the confirm job (never inserted row by row)
    valid_rows = models.JSONField(default=list, blank=True)
    result = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["school", "created_at"],
                name="idx_importjob_school_created",
            ),
            models.Index(
                fields=["city", "created_at"],
                name="idx_importjob_city_created",
            ),
            models.Index(
                fields=["uploaded_by", "created_at"],
                name="idx_importjob_user_created",
            ),
            models.Index(
                fields=["status", "created_at"],
                name="idx_importjob_status_created",
            ),
        ]

    @property
    def is_finished(self) -> bool:
        return self.status in (
            self.Status.COMPLETED,
            self.Status.FAILED,
            self.Status.CANCELLED,
        )

    def __str__(self) -> str:
        return f"{self.job_type} {self.status} ({self.original_filename})"


class AuditLog(UUIDModel):
    """
    Append-only production audit trail.
    Records who created logins, changed stock, changed order status, and changed prices.
    """

    class Action(models.TextChoices):
        LOGIN_CREATED = "LOGIN_CREATED", "Login Created"
        STOCK_CHANGED = "STOCK_CHANGED", "Stock Changed"
        ORDER_STATUS_CHANGED = "ORDER_STATUS_CHANGED", "Order Status Changed"
        PRICE_CHANGED = "PRICE_CHANGED", "Price Changed"

    action = models.CharField(max_length=40, choices=Action.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    actor_username = models.CharField(max_length=150, blank=True, default="")
    target_type = models.CharField(max_length=80)
    target_id = models.CharField(max_length=64)
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["action", "created_at"], name="idx_audit_action_created"),
            models.Index(fields=["actor", "created_at"], name="idx_audit_actor_created"),
            models.Index(fields=["target_type", "target_id"], name="idx_audit_target"),
        ]

    def __str__(self) -> str:
        return f"[{self.created_at}] {self.actor_username or 'system'} - {self.action} on {self.target_type}:{self.target_id}"

