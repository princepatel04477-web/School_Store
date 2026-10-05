"""
School Admin panel read layer.

Design rules enforced here:

* Every query is scoped with a single indexed `WHERE school_id = ?`
  (or `student_id = ?` for the per-child view) - no joins or subqueries to
  work out what the user may see.
* Headline numbers come from the rollup tables (DailySchoolTotal /
  DailySalesSummary). The orders table is never scanned to count or sum a
  school's sales.
* No `COUNT(*)` over a large filtered set anywhere: lists are cursor
  paginated ("load more") and the only counts in the API are (a) rollup sums
  and (b) the pending-approval counter, which is a tiny set served by
  `idx_student_school_approval`.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Any, Iterable

from django.conf import settings
from django.db.models import Exists, OuterRef, QuerySet, Sum
from django.utils import timezone

from analytics.models import DailySalesSummary, DailySchoolTotal
from catalog.models import Category
from orders.models import Order, OrderItem
from schools.models import School, Student

# --------------------------------------------------------------------------- #
# School resolution
# --------------------------------------------------------------------------- #
PANEL_ROLES = ("BOSS", "ADMIN", "SCHOOL_ADMIN")


def schools_for_user(user) -> QuerySet[School]:
    """Schools this account may administer (used by the school switcher)."""
    qs = School.objects.select_related("city").filter(active=True).order_by("name")
    if not user or not user.is_authenticated:
        return qs.none()
    if user.role == "BOSS" or getattr(user, "is_superuser", False):
        return qs
    if user.role == "ADMIN":
        return qs.filter(city_id=user.city_id)
    if user.role in ("SCHOOL_ADMIN", "TEACHER"):
        return qs.filter(id=user.school_id)
    return qs.none()


def resolve_school(user, school_id: str | None = None) -> School | None:
    """
    The one school the panel is scoped to.

    School Admin -> always their own school. Boss / City Admin -> the school
    they picked in the switcher, defaulting to the first one in scope.
    """
    if not user or not user.is_authenticated:
        return None
    if user.role in ("SCHOOL_ADMIN", "TEACHER") and user.school_id:
        if school_id and str(user.school_id) != str(school_id):
            return None
        return School.objects.select_related("city").filter(id=user.school_id).first()
    qs = schools_for_user(user)
    if school_id:
        return qs.filter(id=school_id).first()
    return qs.first()


# --------------------------------------------------------------------------- #
# Date handling
# --------------------------------------------------------------------------- #
MAX_RANGE_DAYS = 366


def parse_date(value: Any) -> dt.date | None:
    """Parse `YYYY-MM-DD` (also accepts the ISO prefix of a datetime)."""
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return dt.date.fromisoformat(text[:10])
    except ValueError as exc:
        raise ValueError(f"Use a YYYY-MM-DD date, got '{text}'.") from exc


def local_day_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """[00:00, next 00:00) in the project timezone, as aware datetimes."""
    import zoneinfo

    tz = zoneinfo.ZoneInfo(settings.TIME_ZONE)
    start = dt.datetime.combine(day, dt.time.min, tzinfo=tz)
    return start, start + dt.timedelta(days=1)


def default_range() -> tuple[dt.date, dt.date]:
    today = timezone.localdate()
    return today - dt.timedelta(days=29), today


def resolve_range(date_from: Any, date_to: Any) -> tuple[dt.date, dt.date]:
    start = parse_date(date_from)
    end = parse_date(date_to)
    if start is None or end is None:
        start, end = default_range()
    if end < start:
        start, end = end, start
    if (end - start).days > MAX_RANGE_DAYS:
        raise ValueError(f"Pick a range of {MAX_RANGE_DAYS} days or fewer.")
    return start, end


# --------------------------------------------------------------------------- #
# Order filters (shared by the table, the per-child view and the export job)
# --------------------------------------------------------------------------- #
PLACED_BY_ROLES = ("PARENT", "TEACHER", "SCHOOL_ADMIN", "ADMIN", "BOSS")

ITEM_PREVIEW_LIMIT = 4  # Rule P2: keep each row of the table small


@dataclass
class OrderFilters:
    class_name: str = ""
    section: str = ""
    category_id: str = ""
    date_from: str = ""
    date_to: str = ""
    placed_by_role: str = ""
    status: str = ""
    student_id: str = ""

    # -- construction ----------------------------------------------------- #
    @classmethod
    def from_params(cls, params: Any) -> "OrderFilters":
        def get(*names, default=""):
            for name in names:
                if hasattr(params, "getlist"):
                    value = params.get(name)
                else:
                    value = params.get(name) if hasattr(params, "get") else None
                if value not in (None, ""):
                    return str(value)
            return default

        return cls(
            class_name=get("class_name", "class"),
            section=get("section"),
            category_id=get("category", "category_id"),
            date_from=get("date_from", "from", "start"),
            date_to=get("date_to", "to", "end"),
            placed_by_role=get("placed_by_role", "placed_by"),
            status=get("status"),
            student_id=get("student", "student_id"),
        )

    def as_dict(self) -> dict:
        data = asdict(self)
        return {key: value for key, value in data.items() if value}

    # -- queryset --------------------------------------------------------- #
    def apply(self, qs: QuerySet[Order], *, skip_student: bool = False) -> QuerySet[Order]:
        if self.student_id and not skip_student:
            qs = qs.filter(student_id=self.student_id)
        if self.class_name:
            # Denormalised on the order row -> one indexed WHERE, no join.
            qs = qs.filter(student_class=self.class_name)
        if self.section:
            qs = qs.filter(student__section=self.section)
        if self.placed_by_role:
            qs = qs.filter(placed_by_role=self.placed_by_role)
        if self.status:
            qs = qs.filter(status=self.status)

        start = parse_date(self.date_from)
        end = parse_date(self.date_to)
        if start:
            qs = qs.filter(created_at__gte=local_day_bounds(start)[0])
        if end:
            qs = qs.filter(created_at__lt=local_day_bounds(end)[1])

        if self.category_id:
            # Semi-join on idx_orderitem_order: Postgres walks the
            # (school, created_at, id) index and probes row by row, stopping
            # as soon as the page is full - no DISTINCT, no full join.
            qs = qs.filter(
                Exists(
                    OrderItem.objects.filter(
                        order_id=OuterRef("pk"), category_id=self.category_id
                    )
                )
            )
        return qs


def panel_orders_qs(school: School, filters: OrderFilters) -> QuerySet[Order]:
    """
    Every order belonging to one school, newest first.

    Ordering is `(-created_at, -id)` so `idx_order_school_created_id`
    (school, created_at, id) serves it directly with no sort node, and so
    cursor pagination has a stable, unique key.
    """
    qs = (
        Order.objects.filter(school_id=school.id)
        .select_related("student", "placed_by")
        .prefetch_related("items__variant__product", "items__category")
    )
    return filters.apply(qs).order_by("-created_at", "-id")


def student_orders_qs(student: Student, filters: OrderFilters) -> QuerySet[Order]:
    """One child's orders, served by `idx_order_student_created_id`."""
    qs = (
        Order.objects.filter(student_id=student.id)
        .select_related("placed_by")
        .prefetch_related("items__variant__product", "items__category")
    )
    return filters.apply(qs, skip_student=True).order_by("-created_at", "-id")


