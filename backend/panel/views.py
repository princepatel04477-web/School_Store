"""
School Admin panel API - everything is scoped to ONE school.

| Endpoint | Requirement |
|---|---|
| GET  /api/panel/dashboard/                 | 1, 7 - orders / units / gross sales from the rollups + commission |
| GET  /api/panel/commission/                | 7 - gross sales and the school's commission rate |
| GET  /api/panel/orders/                    | 2 - cursor paginated (50) via idx_order_school_created_id |
| GET  /api/panel/students/                  | 5 - roster, add, edit, approve |
| GET  /api/panel/students/{id}/orders/      | 3 - one child's year via idx_order_student_created_id |
| GET  /api/panel/student-imports/           | 5 - bulk import jobs (validate -> preview -> confirm) |
| GET  /api/panel/teachers/                  | 6 - create / deactivate teacher logins |
| GET  /api/panel/exports/                   | 4 - background Excel export, poll + download |
"""

import datetime as dt

from django.db.models import Count, DecimalField, F, IntegerField, Q, Sum
from django.db.models.functions import Coalesce
from django.http import FileResponse
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from common.models import ImportJob
from common.pagination import BoundedCursorPagination, BoundedPageNumberPagination
from common.permissions import RoleScopedPermission
from orders.models import Order
from schools.models import Student
from schools.serializers import (
    StudentImportJobSerializer,
    StudentImportUploadSerializer,
    StudentSerializer,
)
from schools.tasks import validate_student_import
from schools.views import StudentImportViewSet

from .models import ExportJob
from .serializers import (
    CategoryBreakdownSerializer,
    CommissionSectionSerializer,
    CommissionSerializer,
    DashboardDailySerializer,
    DashboardTotalsSerializer,
    ExportJobCreateSerializer,
    ExportJobSerializer,
    PanelOrderSerializer,
    SchoolBriefSerializer,
    StudentOrderTotalsSerializer,
    TeacherCreateSerializer,
    TeacherSerializer,
)
from .services import (
    ITEM_PREVIEW_LIMIT,
    OrderFilters,
    category_breakdown,
    category_options,
    class_options,
    commission_payload,
    daily_trend,
    default_range,
    generate_password,
    panel_orders_qs,
    pending_student_count,
    resolve_range,
    resolve_school,
    schools_for_user,
    student_orders_qs,
    summary_totals,
)
from .tasks import build_export

# --------------------------------------------------------------------------- #
# Shared mixins
# --------------------------------------------------------------------------- #
class SchoolScopedMixin:
    """
    Resolves the single school the whole panel works against.

    School Admins are pinned to their own school; Boss and City Admins pick
    one with `?school=<id>`.
    """

    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN")
    write_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN")

    def get_school(self):
        request = getattr(self, "request", None)
        school_id = request.query_params.get("school") if request else None
        school = resolve_school(request.user, school_id)
        if school is None:
            raise NotFound(
                "No school is available for this account."
                if not school_id
                else "That school is not in your scope."
            )
        return school


class PanelOrderPagination(BoundedCursorPagination):
    """Requirement 2 + 8: 50 rows a page, cursor style, no COUNT(*) anywhere."""

    page_size = 50
    max_page_size = 50
    ordering = ("-created_at", "-id")


class PanelStudentPagination(BoundedCursorPagination):
    """Requirement 8: the roster uses "load more" too - no row counts."""

    page_size = 50
    max_page_size = 50
    ordering = ("class_name", "section", "name", "id")


