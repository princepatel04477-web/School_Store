"""
Student bulk-import engine (Prompt 4, requirement 3).

Everything heavy happens inside Celery workers (Rule P5):
  1. `parse_rows()`      - streams .xlsx / .csv rows (5 MB / 5,000 row caps)
  2. `validate_import()` - validates every row and stores a preview on the job
  3. `commit_import()`   - `bulk_create(batch_size=500, ignore_conflicts=True)`,
                           i.e. `INSERT ... ON CONFLICT (school_id, gr_number) DO NOTHING`.

Duplicate GR numbers are detected with ONE indexed query for the whole file
(`WHERE school_id = %s AND gr_number IN (...)`) - never one query per row.
"""

import csv
import datetime as dt
import uuid
from collections import OrderedDict
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from common.models import ImportJob

from .models import Student

# Exact template columns (requirement 3: "downloadable template with the exact columns")
TEMPLATE_COLUMNS = ["name", "gr_number", "class", "section", "gender", "date_of_birth"]
REQUIRED_COLUMNS = ["name", "gr_number", "class", "section", "gender"]
OPTIONAL_COLUMNS = ["date_of_birth"]

# Tolerated header spellings -> canonical template column
COLUMN_ALIASES = {
    "name": "name",
    "student name": "name",
    "student": "name",
    "full name": "name",
    "gr_number": "gr_number",
    "gr number": "gr_number",
    "gr no": "gr_number",
    "gr no.": "gr_number",
    "grno": "gr_number",
    "gr": "gr_number",
    "general register number": "gr_number",
    "class": "class",
    "class name": "class",
    "std": "class",
    "standard": "class",
    "grade": "class",
    "section": "section",
    "sec": "section",
    "div": "section",
    "division": "section",
    "gender": "gender",
    "sex": "gender",
    "date_of_birth": "date_of_birth",
    "date of birth": "date_of_birth",
    "dob": "date_of_birth",
    "birth date": "date_of_birth",
    "birthdate": "date_of_birth",
}

GENDER_ALIASES = {
    "m": "MALE",
    "male": "MALE",
    "boy": "MALE",
    "f": "FEMALE",
    "female": "FEMALE",
    "girl": "FEMALE",
    "o": "OTHER",
    "other": "OTHER",
    "others": "OTHER",
    "n/a": "OTHER",
    "na": "OTHER",
}

MAX_FIELD_LENGTHS = {
    "name": 150,
    "gr_number": 50,
    "class": 30,
    "section": 20,
}

DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d", "%m/%d/%Y")


class ImportValidationError(Exception):
    """Raised for whole-file problems (missing columns, caps exceeded, ...)."""


# --------------------------------------------------------------------------- #
# Configuration helpers (settings driven so tests can tighten the caps)
# --------------------------------------------------------------------------- #
def max_upload_bytes() -> int:
    return int(getattr(settings, "STUDENT_IMPORT_MAX_BYTES", 5 * 1024 * 1024))


def max_rows() -> int:
    return int(getattr(settings, "STUDENT_IMPORT_MAX_ROWS", 5000))


def batch_size() -> int:
    return int(getattr(settings, "STUDENT_IMPORT_BATCH_SIZE", 500))


def preview_limit() -> int:
    return int(getattr(settings, "STUDENT_IMPORT_PREVIEW_LIMIT", 50))


# --------------------------------------------------------------------------- #
# 1. Parsing
# --------------------------------------------------------------------------- #
def normalise_header(raw) -> str:
    if raw is None:
        return ""
    key = str(raw).strip().lower().replace("\ufeff", "")
    key = key.replace("_", " ").replace("-", " ")
    key = " ".join(key.split())
    return COLUMN_ALIASES.get(key, key.replace(" ", "_"))


def _iter_xlsx_rows(path: str):
    from openpyxl import load_workbook

    workbook = load_workbook(filename=path, read_only=True, data_only=True)
    try:
        sheet = workbook.worksheets[0]
        for row in sheet.iter_rows(values_only=True):
            yield list(row)
    finally:
        workbook.close()


def _iter_csv_rows(path: str):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.reader(handle):
            yield row


