from datetime import date

from celery import shared_task

from .services import refresh_sales_summary

from .models import DailySalesSummary


@shared_task(name="analytics.refresh_daily_sales_summary")
def refresh_daily_sales_summary(target_date_iso: str | None = None) -> int:
    """
    Refresh dashboard rollups off the request path using application UUIDs.

    Writes both grains in one SQL pass:
      * DailySalesSummary (date, school, category) - category breakdown
      * DailySchoolTotal  (date, school)           - exact school-day totals
    """
    target_date = date.fromisoformat(target_date_iso) if target_date_iso else None
    result = refresh_sales_summary(target_date)
    return result["category_rows"] + result["school_rows"]
