from datetime import date, timedelta

from django.core.management.base import BaseCommand
from django.db.models import Min, Max

from analytics.services import refresh_sales_summary
from orders.models import Order


class Command(BaseCommand):
    help = (
        "Rebuild DailySalesSummary + DailySchoolTotal + DailyProductTotal from the orders table. "
        "Use once after deploying rollups, or to repair drift. "
        "Each day is rebuilt in turn so a large history never becomes one "
        "long-running transaction. Use --scratch to drop everything first."
    )

    def add_arguments(self, parser):
        parser.add_argument("--date", type=str, help="Rebuild a single day (YYYY-MM-DD).")
        parser.add_argument(
            "--all",
            action="store_true",
            help="Rebuild every day in one SQL pass (fastest for small datasets).",
        )
        parser.add_argument(
            "--scratch",
            action="store_true",
            help="Delete all summary tables before rebuilding from scratch.",
        )

    def handle(self, *args, **options):
        if options.get("scratch"):
            from analytics.services import delete_summaries
            self.stdout.write("Dropping all summary rows for clean rebuild...")
            delete_summaries(None)

        if options["date"]:
            target = date.fromisoformat(options["date"])
            result = refresh_sales_summary(target)
            self.stdout.write(
                self.style.SUCCESS(
                    f"{target}: {result['category_rows']} category rows, "
                    f"{result['school_rows']} school-day rows, "
                    f"{result.get('product_rows', 0)} product rows."
                )
            )
            return

        if options["all"]:
            result = refresh_sales_summary(None)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Rebuilt {result['category_rows']} category rows, "
                    f"{result['school_rows']} school-day rows, and "
                    f"{result.get('product_rows', 0)} product rows."
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
