"""
Size chart import for the School Admin and Boss panels (plan A1).

    POST /api/size-chart-imports/?school=<id|generic>           upload -> job id (202)
    GET  /api/size-chart-imports/?school=<id|generic>           list jobs
    GET  /api/size-chart-imports/{id}/                          poll status + dry-run preview
    POST /api/size-chart-imports/{id}/confirm/                  write, in one transaction
    GET  /api/size-chart-imports/{id}/report/                   CSV of rows not imported
    GET  /api/size-chart-imports/template/?school=<id|generic>  CSV of the school's SKUs

A School Admin works on their own school's products only. Boss picks a school,
or `generic` for the shared products that have no school.
"""

from uuid import UUID

from django.http import HttpResponse
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from common.models import ImportJob
from common.pagination import BoundedPageNumberPagination
from schools.models import School
from schools.serializers import StudentImportJobSerializer, StudentImportUploadSerializer

from .size_chart_import import build_report, build_template
from .tasks import commit_size_chart_import, validate_size_chart_import

GENERIC = "generic"


class IsBossOrSchoolAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.role in ("BOSS", "SCHOOL_ADMIN") or getattr(user, "is_superuser", False))
        )


class SizeChartImportUploadSerializer(StudentImportUploadSerializer):
    """Same file checks as the student import; the school comes from the scope."""

    school = None


def _is_boss(user) -> bool:
    return user.role == "BOSS" or getattr(user, "is_superuser", False)


class SizeChartImportViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ImportJob.objects.select_related("school", "uploaded_by").order_by("-created_at")
    serializer_class = StudentImportJobSerializer
    permission_classes = [IsBossOrSchoolAdmin]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    pagination_class = BoundedPageNumberPagination

    # ------------------------------------------------------------------ #
    # Scope
    # ------------------------------------------------------------------ #
    def get_scope(self, required: bool = True) -> tuple[bool, School | None]:
        """-> (scope given, school). school None with scope given = generic products."""
        user = self.request.user
        raw = (self.request.query_params.get("school") or "").strip()
        if not _is_boss(user):
            if raw and raw != str(user.school_id):
                raise PermissionDenied("You can only manage size charts for your own school.")
            school = School.objects.filter(pk=user.school_id).first()
            if school is None:
                raise PermissionDenied("Your account is not linked to a school.")
            return True, school
        if raw == GENERIC:
            return True, None
        if not raw:
            if required:
                raise ValidationError({"school": "Choose a school, or 'generic' for shared products."})
            return False, None
        try:
            school = School.objects.filter(pk=UUID(raw)).first()
        except ValueError:
            school = None
        if school is None:
            raise ValidationError({"school": "School not found."})
        return True, school

    def get_queryset(self):
        qs = super().get_queryset().filter(job_type=ImportJob.JobType.SIZE_CHART_IMPORT)
        scoped, school = self.get_scope(required=False)
        if not scoped:
            return qs
        return qs.filter(school=school) if school else qs.filter(school__isnull=True)

    # ------------------------------------------------------------------ #
    # Upload (returns a job id at once; checking runs in the worker)
    # ------------------------------------------------------------------ #
    def create(self, request, *args, **kwargs):
        _, school = self.get_scope()
        serializer = SizeChartImportUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        job = ImportJob.objects.create(
            job_type=ImportJob.JobType.SIZE_CHART_IMPORT,
            status=ImportJob.Status.PENDING,
            school=school,
            city_id=school.city_id if school else None,
            uploaded_by=request.user,
            original_filename=(upload.name or "upload")[:255],
            file=upload,
        )
        validate_size_chart_import.delay(str(job.id))
        job.refresh_from_db()
        return Response(
            self.get_serializer(job).data,
            status=status.HTTP_202_ACCEPTED,
        )

    # ------------------------------------------------------------------ #
    # Confirm -> one-transaction write
    # ------------------------------------------------------------------ #
    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        job = self.get_object()
        if job.status == ImportJob.Status.FAILED:
            raise ValidationError({"detail": f"This import failed and cannot be saved: {job.error_message}"})
        if job.status in (ImportJob.Status.IMPORTING, ImportJob.Status.COMPLETED):
            raise ValidationError({"detail": f"This import is already {job.status.lower()}."})
        if job.status != ImportJob.Status.PREVIEW_READY:
            raise ValidationError({"detail": "The file is still being checked. Try again shortly."})
        if not job.valid_rows:
            raise ValidationError({"detail": "No product in this file can be imported. Fix the file and upload it again."})

        commit_size_chart_import.delay(str(job.id))
        job.refresh_from_db()
        return Response(self.get_serializer(job).data, status=status.HTTP_202_ACCEPTED)

    # ------------------------------------------------------------------ #
    # CSV files
    # ------------------------------------------------------------------ #
    @action(detail=True, methods=["get"], url_path="report")
    def report(self, request, pk=None):
        job = self.get_object()
        response = HttpResponse(build_report(job), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="size-chart-import-{job.id}-report.csv"'
        return response

    @action(detail=False, methods=["get"], url_path="template")
    def template(self, request):
        _, school = self.get_scope()
        name = school.code if school else GENERIC
        response = HttpResponse(build_template(school.id if school else None), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="size-chart-{name}.csv"'
        return response
