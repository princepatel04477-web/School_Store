from datetime import date, timedelta

from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Min, Max
from django.utils import timezone

from analytics.services import refresh_sales_summary
from orders.models import Order


def _vacuum_rollups() -> None:
    """
    VACUUM (not just ANALYZE): the planner only chooses index-only scans
    once the visibility map is populated, and ANALYZE alone does not set it
    after a bulk rebuild.

    VACUUM cannot run inside a transaction (e.g. the test runner), where it
    is simply skipped - tests do not assert query plans.
    """
    if connection.in_atomic_block:
        return
    with connection.cursor() as cursor:
        cursor.execute("VACUUM ANALYZE analytics_dailysalessummary;")
        cursor.execute("VACUUM ANALYZE analytics_dailyschooltotal;")
        cursor.execute("VACUUM ANALYZE analytics_dailyproductsummary;")


class Command(BaseCommand):
    help = (
        "Rebuild DailySalesSummary + DailySchoolTotal + DailyProductSummary "
        "from scratch off the orders table. Use to bootstrap the rollups or "
        "to repair drift. By default each day is rebuilt in turn so a large "
        "history never becomes one long-running transaction."
    )

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str, help="Rebuild a single day (YYYY-MM-DD).")
        parser.add_argument(
            "--all",
            action="store_true",
            help="Rebuild every day in one SQL pass (fastest for small datasets).",
        )

    def handle(self, *args, **options):
        if options["date"]:
            target = date.fromisoformat(options["date"])
            result = refresh_sales_summary(target)
            self.stdout.write(
                self.style.SUCCESS(
                    f"{target}: {result['category_rows']} category rows, "
                    f"{result['school_rows']} school-day rows, "
                    f"{result['product_rows']} product rows."
                )
            )
            _vacuum_rollups()
            return

        if options["all"]:
            result = refresh_sales_summary(None)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Rebuilt {result['category_rows']} category rows, "
                    f"{result['school_rows']} school-day rows and "
                    f"{result['product_rows']} product rows."
                )
            )
            _vacuum_rollups()
            return

        bounds = Order.objects.aggregate(first=Min("created_at"), last=Max("created_at"))
        if not bounds["first"]:
            self.stdout.write("No orders to roll up.")
            return

        # Rollup days are local (project timezone) calendar days.
        day = timezone.localtime(bounds["first"]).date()
        last = timezone.localtime(bounds["last"]).date()
        days = 0
        totals = {"category_rows": 0, "school_rows": 0, "product_rows": 0}
        while day <= last:
            result = refresh_sales_summary(day)
            for key in totals:
                totals[key] += result[key]
            days += 1
            day += timedelta(days=1)
        self.stdout.write(
            self.style.SUCCESS(
                f"Rolled up {days} day(s): {totals['category_rows']} category rows, "
                f"{totals['school_rows']} school-day rows, "
                f"{totals['product_rows']} product rows."
            )
        )
        _vacuum_rollups()
