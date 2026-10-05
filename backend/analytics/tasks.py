from datetime import date

from celery import shared_task

from .services import refresh_sales_summary

from .models import DailySalesSummary


@shared_task(name="analytics.refresh_daily_sales_summary")
def refresh_daily_sales_summary(target_date_iso: str | None = None) -> int:
    """
    Refresh dashboard rollups off the request path using application UUIDs.

    Writes three grains:
      * DailySalesSummary (date, school, category) - category breakdown
      * DailySchoolTotal  (date, school)           - exact school-day totals
      * DailyProductTotal (date, product)          - top products
    """
    target_date = date.fromisoformat(target_date_iso) if target_date_iso else None
    result = refresh_sales_summary(target_date)
    return result["category_rows"] + result["school_rows"] + result.get("product_rows", 0)


@shared_task(name="analytics.nightly_sales_recompute")
def nightly_sales_recompute() -> dict:
    """
    Requirement 5: A nightly job recomputes the last 7 days from the raw tables
    to correct any drift (e.g. late cancellations, status changes).
    """
    from datetime import timedelta
    from django.utils import timezone

    today = timezone.localdate()
    recomputed = {}
    for i in range(7):
        target = today - timedelta(days=i)
        res = refresh_sales_summary(target)
        recomputed[target.isoformat()] = res
    return recomputed
