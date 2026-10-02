from datetime import date
from celery import shared_task
from django.db import connection


@shared_task
def refresh_daily_sales_summary(target_date_iso: str | None = None) -> int:
    """
    Background job (Rule P5) to aggregate DailySalesSummary rows from Orders/OrderItems.
    Uses a single indexed SQL UPSERT (ON CONFLICT DO UPDATE) for O(log N) speed.
    """
    where_clause = ""
    params = []
    if target_date_iso:
        where_clause = "AND DATE(o.created_at) = %s"
        params.append(date.fromisoformat(target_date_iso))

    sql = f"""
        INSERT INTO analytics_dailysalessummary
            (id, date, city_id, school_id, category_id, orders, units, revenue, cost)
        SELECT
            gen_random_uuid(),
            DATE(o.created_at) AS sale_date,
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
        GROUP BY DATE(o.created_at), o.city_id, o.school_id, oi.category_id
        ON CONFLICT (date, school_id, category_id)
        DO UPDATE SET
            city_id = EXCLUDED.city_id,
            orders = EXCLUDED.orders,
            units = EXCLUDED.units,
            revenue = EXCLUDED.revenue,
            cost = EXCLUDED.cost;
    """
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.rowcount
