import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from celery import shared_task
from django.conf import settings
from django.db import connection

from .models import DailySalesSummary


@shared_task
def refresh_daily_sales_summary(target_date_iso: str | None = None) -> int:
    """Refresh dashboard rollups off the request path using application UUIDs."""
    where_clause = ""
    params = [settings.TIME_ZONE]
    if target_date_iso:
        target_date = date.fromisoformat(target_date_iso)
        local_tz = ZoneInfo(settings.TIME_ZONE)
        start = datetime.combine(target_date, time.min, tzinfo=local_tz)
        end = start + timedelta(days=1)
        where_clause = "AND o.created_at >= %s AND o.created_at < %s"
        params.extend([start, end])

    sql = f"""
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
        GROUP BY sale_date, o.city_id, o.school_id, oi.category_id
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()

    summaries = [
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
        for (
            sale_date,
            city_id,
            school_id,
            category_id,
            orders_count,
            units_sum,
            revenue_sum,
            cost_sum,
        ) in rows
    ]
    if summaries:
        DailySalesSummary.objects.bulk_create(
            summaries,
            batch_size=500,
            update_conflicts=True,
            update_fields=("city", "orders", "units", "revenue", "cost"),
            unique_fields=("date", "school", "category"),
        )
    return len(summaries)