# --------------------------------------------------------------------------- #
# 1 + 7. Dashboard
# --------------------------------------------------------------------------- #
class DashboardView(SchoolScopedMixin, APIView):
    """
    School Admin dashboard for one school over a date range.

    Total orders, total units sold and gross sales are read from
    `DailySchoolTotal`; the category breakdown comes from
    `DailySalesSummary`. The orders table is never scanned.
    """

    def get(self, request):
        school = self.get_school()
        try:
            start, end = resolve_range(
                request.query_params.get("date_from") or request.query_params.get("from"),
                request.query_params.get("date_to") or request.query_params.get("to"),
            )
        except ValueError as exc:
            raise ValidationError({"date_range": str(exc)})

        totals = summary_totals(school, start, end)
        payload = {
            "school": SchoolBriefSerializer(school).data,
            "date_from": start.isoformat(),
            "date_to": end.isoformat(),
            "days": (end - start).days + 1,
            "totals": DashboardTotalsSerializer(totals).data,
            "categories": CategoryBreakdownSerializer(
                category_breakdown(school, start, end), many=True
            ).data,
            "daily": DashboardDailySerializer(daily_trend(school, start, end), many=True).data,
            "commission": CommissionSectionSerializer(
                commission_payload(school, totals["gross_sales"])
            ).data,
            "pending_students": pending_student_count(school),
            "notes": [
                "Totals come from the daily sales rollup, not from scanning orders.",
                "Category orders do not add up to the total: an order with items "
                "in two categories is counted once in each.",
            ],
        }
        return Response(payload)


class CommissionView(SchoolScopedMixin, APIView):
    """
    Requirement 7: gross sales for the school plus the commission derived
    from `School.commission_rate`. Reports "not set" when the rate is empty -
    the rate is never hard-coded anywhere in the code base.
    """

    def get(self, request):
        school = self.get_school()
        try:
            start, end = resolve_range(
                request.query_params.get("date_from"),
                request.query_params.get("date_to"),
            )
        except ValueError as exc:
            raise ValidationError({"date_range": str(exc)})
        totals = summary_totals(school, start, end)
        return Response(
            CommissionSerializer(
                {
                    "school": school,
                    "date_from": start,
                    "date_to": end,
                    "orders": totals["orders"],
                    "units": totals["units"],
                    "gross_sales": totals["gross_sales"],
                    "cost": totals["cost"],
                    "margin": totals["margin"],
                    "commission": commission_payload(school, totals["gross_sales"]),
                }
            ).data
        )


