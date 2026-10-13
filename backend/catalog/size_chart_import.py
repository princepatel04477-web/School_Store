"""
Size chart bulk import (plan A1), built like `schools/import_service.py`.

Everything heavy happens inside Celery workers:
  1. `parse_rows()`      - streams .csv / .xlsx rows
  2. `validate_import()` - checks the WHOLE file, decides per product, and
                           stores a dry-run preview (adds / replaces / deletes)
  3. `commit_import()`   - after the user confirms: one transaction that
                           re-checks the catalogue and replaces each accepted
                           product's chart

Rules:
  - Rows are keyed by SKU. One SKU is one size of one product.
  - A product is "in the file" when at least one of its SKUs has a cm or kg
    value. Rows left blank from the template are ignored.
  - A product in the file must list every one of its active SKUs, otherwise
    it is rejected and the missing SKUs are named. A row error rejects its
    product too. Other products can still be imported.
  - A product in the file has its whole chart replaced. Products not in the
    file are left alone. Orders store sizes as values, so this never touches
    order history.
"""

from __future__ import annotations

import csv
import io
from collections import OrderedDict
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models.functions import Upper
from django.utils import timezone

from common.models import ImportJob
from schools.import_service import ImportValidationError, _iter_csv_rows, _iter_xlsx_rows

from .models import ProductVariant, SizeChartRow

VALUE_COLUMNS = [
    "height_cm_min",
    "height_cm_max",
    "weight_kg_min",
    "weight_kg_max",
    "shoulder_cm_min",
    "shoulder_cm_max",
    "chest_cm_min",
    "chest_cm_max",
    "length_cm",
]
TEMPLATE_COLUMNS = ["sku", "product_name", "size", *VALUE_COLUMNS]
REQUIRED_COLUMNS = ["sku", "height_cm_min", "height_cm_max"]
RANGE_PAIRS = [
    ("height_cm_min", "height_cm_max"),
    ("weight_kg_min", "weight_kg_max"),
    ("shoulder_cm_min", "shoulder_cm_max"),
    ("chest_cm_min", "chest_cm_max"),
]
# Plausible garment / body measurements. Wider than the shopper's limits in
# shared/fit_limits.json because a chart can cover sizes beyond school age.
VALUE_LIMITS = {
    "height_cm": (Decimal("50"), Decimal("210")),
    "weight_kg": (Decimal("5"), Decimal("150")),
    "shoulder_cm": (Decimal("15"), Decimal("70")),
    "chest_cm": (Decimal("30"), Decimal("160")),
    "length_cm": (Decimal("20"), Decimal("130")),
}

COLUMN_ALIASES = {
    "sku": "sku",
    "sku code": "sku",
    "product": "product_name",
    "product name": "product_name",
    "item": "product_name",
    "size": "size",
    "size label": "size",
    "height min": "height_cm_min",
    "height max": "height_cm_max",
    "weight min": "weight_kg_min",
    "weight max": "weight_kg_max",
    "shoulder min": "shoulder_cm_min",
    "shoulder max": "shoulder_cm_max",
    "chest min": "chest_cm_min",
    "chest max": "chest_cm_max",
    "length": "length_cm",
    "garment length": "length_cm",
}
for _column in VALUE_COLUMNS:
    COLUMN_ALIASES[_column.replace("_", " ")] = _column

ONE_DECIMAL = Decimal("0.1")


def max_rows() -> int:
    return int(getattr(settings, "SIZE_CHART_IMPORT_MAX_ROWS", 5000))


def preview_limit() -> int:
    return int(getattr(settings, "SIZE_CHART_IMPORT_PREVIEW_LIMIT", 100))


# --------------------------------------------------------------------------- #
# Scope: which SKUs the uploader may chart
# --------------------------------------------------------------------------- #
def variants_in_scope(school_id):
    """A school's own products, or (school_id=None) the generic shared ones."""
    qs = ProductVariant.objects.select_related("product")
    if school_id:
        return qs.filter(product__school_id=school_id)
    return qs.filter(product__school__isnull=True)


# --------------------------------------------------------------------------- #
# 1. Parsing
# --------------------------------------------------------------------------- #
def normalise_header(raw) -> str:
    if raw is None:
        return ""
    key = str(raw).strip().lower().replace("﻿", "")
    for unit in ("(cm)", "(kg)"):
        key = key.replace(unit, " ")
    key = key.replace("_", " ").replace("-", " ")
    key = " ".join(key.split())
    if key in COLUMN_ALIASES:
        return COLUMN_ALIASES[key]
    return key.replace(" ", "_")


