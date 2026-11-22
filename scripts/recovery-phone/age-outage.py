"""Local test helper: mark one order's provider check as failing for 11 minutes (simulated time)."""
import os
import sys
from datetime import timedelta
from pathlib import Path

BACKEND = Path(os.environ["SIM_BACKEND"])
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django  # noqa: E402

django.setup()
from django.utils import timezone  # noqa: E402
from orders.models import Order  # noqa: E402

now = timezone.now()
Order.objects.filter(pk=sys.argv[1]).update(
    payment_check_ok=False, payment_checked_at=now, payment_check_failed_since=now - timedelta(minutes=11),
)
