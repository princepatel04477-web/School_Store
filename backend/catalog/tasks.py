"""
Celery tasks for the size chart import (Rule P5: imports never run in the
HTTP request). Same two steps as the student import in `schools/tasks.py`:
validate -> preview, then commit after the user confirms.
"""

import logging

from celery import shared_task
from django.utils import timezone

from common.models import ImportJob
from schools.import_service import ImportValidationError

from .size_chart_import import commit_import, validate_import

logger = logging.getLogger(__name__)


def _fail(job: ImportJob, message: str) -> None:
    job.status = ImportJob.Status.FAILED
    job.error_message = message
    job.completed_at = timezone.now()
    job.save(update_fields=["status", "error_message", "completed_at", "updated_at"])


@shared_task(bind=True, name="catalog.validate_size_chart_import")
def validate_size_chart_import(self, job_id: str) -> dict:
    """Step 1: check the whole file and store the dry-run preview on the job."""
    try:
        job = ImportJob.objects.get(pk=job_id)
    except ImportJob.DoesNotExist:
        logger.warning("validate_size_chart_import: job %s no longer exists", job_id)
        return {"job_id": job_id, "status": "MISSING"}

    job.status = ImportJob.Status.VALIDATING
    job.error_message = ""
    job.save(update_fields=["status", "error_message", "updated_at"])

    try:
        validate_import(job)
    except ImportValidationError as exc:
        _fail(job, str(exc))
        return {"job_id": job_id, "status": job.status, "error": str(exc)}
    except Exception as exc:  # pragma: no cover - unexpected worker failure
        logger.exception("validate_size_chart_import failed for job %s", job_id)
        _fail(job, f"Could not read the uploaded file: {exc}")
        raise

    return {"job_id": job_id, "status": job.status, **(job.preview or {}).get("summary", {})}


@shared_task(bind=True, name="catalog.commit_size_chart_import")
def commit_size_chart_import(self, job_id: str) -> dict:
    """Step 2 (after the user confirms): replace the charts in one transaction."""
    try:
        job = ImportJob.objects.get(pk=job_id)
    except ImportJob.DoesNotExist:
        logger.warning("commit_size_chart_import: job %s no longer exists", job_id)
        return {"job_id": job_id, "status": "MISSING"}

    if job.status != ImportJob.Status.PREVIEW_READY:
        return {"job_id": job_id, "status": job.status, "error": "Job is not waiting for confirmation."}

    job.status = ImportJob.Status.IMPORTING
    job.save(update_fields=["status", "updated_at"])

    try:
        commit_import(job)
    except ImportValidationError as exc:
        # The transaction rolled back, so no chart was changed.
        _fail(job, str(exc))
        return {"job_id": job_id, "status": job.status, "error": str(exc)}
    except Exception as exc:  # pragma: no cover - unexpected worker failure
        logger.exception("commit_size_chart_import failed for job %s", job_id)
        _fail(job, f"Import failed, nothing was saved: {exc}")
        raise

    return {"job_id": job_id, "status": job.status, **(job.result or {})}