# --------------------------------------------------------------------------- #
# Dashboard (requirement 1 + 7)
# --------------------------------------------------------------------------- #
def summary_totals(school: School, start: dt.date, end: dt.date) -> dict:
    """
    Headline figures for one school over a date range - read from the
    DailySchoolTotal rollup, never by scanning orders.

    `orders` here is the exact distinct-order count for the school-day: the
    per-category rows cannot be summed into it (an order spanning two
    categories is counted once per category).
    """
    rows = DailySchoolTotal.objects.filter(
        school_id=school.id, date__gte=start, date__lte=end
    ).aggregate(
        orders=Sum("orders"),
        units=Sum("units"),
        gross_sales=Sum("revenue"),
        cost=Sum("cost"),
    )
    orders = int(rows["orders"] or 0)
    units = int(rows["units"] or 0)
    gross = rows["gross_sales"] or Decimal("0.00")
    cost = rows["cost"] or Decimal("0.00")
    return {
        "orders": orders,
        "units": units,
        "gross_sales": gross,
        "cost": cost,
        "margin": gross - cost,
        "average_order_value": (gross / orders).quantize(Decimal("0.01"))
        if orders
        else Decimal("0.00"),
    }


def category_breakdown(school: School, start: dt.date, end: dt.date) -> list[dict]:
    """Per-category slice of the same rollup (DailySalesSummary)."""
    rows = (
        DailySalesSummary.objects.filter(
            school_id=school.id, date__gte=start, date__lte=end
        )
        .values("category_id", "category__name")
        .annotate(
            orders=Sum("orders"),
            units=Sum("units"),
            gross_sales=Sum("revenue"),
        )
        .order_by("-gross_sales")
    )
    total = sum((row["gross_sales"] or Decimal("0.00")) for row in rows)
    breakdown = []
    for row in rows:
        gross = row["gross_sales"] or Decimal("0.00")
        share = (
            (gross / total * Decimal("100")).quantize(Decimal("0.1")) if total else Decimal("0.0")
        )
        breakdown.append(
            {
                "category_id": row["category_id"],
                "category": row["category__name"],
                "orders": int(row["orders"] or 0),
                "units": int(row["units"] or 0),
                "gross_sales": gross,
                "share_pct": share,
            }
        )
    return breakdown