def parse_rows(path: str, filename: str):
    lower = (filename or "").lower()
    if lower.endswith(".xlsx"):
        raw_rows = _iter_xlsx_rows(path)
    elif lower.endswith(".csv"):
        raw_rows = _iter_csv_rows(path)
    else:
        raise ImportValidationError("Only .csv and .xlsx files are supported.")

    try:
        first = next(raw_rows)
    except StopIteration:
        raise ImportValidationError("The uploaded file is empty.")

    headers = [normalise_header(cell) for cell in first]
    while headers and headers[-1] in ("", None):
        headers.pop()
    if not any(headers):
        raise ImportValidationError("The uploaded file has no header row.")

    missing = [c for c in REQUIRED_COLUMNS if c not in headers]
    if missing:
        raise ImportValidationError(
            "Missing required column(s): " + ", ".join(missing) + ". "
            "Download the template for the exact columns."
        )
    unknown = [h for h in headers if h and h not in TEMPLATE_COLUMNS]
    if unknown:
        raise ImportValidationError("Unexpected column(s): " + ", ".join(sorted(set(unknown))) + ".")
    repeated = sorted({h for h in headers if h and headers.count(h) > 1})
    if repeated:
        raise ImportValidationError("Column(s) appear twice: " + ", ".join(repeated) + ".")

    def row_iterator():
        for raw in raw_rows:
            if raw is None or all(cell is None or str(cell).strip() == "" for cell in raw):
                continue
            values = list(raw) + [None] * (len(headers) - len(raw))
            yield {column: values[index] for index, column in enumerate(headers) if column}

    return headers, row_iterator()


# --------------------------------------------------------------------------- #
# 2. Row checks
# --------------------------------------------------------------------------- #
def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    # The template guards spreadsheet formulas with a leading apostrophe.
    return text[1:] if text.startswith("'") else text


def _same(a: str, b: str) -> bool:
    return " ".join(a.lower().split()) == " ".join(b.lower().split())


def clean_values(raw_row: dict) -> tuple[dict, dict, bool]:
    """-> (values as Decimal or None, {column: error}, has_any_value)."""
    values: dict = {}
    errors: dict = {}
    has_any = False
    for column in VALUE_COLUMNS:
        text = _text(raw_row.get(column))
        if not text:
            values[column] = None
            continue
        has_any = True
        try:
            number = Decimal(text)
            if not number.is_finite():
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            errors[column] = f"{column} must be a number."
            continue
        kind = column.rsplit("_", 1)[0] if column != "length_cm" else "length_cm"
        low, high = VALUE_LIMITS[kind]
        if not low <= number <= high:
            errors[column] = f"{column} must be between {low} and {high}."
            continue
        values[column] = number.quantize(ONE_DECIMAL, rounding=ROUND_HALF_UP)

    if has_any:
        for column in ("height_cm_min", "height_cm_max"):
            if values.get(column) is None and column not in errors:
                errors[column] = f"{column} is required."
        for low, high in RANGE_PAIRS:
            lo, hi = values.get(low), values.get(high)
            if lo is not None and hi is not None and lo > hi:
                errors[high] = f"{high} ({hi}) is smaller than {low} ({lo})."
    return values, errors, has_any


def _row_payload(values: dict) -> dict:
    return {column: (str(values[column]) if values[column] is not None else None) for column in VALUE_COLUMNS}


def _existing_payload(row: SizeChartRow) -> dict:
    return {
        column: (str(getattr(row, column)) if getattr(row, column) is not None else None)
        for column in VALUE_COLUMNS
    }


