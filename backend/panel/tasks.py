"""
Background jobs for the School Admin panel (Rule P5).

Nothing heavy runs inside an HTTP request: the export endpoint inserts a job
row and returns 202, and this worker streams the workbook to storage.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import ExportJob
from .services import (
    ORDERS_COLUMNS,
    STUDENTS_COLUMNS,
    OrderFilters,
    order_rows,
    panel_orders_qs,
    student_rows,
    write_export_workbook,
)

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="panel.build_export")
def build_export(self, job_id: str) -> dict:
    """
    Build one Excel export in streaming mode and store it on the job.

    * openpyxl write-only worksheet -> rows go straight into the zip stream
    * `.iterator(chunk_size=...)`   -> the queryset is streamed in chunks
    so memory stays flat for a 200,000-row export.
    """
    try:
        job = ExportJob.objects.select_related("school").get(pk=job_id)
    except ExportJob.DoesNotExist:
        logger.warning("panel.build_export: job %s no longer exists", job_id)
        return {"job_id": job_id, "status": "MISSING"}

    if job.status in (ExportJob.Status.RUNNING, ExportJob.Status.READY):
        return {"job_id": job_id, "status": job.status}

    job.status = ExportJob.Status.RUNNING
    job.error_message = ""
    job.save(update_fields=["status", "error_message", "updated_at"])

    try:
        if job.job_type == ExportJob.JobType.STUDENTS:
            from schools.models import Student

            filters = OrderFilters.from_params(job.filters or {})
            queryset = (
                Student.objects.filter(school_id=job.school_id)
                .select_related("parent")
                .order_by("class_name", "section", "name", "id")
            )
            if filters.class_name:
                queryset = queryset.filter(class_name=filters.class_name)
            if filters.section:
                queryset = queryset.filter(section=filters.section)
            rows = student_rows(queryset.iterator(chunk_size=500))
            columns = STUDENTS_COLUMNS
            title = "Students"
        else:
            school = job.school
            filters = OrderFilters.from_params(job.filters or {})
            queryset = panel_orders_qs(school, filters)
            rows = order_rows(queryset.iterator(chunk_size=500))
            columns = ORDERS_COLUMNS
            title = "Orders"

        write_export_workbook(job, rows, columns, title)

        job.status = ExportJob.Status.READY
        job.completed_at = timezone.now()
        job.expires_at = job.completed_at + timedelta(
            days=int(_ttl_days())
        )
        job.save(
            update_fields=[
                "status",
                "file",
                "filename",
                "row_count",
                "result",
                "completed_at",
                "expires_at",
                "updated_at",
            ]
        )
        return {"job_id": job_id, "status": job.status, "rows": job.row_count}

    except Exception as exc:  # pragma: no cover - worker failure path
        logger.exception("panel.build_export failed for job %s", job_id)
        job.status = ExportJob.Status.FAILED
        job.error_message = f"Could not build the export: {exc}"
        job.completed_at = timezone.now()
        job.save(
            update_fields=[
                "status",
                "error_message",
                "completed_at",
                "updated_at",
            ]
        )
        raise


def _ttl_days() -> int:
    from django.conf import settings

    return getattr(settings, "EXPORT_FILE_TTL_DAYS", 7)


@shared_task(name="panel.purge_expired_exports")
def purge_expired_exports() -> int:
    """
    Delete export files past their retention window.

    Wire this to Celery beat (or a nightly cron) if you want the media
    directory to stay tidy; nothing else depends on it.
    """
    stale = ExportJob.objects.filter(
        status=ExportJob.Status.READY, expires_at__lt=timezone.now()
    )
    removed = 0
    for job in stale.iterator():
        if job.file:
            job.file.delete(save=False)
        job.status = ExportJob.Status.EXPIRED
        job.save(update_fields=["status", "updated_at"])
        removed += 1
    return removed
