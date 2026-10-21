"""
Size chart import for the Boss, Admin and School Admin panels (plan A1).

    POST /api/size-chart-imports/?school=<id|generic>           upload -> job id (202)
    GET  /api/size-chart-imports/?school=<id|generic>           list jobs
    GET  /api/size-chart-imports/{id}/                          poll status + dry-run preview
    POST /api/size-chart-imports/{id}/confirm/                  write, in one transaction
    GET  /api/size-chart-imports/{id}/report/                   CSV of rows not imported
    GET  /api/size-chart-imports/template/?school=<id|generic>  CSV of the school's SKUs

Size charts themselves (view, edit, copy) for the Boss, Admin and School
Admin panels (Prompt 20):

    GET    /api/size-charts/?school=<id|generic>         items with their charts
    POST   /api/size-charts/rows/                        add one size's row
    PATCH  /api/size-charts/rows/{row_id}/               edit one size's row
    DELETE /api/size-charts/rows/{row_id}/               remove one size's row
    DELETE /api/size-charts/{product_id}/?school=...     remove an item's chart
    POST   /api/size-charts/copy/?school=...             one chart for many items

A School Admin works on their own school's products only. An Admin works on
the schools in their city. Boss picks a school, or `generic` for the shared
products that have no school.
"""

import re
from uuid import UUID

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from common.models import ImportJob
from common.pagination import BoundedPageNumberPagination
from schools.models import School
from schools.serializers import StudentImportJobSerializer, StudentImportUploadSerializer

from .models import Product, ProductVariant, SizeChartRow
from .size_chart_import import VALUE_COLUMNS, build_report, build_template, clean_values, variants_in_scope
from .tasks import commit_size_chart_import, validate_size_chart_import

GENERIC = "generic"


class IsChartManager(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.role in ("BOSS", "ADMIN", "SCHOOL_ADMIN") or getattr(user, "is_superuser", False))
        )


class SizeChartImportUploadSerializer(StudentImportUploadSerializer):
    """Same file checks as the student import; the school comes from the scope."""

    school = None


def _is_boss(user) -> bool:
    return user.role == "BOSS" or getattr(user, "is_superuser", False)


def resolve_chart_scope(request, required: bool = True) -> tuple[bool, School | None]:
    """
    -> (scope given, school). school None with scope given = generic products.
    Read from ?school= (or "school" in the body).
    """
    user = request.user
    raw = str(request.query_params.get("school") or request.data.get("school") or "").strip()
    if user.role == "SCHOOL_ADMIN":
        if raw and raw != str(user.school_id):
            raise PermissionDenied("You can only manage size charts for your own school.")
        school = School.objects.filter(pk=user.school_id).first()
        if school is None:
            raise PermissionDenied("Your account is not linked to a school.")
        return True, school
    if raw == GENERIC:
        if not _is_boss(user):
            raise PermissionDenied("Only the Boss manages the shared items every school uses.")
        return True, None
    if not raw:
        if required or not _is_boss(user):
            raise ValidationError({"school": "Choose a school."})
        return False, None
    try:
        school = School.objects.filter(pk=UUID(raw)).first()
    except ValueError:
        school = None
    if school is None:
        raise ValidationError({"school": "School not found."})
    if user.role == "ADMIN" and school.city_id != user.city_id:
        raise PermissionDenied("You can only manage size charts for schools in your city.")
    return True, school


class SizeChartImportViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ImportJob.objects.select_related("school", "uploaded_by").order_by("-created_at")
    serializer_class = StudentImportJobSerializer
    permission_classes = [IsChartManager]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    pagination_class = BoundedPageNumberPagination

    # ------------------------------------------------------------------ #
    # Scope
    # ------------------------------------------------------------------ #
    def get_scope(self, required: bool = True) -> tuple[bool, School | None]:
        return resolve_chart_scope(self.request, required)

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


# --------------------------------------------------------------------------- #
# Size charts: view, edit, copy (Prompt 20)
# --------------------------------------------------------------------------- #
def _row_data(variant: ProductVariant, row: SizeChartRow | None) -> dict:
    values = {
        column: (float(getattr(row, column)) if row and getattr(row, column) is not None else None)
        for column in VALUE_COLUMNS
    }
    return {"id": str(row.id) if row else None, "variant": str(variant.id), "sku": variant.sku, "size": variant.size, **values}


def _size_key(label: str) -> str:
    """'28 (Class 1-3)' and '28' are the same size; case and spacing don't matter."""
    return " ".join(re.sub(r"\([^)]*\)", " ", label).lower().split())


def _clean_or_400(data) -> dict:
    values, errors, has_any = clean_values({column: data.get(column) for column in VALUE_COLUMNS})
    if not has_any:
        errors = {"height_cm_min": "height_cm_min is required.", "height_cm_max": "height_cm_max is required."}
    if errors:
        raise ValidationError(errors)
    return values


