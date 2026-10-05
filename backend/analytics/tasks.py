from datetime import date

from celery import shared_task

from .services import NIGHTLY_RECOMPUTE_DAYS, recompute_recent_days, refresh_sales_summary


@shared_task(name="analytics.refresh_daily_sales_summary")
def refresh_daily_sales_summary(target_date_iso: str | None = None) -> int:
    """
    Refresh dashboard rollups off the request path using application UUIDs.

    Fired after every order, return and cancellation. Writes all three
    grains in one SQL pass:
      * DailySalesSummary   (date, school, category) - category breakdown
      * DailySchoolTotal    (date, school)           - exact school-day totals
      * DailyProductSummary (date, product, ...)     - Boss "top products"
    """
    target_date = date.fromisoformat(target_date_iso) if target_date_iso else None
    result = refresh_sales_summary(target_date)
    return result["category_rows"] + result["school_rows"] + result["product_rows"]


@shared_task(name="analytics.recompute_recent_days")
def recompute_recent_days_task(days: int = NIGHTLY_RECOMPUTE_DAYS) -> dict:
    """
    Nightly drift correction (Celery beat, 02:00 Asia/Kolkata): rebuild the
    last 7 days from the raw order tables so any missed or stale incremental
    refresh is repaired within a day.
    """
    return recompute_recent_days(days)