# --------------------------------------------------------------------------- #
# 3. Validation job (whole file, dry-run preview)
# --------------------------------------------------------------------------- #
def validate_import(job: ImportJob) -> ImportJob:
    limit = preview_limit()
    headers, rows = parse_rows(job.file.path, job.original_filename)

    parsed = []
    total_rows = 0
    for index, raw_row in enumerate(rows, start=2):  # row 1 is the header
        if index - 1 > max_rows():
            raise ImportValidationError(
                f"The file has more than {max_rows()} rows. Split it and import again."
            )
        total_rows = index - 1
        parsed.append((index, raw_row))

    # ONE query for every SKU in the file (matched without regard to case).
    skus = {_text(raw.get("sku")).upper() for _, raw in parsed if _text(raw.get("sku"))}
    variants = {
        v.sku.upper(): v
        for v in ProductVariant.objects.select_related("product")
        .annotate(sku_upper=Upper("sku"))
        .filter(sku_upper__in=skus)
    }
    scope_ids = set(
        variants_in_scope(job.school_id)
        .filter(id__in=[v.id for v in variants.values()])
        .values_list("id", flat=True)
    )

    file_errors: list = []           # rows that can't be tied to a product
    product_errors: dict = {}        # product_id -> [row errors]
    filled: dict = {}                # product_id -> {variant_id: (row, values)}
    seen_rows: dict = {}             # SKU -> first row number
    duplicate_count = 0

    for row_number, raw in parsed:
        sku = _text(raw.get("sku"))
        values, errors, has_any = clean_values(raw)
        if not sku:
            if has_any:
                file_errors.append({"row": row_number, "sku": "", "errors": {"sku": "sku is required."}})
            continue
        variant = variants.get(sku.upper())
        if variant is None:
            file_errors.append({"row": row_number, "sku": sku, "errors": {"sku": "No product has this SKU."}})
            continue
        if variant.id not in scope_ids:
            file_errors.append({"row": row_number, "sku": sku, "errors": {"sku": "This SKU is not in your catalogue."}})
            continue

        product_id = str(variant.product_id)
        if sku.upper() in seen_rows:
            duplicate_count += 1
            errors["sku"] = f"SKU also on row {seen_rows[sku.upper()]}."
            has_any = True
        else:
            seen_rows[sku.upper()] = row_number

        name, size = _text(raw.get("product_name")), _text(raw.get("size"))
        if has_any and name and not _same(name, variant.product.name):
            errors["product_name"] = f"This SKU is '{variant.product.name}', not '{name}'."
        if has_any and size and not _same(size, variant.size):
            errors["size"] = f"This SKU is size '{variant.size}', not '{size}'."

        if not has_any:
            continue  # blank template row
        if errors:
            product_errors.setdefault(product_id, []).append({"row": row_number, "sku": sku, "errors": errors})
            continue
        filled.setdefault(product_id, {})[str(variant.id)] = (row_number, sku, values)

    product_ids = set(filled) | set(product_errors)
    products = {}
    active_variants: dict = {}
    for variant in variants_in_scope(job.school_id).filter(product_id__in=product_ids).order_by("size", "sku"):
        products[str(variant.product_id)] = variant.product
        if variant.active:
            active_variants.setdefault(str(variant.product_id), []).append(variant)
    existing: dict = {}
    for chart_row in SizeChartRow.objects.select_related("variant").filter(variant__product_id__in=product_ids):
        existing.setdefault(str(chart_row.variant.product_id), {})[str(chart_row.variant_id)] = chart_row

    accepted, rejected = [], []
    for product_id in sorted(product_ids, key=lambda pid: (products[pid].name.lower(), pid)):
        product = products[product_id]
        rows_for_product = filled.get(product_id, {})
        reasons = []
        missing = [v.sku for v in active_variants.get(product_id, []) if str(v.id) not in rows_for_product]
        if product_errors.get(product_id):
            reasons.append("Some rows have errors.")
        if missing:
            reasons.append("The file has some of this product's sizes but not all. Add the missing SKUs.")
        if reasons:
            rejected.append({
                "product_id": product_id,
                "product_name": product.name,
                "reasons": reasons,
                "missing_skus": missing,
                "row_errors": product_errors.get(product_id, [])[:limit],
            })
            continue

        current = existing.get(product_id, {})
        adds = replaces = unchanged = 0
        rows_out = []
        for variant_id, (row_number, sku, values) in rows_for_product.items():
            payload = _row_payload(values)
            if variant_id not in current:
                adds += 1
            elif _existing_payload(current[variant_id]) != payload:
                replaces += 1
            else:
                unchanged += 1
            rows_out.append({"variant_id": variant_id, "sku": sku, "row": row_number, **payload})
        deletes = [chart_row.variant.sku for vid, chart_row in current.items() if vid not in rows_for_product]
        accepted.append({
            "product_id": product_id,
            "product_name": product.name,
            "active_variant_ids": sorted(str(v.id) for v in active_variants.get(product_id, [])),
            "rows": sorted(rows_out, key=lambda r: r["row"]),
            "adds": adds,
            "replaces": replaces,
            "unchanged": unchanged,
            "deletes": deletes,
        })

    error_count = len(file_errors) + sum(len(e) for e in product_errors.values())
    job.total_rows = total_rows
    job.valid_count = sum(len(p["rows"]) for p in accepted)
    job.duplicate_count = duplicate_count
    job.error_count = error_count
    job.valid_rows = accepted
    job.preview = {
        "columns": headers,
        "products": [
            {key: p[key] for key in ("product_id", "product_name", "adds", "replaces", "unchanged", "deletes")}
            for p in accepted[:limit]
        ],
        "rejected": rejected[:limit],
        "errors": file_errors[:limit],
        "preview_limit": limit,
        "summary": {
            "products_accepted": len(accepted),
            "products_rejected": len(rejected),
            "adds": sum(p["adds"] for p in accepted),
            "replaces": sum(p["replaces"] for p in accepted),
            "unchanged": sum(p["unchanged"] for p in accepted),
            "deletes": sum(len(p["deletes"]) for p in accepted),
            "unknown_rows": len(file_errors),
        },
        "notes": [
            "Each product in the file has its whole size chart replaced.",
            "Products not in the file keep their current chart.",
            "Nothing is saved until you confirm.",
        ],
    }
    job.status = ImportJob.Status.PREVIEW_READY
    job.save(update_fields=[
        "total_rows", "valid_count", "duplicate_count", "error_count",
        "valid_rows", "preview", "status", "updated_at",
    ])
    return job


