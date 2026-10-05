"""
School Admin panel models.

The only thing stored here is the export job bookkeeping: the panel itself is
a thin read layer over the scoped tables (DailySalesSummary / DailySchoolTotal
for numbers, Order for the tables).
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import UUIDModel


def default_expiry():
    from django.conf import settings

    return timezone.now() + timezone.timedelta(
        days=int(getattr(settings, "EXPORT_FILE_TTL_DAYS", 7))
    )


class ExportJob(UUIDModel):
    """
    Background Excel export (Rule P5 / requirement 4).

    The HTTP request only inserts this row and returns 202; a Celery worker
    streams the workbook to storage and flips the status to READY, after which
    the panel shows a download link. No workbook is ever built inside a
    request, so a 200,000-row export cannot hold a web worker hostage.
    """

    class JobType(models.TextChoices):
        ORDERS = "ORDERS", "Orders export"
        STUDENTS = "STUDENTS", "Students export"

    class Status(models.TextChoices):
        QUEUED = "QUEUED", "Queued"
        RUNNING = "RUNNING", "Building the file"
        READY = "READY", "Ready to download"
        FAILED = "FAILED", "Failed"
        EXPIRED = "EXPIRED", "Expired"

    job_type = models.CharField(
        max_length=20,
        choices=JobType.choices,
        default=JobType.ORDERS,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.QUEUED,
    )
    # Denormalised scope so every list/detail lookup is one indexed WHERE.
    school = models.ForeignKey(
        "schools.School",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="export_jobs",
    )
    city = models.ForeignKey(
        "schools.City",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="export_jobs",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="export_jobs",
    )
    # The exact filters the user had on screen when they clicked export.
    filters = models.JSONField(default=dict, blank=True)
    file = models.FileField(upload_to="exports/%Y/%m/", null=True, blank=True)
    filename = models.CharField(max_length=255, blank=True, default="")
    row_count = models.PositiveIntegerField(default=0)
    result = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, default=default_expiry)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["school", "created_at"],
                name="idx_exportjob_school_created",
            ),
            models.Index(
                fields=["status", "created_at"],
                name="idx_exportjob_status_created",
            ),
            models.Index(
                fields=["requested_by", "created_at"],
                name="idx_exportjob_user_created",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.job_type} {self.status} ({self.filename or self.id})"

    @property
    def is_finished(self) -> bool:
        return self.status in (
            self.Status.READY,
            self.Status.FAILED,
            self.Status.EXPIRED,
        )

    @property
    def is_expired(self) -> bool:
        """Download links stop working once the file's retention window closes."""
        return bool(
            self.status == self.Status.READY
            and self.expires_at
            and self.expires_at < timezone.now()
        )

    @property
    def effective_status(self) -> str:
        return self.Status.EXPIRED if self.is_expired else self.status
