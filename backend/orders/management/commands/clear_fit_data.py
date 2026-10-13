from django.conf import settings
from django.core.management.base import BaseCommand

from orders.fit_retention import clear_fit_data


class Command(BaseCommand):
    help = (
        "Clear children's height and weight from order lines "
        "FIT_DATA_RETENTION_DAYS after the order ended, keeping an unlinked SizingSample. "
        "Run daily."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only count the lines that are due.")

    def handle(self, *args, dry_run=False, **options):
        result = clear_fit_data(dry_run=dry_run)
        verb = "Due" if dry_run else "Cleared"
        self.stdout.write(
            f"{verb}: {result['due']} order line(s) "
            f"(retention {settings.FIT_DATA_RETENTION_DAYS} days after the order ended, "
            f"backstop {settings.FIT_DATA_BACKSTOP_DAYS} days after it was placed)."
        )