# --------------------------------------------------------------------------- #
# 4. Commit job (one transaction)
# --------------------------------------------------------------------------- #
class CatalogueChangedError(ImportValidationError):
    """The products' sizes changed between the preview and the confirm."""


@transaction.atomic
def commit_import(job: ImportJob) -> ImportJob:
    """
    Replaces the chart of every accepted product, all or nothing. The
    products' variants are locked and checked again first: if a size was
    added, removed, switched off or moved since the preview, nothing is
    written and the job fails so the user uploads a fresh file.
    """
    accepted = job.valid_rows or []
    product_ids = [p["product_id"] for p in accepted]
    if not product_ids:
        raise ImportValidationError("There is nothing to import.")

    locked = list(
        variants_in_scope(job.school_id)
        .select_for_update(of=("self",))
        .filter(product_id__in=product_ids)
        .order_by("id")
    )
    active_now: dict = {}
    known_now = set()
    for variant in locked:
        known_now.add(str(variant.id))
        if variant.active:
            active_now.setdefault(str(variant.product_id), []).append(str(variant.id))

    changed = []
    for product in accepted:
        if sorted(active_now.get(product["product_id"], [])) != product["active_variant_ids"]:
            changed.append(product["product_name"])
        elif any(row["variant_id"] not in known_now for row in product["rows"]):
            changed.append(product["product_name"])
    if changed:
        raise CatalogueChangedError(
            "The catalogue changed after the preview (sizes added, removed or switched off) for: "
            + ", ".join(changed) + ". Download a new template and upload again."
        )

    deleted, _ = SizeChartRow.objects.filter(variant__product_id__in=product_ids).delete()
    new_rows = [
        SizeChartRow(
            variant_id=row["variant_id"],
            **{column: (Decimal(row[column]) if row[column] is not None else None) for column in VALUE_COLUMNS},
        )
        for product in accepted
        for row in product["rows"]
    ]
    SizeChartRow.objects.bulk_create(new_rows, batch_size=500)

    job.result = {
        "products": len(accepted),
        "rows_written": len(new_rows),
        "rows_removed": deleted,
    }
    job.status = ImportJob.Status.COMPLETED
    job.completed_at = timezone.now()
    job.save(update_fields=["result", "status", "completed_at", "updated_at"])
    return job


# --------------------------------------------------------------------------- #
# 5. Template and report
# --------------------------------------------------------------------------- #
def _safe_cell(text: str) -> str:
    """Stop a spreadsheet from running a product name as a formula."""
    return f"'{text}" if text[:1] in ("=", "+", "-", "@") else text


def build_template(school_id) -> str:
    """
    CSV of every active SKU in scope whose product comes in more than one
    size, sorted by product then size, with the cm and kg columns empty.
    """
    variants = list(
        variants_in_scope(school_id)
        .filter(active=True, product__active=True)
        .order_by("product__name", "product_id", "size", "sku")
    )
    sizes_per_product: dict = {}
    for variant in variants:
        sizes_per_product[variant.product_id] = sizes_per_product.get(variant.product_id, 0) + 1

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(TEMPLATE_COLUMNS)
    for variant in variants:
        if sizes_per_product[variant.product_id] < 2:
            continue
        writer.writerow([
            _safe_cell(variant.sku),
            _safe_cell(variant.product.name),
            _safe_cell(variant.size),
            *[""] * len(VALUE_COLUMNS),
        ])
    return buffer.getvalue()


def build_report(job: ImportJob) -> str:
    """CSV of everything that will not be imported, with the reason."""
    preview = job.preview or {}
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["row", "sku", "product_name", "reason"])
    for entry in preview.get("errors", []):
        reasons = "; ".join(f"{k}: {v}" for k, v in (entry.get("errors") or {}).items())
        writer.writerow([entry.get("row", ""), _safe_cell(entry.get("sku", "")), "", reasons])
    for product in preview.get("rejected", []):
        name = _safe_cell(product.get("product_name", ""))
        for entry in product.get("row_errors", []):
            reasons = "; ".join(f"{k}: {v}" for k, v in (entry.get("errors") or {}).items())
            writer.writerow([entry.get("row", ""), _safe_cell(entry.get("sku", "")), name, reasons])
        for sku in product.get("missing_skus", []):
            writer.writerow(["", _safe_cell(sku), name, "Missing from the file. Add every size of this product."])
    return buffer.getvalue()
