"""
Sales rollup engine (Rule P5: rollups run in a Celery worker, never on the
request path; the School Admin dashboard only ever reads these tables).

One SQL pass produces BOTH grains:

  * per (date, school, category) -> DailySalesSummary   (category breakdown)
  * per (date, school)           -> DailySchoolTotal    (headline totals)

`GROUPING SETS` gives us both grains from a single scan of the order-item
join, with `COUNT(DISTINCT o.id)` computed at the right grain so the
school-day order count is exact (summing the per-category counts would
double count an order that spans two categories).
"""

import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection

from .models import DailyProductTotal, DailySalesSummary, DailySchoolTotal

# Statuses that must never appear in revenue reporting.
EXCLUDED_STATUSES = ("CANCELLED", "REFUNDED")

# Order numbers made by the seed and load-test scripts (seed_data, seed_perf_orders,
# the old DEMO generator). They are sample data, never sales, so no dashboard counts them.
SAMPLE_ORDER_PREFIXES = ("ORD-SEED-", "ORD-PERF-", "DEMO")
# The same rule inside the raw SQL; %% is a literal % once the query is given its parameters.
_SAMPLE_ORDER_SQL = " ".join(
    f"AND o.order_number NOT LIKE '{prefix}%%'" for prefix in SAMPLE_ORDER_PREFIXES
)


def _day_bounds(target_date: date) -> tuple[datetime, datetime]:
    local_tz = ZoneInfo(settings.TIME_ZONE)
    start = datetime.combine(target_date, time.min, tzinfo=local_tz)
    return start, start + timedelta(days=1)


def _rollup_sql(where_clause: str) -> str:
    """
    GROUP BY GROUPING SETS ((day, city, school, category), (day, city, school))

    Rows whose `category_id` is NULL are the school-day grain.
    """
    return f"""
        SELECT
            (o.created_at AT TIME ZONE %s::text)::date AS sale_date,
            o.city_id,
            o.school_id,
            oi.category_id,
            COUNT(DISTINCT o.id) AS orders_count,
            COALESCE(SUM(oi.quantity), 0) AS units_sum,
            COALESCE(SUM(oi.quantity * oi.unit_price_snapshot), 0) AS revenue_sum,
            COALESCE(SUM(oi.quantity * oi.unit_cost_snapshot), 0) AS cost_sum
        FROM orders_order o
        INNER JOIN orders_orderitem oi ON oi.order_id = o.id
        WHERE o.status NOT IN ('CANCELLED', 'REFUNDED')
        {_SAMPLE_ORDER_SQL}
        {where_clause}
        GROUP BY GROUPING SETS (
            (
                (o.created_at AT TIME ZONE %s::text)::date,
                o.city_id,
                o.school_id,
                oi.category_id
            ),
            (
                (o.created_at AT TIME ZONE %s::text)::date,
                o.city_id,
                o.school_id
            )
        )
    """


def _product_rollup_sql(where_clause: str) -> str:
    """
    Rollup aggregated by (sale_date, product_id, category_id, school_id, city_id)
    for top products summary.
    """
    return f"""
        SELECT
            (o.created_at AT TIME ZONE %s::text)::date AS sale_date,
            pv.product_id,
            oi.category_id,
            o.school_id,
            o.city_id,
            COALESCE(SUM(oi.quantity), 0) AS units_sum,
            COALESCE(SUM(oi.quantity * oi.unit_price_snapshot), 0) AS revenue_sum,
            COALESCE(SUM(oi.quantity * oi.unit_cost_snapshot), 0) AS cost_sum
        FROM orders_order o
        INNER JOIN orders_orderitem oi ON oi.order_id = o.id
        INNER JOIN catalog_productvariant pv ON pv.id = oi.variant_id
        WHERE o.status NOT IN ('CANCELLED', 'REFUNDED')
        {_SAMPLE_ORDER_SQL}
        {where_clause}
        GROUP BY
            (o.created_at AT TIME ZONE %s::text)::date,
            pv.product_id,
            oi.category_id,
            o.school_id,
            o.city_id
    """


def _orm_rollup_rows(target_date: date | None) -> tuple[list[tuple], list[tuple]]:
    """
    The rollup rows in the same tuple shapes as the Postgres SQL, built with the
    ORM for databases without GROUPING SETS.
    """
    from django.db.models import Count, DecimalField, ExpressionWrapper, F, Sum
    from django.db.models.functions import TruncDate

    from orders.models import OrderItem

    local_tz = ZoneInfo(settings.TIME_ZONE)
    items = OrderItem.objects.exclude(order__status__in=EXCLUDED_STATUSES)
    for prefix in SAMPLE_ORDER_PREFIXES:
        items = items.exclude(order__order_number__startswith=prefix)
    if target_date is not None:
        start, end = _day_bounds(target_date)
        items = items.filter(order__created_at__gte=start, order__created_at__lt=end)
    items = items.annotate(sale_date=TruncDate("order__created_at", tzinfo=local_tz))

    money = DecimalField(max_digits=16, decimal_places=2)
    revenue = Sum(ExpressionWrapper(F("quantity") * F("unit_price_snapshot"), output_field=money))
    cost = Sum(ExpressionWrapper(F("quantity") * F("unit_cost_snapshot"), output_field=money))

    def grain(*keys):
        return items.values("sale_date", "order__city_id", "order__school_id", *keys).annotate(
            orders_count=Count("order_id", distinct=True),
            units_sum=Sum("quantity"),
            revenue_sum=revenue,
            cost_sum=cost,
        ).order_by()

    rows: list[tuple] = []
    for r in grain("category_id"):
        rows.append((r["sale_date"], r["order__city_id"], r["order__school_id"], r["category_id"],
                     r["orders_count"], r["units_sum"] or 0, r["revenue_sum"] or 0, r["cost_sum"] or 0))
    for r in grain():
        rows.append((r["sale_date"], r["order__city_id"], r["order__school_id"], None,
                     r["orders_count"], r["units_sum"] or 0, r["revenue_sum"] or 0, r["cost_sum"] or 0))

    prod_rows = [
        (r["sale_date"], r["variant__product_id"], r["category_id"], r["order__school_id"],
         r["order__city_id"], r["units_sum"] or 0, r["revenue_sum"] or 0, r["cost_sum"] or 0)
        for r in items.values(
            "sale_date", "variant__product_id", "category_id", "order__school_id", "order__city_id"
        ).annotate(units_sum=Sum("quantity"), revenue_sum=revenue, cost_sum=cost).order_by()
    ]
    return rows, prod_rows