def parse_rows(path: str, filename: str):
    """
    Streams the uploaded file -> (canonical_header_map, iterator of dict rows).

    Returns `(headers, rows)` where headers is the list of canonical column names
    in file order and rows is a generator of `{column: raw_value}` mappings.
    """
    lower = (filename or "").lower()
    if lower.endswith(".xlsx"):
        raw_rows = _iter_xlsx_rows(path)
    elif lower.endswith(".csv"):
        raw_rows = _iter_csv_rows(path)
    else:
        raise ImportValidationError("Only .xlsx and .csv files are supported.")

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
        raise ImportValidationError(
            "Unexpected column(s): " + ", ".join(sorted(set(unknown))) + "."
        )

    def row_iterator():
        for raw in raw_rows:
            if raw is None:
                continue
            if all(cell is None or str(cell).strip() == "" for cell in raw):
                continue
            values = list(raw) + [None] * (len(headers) - len(raw))
            yield {
                column: values[index] if index < len(values) else None
                for index, column in enumerate(headers)
                if column
            }

    return headers, row_iterator()


# --------------------------------------------------------------------------- #
# 2. Row validation helpers
# --------------------------------------------------------------------------- #
def clean_text(value, column: str) -> tuple[str, str | None]:
    if value is None:
        return "", f"{column} is required."
    if isinstance(value, float) and value.is_integer():
        text = str(int(value))
    elif isinstance(value, Decimal):
        text = format(value.normalize(), "f")
    else:
        text = str(value).strip()
    if not text:
        return "", f"{column} is required."
    max_len = MAX_FIELD_LENGTHS.get(column)
    if max_len and len(text) > max_len:
        return text[:max_len], f"{column} must be at most {max_len} characters."
    return text, None


def clean_gender(value) -> tuple[str, str | None]:
    if value is None or str(value).strip() == "":
        return "", "gender is required (M/F/OTHER)."
    key = str(value).strip().lower()
    mapped = GENDER_ALIASES.get(key)
    if not mapped:
        return "", "gender must be one of M, F, OTHER (or Male/Female/Other)."
    return mapped, None


def clean_date(value) -> tuple[dt.date | None, str | None]:
    if value is None or str(value).strip() == "":
        return None, None
    if isinstance(value, dt.datetime):
        return value.date(), None
    if isinstance(value, dt.date):
        return value, None
    text = str(value).strip()
    for fmt in DATE_FORMATS:
        try:
            return dt.datetime.strptime(text, fmt).date(), None
        except ValueError:
            continue
    return None, "date_of_birth must be a valid date (YYYY-MM-DD)."


def validate_row(raw_row: dict, row_number: int) -> tuple[dict | None, dict | None]:
    """Returns `(cleaned_row, error)` - exactly one of the two is not None."""
    cleaned: dict = {}
    errors: dict = {}

    for column in REQUIRED_COLUMNS:
        if column == "gender":
            value, error = clean_gender(raw_row.get(column))
        else:
            value, error = clean_text(raw_row.get(column), column)
        if error:
            errors[column] = error
        cleaned[column] = value

    if "date_of_birth" in raw_row or "date_of_birth" in TEMPLATE_COLUMNS:
        dob, dob_error = clean_date(raw_row.get("date_of_birth"))
        if dob_error:
            errors["date_of_birth"] = dob_error
        cleaned["date_of_birth"] = dob.isoformat() if dob else None

    if errors:
        return None, {
            "row": row_number,
            "gr_number": cleaned.get("gr_number") or "",
            "name": cleaned.get("name") or "",
            "errors": errors,
        }

    cleaned["row"] = row_number
    return cleaned, None


# --------------------------------------------------------------------------- #
# 3. Validation job (stores the preview)
# --------------------------------------------------------------------------- #
def _save_preview_row(collection: list, row: dict) -> None:
    if len(collection) < preview_limit():
        collection.append(row)


