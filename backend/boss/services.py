"""
Boss dashboard read layer.

Hard rules (prompt 9):

* No dashboard query may scan `orders_order` or `orders_orderitem`. Every
  number comes from the analytics rollups:

    - DailySalesSummary   (date, city, school, category)  -> money / units
    - DailySchoolTotal    (date, city, school)            -> exact order counts
    - DailyProductSummary (date, product, city, school)   -> top products

* Profit = sum of (unit_price_snapshot - unit_cost_snapshot) x quantity,
  which equals `revenue - cost` because both snapshots were rolled up
  separately. Gross margin = profit / revenue.
* Every response is cached in Redis for `BOSS_DASHBOARD_CACHE_TTL` seconds
  (60 by default), keyed by the exact filter combination. The stock-value
  aggregate is cached for `BOSS_STOCK_VALUE_CACHE_TTL` seconds.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db.models import F, Sum
from django.utils import timezone

from analytics.models import DailyProductSummary, DailySalesSummary, DailySchoolTotal
from inventory.models import StockBalance

MAX_RANGE_DAYS = 366
TOP_N_LIMIT = 10
TREND_POINT_CAP = 400

ZERO = Decimal("0.00")


# --------------------------------------------------------------------------- #
# Filters
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class BossFilters:
    """
    City / school / category / date-range filters shared by every card and
    chart. All query builders below take this object and nothing else, which
    is what guarantees every endpoint respects the same filters.
    """

    city_id: str = ""
    school_id: str = ""
    category_id: str = ""
    date_from: dt.date | None = None
    date_to: dt.date | None = None

    @classmethod
    def from_params(cls, params) -> "BossFilters":
        try:
            start, end = resolve_range(
                params.get("date_from") or params.get("from"),
                params.get("date_to") or params.get("to"),
            )
        except ValueError as exc:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"date_range": str(exc)}) from exc
        return cls(
            city_id=(params.get("city") or "").strip(),
            school_id=(params.get("school") or "").strip(),
            category_id=(params.get("category") or "").strip(),
            date_from=start,
            date_to=end,
        )

    def cache_key(self, namespace: str) -> str:
        raw = "|".join(
            [
                namespace,
                self.city_id or "-",
                self.school_id or "-",
                self.category_id or "-",
                self.date_from.isoformat(),
                self.date_to.isoformat(),
            ]
        )
        return "boss:" + hashlib.sha256(raw.encode()).hexdigest()

    def as_dict(self) -> dict:
        return {
            "city": self.city_id or None,
            "school": self.school_id or None,
            "category": self.category_id or None,
            "date_from": self.date_from.isoformat(),
            "date_to": self.date_to.isoformat(),
        }


def parse_date(value) -> dt.date | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    try:
        return dt.date.fromisoformat(text[:10])
    except ValueError as exc:
        raise ValueError(f"Use a YYYY-MM-DD date, got '{text}'.") from exc


def resolve_range(date_from, date_to) -> tuple[dt.date, dt.date]:
    start = parse_date(date_from)
    end = parse_date(date_to)
    if start is None or end is None:
        today = timezone.localdate()
        start, end = today - dt.timedelta(days=29), today
    if end < start:
        start, end = end, start
    if (end - start).days > MAX_RANGE_DAYS:
        raise ValueError(f"Pick a range of {MAX_RANGE_DAYS} days or fewer.")
    return start, end


# --------------------------------------------------------------------------- #
# Query builders (rollups only - never orders / order items)
# --------------------------------------------------------------------------- #
def _sales_qs(filters: BossFilters):
    """DailySalesSummary restricted by the active filters."""
    qs = DailySalesSummary.objects.filter(
        date__gte=filters.date_from, date__lte=filters.date_to
    )
    if filters.city_id:
        qs = qs.filter(city_id=filters.city_id)
    if filters.school_id:
        qs = qs.filter(school_id=filters.school_id)
    if filters.category_id:
        qs = qs.filter(category_id=filters.category_id)
    return qs


def _school_total_qs(filters: BossFilters):
    """DailySchoolTotal restricted by the active (non-category) filters."""
    qs = DailySchoolTotal.objects.filter(
        date__gte=filters.date_from, date__lte=filters.date_to
    )
    if filters.city_id:
        qs = qs.filter(city_id=filters.city_id)
    if filters.school_id:
        qs = qs.filter(school_id=filters.school_id)
    return qs


def _product_qs(filters: BossFilters):
    qs = DailyProductSummary.objects.filter(
        date__gte=filters.date_from, date__lte=filters.date_to
    )
    if filters.city_id:
        qs = qs.filter(city_id=filters.city_id)
    if filters.school_id:
        qs = qs.filter(school_id=filters.school_id)
    if filters.category_id:
        qs = qs.filter(category_id=filters.category_id)
    return qs


def exact_order_count(filters: BossFilters) -> int:
    """
    Exact distinct-order count for the current scope.

    Without a category filter the school-day rollup is exact (each order
    belongs to exactly one school). With a category filter the per-category
    rollup counts the distinct orders that touched that category, which is
    the right number for that cut.
    """
    if filters.category_id:
        rows = _sales_qs(filters).aggregate(orders=Sum("orders"))
    else:
        rows = _school_total_qs(filters).aggregate(orders=Sum("orders"))
    return int(rows["orders"] or 0)


def money_totals(filters: BossFilters) -> dict:
    """Revenue, cost, units over DailySalesSummary (amounts never double count)."""
    rows = _sales_qs(filters).aggregate(
        revenue=Sum("revenue"), cost=Sum("cost"), units=Sum("units")
    )
    revenue = rows["revenue"] or ZERO
    cost = rows["cost"] or ZERO
    return {
        "revenue": revenue,
        "cost": cost,
        "units": int(rows["units"] or 0),
    }


def gross_profit(revenue: Decimal, cost: Decimal) -> Decimal:
    """Profit = sum of (unit_price_snapshot - unit_cost_snapshot) x quantity."""
    return revenue - cost


def gross_margin_pct(revenue: Decimal, cost: Decimal) -> Decimal:
    """Gross margin = profit / revenue, as a percentage."""
    if not revenue:
        return Decimal("0.0")
    return ((revenue - cost) / revenue * Decimal("100")).quantize(Decimal("0.1"))


# --------------------------------------------------------------------------- #
# Stock value (one aggregate over variants, cached for a few minutes)
# --------------------------------------------------------------------------- #
def stock_value(city_id: str = "") -> Decimal:
    """
    Value of the stock currently on hand: SUM(stock_quantity x cost_price)
    over every city/variant balance. Cached separately because it ignores
    the date range and changes only on checkout / restock.
    """
    key = f"boss:stock-value:{city_id or 'all'}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    qs = StockBalance.objects.all()
    if city_id:
        qs = qs.filter(city_id=city_id)
    rows = qs.aggregate(
        value=Sum(F("stock_quantity") * F("variant__product__cost_price"))
    )
    value = (rows["value"] or Decimal("0")).quantize(Decimal("0.01"))
    cache.set(key, value, timeout=settings.BOSS_STOCK_VALUE_CACHE_TTL)
    return value


# --------------------------------------------------------------------------- #
# KPI cards (requirement 1) - one endpoint, one small response
# --------------------------------------------------------------------------- #
def kpi_payload(filters: BossFilters) -> dict:
    totals = money_totals(filters)
    revenue, cost = totals["revenue"], totals["cost"]
    profit = gross_profit(revenue, cost)
    return {
        "filters": filters.as_dict(),
        "revenue": revenue,
        "cost": cost,
        "profit": profit,
        "margin_pct": gross_margin_pct(revenue, cost),
        "orders": exact_order_count(filters),
        "units": totals["units"],
        "stock_value": stock_value(filters.city_id),
    }


# --------------------------------------------------------------------------- #
# Charts (requirement 2) - each returns only its aggregated points
# --------------------------------------------------------------------------- #
def revenue_trend(filters: BossFilters) -> list[dict]:
    """Revenue and profit per day for the trend chart."""
    rows = (
        _sales_qs(filters)
        .values("date")
        .annotate(revenue=Sum("revenue"), cost=Sum("cost"))
        .order_by("date")[:TREND_POINT_CAP]
    )
    return [
        {
            "date": row["date"].isoformat(),
            "revenue": row["revenue"] or ZERO,
            "cost": row["cost"] or ZERO,
            "profit": gross_profit(row["revenue"] or ZERO, row["cost"] or ZERO),
        }
        for row in rows
    ]


def sales_by_category(filters: BossFilters) -> list[dict]:
    # Aggregate on the raw FK only (pure index-only scan on the rollup);
    # names are resolved afterwards from the tiny Category table.
    rows = (
        _sales_qs(filters)
        .values("category_id")
        .annotate(revenue=Sum("revenue"), cost=Sum("cost"), units=Sum("units"))
        .order_by("-revenue")
    )
    names = _category_names(row["category_id"] for row in rows)
    return [
        {
            "category_id": row["category_id"],
            "category": names.get(row["category_id"], ""),
            "revenue": row["revenue"] or ZERO,
            "cost": row["cost"] or ZERO,
            "profit": gross_profit(row["revenue"] or ZERO, row["cost"] or ZERO),
            "units": int(row["units"] or 0),
        }
        for row in rows
    ]


def sales_by_city(filters: BossFilters) -> list[dict]:
    rows = (
        _sales_qs(filters)
        .values("city_id")
        .annotate(revenue=Sum("revenue"), cost=Sum("cost"), units=Sum("units"))
        .order_by("-revenue")
    )
    names = _city_names(row["city_id"] for row in rows)
    return [
        {
            "city_id": row["city_id"],
            "city": names.get(row["city_id"], ""),
            "revenue": row["revenue"] or ZERO,
            "cost": row["cost"] or ZERO,
            "profit": gross_profit(row["revenue"] or ZERO, row["cost"] or ZERO),
            "units": int(row["units"] or 0),
        }
        for row in rows
    ]


def top_schools(filters: BossFilters, limit: int = TOP_N_LIMIT) -> list[dict]:
    rows = (
        _sales_qs(filters)
        .values("school_id")
        .annotate(revenue=Sum("revenue"), units=Sum("units"))
        .order_by("-revenue")[:limit]
    )
    rows = list(rows)
    names = _school_names(row["school_id"] for row in rows)
    return [
        {
            "school_id": row["school_id"],
            "school": names.get(row["school_id"], ("", ""))[0],
            "code": names.get(row["school_id"], ("", ""))[1],
            "revenue": row["revenue"] or ZERO,
            "units": int(row["units"] or 0),
        }
        for row in rows
    ]


def top_products(filters: BossFilters, limit: int = TOP_N_LIMIT) -> list[dict]:
    """Reads DailyProductSummary - never the order tables."""
    rows = (
        _product_qs(filters)
        .values("product_id")
        .annotate(units=Sum("units"), revenue=Sum("revenue"))
        .order_by("-units")[:limit]
    )
    rows = list(rows)
    names = _product_names(row["product_id"] for row in rows)
    return [
        {
            "product_id": row["product_id"],
            "product": names.get(row["product_id"], ""),
            "units": int(row["units"] or 0),
            "revenue": row["revenue"] or ZERO,
        }
        for row in rows
    ]


def _category_names(ids) -> dict:
    from catalog.models import Category

    ids = [pk for pk in set(ids) if pk]
    if not ids:
        return {}
    return {pk: name for pk, name in Category.objects.filter(id__in=ids).values_list("id", "name")}


def _city_names(ids) -> dict:
    from schools.models import City

    ids = [pk for pk in set(ids) if pk]
    if not ids:
        return {}
    return {pk: name for pk, name in City.objects.filter(id__in=ids).values_list("id", "name")}


def _school_names(ids) -> dict:
    from schools.models import School

    ids = [pk for pk in set(ids) if pk]
    if not ids:
        return {}
    return {
        pk: (name, code)
        for pk, name, code in School.objects.filter(id__in=ids).values_list("id", "name", "code")
    }


def _product_names(ids) -> dict:
    from catalog.models import Product

    ids = [pk for pk in set(ids) if pk]
    if not ids:
        return {}
    return {pk: name for pk, name in Product.objects.filter(id__in=ids).values_list("id", "name")}


def stock_by_category(filters: BossFilters) -> list[dict]:
    """
    Current stock level per category from StockBalance (never the order
    tables). Stock lives per city, so the school filter narrows to the
    school's city; the date range does not apply to a snapshot.
    """
    qs = StockBalance.objects.all()
    if filters.city_id:
        qs = qs.filter(city_id=filters.city_id)
    elif filters.school_id:
        qs = qs.filter(school_city_via_school(filters.school_id))
    if filters.category_id:
        qs = qs.filter(variant__product__category_id=filters.category_id)
    rows = (
        qs.values("variant__product__category_id", "variant__product__category__name")
        .annotate(
            units=Sum("stock_quantity"),
            value=Sum(F("stock_quantity") * F("variant__product__cost_price")),
        )
        .order_by("-units")
    )
    return [
        {
            "category_id": row["variant__product__category_id"],
            "category": row["variant__product__category__name"],
            "units": int(row["units"] or 0),
            "value": (row["value"] or Decimal("0")).quantize(Decimal("0.01")),
        }
        for row in rows
    ]


def school_city_via_school(school_id: str):
    """Build `city_id=<city of that school>` without a join in the main query."""
    from django.db.models import Q

    from schools.models import School

    city_id = (
        School.objects.filter(id=school_id).values_list("city_id", flat=True).first()
    )
    return Q(city_id=city_id) if city_id else Q(pk=None)


# --------------------------------------------------------------------------- #
# Filter options for the dropdowns
# --------------------------------------------------------------------------- #
def filter_options() -> dict:
    from catalog.models import Category
    from schools.models import City, School

    cities = list(City.objects.filter(active=True).order_by("name").values("id", "name"))
    schools = list(
        School.objects.filter(active=True)
        .order_by("name")
        .values("id", "name", "code", "city_id")
    )
    categories = list(Category.objects.filter(active=True).order_by("name").values("id", "name"))
    today = timezone.localdate()
    return {
        "cities": cities,
        "schools": schools,
        "categories": categories,
        "default_date_from": (today - dt.timedelta(days=29)).isoformat(),
        "default_date_to": today.isoformat(),
    }


# --------------------------------------------------------------------------- #
# Response caching (requirement 6)
# --------------------------------------------------------------------------- #
def cached_dashboard(namespace: str, filters: BossFilters, producer) -> dict:
    """
    One Redis entry per endpoint x filter combination, 60-second TTL.

    `producer` returns the payload dict; it runs only on a cache miss, so a
    busy dashboard costs the database at most one aggregate query per minute
    per filter combination.
    """
    key = filters.cache_key(namespace)
    payload = cache.get(key)
    if payload is None:
        payload = producer()
        cache.set(key, payload, timeout=settings.BOSS_DASHBOARD_CACHE_TTL)
    return payload