# --------------------------------------------------------------------------- #
# 2. Orders table
# --------------------------------------------------------------------------- #
class PanelOrdersView(SchoolScopedMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """
    Every order placed for this school's students.

    Filters: `?class_name=` (or `?class=`), `?category=`, `?date_from=` /
    `?date_to=`, `?placed_by_role=`, `?status=`, `?student=`.
    Cursor paginated at 50 rows, ordered by `(-created_at, -id)` so Postgres
    streams straight out of `idx_order_school_created_id`.
    """

    serializer_class = PanelOrderSerializer
    pagination_class = PanelOrderPagination

    def get_queryset(self):
        filters = OrderFilters.from_params(self.request.query_params)
        return panel_orders_qs(self.get_school(), filters)


# --------------------------------------------------------------------------- #
# 3 + 5. Students
# --------------------------------------------------------------------------- #
class PanelStudentViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    """
    Requirement 5: the school roster - view, add, edit and approve.

    `GET /api/panel/students/{id}/orders/` is requirement 3: one child's
    orders across the year with total units and number of orders, served by
    `idx_order_student_created_id`.
    """

    serializer_class = StudentSerializer
    pagination_class = PanelStudentPagination

    @property
    def paginator(self):
        """
        The roster pages by name; a child's orders page by date. Both are
        cursor paginated, so neither ever issues a COUNT(*).
        """
        if not hasattr(self, "_paginator"):
            if self.action == "orders":
                self._paginator = PanelOrderPagination()
            else:
                self._paginator = PanelStudentPagination()
        return self._paginator

    @paginator.setter
    def paginator(self, value):  # pragma: no cover - DRF compatibility
        self._paginator = value

    def get_queryset(self):
        school = self.get_school()
        qs = Student.objects.filter(school_id=school.id).select_related("school", "parent")
        params = self.request.query_params
        search = (params.get("search") or params.get("q") or "").strip()
        class_name = params.get("class_name") or params.get("class")
        section = params.get("section")
        approval_status = params.get("approval_status")
        pending = params.get("pending")

        if class_name:
            qs = qs.filter(class_name=class_name)
        if section:
            qs = qs.filter(section=section)
        if search:
            # Prefix match on the UPPER(name)/UPPER(gr) expression indexes.
            qs = qs.filter(Q(name__istartswith=search) | Q(gr_number__istartswith=search))
        if approval_status:
            qs = qs.filter(approval_status=approval_status)
        if pending in ("1", "true", "True"):
            qs = qs.filter(approval_status=Student.ApprovalStatus.PENDING)
        return qs.order_by("class_name", "section", "name", "id")

    # -- approval queue ---------------------------------------------------- #
    @action(detail=False, methods=["get"], url_path="pending")
    def pending(self, request):
        """Approval queue: parent-added children waiting for the school."""
        school = self.get_school()
        rows = (
            Student.objects.filter(
                school_id=school.id,
                approval_status=Student.ApprovalStatus.PENDING,
            )
            .select_related("parent")
            .order_by("name", "id")[:200]
        )
        return Response(
            {
                "count": pending_student_count(school),
                "results": StudentSerializer(
                    rows, many=True, context={"request": request}
                ).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        """Approve a parent-added child (and optionally correct the details)."""
        student = self.get_object()
        if student.approval_status != Student.ApprovalStatus.APPROVED:
            for field_name in ("name", "gr_number", "class_name", "section", "gender"):
                value = request.data.get(field_name)
                if value:
                    setattr(student, field_name, value)
            if "date_of_birth" in request.data:
                student.date_of_birth = request.data.get("date_of_birth") or None
            if "parent" in request.data:
                parent_id = request.data.get("parent")
                student.parent = (
                    User.objects.filter(pk=parent_id, role=User.Role.PARENT).first()
                    if parent_id
                    else None
                )
            student.approval_status = Student.ApprovalStatus.APPROVED
            student.save()
        return Response(StudentSerializer(student, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="assign-parent")
    def assign_parent(self, request, pk=None):
        """Override the parent link on a child (or unlink with `parent: null`)."""
        student = self.get_object()
        if "parent" not in request.data:
            raise ValidationError({"parent": "Pass a parent id or null."})
        parent_id = request.data.get("parent")
        student.parent = (
            User.objects.filter(pk=parent_id, role=User.Role.PARENT).first()
            if parent_id
            else None
        )
        student.save(update_fields=["parent", "updated_at"])
        return Response(StudentSerializer(student, context={"request": request}).data)

    # -- requirement 3 ----------------------------------------------------- #
    @staticmethod
    def _academic_year(year: int | None = None) -> tuple[dt.date, dt.date]:
        today = timezone.localdate()
        if year is None:
            year = today.year if today.month >= 4 else today.year - 1
        return dt.date(year, 4, 1), dt.date(year + 1, 3, 31)

    @action(detail=True, methods=["get"], url_path="orders")
    def orders(self, request, pk=None):
        """
        Every order this child has across the school year.

        Totals are aggregated over the (student, created_at) index range -
        one child's orders, never a school-wide COUNT(*).
        """
        student = self.get_object()
        params = request.query_params
        raw_year = params.get("year")
        if params.get("date_from") or params.get("date_to"):
            start, end = resolve_range(params.get("date_from"), params.get("date_to"))
        elif raw_year and str(raw_year).isdigit():
            start, end = self._academic_year(int(raw_year))
        else:
            start, end = self._academic_year()

        filters = OrderFilters.from_params(
            {
                "date_from": start.isoformat(),
                "date_to": end.isoformat(),
                "category": params.get("category") or "",
            }
        )
        queryset = student_orders_qs(student, filters)

        # Bounded aggregate: one child's orders over one index range.
        totals = queryset.aggregate(
            orders=Count("id", distinct=True),
            units=Coalesce(Sum(F("items__quantity")), 0, output_field=IntegerField()),
            gross_sales=Coalesce(
                Sum(
                    F("items__quantity") * F("items__unit_price_snapshot"),
                    output_field=DecimalField(max_digits=14, decimal_places=2),
                ),
                0,
                output_field=DecimalField(max_digits=14, decimal_places=2),
            ),
        )

        page = self.paginate_queryset(queryset)
        if page is not None:
            data = PanelOrderSerializer(page, many=True, context={"request": request}).data
            page_payload = self.get_paginated_response(data).data
        else:  # pragma: no cover - pagination is always configured
            data = PanelOrderSerializer(
                queryset[:50], many=True, context={"request": request}
            ).data
            page_payload = {"results": data, "next": None, "previous": None}

        payload = {
            "student": {
                "id": student.id,
                "name": student.name,
                "gr_number": student.gr_number,
                "class_name": student.class_name,
                "section": student.section,
            },
            "date_from": start.isoformat(),
            "date_to": end.isoformat(),
            "totals": StudentOrderTotalsSerializer(
                {
                    "orders": int(totals["orders"] or 0),
                    "units": int(totals["units"] or 0),
                    "gross_sales": totals["gross_sales"],
                }
            ).data,
            "item_preview_limit": ITEM_PREVIEW_LIMIT,
        }
        payload.update(page_payload)
        return Response(payload)


# --------------------------------------------------------------------------- #
# 5. Bulk student import (reuses the schools import pipeline, school-locked)
# --------------------------------------------------------------------------- #
class PanelStudentImportViewSet(SchoolScopedMixin, StudentImportViewSet):
    """
    Same two-step job as `/api/student-imports/`, but the school always comes
    from the admin's scope: upload -> 202 + job id -> poll -> confirm.
    """

    pagination_class = BoundedPageNumberPagination

    def get_queryset(self):
        return super().get_queryset().filter(school_id=self.get_school().id)

    def create(self, request, *args, **kwargs):
        school = self.get_school()
        serializer = StudentImportUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]

        job = ImportJob.objects.create(
            job_type=ImportJob.JobType.STUDENT_IMPORT,
            status=ImportJob.Status.PENDING,
            school=school,
            city_id=school.city_id,
            uploaded_by=request.user,
            original_filename=(upload.name or "upload")[:255],
            file=upload,
        )
        # Rule P5: parsing and validation happen in the Celery worker.
        validate_student_import.delay(str(job.id))
        job.refresh_from_db()
        return Response(
            StudentImportJobSerializer(job, context={"request": request}).data,
            status=status.HTTP_202_ACCEPTED,
        )


# --------------------------------------------------------------------------- #
# 6. Teacher accounts
# --------------------------------------------------------------------------- #
class PanelTeacherViewSet(SchoolScopedMixin, viewsets.ModelViewSet):
    """
    Requirement 6: teacher logins for this school.

    `?school=` picks the school for Boss / City Admin; School Admins always
    work on their own school. `idx_user_role_school` serves the list.
    """

    serializer_class = TeacherSerializer
    pagination_class = BoundedPageNumberPagination

    def get_queryset(self):
        school = self.get_school()
        return (
            User.objects.filter(school_id=school.id, role=User.Role.TEACHER)
            .select_related("school")
            .order_by("first_name", "last_name", "username")
        )

    def create(self, request, *args, **kwargs):
        school = self.get_school()
        serializer = TeacherCreateSerializer(data=request.data, context={"school": school})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        password = data.get("password") or generate_password()

        user = User(
            username=data["username"],
            email=data.get("email") or "",
            first_name=data.get("first_name") or "",
            last_name=data.get("last_name") or "",
            phone=data.get("phone") or "",
            role=User.Role.TEACHER,
            school=school,
            city_id=school.city_id,
            is_staff=False,
            is_superuser=False,
            is_active=True,
        )
        user.set_password(password)
        user.must_change_password = True
        user.save()
        payload = TeacherSerializer(user).data
        # Returned once so the admin can hand the credentials over.
        payload["temporary_password"] = password
        return Response(payload, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        # Deleting logins would orphan order history; deactivate instead.
        raise PermissionDenied(
            "Teacher accounts are deactivated, not deleted, so their order "
            "history stays intact."
        )

    @action(detail=True, methods=["post"], url_path="deactivate")
    def deactivate(self, request, pk=None):
        user = self.get_object()
        if user.id == request.user.id:
            raise ValidationError({"detail": "You cannot deactivate your own account."})
        if user.is_active:
            user.is_active = False
            user.save(update_fields=["is_active", "updated_at"])
        return Response(TeacherSerializer(user).data)

    @action(detail=True, methods=["post"], url_path="activate")
    def activate(self, request, pk=None):
        user = self.get_object()
        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active", "updated_at"])
        return Response(TeacherSerializer(user).data)


# --------------------------------------------------------------------------- #
# 4. Excel export as a background job
# --------------------------------------------------------------------------- #
class ExportJobViewSet(
    SchoolScopedMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """
    POST   /api/panel/exports/                 -> 202 + job id (nothing is built here)
    GET    /api/panel/exports/{id}/            -> poll: status + download link
    GET    /api/panel/exports/{id}/download/   -> stream the finished workbook
    """

    serializer_class = ExportJobSerializer
    pagination_class = BoundedPageNumberPagination

    def get_queryset(self):
        school = self.get_school()
        return (
            ExportJob.objects.filter(school_id=school.id)
            .select_related("school", "requested_by")
            .order_by("-created_at")
        )

    def create(self, request, *args, **kwargs):
        school = self.get_school()
        serializer = ExportJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        job_type = serializer.validated_data["job_type"]
        filters = serializer.validated_data.get("filters") or {}

        stamp = timezone.localdate().isoformat()
        filename = f"{school.code.lower()}-{job_type.lower()}-{stamp}.xlsx"
        job = ExportJob.objects.create(
            job_type=job_type,
            status=ExportJob.Status.QUEUED,
            school=school,
            city_id=school.city_id,
            requested_by=request.user,
            filters=filters,
            filename=filename,
        )
        # Requirement 4: the workbook is built in a Celery worker, never here.
        build_export.delay(str(job.id))
        job.refresh_from_db()
        return Response(
            ExportJobSerializer(job, context={"request": request}).data,
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, pk=None):
        job = self.get_object()
        if job.status != ExportJob.Status.READY or not job.file:
            raise NotFound("This export is not ready yet.")
        if job.is_expired:
            raise NotFound("This export has expired. Request it again.")
        return FileResponse(
            job.file.open("rb"),
            as_attachment=True,
            filename=job.filename or "export.xlsx",
            content_type=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
        )


# --------------------------------------------------------------------------- #
# Supporting endpoints for the panel chrome
# --------------------------------------------------------------------------- #
class PanelSchoolsView(APIView):
    """Schools this account may administer (drives the school switcher)."""

    permission_classes = [RoleScopedPermission]
    read_roles = ("BOSS", "ADMIN", "SCHOOL_ADMIN")
    write_roles = ("BOSS",)

    def get(self, request):
        rows = schools_for_user(request.user)
        return Response(
            {
                "results": [
                    {
                        "id": school.id,
                        "name": school.name,
                        "code": school.code,
                        # Drives the Boss "view as city admin" school filter.
                        "city_id": school.city_id,
                        "city_name": school.city.name,
                    }
                    for school in rows
                ]
            }
        )


class PanelFilterOptionsView(SchoolScopedMixin, APIView):
    """Values for the filter dropdowns (classes, categories, statuses, roles)."""

    def get(self, request):
        school = self.get_school()
        start, end = default_range()
        return Response(
            {
                "school": {"id": school.id, "name": school.name, "code": school.code},
                "classes": class_options(school),
                "sections": list(
                    Student.objects.filter(school_id=school.id)
                    .order_by("section")
                    .values_list("section", flat=True)
                    .distinct()
                ),
                "categories": category_options(),
                "statuses": [
                    {"value": value, "label": label} for value, label in Order.Status.choices
                ],
                "placed_by_roles": [
                    {"value": "PARENT", "label": "Parent"},
                    {"value": "TEACHER", "label": "Teacher"},
                    {"value": "SCHOOL_ADMIN", "label": "School admin"},
                ],
                "default_date_from": start.isoformat(),
                "default_date_to": end.isoformat(),
            }
        )