def validate_import(job: ImportJob) -> ImportJob:
    """
    Validates every row of the uploaded file and stores the preview on the job.
    Runs inside a Celery worker (never in the HTTP request).
    """
    limit = preview_limit()

    def row_detail(row: dict) -> dict:
        return {
            "row": row.get("row"),
            "name": row.get("name", ""),
            "gr_number": row.get("gr_number", ""),
            "class": row.get("class", ""),
            "section": row.get("section", ""),
        }

    valid_rows: "OrderedDict[str, dict]" = OrderedDict()
    valid_preview: list = []
    duplicates_preview: list = []
    errors_preview: list = []
    duplicate_count = 0
    error_count = 0
    total_rows = 0

    headers, rows = parse_rows(job.file.path, job.original_filename)
    seen_in_file: dict = {}

    for index, raw_row in enumerate(rows, start=1):
        if index > max_rows():
            raise ImportValidationError(
                f"The file has more than {max_rows()} rows. "
                "Split it into smaller files and import again."
            )
        total_rows = index
        cleaned, error = validate_row(raw_row, index)
        if error:
            error_count += 1
            _save_preview_row(errors_preview, error)
            continue

        gr_key = cleaned["gr_number"].upper()
        if gr_key in seen_in_file:
            duplicate_count += 1
            _save_preview_row(
                duplicates_preview,
                {
                    **row_detail(cleaned),
                    "reason": f"Duplicate GR number inside the file (also on row {seen_in_file[gr_key]}).",
                },
            )
            continue
        seen_in_file[gr_key] = index
        valid_rows[cleaned["gr_number"]] = cleaned

    # ONE indexed query for the whole file (uses uniq_student_school_gr).
    if valid_rows:
        existing = set(
            Student.objects.filter(
                school_id=job.school_id,
                gr_number__in=list(valid_rows.keys()),
            ).values_list("gr_number", flat=True)
        )
    else:
        existing = set()

    if existing:
        for gr_number in list(valid_rows.keys()):
            if gr_number in existing:
                row = valid_rows.pop(gr_number)
                duplicate_count += 1
                _save_preview_row(
                    duplicates_preview,
                    {
                        **row_detail(row),
                        "reason": "GR number already exists in this school.",
                    },
                )

    job.total_rows = total_rows
    job.valid_count = len(valid_rows)
    job.duplicate_count = duplicate_count
    job.error_count = error_count
    job.valid_rows = list(valid_rows.values())
    job.preview = {
        "valid": valid_preview[:limit],
        "duplicates": duplicates_preview[:limit],
        "errors": errors_preview[:limit],
        "preview_limit": limit,
        "columns": headers,
        "notes": [
            "Duplicates use the unique (school, GR number) index and are skipped.",
            "Confirm the import to insert the valid rows.",
        ],
    }
    # Rebuild the valid preview from the (possibly de-duplicated) valid rows
    job.preview["valid"] = [row_detail(row) for row in list(valid_rows.values())[:limit]]
    job.status = ImportJob.Status.PREVIEW_READY
    job.save(
        update_fields=[
            "total_rows",
            "valid_count",
            "duplicate_count",
            "error_count",
            "valid_rows",
            "preview",
            "status",
            "updated_at",
        ]
    )
    return job


# --------------------------------------------------------------------------- #
# 4. Commit job (batched insert, ON CONFLICT DO NOTHING)
# --------------------------------------------------------------------------- #
@transaction.atomic
def commit_import(job: ImportJob) -> ImportJob:
    """
    Inserts the validated rows in batches of 500 using
    `bulk_create(..., ignore_conflicts=True)` which compiles to
    `INSERT ... ON CONFLICT DO NOTHING` - the unique (school_id, gr_number)
    constraint is the conflict target, so duplicates are skipped, never
    inserted one row at a time (Rule P5 + requirement 3).
    """
    rows = job.valid_rows or []
    if not rows:
        job.status = ImportJob.Status.COMPLETED
        job.result = {"inserted": 0, "skipped_duplicates": 0, "batches": 0}
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "result", "completed_at", "updated_at"])
        return job

    size = batch_size()
    gr_numbers = [row["gr_number"] for row in rows]

    # Indexed pre-count via (school_id, gr_number) - guards against a concurrent import.
    already_present = Student.objects.filter(
        school_id=job.school_id, gr_number__in=gr_numbers
    ).count()

    objs = [
        Student(
            id=uuid.uuid4(),
            name=row["name"],
            gr_number=row["gr_number"],
            class_name=row["class"],
            section=row["section"],
            gender=row["gender"],
            date_of_birth=(
                dt.date.fromisoformat(row["date_of_birth"])
                if row.get("date_of_birth")
                else None
            ),
            school_id=job.school_id,
            city_id=job.city_id,
            approval_status=Student.ApprovalStatus.APPROVED,
            source=Student.Source.IMPORT,
            active=True,
        )
        for row in rows
    ]

    for start in range(0, len(objs), size):
        Student.objects.bulk_create(
            objs[start : start + size],
            batch_size=size,
            ignore_conflicts=True,
        )

    present_after = Student.objects.filter(
        school_id=job.school_id, gr_number__in=gr_numbers
    ).count()

    inserted = present_after - already_present
    job.result = {
        "inserted": inserted,
        "skipped_duplicates": len(objs) - inserted,
        "batches": (len(objs) + size - 1) // size,
        "batch_size": size,
    }
    job.status = ImportJob.Status.COMPLETED
    job.completed_at = timezone.now()
    job.save(update_fields=["result", "status", "completed_at", "updated_at"])
    return job
