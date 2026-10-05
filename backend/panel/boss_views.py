"""
Boss Panel Read & Analytics Layer.

Enforces:
1. One KPI endpoint returning all KPI cards in one small response.
2. Separate chart endpoints returning aggregated points (tens of rows, never raw orders).
3. Reads strictly from DailySalesSummary, DailySchoolTotal, and DailyProductTotal.
   NEVER scans Order or OrderItem.
4. Redis caching: 60 seconds for dashboard & chart endpoints, keyed by filter parameters;
   stock value cached for a few minutes.
5. Profit = (revenue - cost). Gross Margin % = (profit / revenue) * 100.
6. Boss-only permission checking.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
import hashlib
import json

from django.core.cache import cache
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from analytics.models import DailyProductTotal, DailySalesSummary, DailySchoolTotal
from catalog.models import Category, Product
from common.permissions import RoleScopedPermission
from inventory.models import StockBalance
from schools.models import City, School


def _boss_cache_key(prefix: str, params: dict) -> str:
    """Generate deterministic MD5 cache key from sorted query filters."""
    normalized = sorted([(k, str(v)) for k, v in params.items() if v not in (None, "")])
    payload = json.dumps(normalized, sort_keys=True)
    digest = hashlib.md5(payload.encode("utf-8")).hexdigest()
    return f"boss_panel:{prefix}:{digest}"


def _parse_boss_filters(request) -> tuple[dt.date, dt.date, str | None, str | None, str | None]:
    """Parse and validate date range, city, school, and category filters."""
    user = request.user
    if not (user and user.is_authenticated and (user.role == "BOSS" or getattr(user, "is_superuser", False))):
        raise PermissionDenied("Only the Boss has access to the executive business panel.")

    today = timezone.localdate()
    from_param = request.query_params.get("date_from") or request.query_params.get("from")
    to_param = request.query_params.get("date_to") or request.query_params.get("to")

    try:
        date_from = dt.date.fromisoformat(from_param) if from_param else today - dt.timedelta(days=30)
        date_to = dt.date.fromisoformat(to_param) if to_param else today
    except ValueError:
        raise ValidationError({"date": "Dates must be in YYYY-MM-DD format."})

    if date_from > date_to:
        raise ValidationError({"date": "date_from cannot be after date_to."})

    city_id = request.query_params.get("city")
    school_id = request.query_params.get("school")
    category_id = request.query_params.get("category")

    return date_from, date_to, city_id, school_id, category_id


def _get_stock_value(city_id: str | None = None, category_id: str | None = None) -> Decimal:
    """
    Requirement 7: Stock value is a single aggregate over variants (stock x cost),
    cached for a few minutes (180 seconds).
    """
    cache_key = f"boss_panel:stock_val:{city_id or 'all'}:{category_id or 'all'}"
    cached = cache.get(cache_key)
    if cached is not None:
        return Decimal(str(cached))

    qs = StockBalance.objects.select_related("variant__product")
    if city_id:
        qs = qs.filter(city_id=city_id)
    if category_id:
        qs = qs.filter(variant__product__category_id=category_id)

    agg = qs.aggregate(
        total_value=Sum(F("stock_quantity") * F("variant__product__cost_price"))
    )
    val = agg["total_value"] or Decimal("0.00")
    cache.set(cache_key, str(val), timeout=180)
    return val


# =========================================================================== #
# 1. KPI Cards Endpoint (Requirement 1, 4, 6)
# =========================================================================== #
class BossKpisView(APIView):
    """
    One dashboard endpoint returning all KPI cards in one small response:
    - revenue, cost, gross profit, gross margin %, orders, units sold, current stock value.
    Reads strictly from DailySchoolTotal / DailySalesSummary. Cached in Redis for 60s.
    """

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        date_from, date_to, city_id, school_id, category_id = _parse_boss_filters(request)

        params_dict = {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "city": city_id,
            "school": school_id,
            "category": category_id,
        }
        cache_key = _boss_cache_key("kpis", params_dict)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        # If filtered by category, we must read from DailySalesSummary.
        # If not filtered by category, distinct orders count comes from DailySchoolTotal.
        if category_id:
            qs = DailySalesSummary.objects.filter(
                date__gte=date_from, date__lte=date_to, category_id=category_id
            )
            if city_id:
                qs = qs.filter(city_id=city_id)
            if school_id:
                qs = qs.filter(school_id=school_id)

            agg = qs.aggregate(
                orders=Sum("orders"),
                units=Sum("units"),
                revenue=Sum("revenue"),
                cost=Sum("cost"),
            )
        else:
            qs = DailySchoolTotal.objects.filter(date__gte=date_from, date__lte=date_to)
            if city_id:
                qs = qs.filter(city_id=city_id)
            if school_id:
                qs = qs.filter(school_id=school_id)

            agg = qs.aggregate(
                orders=Sum("orders"),
                units=Sum("units"),
                revenue=Sum("revenue"),
                cost=Sum("cost"),
            )

        orders = int(agg["orders"] or 0)
        units = int(agg["units"] or 0)
        revenue = agg["revenue"] or Decimal("0.00")
        cost = agg["cost"] or Decimal("0.00")
        gross_profit = revenue - cost
        margin_pct = (
            ((gross_profit / revenue) * 100).quantize(Decimal("0.1"))
            if revenue > 0
            else Decimal("0.0")
        )

        stock_val = _get_stock_value(city_id=city_id, category_id=category_id)

        data = {
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "revenue": str(revenue),
            "cost": str(cost),
            "gross_profit": str(gross_profit),
            "gross_margin_pct": str(margin_pct),
            "orders": orders,
            "units_sold": units,
            "current_stock_value": str(stock_val),
        }

        cache.set(cache_key, data, timeout=60)
        return Response(data)


# =========================================================================== #
# 2. Charts Endpoints (Requirement 2 & 6: Cached 60s, tens of rows)
# =========================================================================== #
class BossRevenueProfitTimeView(APIView):
    """Chart: revenue and profit over time by day."""

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        date_from, date_to, city_id, school_id, category_id = _parse_boss_filters(request)
        params_dict = {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "city": city_id,
            "school": school_id,
            "category": category_id,
        }
        cache_key = _boss_cache_key("chart_rev_profit", params_dict)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        # Query DailySalesSummary or DailySchoolTotal grouped by date
        if category_id:
            qs = DailySalesSummary.objects.filter(
                date__gte=date_from, date__lte=date_to, category_id=category_id
            )
        else:
            qs = DailySchoolTotal.objects.filter(date__gte=date_from, date__lte=date_to)

        if city_id:
            qs = qs.filter(city_id=city_id)
        if school_id:
            qs = qs.filter(school_id=school_id)

        rows = (
            qs.values("date")
            .annotate(
                rev=Sum("revenue"),
                cst=Sum("cost"),
                ord=Sum("orders"),
                unt=Sum("units"),
            )
            .order_by("date")
        )

        points = []
        for r in rows:
            rev = r["rev"] or Decimal("0.00")
            cst = r["cst"] or Decimal("0.00")
            profit = rev - cst
            points.append({
                "date": r["date"].isoformat(),
                "revenue": str(rev),
                "cost": str(cst),
                "profit": str(profit),
                "orders": r["ord"] or 0,
                "units": r["unt"] or 0,
            })

        cache.set(cache_key, points, timeout=60)
        return Response(points)


class BossCategorySalesView(APIView):
    """Chart: sales by category."""

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        date_from, date_to, city_id, school_id, category_id = _parse_boss_filters(request)
        params_dict = {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "city": city_id,
            "school": school_id,
            "category": category_id,
        }
        cache_key = _boss_cache_key("chart_cat_sales", params_dict)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        qs = DailySalesSummary.objects.filter(date__gte=date_from, date__lte=date_to)
        if city_id:
            qs = qs.filter(city_id=city_id)
        if school_id:
            qs = qs.filter(school_id=school_id)
        if category_id:
            qs = qs.filter(category_id=category_id)

        rows = (
            qs.values("category_id", "category__name")
            .annotate(
                revenue=Sum("revenue"),
                cost=Sum("cost"),
                units=Sum("units"),
                orders=Sum("orders"),
            )
            .order_by("-revenue")
        )

        points = []
        for r in rows:
            rev = r["revenue"] or Decimal("0.00")
            cst = r["cost"] or Decimal("0.00")
            points.append({
                "category_id": str(r["category_id"]),
                "name": r["category__name"],
                "revenue": str(rev),
                "cost": str(cst),
                "profit": str(rev - cst),
                "units": r["units"] or 0,
                "orders": r["orders"] or 0,
            })

        cache.set(cache_key, points, timeout=60)
        return Response(points)


class BossCitySalesView(APIView):
    """Chart: sales by city."""

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        date_from, date_to, city_id, school_id, category_id = _parse_boss_filters(request)
        params_dict = {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "city": city_id,
            "school": school_id,
            "category": category_id,
        }
        cache_key = _boss_cache_key("chart_city_sales", params_dict)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        if category_id:
            qs = DailySalesSummary.objects.filter(
                date__gte=date_from, date__lte=date_to, category_id=category_id
            )
        else:
            qs = DailySchoolTotal.objects.filter(date__gte=date_from, date__lte=date_to)

        if city_id:
            qs = qs.filter(city_id=city_id)
        if school_id:
            qs = qs.filter(school_id=school_id)

        rows = (
            qs.values("city_id", "city__name", "city__code")
            .annotate(
                revenue=Sum("revenue"),
                cost=Sum("cost"),
                units=Sum("units"),
                orders=Sum("orders"),
            )
            .order_by("-revenue")
        )

        points = []
        for r in rows:
            rev = r["revenue"] or Decimal("0.00")
            cst = r["cost"] or Decimal("0.00")
            points.append({
                "city_id": str(r["city_id"]),
                "name": r["city__name"],
                "code": r["city__code"],
                "revenue": str(rev),
                "cost": str(cst),
                "profit": str(rev - cst),
                "units": r["units"] or 0,
                "orders": r["orders"] or 0,
            })

        cache.set(cache_key, points, timeout=60)
        return Response(points)


class BossTopSchoolsView(APIView):
    """Chart: top schools by revenue."""

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        date_from, date_to, city_id, school_id, category_id = _parse_boss_filters(request)
        params_dict = {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "city": city_id,
            "school": school_id,
            "category": category_id,
        }
        cache_key = _boss_cache_key("chart_top_schools", params_dict)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        if category_id:
            qs = DailySalesSummary.objects.filter(
                date__gte=date_from, date__lte=date_to, category_id=category_id
            )
        else:
            qs = DailySchoolTotal.objects.filter(date__gte=date_from, date__lte=date_to)

        if city_id:
            qs = qs.filter(city_id=city_id)
        if school_id:
            qs = qs.filter(school_id=school_id)

        rows = (
            qs.values("school_id", "school__name", "school__code")
            .annotate(
                revenue=Sum("revenue"),
                cost=Sum("cost"),
                units=Sum("units"),
                orders=Sum("orders"),
            )
            .order_by("-revenue")[:15]
        )

        points = []
        for r in rows:
            rev = r["revenue"] or Decimal("0.00")
            cst = r["cost"] or Decimal("0.00")
            points.append({
                "school_id": str(r["school_id"]),
                "name": r["school__name"],
                "code": r["school__code"],
                "revenue": str(rev),
                "cost": str(cst),
                "profit": str(rev - cst),
                "units": r["units"] or 0,
                "orders": r["orders"] or 0,
            })

        cache.set(cache_key, points, timeout=60)
        return Response(points)


class BossTopProductsView(APIView):
    """
    Chart: top products by units sold.
    Requirement 5: Reads from DailyProductTotal summary table keyed by (date, product).
    """

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        date_from, date_to, city_id, school_id, category_id = _parse_boss_filters(request)
        params_dict = {
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "city": city_id,
            "school": school_id,
            "category": category_id,
        }
        cache_key = _boss_cache_key("chart_top_products", params_dict)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        qs = DailyProductTotal.objects.filter(date__gte=date_from, date__lte=date_to)
        if city_id:
            qs = qs.filter(city_id=city_id)
        if school_id:
            qs = qs.filter(school_id=school_id)
        if category_id:
            qs = qs.filter(category_id=category_id)

        rows = (
            qs.values("product_id", "product__name", "category__name")
            .annotate(
                units=Sum("units"),
                revenue=Sum("revenue"),
                cost=Sum("cost"),
            )
            .order_by("-units")[:15]
        )

        points = []
        for r in rows:
            rev = r["revenue"] or Decimal("0.00")
            cst = r["cost"] or Decimal("0.00")
            points.append({
                "product_id": str(r["product_id"]),
                "name": r["product__name"],
                "category": r["category__name"],
                "units": r["units"] or 0,
                "revenue": str(rev),
                "profit": str(rev - cst),
            })

        cache.set(cache_key, points, timeout=60)
        return Response(points)


class BossStockCategoryView(APIView):
    """Chart: stock level by category (total on-hand units and stock value)."""

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        date_from, date_to, city_id, school_id, category_id = _parse_boss_filters(request)
        cache_key = f"boss_panel:chart_stock_cat:{city_id or 'all'}:{category_id or 'all'}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        qs = StockBalance.objects.select_related("variant__product__category")
        if city_id:
            qs = qs.filter(city_id=city_id)
        if category_id:
            qs = qs.filter(variant__product__category_id=category_id)

        rows = (
            qs.values("variant__product__category_id", "variant__product__category__name")
            .annotate(
                total_units=Sum("stock_quantity"),
                total_value=Sum(F("stock_quantity") * F("variant__product__cost_price")),
            )
            .order_by("-total_units")
        )

        points = [
            {
                "category_id": str(r["variant__product__category_id"]),
                "name": r["variant__product__category__name"] or "Uncategorized",
                "units": r["total_units"] or 0,
                "stock_value": str(r["total_value"] or Decimal("0.00")),
            }
            for r in rows
        ]

        cache.set(cache_key, points, timeout=60)
        return Response(points)


class BossFilterOptionsView(APIView):
    """Dropdown options for Boss panel filters (cities, schools, categories)."""

    permission_classes = [RoleScopedPermission]

    def get(self, request):
        user = request.user
        if not (user and user.is_authenticated and (user.role == "BOSS" or getattr(user, "is_superuser", False))):
            raise PermissionDenied("Only the Boss has access.")

        cities = list(City.objects.filter(active=True).values("id", "name", "code").order_by("name"))
        schools = list(School.objects.filter(active=True).values("id", "name", "code", "city_id").order_by("name"))
        categories = list(Category.objects.filter(active=True).values("id", "name", "slug").order_by("name"))

        today = timezone.localdate()
        return Response({
            "cities": cities,
            "schools": schools,
            "categories": categories,
            "default_from": (today - dt.timedelta(days=30)).isoformat(),
            "default_to": today.isoformat(),
        })
