"""
Celery tasks for the schools app (Rule P5: bulk imports never run in the
HTTP request). The API returns a job id immediately; the frontend polls the
job endpoint for status + preview and then calls confirm, which queues the
second task below.
"""

import logging

from celery import shared_task
from django.utils import timezone

from common.models import ImportJob

from .import_service import (
    ImportValidationError,
    commit_import,
    validate_import,
)

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="schools.validate_student_import")
def validate_student_import(self, job_id: str) -> dict:
    """
    Step 1 of the bulk import: parse + validate every row and store the
    preview (valid rows / duplicates / errors) on the job.
    """
    try:
        job = ImportJob.objects.get(pk=job_id)
    except ImportJob.DoesNotExist:
        logger.warning("validate_student_import: job %s no longer exists", job_id)
        return {"job_id": job_id, "status": "MISSING"}

    job.status = ImportJob.Status.VALIDATING
    job.error_message = ""
    job.save(update_fields=["status", "error_message", "updated_at"])

    try:
        validate_import(job)
    except ImportValidationError as exc:
        job.status = ImportJob.Status.FAILED
        job.error_message = str(exc)
        job.completed_at = timezone.now()
        job.save(
            update_fields=["status", "error_message", "completed_at", "updated_at"]
        )
        return {"job_id": job_id, "status": job.status, "error": str(exc)}
    except Exception as exc:  # pragma: no cover - unexpected worker failure
        logger.exception("validate_student_import failed for job %s", job_id)
        job.status = ImportJob.Status.FAILED
        job.error_message = f"Could not read the uploaded file: {exc}"
        job.completed_at = timezone.now()
        job.save(
            update_fields=["status", "error_message", "completed_at", "updated_at"]
        )
        raise

    return {
        "job_id": job_id,
        "status": job.status,
        "valid": job.valid_count,
        "duplicates": job.duplicate_count,
        "errors": job.error_count,
    }


@shared_task(bind=True, name="schools.commit_student_import")
def commit_student_import(self, job_id: str) -> dict:
    """
    Step 2 of the bulk import (after the user confirms the preview):
    insert with `bulk_create(batch_size=500, ignore_conflicts=True)`, which
    compiles to `INSERT ... ON CONFLICT DO NOTHING` on (school_id, gr_number).
    """
    try:
        job = ImportJob.objects.get(pk=job_id)
    except ImportJob.DoesNotExist:
        logger.warning("commit_student_import: job %s no longer exists", job_id)
        return {"job_id": job_id, "status": "MISSING"}

    if job.status != ImportJob.Status.PREVIEW_READY:
        return {
            "job_id": job_id,
            "status": job.status,
            "error": "Job is not waiting for confirmation.",
        }

    job.status = ImportJob.Status.IMPORTING
    job.save(update_fields=["status", "updated_at"])

    try:
        commit_import(job)
    except Exception as exc:  # pragma: no cover - unexpected worker failure
        logger.exception("commit_student_import failed for job %s", job_id)
        job.status = ImportJob.Status.FAILED
        job.error_message = f"Import failed while inserting rows: {exc}"
        job.completed_at = timezone.now()
        job.save(
            update_fields=["status", "error_message", "completed_at", "updated_at"]
        )
        raise

    return {"job_id": job_id, "status": job.status, **(job.result or {})}