def rollup_sales(target_date: date | None = None) -> dict:
    """
    Rebuild summary tables:
    * DailySalesSummary (date, school, category)
    * DailySchoolTotal  (date, school)
    * DailyProductTotal (date, product, school)

    * `target_date is None` -> full rebuild (used by backfill command).
    * otherwise           -> just that local calendar day.

    Returns the number of rows written per grain.
    """
    where_clause = ""
    params: list = [settings.TIME_ZONE]
    prod_params: list = [settings.TIME_ZONE]
    if target_date is not None:
        start, end = _day_bounds(target_date)
        where_clause = "AND o.created_at >= %s AND o.created_at < %s"
        params.extend([start, end])
        prod_params.extend([start, end])
    # The two grouping sets repeat the timezone conversion, so it is bound twice.
    params.extend([settings.TIME_ZONE, settings.TIME_ZONE])
    prod_params.append(settings.TIME_ZONE)

    if connection.vendor == "postgresql":
        sql = _rollup_sql(where_clause)
        prod_sql = _product_rollup_sql(where_clause)

        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()

            cursor.execute(prod_sql, prod_params)
            prod_rows = cursor.fetchall()
    else:
        # Other databases (SQLite in local mode) used to skip the rollup, so every
        # dashboard read zero there. The ORM builds the same rows, just slower.
        rows, prod_rows = _orm_rollup_rows(target_date)

    category_rows: list[DailySalesSummary] = []
    school_rows: list[DailySchoolTotal] = []
    for (
        sale_date,
        city_id,
        school_id,
        category_id,
        orders_count,
        units_sum,
        revenue_sum,
        cost_sum,
    ) in rows:
        if category_id is None:
            school_rows.append(
                DailySchoolTotal(
                    id=uuid.uuid4(),
                    date=sale_date,
                    city_id=city_id,
                    school_id=school_id,
                    orders=orders_count,
                    units=units_sum,
                    revenue=revenue_sum,
                    cost=cost_sum,
                )
            )
        else:
            category_rows.append(
                DailySalesSummary(
                    id=uuid.uuid4(),
                    date=sale_date,
                    city_id=city_id,
                    school_id=school_id,
                    category_id=category_id,
                    orders=orders_count,
                    units=units_sum,
                    revenue=revenue_sum,
                    cost=cost_sum,
                )
            )

    product_rows: list[DailyProductTotal] = [
        DailyProductTotal(
            id=uuid.uuid4(),
            date=p_date,
            product_id=p_id,
            category_id=c_id,
            school_id=s_id,
            city_id=ct_id,
            units=p_units,
            revenue=p_rev,
            cost=p_cost,
        )
        for (
            p_date,
            p_id,
            c_id,
            s_id,
            ct_id,
            p_units,
            p_rev,
            p_cost,
        ) in prod_rows
    ]

    if category_rows:
        DailySalesSummary.objects.bulk_create(
            category_rows,
            batch_size=500,
            update_conflicts=True,
            update_fields=("city", "orders", "units", "revenue", "cost"),
            unique_fields=("date", "school", "category"),
        )
    if school_rows:
        DailySchoolTotal.objects.bulk_create(
            school_rows,
            batch_size=500,
            update_conflicts=True,
            update_fields=("city", "orders", "units", "revenue", "cost"),
            unique_fields=("date", "school"),
        )
    if product_rows:
        DailyProductTotal.objects.bulk_create(
            product_rows,
            batch_size=500,
            update_conflicts=True,
            update_fields=("units", "revenue", "cost", "category", "city"),
            unique_fields=("date", "product", "school"),
        )

    return {
        "category_rows": len(category_rows),
        "school_rows": len(school_rows),
        "product_rows": len(product_rows),
    }


def delete_summaries(target_date: date | None = None) -> None:
    """Drop rollup rows for one day (or everything) before a rebuild."""
    if target_date is None:
        DailySalesSummary.objects.all().delete()
        DailySchoolTotal.objects.all().delete()
        DailyProductTotal.objects.all().delete()
        return
    DailySalesSummary.objects.filter(date=target_date).delete()
    DailySchoolTotal.objects.filter(date=target_date).delete()
    DailyProductTotal.objects.filter(date=target_date).delete()


def refresh_sales_summary(target_date: date | None = None) -> dict:
    """
    Refresh (not rebuild) the rollups for one day.

    Days whose orders were cancelled after the fact keep a zero row rather
    than a stale one, so the caller deletes the day first.
    """
    if target_date is not None:
        delete_summaries(target_date)
    return rollup_sales(target_date)