class SizeChartViewSet(viewsets.ViewSet):
    """
    Each item that comes in more than one size, with one chart row per size.
    A size with no row has nulls, so the screen can offer to fill it in.
    Products are paged (50 per page) and their variants and rows come in one
    more query, however many items there are.
    """

    permission_classes = [IsChartManager]

    def _products(self, school):
        qs = Product.objects.filter(active=True).select_related("category")
        qs = qs.filter(school=school) if school else qs.filter(school__isnull=True)
        return qs.order_by("name", "id")

    def _product_in_scope(self, product_id, school) -> Product:
        return get_object_or_404(self._products(school), pk=product_id)

    def _variant_in_scope(self, variant_id) -> ProductVariant:
        """The scope is checked against the product's own school, not a query parameter."""
        if not variant_id:
            raise ValidationError({"variant": "Choose a size."})
        variant = get_object_or_404(ProductVariant.objects.select_related("product", "product__school"), pk=variant_id)
        product_school = variant.product.school
        user = self.request.user
        if user.role == "SCHOOL_ADMIN" and variant.product.school_id != user.school_id:
            raise PermissionDenied("You can only manage size charts for your own school.")
        if user.role == "ADMIN" and (product_school is None or product_school.city_id != user.city_id):
            raise PermissionDenied("You can only manage size charts for schools in your city.")
        return variant

    def list(self, request):
        _, school = resolve_chart_scope(request)
        paginator = BoundedPageNumberPagination()
        page = paginator.paginate_queryset(self._products(school), request, view=self)
        ids = [product.id for product in page]
        variants: dict = {}
        for variant in (
            ProductVariant.objects.filter(product_id__in=ids, active=True)
            .select_related("size_chart_row")
            .order_by("size", "sku")
        ):
            variants.setdefault(variant.product_id, []).append(variant)
        results = []
        for product in page:
            sizes = variants.get(product.id, [])
            if len(sizes) < 2:
                continue
            rows = [_row_data(v, getattr(v, "size_chart_row", None)) for v in sizes]
            results.append({
                "product_id": str(product.id),
                "product_name": product.name,
                "category": product.category.name if product.category_id else "",
                "has_chart": any(row["id"] for row in rows),
                "rows": rows,
            })
        return paginator.get_paginated_response(results)

    @action(detail=False, methods=["post"], url_path="rows")
    def create_row(self, request):
        variant = self._variant_in_scope(request.data.get("variant"))
        values = _clean_or_400(request.data)
        if SizeChartRow.objects.filter(variant=variant).exists():
            raise ValidationError({"variant": "This size already has a row. Edit it instead."})
        row = SizeChartRow.objects.create(variant=variant, **values)
        return Response(_row_data(variant, row), status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["patch", "delete"], url_path=r"rows/(?P<row_id>[0-9a-fA-F-]{36})")
    def row(self, request, row_id=None):
        row = get_object_or_404(SizeChartRow.objects.select_related("variant"), pk=row_id)
        variant = self._variant_in_scope(row.variant_id)
        if request.method == "DELETE":
            row.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        merged = {column: getattr(row, column) for column in VALUE_COLUMNS}
        merged.update({column: request.data[column] for column in VALUE_COLUMNS if column in request.data})
        values = _clean_or_400({key: ("" if value is None else value) for key, value in merged.items()})
        for column, value in values.items():
            setattr(row, column, value)
        row.save()
        return Response(_row_data(variant, row))

    def destroy(self, request, pk=None):
        """Remove one item's whole chart."""
        _, school = resolve_chart_scope(request)
        product = self._product_in_scope(pk, school)
        deleted, _ = SizeChartRow.objects.filter(variant__product=product).delete()
        return Response({"rows_removed": deleted})

    @action(detail=False, methods=["post"], url_path="copy")
    def copy(self, request):
        """
        Use one item's chart for other items of the same school, so one chart
        serves, for example, every shirt. Rows are matched by size label, with
        any note in brackets ignored ("28 (Class 1-3)" matches "28"); a target
        size the source has no row for is left as it was and listed.
        All targets are written in one transaction.
        """
        _, school = resolve_chart_scope(request)
        source = self._product_in_scope(request.data.get("source_product"), school)
        target_ids = request.data.get("target_products") or []
        if not isinstance(target_ids, list) or not target_ids:
            raise ValidationError({"target_products": "Choose at least one item to copy the chart to."})
        wanted = {str(t) for t in target_ids} - {str(source.pk)}
        targets = list(self._products(school).filter(pk__in=wanted))
        if len(targets) != len(wanted):
            raise ValidationError({"target_products": "Some items were not found for this school."})

        source_rows = {
            _size_key(row.variant.size): row
            for row in SizeChartRow.objects.select_related("variant").filter(
                variant__product=source, variant__active=True
            )
        }
        if not source_rows:
            raise ValidationError({"source_product": "This item has no chart to copy yet."})

        report = []
        with transaction.atomic():
            for target in targets:
                variants = list(variants_in_scope(school.id if school else None).filter(product=target, active=True))
                matched = [v for v in variants if _size_key(v.size) in source_rows]
                SizeChartRow.objects.filter(variant__in=matched).delete()
                SizeChartRow.objects.bulk_create([
                    SizeChartRow(
                        variant=v,
                        **{column: getattr(source_rows[_size_key(v.size)], column) for column in VALUE_COLUMNS},
                    )
                    for v in matched
                ])
                report.append({
                    "product_id": str(target.id),
                    "product_name": target.name,
                    "rows_written": len(matched),
                    "sizes_not_in_source": sorted(v.size for v in variants if v not in matched),
                })
        return Response({"products": report})