DAILY_TREND_LIMIT = 400


def daily_trend(school: School, start: dt.date, end: dt.date) -> list[dict]:
    """One point per day for the sparkline, still read from the rollup."""
    rows = (
        DailySchoolTotal.objects.filter(
            school_id=school.id, date__gte=start, date__lte=end
        )
        .values("date")
        .annotate(
            orders=Sum("orders"),
            units=Sum("units"),
            gross_sales=Sum("revenue"),
        )
        .order_by("date")[:DAILY_TREND_LIMIT]
    )
    return [
        {
            "date": row["date"].isoformat(),
            "orders": int(row["orders"] or 0),
            "units": int(row["units"] or 0),
            "gross_sales": row["gross_sales"] or Decimal("0.00"),
        }
        for row in rows
    ]


def commission_payload(school: School, gross_sales: Decimal) -> dict:
    """
    Requirement 7: the rate always comes from `School.commission_rate`.

    Nothing is hard-coded - when the school has no rate the API says so
    instead of inventing one.
    """
    rate = school.commission_rate
    if rate is None:
        return {
            "rate_set": False,
            "rate": None,
            "rate_display": "Not set",
            "basis": "gross_sales",
            "gross_sales": gross_sales,
            "commission_amount": None,
            "currency": getattr(settings, "REPORTING_CURRENCY", "INR"),
            "note": (
                "Commission rate is not set for this school, so no commission "
                "is shown. Set it on the school record to see the amount."
            ),
        }
    amount = (gross_sales * rate / Decimal("100")).quantize(Decimal("0.01"))
    return {
        "rate_set": True,
        "rate": rate,
        # `:f` keeps 10.00 as "10" instead of Decimal.normalize()'s "1E+1".
        "rate_display": f"{rate.normalize():f}%",
        "basis": "gross_sales",
        "gross_sales": gross_sales,
        "commission_amount": amount,
        "currency": getattr(settings, "REPORTING_CURRENCY", "INR"),
        "note": None,
    }


def generate_password(length: int = 12) -> str:
    """
    Temporary password for a newly created teacher login.

    `User.objects.make_random_password()` was removed in Django 5.1, and
    `secrets` is the right tool anyway.
    """
    import secrets
    import string

    alphabet = string.ascii_letters + string.digits
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in candidate)
            and any(c.isupper() for c in candidate)
            and any(c.isdigit() for c in candidate)
        ):
            return candidate


def pending_student_count(school: School) -> int:
    """
    Tiny, index-served count (`idx_student_school_approval`): how many
    parent-added children are waiting for the School Admin to approve them.
    """
    return Student.objects.filter(
        school_id=school.id, approval_status=Student.ApprovalStatus.PENDING
    ).count()


def class_options(school: School) -> list[str]:
    return list(
        Student.objects.filter(school_id=school.id)
        .order_by("class_name")
        .values_list("class_name", flat=True)
        .distinct()
    )


def category_options() -> list[dict]:
    return [
        {"id": str(row.id), "name": row.name}
        for row in Category.objects.filter(active=True).order_by("display_order", "name")
    ]


# --------------------------------------------------------------------------- #
# Excel export (requirement 4 - runs in a Celery worker, streams to disk)
# --------------------------------------------------------------------------- #
ORDERS_COLUMNS = [
    "Order number",
    "Date",
    "Student",
    "GR number",
    "Class",
    "Section",
    "Items",
    "Units",
    "Amount",
    "Status",
    "Payment status",
    "Placed by",
    "Placed by role",
    "Fulfilment",
]

