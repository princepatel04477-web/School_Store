from datetime import date, timedelta

from django.core.management.base import BaseCommand
from django.db.models import Min, Max

from analytics.services import refresh_sales_summary
from orders.models import Order


class Command(BaseCommand):
    help = (
        "Rebuild DailySalesSummary + DailySchoolTotal from the orders table. "
        "Use once after deploying the school-day rollup, or to repair drift. "
        "Each day is rebuilt in turn so a large history never becomes one "
        "long-running transaction."
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
                    f"{result['school_rows']} school-day rows."
                )
            )
            return

        if options["all"]:
            result = refresh_sales_summary(None)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Rebuilt {result['category_rows']} category rows and "
                    f"{result['school_rows']} school-day rows."
                )
            )
            return

        bounds = Order.objects.aggregate(first=Min("created_at"), last=Max("created_at"))
        if not bounds["first"]:
            self.stdout.write("No orders to roll up.")
            return

        day = bounds["first"].date()
        last = bounds["last"].date()
        days = 0
        while day <= last:
            refresh_sales_summary(day)
            days += 1
            day += timedelta(days=1)
        self.stdout.write(self.style.SUCCESS(f"Rolled up {days} day(s)."))
