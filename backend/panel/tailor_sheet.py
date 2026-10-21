"""
Tailor sheet (Prompt 25): the measurements and sizes the tailor sews from.

One worksheet per school. Inside it, rows are grouped by class in the fixed
grade order (Nursery, Junior KG, Senior KG, Class 1 to 12), then section,
then student name, with a bold header before each group ("Class 5 - Section
A") and the number of children in it. One row per uniform line, carrying
the measurement copied onto the order line when it was placed, and the shoe,
tie, belt and sock sizes from the same order.

Built by the panel export worker (panel.tasks.build_export) with openpyxl's
write-only mode, so memory stays flat however many orders are in it.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from django.conf import settings
from django.db.models import Count, Prefetch, Q, QuerySet
from django.utils import timezone

from orders.models import Order, OrderItem

TAILOR_COLUMNS = [
    "Order no.",
    "Order date",
    "Student name",
    "GR no.",
    "Gender",
    "Product",
    "Chosen size",
    "Height (cm)",
    "Weight (kg)",
    "Shoulder (cm)",
    "Measurement source",
    "Shoulder edited",
    "Shoe size",
    "Tie size",
    "Belt size",
    "Sock size",
    "Customer notes",
]
COLUMN_WIDTHS = [22, 12, 24, 14, 8, 34, 14, 11, 11, 13, 18, 14, 10, 10, 10, 10, 30]

# Not yet dispatched: the orders the tailor still has to make.
OPEN_STATUSES = [
    Order.Status.PLACED,
    Order.Status.PENDING,
    Order.Status.CONFIRMED,
    Order.Status.PROCESSING,
    Order.Status.PACKED,
]
# "Check with tailor": the child is outside the size chart.
CHECK_STATUSES = {"BELOW_CHART", "ABOVE_CHART"}


@dataclass
class TailorFilters:
    """The choices made before export. Empty means every value is allowed."""

    schools: list[str] = field(default_factory=list)
    grade: str = ""
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    statuses: list[str] = field(default_factory=lambda: list(OPEN_STATUSES))
    order: str = ""

    @classmethod
    def from_params(cls, params: dict) -> "TailorFilters":
        def date(value):
            try:
                return dt.date.fromisoformat(str(value)) if value else None
            except ValueError:
                return None

        valid_statuses = set(Order.Status.values)
        statuses = [s for s in (params.get("statuses") or []) if s in valid_statuses]
        return cls(
            schools=[str(s) for s in (params.get("schools") or []) if s],
            grade=str(params.get("grade") or "").strip(),
            date_from=date(params.get("date_from")),
            date_to=date(params.get("date_to")),
            statuses=statuses or list(OPEN_STATUSES),
            order=str(params.get("order") or "").strip(),
        )

    def as_dict(self) -> dict:
        return {
            "schools": self.schools,
            "grade": self.grade,
            "date_from": self.date_from.isoformat() if self.date_from else "",
            "date_to": self.date_to.isoformat() if self.date_to else "",
            "statuses": self.statuses,
            "order": self.order,
        }


def tailor_orders_qs(filters: TailorFilters, city_id=None) -> QuerySet[Order]:
    """
    The orders on the sheet, sorted school, grade order, section, student.

    By default: orders not yet dispatched that are paid, or cash on delivery
    (which is paid at the door). One order (from its detail page) ignores the
    status and payment defaults.
    """
    qs = Order.objects.all()
    if city_id:
        qs = qs.filter(city_id=city_id)
    if filters.order:
        qs = qs.filter(pk=filters.order)
    else:
        qs = qs.filter(status__in=filters.statuses).filter(
            Q(payment_status=Order.PaymentStatus.PAID) | Q(payment_method=Order.PaymentMethod.CASH_ON_DELIVERY)
        )
        if filters.schools:
            qs = qs.filter(school_id__in=filters.schools)
        if filters.grade:
            qs = qs.filter(student_class=filters.grade)
        if filters.date_from:
            qs = qs.filter(created_at__date__gte=filters.date_from)
        if filters.date_to:
            qs = qs.filter(created_at__date__lte=filters.date_to)
    items = OrderItem.objects.select_related("variant__product", "category").order_by("id")
    return (
        qs.select_related("school", "student", "student__grade")
        .prefetch_related(Prefetch("items", queryset=items))
        .order_by(
            "school__name",
            "school_id",
            "student__grade__sort_order",
            "student_class",
            "student__section",
            "student__name",
            "student_id",
            "created_at",
            "id",
        )
    )


def _group_key(order: Order) -> tuple[str, str, str]:
    return (str(order.school_id), order.student.student_class or order.student_class, order.student.section or "")


def group_counts(queryset: QuerySet[Order]) -> dict:
    """(school, class, section) -> number of children. One grouped query."""
    counts = {}
    rows = (
        queryset.order_by()
        .values("school_id", "student__grade__name", "student__class_name", "student__section")
        .annotate(children=Count("student_id", distinct=True))
    )
    for row in rows:
        cls = row["student__grade__name"] or row["student__class_name"] or ""
        key = (str(row["school_id"]), cls, row["student__section"] or "")
        counts[key] = counts.get(key, 0) + row["children"]
    return counts


def _is_uniform(item: OrderItem) -> bool:
    slug = (getattr(item.category, "slug", "") or "").lower()
    name = (getattr(item.category, "name", "") or "").lower()
    return slug == "uniform" or name == "uniform"


def _other_sizes(items: list[OrderItem]) -> dict:
    """Shoe, tie, belt and sock sizes from the rest of the order."""
    sizes = {"shoe": "", "tie": "", "belt": "", "sock": ""}
    for item in items:
        product = item.variant.product
        size = item.chosen_size or item.variant.size
        category = (getattr(item.category, "slug", "") or getattr(item.category, "name", "")).lower()
        kind = (product.product_type or "").upper()
        name = product.name.lower()
        if "shoe" in category:
            key = "shoe"
        elif kind == "TIE" or "tie" in name.split():
            key = "tie"
        elif kind == "BELT" or "belt" in name:
            key = "belt"
        elif kind == "SOCKS" or "sock" in name:
            key = "sock"
        else:
            continue
        if not sizes[key]:
            sizes[key] = size
    return sizes


def _number(value):
    return float(value) if value is not None else None


def tailor_rows(order: Order) -> list[tuple[list, bool]]:
    """(row, highlight) for each uniform line of one order."""
    items = list(order.items.all())
    others = _other_sizes(items)
    gender = order.student.get_gender_display() if order.student_id else ""
    notes = ""
    if isinstance(order.delivery_details, dict):
        notes = str(order.delivery_details.get("notes") or order.delivery_details.get("note") or "")
    rows = []
    for item in items:
        if not _is_uniform(item):
            continue
        source = {"CAMERA": "camera", "MANUAL": "manual"}.get(item.fit_source, "")
        highlight = item.recommendation_status in CHECK_STATUSES or item.fit_shoulder_edited
        rows.append(
            (
                [
                    order.order_number,
                    timezone.localtime(order.created_at).strftime("%Y-%m-%d"),
                    order.student.name,
                    order.student.gr_number,
                    gender,
                    item.variant.product.name,
                    item.chosen_size or item.variant.size,
                    _number(item.fit_height_cm),
                    _number(item.fit_weight_kg),
                    _number(item.fit_shoulder_cm),
                    source,
                    ("yes" if item.fit_shoulder_edited else "no") if item.fit_height_cm is not None else "",
                    others["shoe"],
                    others["tie"],
                    others["belt"],
                    others["sock"],
                    notes,
                ],
                highlight,
            )
        )
    return rows


def _sheet_title(name: str, used: set) -> str:
    """Excel sheet names: at most 31 characters, none of []:*?/\\, and unique."""
    clean = "".join(" " if ch in '[]:*?/\\' else ch for ch in name).strip() or "School"
    title = clean[:31]
    n = 2
    while title.lower() in used:
        suffix = f" ({n})"
        title = clean[: 31 - len(suffix)] + suffix
        n += 1
    used.add(title.lower())
    return title


def write_tailor_workbook(job, queryset: QuerySet[Order]) -> None:
    import tempfile

    from django.core.files import File
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    max_rows = int(getattr(settings, "EXPORT_MAX_ROWS", 200_000))
    counts = group_counts(queryset)
    bold = Font(bold=True)
    # A muted amber, readable when printed in black and white too.
    check_fill = PatternFill("solid", start_color="FFF2CC", end_color="FFF2CC")

    with tempfile.TemporaryFile() as tmp:
        workbook = Workbook(write_only=True)
        sheet = None
        used_titles: set = set()
        current_school = None
        current_group = None
        written = 0
        sheets = 0
        flagged = 0
        truncated = False

        def styled(sheet, values, font=None, fill=None):
            cells = []
            for value in values:
                cell = WriteOnlyCell(sheet, value=value)
                if font:
                    cell.font = font
                if fill:
                    cell.fill = fill
                cells.append(cell)
            return cells

        for order in queryset.iterator(chunk_size=500):
            rows = tailor_rows(order)
            if not rows:
                continue
            if written >= max_rows:
                truncated = True
                break
            if order.school_id != current_school:
                current_school = order.school_id
                current_group = None
                sheet = workbook.create_sheet(_sheet_title(order.school.name, used_titles))
                for index, width in enumerate(COLUMN_WIDTHS, start=1):
                    sheet.column_dimensions[get_column_letter(index)].width = width
                sheet.append(styled(sheet, TAILOR_COLUMNS, font=bold))
                sheets += 1
            group = _group_key(order)
            if group != current_group:
                current_group = group
                _, cls, section = group
                label = f"{cls or 'No class'} - Section {section}" if section else (cls or "No class")
                children = counts.get(group, 0)
                sheet.append(styled(sheet, [label, f"{children} child{'ren' if children != 1 else ''}"], font=bold))
            for values, highlight in rows:
                sheet.append(styled(sheet, values, fill=check_fill if highlight else None))
                written += 1
                flagged += int(highlight)

        if sheets == 0:
            empty = workbook.create_sheet("Tailor sheet")
            empty.append(TAILOR_COLUMNS)
            empty.append(["No orders match these filters."])

        info = workbook.create_sheet("Export info")
        info.append(["Report", "Tailor sheet"])
        info.append(["Requested by", job.requested_by.username if job.requested_by_id else ""])
        info.append(["Generated at", timezone.localtime().strftime("%Y-%m-%d %H:%M")])
        info.append(["Rows written", written])
        info.append(["Rows to check", flagged])
        info.append(["Filters", str(job.filters or {})])
        info.append(["Highlighted rows", "Outside the size chart (check with the tailor) or shoulder changed by hand."])
        if truncated:
            info.append(["Note", f"Stopped at the {max_rows} row cap; narrow the filters for a full sheet."])

        workbook.save(tmp)
        tmp.flush()
        tmp.seek(0)
        job.file.save(job.filename or "tailor-sheet.xlsx", File(tmp, name=job.filename), save=False)
        job.row_count = written
        job.result = {
            "rows": written,
            "schools": sheets,
            "rows_to_check": flagged,
            "truncated": truncated,
            "columns": TAILOR_COLUMNS,
        }
