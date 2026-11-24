from unittest.mock import patch
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient
from orders.models import PaymentEvent, PaymentReview
import json
from pathlib import Path

from django.conf import settings
from django.test import TestCase

from orders.management.commands.export_payment_contract import payment_contract
from orders.payment import RazorpayGateway
from orders.test_razorpay_checkout import RazorpayTestBase


def keys(value):
    if isinstance(value, dict):
        return {key: keys(child) for key, child in value.items()}
    if isinstance(value, list):
        return [keys(child) for child in value]
    return None


class PaymentContractTests(TestCase):
    def test_generated_fixture_matches_api_and_all_payment_states(self):
        path = Path(settings.BASE_DIR).parent / "frontend/src/test/fixtures/payment-contract.json"
        expected = json.loads(path.read_text(encoding="utf-8"))
        contract = payment_contract()
        self.assertEqual(keys(expected), keys(contract))
        for state, responses in contract["states"].items():
            for endpoint, body in responses.items():
                with self.subTest(state=state, endpoint=endpoint):
                    self.assertEqual(body["payment_view"]["state"], state)
                    receipt = body["payment_view"]["receipt"]
                    if receipt:
                        self.assertEqual(receipt["amount_paise"], 100000)
        self.assertEqual(contract["pending_refusal"]["code"], "payment_in_progress")
        self.assertEqual(contract["outage_refusal"]["code"], "payment_check_failed")


class PaymentAttentionTests(RazorpayTestBase):
    def test_list_query_count_stays_constant_and_never_contacts_provider(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        self.make_order()
        with patch.object(RazorpayGateway, "fetch_order_payments") as gateway:
            with CaptureQueriesContext(connection) as single:
                one = self.parent_client.get("/api/orders/?page_size=20")
            for _ in range(19):
                self.make_order()
            with self.assertNumQueries(len(single)):
                twenty = self.parent_client.get("/api/orders/?page_size=20")
        self.assertEqual(len(one.json()["results"]), 1)
        self.assertEqual(len(twenty.json()["results"]), 20)
        gateway.assert_not_called()


    def test_attention_hides_cod_and_other_parents_orders(self):
        unpaid = self.make_order()
        pending = self.make_order(razorpay_order_id="fixture-pending-order")
        self.make_order(payment_method="COD")
        other = self.make_order()
        other.parent = self.boss
        other.save(update_fields=["parent"])
        with patch.object(RazorpayGateway, "fetch_order_payments") as gateway:
            response = self.parent_client.get("/api/orders/?payment_attention=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {row["id"]: row["payment_view"]["state"] for row in response.json()["results"]},
            {str(unpaid.pk): "NOT_PAID", str(pending.pk): "CHECKING"},
        )
        gateway.assert_not_called()

    def test_hold_too_short_and_stale_check_block_unsafe_retry(self):
        order = self.make_order(
            razorpay_order_id="fixture-old-check",
            payment_checked_at=timezone.now() - timedelta(seconds=61),
            payment_check_ok=True,
            hold_expires_at=timezone.now() + timedelta(seconds=100),
        )
        url = f"/api/orders/{order.pk}/"
        response = self.parent_client.get(url)
        self.assertEqual(response.json()["payment_view"]["state"], "CHECKING")
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=[]):
            response = self.parent_client.post(url + "payment/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "hold_too_short")

    def test_staff_queue_and_reconcile_permissions(self):
        order = self.make_order(razorpay_order_id="fixture-review-order")
        PaymentReview.objects.create(order=order, reason=PaymentReview.Reason.RECONCILE_STUCK)
        queue = "/api/panel/payments/needs-reconciliation/"
        check = f"/api/panel/orders/{order.pk}/reconcile-payment/"
        self.assertEqual(self.parent_client.post(check).status_code, 403)
        for employee in (self.boss, self.city_admin, self.school_admin):
            staff = APIClient()
            staff.force_authenticate(employee)
            response = staff.get(queue)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["results"][0]["reconciliation_reasons"], ["RECONCILE_STUCK"])
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=[]) as gateway:
            self.assertEqual(staff.post(check).status_code, 200)
        gateway.assert_called_once_with(order.razorpay_order_id)


    def test_rate_limit_keeps_payment_checking(self):
        order = self.make_order(razorpay_order_id="fixture-rate-limit")
        url = f"/api/orders/{order.pk}/reconcile-payment/"
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=[]) as gateway:
            first = self.parent_client.post(url).json()
            second = self.parent_client.post(url).json()
        self.assertTrue(first["checked"])
        self.assertFalse(second["checked"])
        self.assertEqual(second["payment_view"]["state"], "CHECKING")
        self.assertFalse(second["payment_view"]["can_pay_now"])
        gateway.assert_called_once_with(order.razorpay_order_id)

    def test_staff_queue_lists_reasons_and_limits_unmatched_events_to_boss(self):
        now = timezone.now()
        order = self.make_order(
            razorpay_order_id="fixture-event-retry", hold_expires_at=now - timedelta(seconds=1),
            payment_check_ok=False, payment_check_failed_since=now - timedelta(minutes=11),
        )
        PaymentEvent.objects.create(
            event_id="fixture-retrying-event", event_type="payment.captured",
            state=PaymentEvent.State.RETRY, razorpay_order_id=order.razorpay_order_id,
        )
        PaymentEvent.objects.create(
            event_id="fixture-unmatched-event", event_type="payment.captured",
            state=PaymentEvent.State.UNMATCHED,
        )
        queue = "/api/panel/payments/needs-reconciliation/"
        for employee in (self.boss, self.city_admin, self.school_admin):
            with self.subTest(role=employee.role):
                staff = APIClient()
                staff.force_authenticate(employee)
                response = staff.get(queue)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json()["results"][0]["reconciliation_reasons"],
                    ["EVENT_RETRY", "HOLD_EXPIRED", "PROVIDER_UNREACHABLE"],
                )
                self.assertEqual(len(response.json()["unmatched_events"]), int(employee == self.boss))
