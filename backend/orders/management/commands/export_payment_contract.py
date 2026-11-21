import json
from datetime import datetime, timedelta, timezone as utc
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from django.core.management.base import BaseCommand
from django.db import transaction
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from orders.models import Order, PaymentAttempt
from orders.payment import RazorpayGateway
from schools.models import City, School, Student


def payment_contract():
    now = datetime(2030, 1, 1, tzinfo=utc.utc)
    with (
        transaction.atomic(),
        override_settings(RAZORPAY_KEY_ID="fixture-key"),
        patch("django.utils.timezone.now", return_value=now),
        patch.object(RazorpayGateway, "create_order", return_value={"id": "fixture-order-new"}),
        patch.object(RazorpayGateway, "fetch_order_payments", return_value=[]),
    ):
        city = City.objects.create(name="Payment fixture", code="PAYFX")
        school = School.objects.create(name="Payment fixture school", code="PAYFX", city=city)
        parent = User.objects.create(username="fixture-parent", role="PARENT")
        staff = User.objects.create(username="fixture-boss", role="BOSS")
        student = Student.objects.create(
            name="Fixture Child", gr_number="1", class_name="5", school=school, parent=parent,
        )
        parent_api, staff_api = APIClient(), APIClient()
        parent_api.force_authenticate(parent)
        staff_api.force_authenticate(staff)

        def body(response, status=200):
            if response.status_code != status:
                raise RuntimeError(f"Expected {status}, received {response.status_code}")
            return response.json()

        states = {}
        orders = {}
        for state in ("NOT_PAID", "CHECKING", "PAID", "RELEASED", "REFUND_DUE", "COD_DUE", "PAID_DO_NOT_COLLECT"):
            captured = state in {"PAID", "REFUND_DUE", "PAID_DO_NOT_COLLECT"}
            order = Order.objects.create(
                order_number=f"FIXTURE-{state}", student=student, parent=parent, payer=parent,
                placed_by=parent, placed_by_role="PARENT", school=school, city=city,
                subtotal=Decimal("1000.00"), total=Decimal("1000.00"), created_at=now,
                payment_method="COD" if state in {"COD_DUE", "PAID_DO_NOT_COLLECT"} else "ONLINE",
                status="CANCELLED" if state in {"RELEASED", "REFUND_DUE"} else "PLACED",
                payment_status="PAID" if captured else "PENDING",
                cancel_reason="PAYMENT_EXPIRED" if state == "RELEASED" else "",
                hold_expires_at=now + timedelta(minutes=15),
                razorpay_order_id=f"fixture-order-{state}" if captured or state == "CHECKING" else "",
                razorpay_payment_id=f"fixture-payment-{state}-1234" if captured else "",
            )
            if captured or state == "CHECKING":
                PaymentAttempt.objects.create(
                    order=order, razorpay_payment_id=order.razorpay_payment_id or "fixture-pending",
                    status="CAPTURED" if captured else "CREATED", amount_paise=100000,
                    currency="INR", method="upi", first_seen_at=now, last_source="RECONCILE",
                )
            orders[state] = order
            url = f"/api/orders/{order.pk}/"
            states[state] = {
                "detail": body(parent_api.get(url)),
                "reconcile": body(parent_api.post(url + "reconcile-payment/")),
            }
        parent_rows = body(parent_api.get("/api/orders/"))["results"]
        staff_rows = body(staff_api.get(f"/api/panel/orders/?school={school.pk}"))["results"]
        for state, order in orders.items():
            for key, rows in (("list", parent_rows), ("panel", staff_rows)):
                states[state][key] = next(row for row in rows if row["id"] == str(order.pk))
        unpaid = orders["NOT_PAID"]
        pending = orders["CHECKING"]
        start = body(parent_api.post(f"/api/orders/{unpaid.pk}/payment/"))
        refusal = body(parent_api.post(f"/api/orders/{pending.pk}/payment/"), status=409)
        with patch.object(RazorpayGateway, "fetch_order_payments", side_effect=TimeoutError):
            outage = body(parent_api.post(f"/api/orders/{pending.pk}/payment/"), status=503)
        transaction.set_rollback(True)
        return {"states": states, "start": start, "pending_refusal": refusal, "outage_refusal": outage}


class Command(BaseCommand):
    help = "Generate browser payment fixtures from real API responses in a rolled-back transaction."

    def add_arguments(self, parser):
        parser.add_argument("output", type=Path)

    def handle(self, *args, output, **options):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payment_contract(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
