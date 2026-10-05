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

from .models import DailySalesSummary, DailySchoolTotal

# Statuses that must never appear in revenue reporting.
EXCLUDED_STATUSES = ("CANCELLED", "REFUNDED")


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


def rollup_sales(target_date: date | None = None) -> dict:
    """
    Rebuild both summary tables.

    * `target_date is None` -> full rebuild (used by the seed commands).
    * otherwise           -> just that local calendar day.

    Returns the number of rows written per grain.
    """
    where_clause = ""
    params: list = [settings.TIME_ZONE]
    if target_date is not None:
        start, end = _day_bounds(target_date)
        where_clause = "AND o.created_at >= %s AND o.created_at < %s"
        params.extend([start, end])
    # The two grouping sets repeat the timezone conversion, so it is bound twice.
    params.extend([settings.TIME_ZONE, settings.TIME_ZONE])

    sql = _rollup_sql(where_clause)
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()

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

    return {
        "category_rows": len(category_rows),
        "school_rows": len(school_rows),
    }


def delete_summaries(target_date: date | None = None) -> None:
    """Drop rollup rows for one day (or everything) before a rebuild."""
    if target_date is None:
        DailySalesSummary.objects.all().delete()
        DailySchoolTotal.objects.all().delete()
        return
    DailySalesSummary.objects.filter(date=target_date).delete()
    DailySchoolTotal.objects.filter(date=target_date).delete()


def refresh_sales_summary(target_date: date | None = None) -> dict:
    """
    Refresh (not rebuild) the rollups for one day.

    Days whose orders were cancelled after the fact keep a zero row rather
    than a stale one, so the caller deletes the day first.
    """
    if target_date is not None:
        delete_summaries(target_date)
    return rollup_sales(target_date)