STUDENTS_COLUMNS = [
    "Name",
    "GR number",
    "Class",
    "Section",
    "Gender",
    "Date of birth",
    "Approval status",
    "Source",
    "Parent name",
    "Parent phone",
    "Active",
]


def order_rows(queryset: QuerySet[Order]) -> Iterable[list]:
    for order in queryset:
        items = list(order.items.all())
        units = sum(item.quantity for item in items)
        lines = []
        for item in items:
            product = getattr(item.variant, "product", None)
            name = getattr(product, "name", "") if product else ""
            size = getattr(item.variant, "size", "") or ""
            lines.append(f"{item.quantity} x {name}" + (f" ({size})" if size else ""))
        lines.sort()
        placed_by = order.placed_by
        lines_text = "; ".join(lines)
        if len(lines_text) > 1000:
            lines_text = lines_text[:1000] + "…"
        yield [
            order.order_number,
            timezone.localtime(order.created_at).strftime("%Y-%m-%d %H:%M"),
            order.student.name,
            order.student.gr_number,
            order.student.class_name,
            order.student.section,
            lines_text,
            units,
            float(order.total),
            order.get_status_display(),
            order.get_payment_status_display(),
            placed_by.get_full_name() if placed_by else "",
            order.placed_by_role,
            order.get_fulfillment_type_display(),
        ]


def student_rows(queryset: QuerySet[Student]) -> Iterable[list]:
    for student in queryset:
        parent = student.parent
        yield [
            student.name,
            student.gr_number,
            student.class_name,
            student.section,
            student.get_gender_display(),
            student.date_of_birth.isoformat() if student.date_of_birth else "",
            student.get_approval_status_display(),
            student.get_source_display(),
            parent.get_full_name() if parent else "",
            parent.phone if parent else "",
            "Yes" if student.active else "No",
        ]


def write_export_workbook(job, rows: Iterable[list], columns: list[str], title: str) -> None:
    """
    Stream the workbook to disk with openpyxl's write-only mode.

    Write-only worksheets append straight into a zip stream, so memory stays
    flat no matter how many rows the export has - the file is never assembled
    in Python memory.
    """
    import tempfile

    from django.core.files import File
    from openpyxl import Workbook
    from openpyxl.utils import get_column_letter

    max_rows = int(getattr(settings, "EXPORT_MAX_ROWS", 200_000))

    with tempfile.TemporaryFile() as tmp:
        # `write_only` worksheets stream straight into the zip file, so memory
        # stays flat for a 200,000-row export (Rule P5 + P2).
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet(title[:31])
        sheet.append(columns)
        for index, width in enumerate(_column_widths(columns), start=1):
            sheet.column_dimensions[get_column_letter(index)].width = width

        count = 0
        truncated = False
        for row in rows:
            if count >= max_rows:
                truncated = True
                break
            sheet.append(row)
            count += 1

        info = workbook.create_sheet("Export info")
        info.append(["School", job.school.name if job.school_id else ""])
        info.append(["Report", job.get_job_type_display()])
        info.append(["Requested by", job.requested_by.username if job.requested_by_id else ""])
        info.append(["Generated at", timezone.localtime().strftime("%Y-%m-%d %H:%M")])
        info.append(["Rows written", count])
        info.append(["Filters", str(job.filters or {})])
        if truncated:
            info.append(
                [
                    "Note",
                    f"Stopped at the {max_rows} row cap; narrow the filters for a full export.",
                ]
            )

        workbook.save(tmp)
        tmp.flush()
        tmp.seek(0)
        job.file.save(job.filename or "export.xlsx", File(tmp, name=job.filename), save=False)
        job.row_count = count
        job.result = {
            "rows": count,
            "truncated": truncated,
            "max_rows": max_rows,
            "columns": columns,
        }


def _column_widths(columns: list[str]) -> list[int]:
    widths = {
        "Order number": 22,
        "Date": 17,
        "Student": 26,
        "GR number": 16,
        "Class": 8,
        "Section": 9,
        "Items": 60,
        "Units": 8,
        "Amount": 12,
        "Status": 14,
        "Payment status": 15,
        "Placed by": 24,
        "Placed by role": 15,
        "Fulfilment": 15,
        "Name": 26,
        "Gender": 10,
        "Date of birth": 14,
        "Approval status": 26,
        "Source": 20,
        "Parent name": 24,
        "Parent phone": 14,
        "Active": 8,
    }
    return [widths.get(column, 18) for column in columns]
