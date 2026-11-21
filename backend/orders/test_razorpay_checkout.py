"""Comprehensive test suite for Razorpay checkout integration (Tests 1 through 30).

Follows Section 10 of razorpay-checkout-prompt.md.
"""

import hashlib
import hmac
import json
import threading
import time
import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.db import DatabaseError, connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import Category, Product, ProductCityPrice, ProductVariant
from common.testing import requires_postgres
from inventory.models import StockBalance, StockMovement
from inventory.services import apply_stock_movement
from orders.models import (
    Order,
    OrderItem,
    OrderStatusEvent,
    PaymentAttempt,
    PaymentEvent,
    PaymentReview,
)
from orders.payment import RazorpayGateway
from orders.status import apply_provider_payment, can_transition_order
from orders.tasks import (
    reprocess_payment_events,
    release_expired_reservation,
    sweep_expired_reservations,
)
from schools.models import City, School, Student

TEST_KEY_ID = "rzp_test_fixture"
TEST_SECRET = "fixture_secret"
TEST_WEBHOOK_SECRET = "fixture_webhook_secret"


def sign_payment(order_id: str, payment_id: str) -> str:
    msg = f"{order_id}|{payment_id}".encode("utf-8")
    return hmac.new(TEST_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def sign_webhook(body: bytes) -> str:
    return hmac.new(TEST_WEBHOOK_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()


class RazorpayTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        uid = uuid.uuid4().hex[:6]
        cls.city = City.objects.create(name=f"Surat {uid}", code=f"S{uid[:3]}")
        cls.school = School.objects.create(name="DPS Surat", code=f"DPS-{uid}", city=cls.city)
        cls.boss = User.objects.create_user(username=f"boss_{uid}", password="Pass123456!", role="BOSS")
        cls.city_admin = User.objects.create_user(
            username=f"admin_{uid}", password="Pass123456!", role="ADMIN", city=cls.city
        )
        cls.school_admin = User.objects.create_user(
            username=f"sch_admin_{uid}", password="Pass123456!", role="SCHOOL_ADMIN", school=cls.school, city=cls.city
        )
        cls.parent = User.objects.create_user(
            username=f"parent_{uid}", password="Pass123456!", role="PARENT", city=cls.city, school=cls.school
        )
        cls.student = Student.objects.create(
            name="Child One", gr_number=f"DPS-{uid}", class_name="5", section="A", gender="boy", school=cls.school, parent=cls.parent
        )
        cls.category = Category.objects.create(name=f"Uniform {uid}", slug=f"uniform-{uid}")
        cls.product = Product.objects.create(
            name="School Shirt",
            category=cls.category,
            school=cls.school,
            gender="unisex",
            needs_review=False,
            cost_price=Decimal("200.00"),
            selling_price=Decimal("400.00"),
        )
        cls.variant = ProductVariant.objects.create(
            product=cls.product, sku=f"SHIRT-{uid}", size="M", school=cls.school
        )
        # Set city price override: 450.00 instead of default 400.00
        ProductCityPrice.objects.create(city=cls.city, product=cls.product, selling_price=Decimal("450.00"))
        # Add stock
        apply_stock_movement(variant=cls.variant, city_id=cls.city.id, quantity_change=50, reason="INITIAL_STOCK")

    def setUp(self):
        cache.clear()
        self.parent_client = APIClient()
        token = build_tokens_for_user(self.parent)["access"]
        self.parent_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def stock(self):
        return StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity

    def make_order(self, number=None, quantity=1, **extra):
        num = number or f"ORD-{uuid.uuid4().hex[:12].upper()}"
        apply_stock_movement(variant=self.variant, city_id=self.city.id, quantity_change=-quantity, reason="ORDER_PLACED")
        price = Decimal("450.00")
        total = price * quantity
        order = Order.objects.create(
            order_number=num,
            idempotency_key=str(uuid.uuid4()),
            student=self.student,
            parent=self.parent,
            placed_by=self.parent,
            placed_by_role="PARENT",
            payer=self.parent,
            school=self.school,
            city=self.city,
            subtotal=total,
            total=total,
            status=extra.pop("status", Order.Status.PLACED),
            payment_status=extra.pop("payment_status", Order.PaymentStatus.PENDING),
            payment_method=extra.pop("payment_method", Order.PaymentMethod.ONLINE),
            **extra,
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.category,
            quantity=quantity,
            unit_price_snapshot=price,
            unit_cost_snapshot=self.variant.product.cost_price,
            chosen_size="M",
        )
        return order


@override_settings(
    RAZORPAY_KEY_ID=TEST_KEY_ID,
    RAZORPAY_KEY_SECRET=TEST_SECRET,
    RAZORPAY_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET,
)
class QuoteAndCreateTests(RazorpayTestBase):
    def test_01_quote_total_equals_order_total_uses_city_price_and_writes_nothing(self):
        payload = {
            "student": str(self.student.id),
            "fulfillment_type": "HOME_DELIVERY",
            "payment_method": "ONLINE",
            "items": [{"variant": str(self.variant.id), "quantity": 2}],
        }
        order_count_before = Order.objects.count()
        stock_before = self.stock()

        res = self.parent_client.post("/api/orders/quote/", payload, format="json")
        self.assertEqual(res.status_code, 200, res.json())
        data = res.json()
        self.assertEqual(data["total_paise"], 90000)  # 2 * 450.00 * 100
        self.assertEqual(data["currency"], "INR")
        self.assertIn("ONLINE", data["payment_methods"])

        # Writes nothing
        self.assertEqual(Order.objects.count(), order_count_before)
        self.assertEqual(self.stock(), stock_before)

        # Place order with expected_total_paise
        valid_delivery = {
            "recipient_name": "Ramesh Patel",
            "phone": "9876543210",
            "address": "101 Sunrise Apt, Vesu Road",
            "city": "Surat",
            "state": "Gujarat",
            "pincode": "395007",
        }
        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student.id),
            "fulfillment_type": "HOME_DELIVERY",
            "payment_method": "ONLINE",
            "delivery_details": valid_delivery,
            "expected_total_paise": data["total_paise"],
            "items": [{"variant": str(self.variant.id), "quantity": 2}],
        }
        res_order = self.parent_client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(res_order.status_code, 201, res_order.json())
        created = res_order.json()
        self.assertEqual(int(Decimal(created["total"]) * 100), data["total_paise"])

    def test_02_expected_total_paise_mismatch_gives_409_no_order_no_stock_change(self):
        order_count_before = Order.objects.count()
        stock_before = self.stock()
        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student.id),
            "fulfillment_type": "HOME_DELIVERY",
            "payment_method": "ONLINE",
            "delivery_details": {
                "recipient_name": "Ramesh Patel",
                "phone": "9876543210",
                "address": "101 Sunrise Apt, Vesu Road",
                "city": "Surat",
                "state": "Gujarat",
                "pincode": "395007",
            },
            "expected_total_paise": 50000,  # Real total is 45000
            "items": [{"variant": str(self.variant.id), "quantity": 1}],
        }
        res = self.parent_client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(res.status_code, 409, res.json())
        self.assertEqual(res.json()["code"], "price_changed")
        self.assertEqual(res.json()["quote"]["total_paise"], 45000)
        self.assertEqual(Order.objects.count(), order_count_before)
        self.assertEqual(self.stock(), stock_before)

    def test_03_online_creation_refused_when_gateway_not_usable_debug_false(self):
        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student.id),
            "fulfillment_type": "HOME_DELIVERY",
            "payment_method": "ONLINE",
            "delivery_details": {
                "recipient_name": "Ramesh Patel",
                "phone": "9876543210",
                "address": "101 Sunrise Apt, Vesu Road",
                "city": "Surat",
                "state": "Gujarat",
                "pincode": "395007",
            },
            "items": [{"variant": str(self.variant.id), "quantity": 1}],
        }
        with override_settings(RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", DEBUG=False):
            res = self.parent_client.post("/api/orders/", order_payload, format="json")
            self.assertEqual(res.status_code, 400, res.json())
            self.assertIn("payment_method", res.json())
            self.assertIn("Online payment is currently unavailable", str(res.json()["payment_method"]))

    def test_04_same_idempotency_key_sent_twice_gives_one_order_and_one_movement_set(self):
        key = str(uuid.uuid4())
        payload = {
            "idempotency_key": key,
            "student": str(self.student.id),
            "fulfillment_type": "HOME_DELIVERY",
            "payment_method": "ONLINE",
            "delivery_details": {
                "recipient_name": "Ramesh Patel",
                "phone": "9876543210",
                "address": "101 Sunrise Apt, Vesu Road",
                "city": "Surat",
                "state": "Gujarat",
                "pincode": "395007",
            },
            "items": [{"variant": str(self.variant.id), "quantity": 1}],
        }
        stock_before = self.stock()
        res1 = self.parent_client.post("/api/orders/", payload, format="json")
        self.assertEqual(res1.status_code, 201)
        res2 = self.parent_client.post("/api/orders/", payload, format="json")
        self.assertIn(res2.status_code, (200, 201))
        self.assertEqual(res1.json()["id"], res2.json()["id"])
        self.assertEqual(self.stock(), stock_before - 1)
        self.assertEqual(StockMovement.objects.filter(reference_order_id=res1.json()["id"]).count(), 1)

    def test_05_payment_called_twice_creates_razorpay_order_once_with_paise_amount(self):
        order = self.make_order(quantity=2)  # 900.00 = 90000 paise
        mock_rzp_order = {"id": "order_rzp_unique_05", "amount": 90000, "currency": "INR"}
        with patch.object(RazorpayGateway, "create_order", return_value=mock_rzp_order) as mock_create:
            res1 = self.parent_client.post(f"/api/orders/{order.pk}/payment/")
            self.assertEqual(res1.status_code, 200, res1.json())
            self.assertEqual(res1.json()["order_id"], "order_rzp_unique_05")
            self.assertEqual(res1.json()["amount"], 90000)

            # Second call reuses existing razorpay_order_id
            res2 = self.parent_client.post(f"/api/orders/{order.pk}/payment/")
            self.assertEqual(res2.status_code, 200, res2.json())
            self.assertEqual(res2.json()["order_id"], "order_rzp_unique_05")
            mock_create.assert_called_once()


@override_settings(
    RAZORPAY_KEY_ID=TEST_KEY_ID,
    RAZORPAY_KEY_SECRET=TEST_SECRET,
    RAZORPAY_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET,
)
class AttemptsAndPaymentStateTests(RazorpayTestBase):
    def test_06_failed_attempt_then_captured_attempt_gives_two_attempts_paid_confirmed(self):
        order = self.make_order(razorpay_order_id="order_rzp_06")
        amount_paise = int(order.total * 100)

        # 1. Failed attempt
        apply_provider_payment(
            order,
            payment_id="pay_fail_06",
            status="failed",
            amount=amount_paise,
            currency="INR",
            method="card",
            error_code="BAD_REQUEST",
            error_reason="Card expired",
            source=PaymentAttempt.Source.WEBHOOK,
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)
        self.assertEqual(order.payment_attempts.count(), 1)

        # 2. Captured attempt with different payment id
        apply_provider_payment(
            order,
            payment_id="pay_succ_06",
            status="captured",
            amount=amount_paise,
            currency="INR",
            method="upi",
            source=PaymentAttempt.Source.WEBHOOK,
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.status, Order.Status.CONFIRMED)
        self.assertEqual(order.payment_attempts.count(), 2)

    def test_07_capture_then_late_failed_for_same_payment_id_leaves_captured_and_paid(self):
        order = self.make_order(razorpay_order_id="order_rzp_07")
        amount_paise = int(order.total * 100)

        apply_provider_payment(
            order, payment_id="pay_07", status="captured", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

        # Late failed for same payment id
        apply_provider_payment(
            order, payment_id="pay_07", status="failed", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        attempt = order.payment_attempts.get(razorpay_payment_id="pay_07")
        self.assertEqual(attempt.status, PaymentAttempt.Status.CAPTURED)

    def test_08_capture_on_attempt_a_then_payment_failed_for_b_leaves_order_paid(self):
        order = self.make_order(razorpay_order_id="order_rzp_08")
        amount_paise = int(order.total * 100)

        apply_provider_payment(
            order, payment_id="pay_08_a", status="captured", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

        apply_provider_payment(
            order, payment_id="pay_08_b", status="failed", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.payment_attempts.count(), 2)

    def test_09_payment_failed_then_late_auth_and_capture_gives_paid(self):
        order = self.make_order(razorpay_order_id="order_rzp_09")
        amount_paise = int(order.total * 100)

        apply_provider_payment(
            order, payment_id="pay_09", status="failed", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)

        apply_provider_payment(
            order, payment_id="pay_09", status="authorized", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.AUTHORIZED)

        apply_provider_payment(
            order, payment_id="pay_09", status="captured", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.status, Order.Status.CONFIRMED)

    def test_10_verify_with_valid_signature_and_captured_payment_gives_paid_one_event(self):
        order = self.make_order(razorpay_order_id="order_rzp_10")
        pay_id = "pay_valid_10"
        sig = sign_payment("order_rzp_10", pay_id)
        mock_fetch = {
            "id": pay_id,
            "order_id": "order_rzp_10",
            "status": "captured",
            "amount": int(order.total * 100),
            "currency": "INR",
            "method": "upi",
        }
        with patch.object(RazorpayGateway, "fetch_payment", return_value=mock_fetch):
            res = self.parent_client.post(
                f"/api/orders/{order.pk}/verify-payment/",
                {
                    "razorpay_order_id": "order_rzp_10",
                    "razorpay_payment_id": pay_id,
                    "razorpay_signature": sig,
                },
                format="json",
            )
            self.assertEqual(res.status_code, 200, res.json())
            order.refresh_from_db()
            self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
            self.assertEqual(order.status, Order.Status.CONFIRMED)
            self.assertEqual(OrderStatusEvent.objects.filter(order=order, status=Order.Status.CONFIRMED).count(), 1)

    def test_11_verify_with_mismatched_amount_gives_not_paid_and_amount_mismatch_item(self):
        order = self.make_order(razorpay_order_id="order_rzp_11")
        pay_id = "pay_mismatch_11"
        sig = sign_payment("order_rzp_11", pay_id)
        mock_fetch = {
            "id": pay_id,
            "order_id": "order_rzp_11",
            "status": "captured",
            "amount": int(order.total * 100) - 1000,  # 10 INR less
            "currency": "INR",
            "method": "upi",
        }
        with patch.object(RazorpayGateway, "fetch_payment", return_value=mock_fetch):
            res = self.parent_client.post(
                f"/api/orders/{order.pk}/verify-payment/",
                {
                    "razorpay_order_id": "order_rzp_11",
                    "razorpay_payment_id": pay_id,
                    "razorpay_signature": sig,
                },
                format="json",
            )
            order.refresh_from_db()
            self.assertNotEqual(order.payment_status, Order.PaymentStatus.PAID)
            self.assertTrue(PaymentReview.objects.filter(order=order, reason="AMOUNT_MISMATCH").exists())

    def test_12_verify_with_authorized_payment_gives_authorized_status_unchanged(self):
        order = self.make_order(razorpay_order_id="order_rzp_12")
        pay_id = "pay_auth_12"
        sig = sign_payment("order_rzp_12", pay_id)
        mock_fetch = {
            "id": pay_id,
            "order_id": "order_rzp_12",
            "status": "authorized",
            "amount": int(order.total * 100),
            "currency": "INR",
            "method": "upi",
        }
        with patch.object(RazorpayGateway, "fetch_payment", return_value=mock_fetch):
            res = self.parent_client.post(
                f"/api/orders/{order.pk}/verify-payment/",
                {
                    "razorpay_order_id": "order_rzp_12",
                    "razorpay_payment_id": pay_id,
                    "razorpay_signature": sig,
                },
                format="json",
            )
            self.assertEqual(res.status_code, 200)
            order.refresh_from_db()
            self.assertEqual(order.payment_status, Order.PaymentStatus.AUTHORIZED)
            self.assertEqual(order.status, Order.Status.PLACED)

    def test_13_second_captured_attempt_on_paid_order_gives_duplicate_payment_item(self):
        order = self.make_order(razorpay_order_id="order_rzp_13")
        amount_paise = int(order.total * 100)

        apply_provider_payment(
            order, payment_id="pay_13_first", status="captured", amount=amount_paise, currency="INR"
        )
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

        # Second captured attempt with distinct payment id
        apply_provider_payment(
            order, payment_id="pay_13_second", status="captured", amount=amount_paise, currency="INR"
        )
        self.assertTrue(PaymentReview.objects.filter(order=order, reason="DUPLICATE_PAYMENT").exists())

    def test_14_one_razorpay_payment_id_cannot_be_recorded_on_two_orders(self):
        order1 = self.make_order(razorpay_order_id="order_rzp_14_a")
        order2 = self.make_order(razorpay_order_id="order_rzp_14_b")
        amount_paise = int(order1.total * 100)

        apply_provider_payment(
            order1, payment_id="pay_14_dup", status="captured", amount=amount_paise, currency="INR"
        )
        # Attempt to apply pay_14_dup to order2
        apply_provider_payment(
            order2, payment_id="pay_14_dup", status="captured", amount=amount_paise, currency="INR"
        )
        order2.refresh_from_db()
        self.assertNotEqual(order2.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(PaymentAttempt.objects.filter(razorpay_payment_id="pay_14_dup").count(), 1)
        self.assertTrue(PaymentReview.objects.filter(order=order2, reason="AMOUNT_MISMATCH").exists())

    def test_15_reconcile_payment_after_window_closed_gives_paid(self):
        order = self.make_order(razorpay_order_id="order_rzp_15")
        mock_payments = [
            {
                "id": "pay_reconcile_15",
                "order_id": "order_rzp_15",
                "status": "captured",
                "amount": int(order.total * 100),
                "currency": "INR",
                "method": "upi",
            }
        ]
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=mock_payments):
            res = self.parent_client.post(f"/api/orders/{order.pk}/reconcile-payment/")
            self.assertEqual(res.status_code, 200, res.json())
            order.refresh_from_db()
            self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
            self.assertEqual(order.status, Order.Status.CONFIRMED)


@override_settings(
    RAZORPAY_KEY_ID=TEST_KEY_ID,
    RAZORPAY_KEY_SECRET=TEST_SECRET,
    RAZORPAY_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET,
)
class WebhookAcknowledgementTests(RazorpayTestBase):
    def test_16_payment_failed_alone_never_gives_paid_regression_test(self):
        order = self.make_order(razorpay_order_id="order_rzp_16")
        body = json.dumps({
            "event_id": "evt_fail_16",
            "event": "payment.failed",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_fail_16",
                        "order_id": "order_rzp_16",
                        "status": "failed",
                        "amount": int(order.total * 100),
                        "currency": "INR",
                        "method": "card",
                    }
                }
            },
        }).encode("utf-8")
        res = self.client.post(
            reverse("razorpay-webhook"),
            body,
            content_type="application/json",
            HTTP_X_RAZORPAY_SIGNATURE=sign_webhook(body),
        )
        self.assertEqual(res.status_code, 200)
        order.refresh_from_db()
        self.assertNotEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)

    def test_17_same_event_id_delivered_twice_gives_one_event_one_status_event_200_both_times(self):
        order = self.make_order(razorpay_order_id="order_rzp_17")
        body = json.dumps({
            "event_id": "evt_dup_17",
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_17",
                        "order_id": "order_rzp_17",
                        "status": "captured",
                        "amount": int(order.total * 100),
                        "currency": "INR",
                        "method": "upi",
                    }
                }
            },
        }).encode("utf-8")
        sig = sign_webhook(body)

        res1 = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)
        self.assertEqual(res1.status_code, 200)
        res2 = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)
        self.assertEqual(res2.status_code, 200)

        self.assertEqual(PaymentEvent.objects.filter(event_id="evt_dup_17").count(), 1)
        self.assertEqual(OrderStatusEvent.objects.filter(order=order, status=Order.Status.CONFIRMED).count(), 1)

    def test_18_order_paid_plus_payment_captured_for_one_payment_give_one_outcome(self):
        order = self.make_order(razorpay_order_id="order_rzp_18")
        pay_id = "pay_18"
        amount = int(order.total * 100)

        body_captured = json.dumps({
            "event_id": "evt_18_cap",
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": pay_id,
                        "order_id": "order_rzp_18",
                        "status": "captured",
                        "amount": amount,
                        "currency": "INR",
                        "method": "upi",
                    }
                }
            },
        }).encode("utf-8")

        body_paid = json.dumps({
            "event_id": "evt_18_paid",
            "event": "order.paid",
            "payload": {
                "order": {
                    "entity": {
                        "id": "order_rzp_18",
                        "amount": amount,
                        "currency": "INR",
                    }
                },
                "payment": {
                    "entity": {
                        "id": pay_id,
                        "order_id": "order_rzp_18",
                        "status": "captured",
                        "amount": amount,
                        "currency": "INR",
                        "method": "upi",
                    }
                },
            },
        }).encode("utf-8")

        res1 = self.client.post(reverse("razorpay-webhook"), body_captured, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign_webhook(body_captured))
        self.assertEqual(res1.status_code, 200)
        res2 = self.client.post(reverse("razorpay-webhook"), body_paid, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign_webhook(body_paid))
        self.assertEqual(res2.status_code, 200)

        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.payment_attempts.count(), 1)
        self.assertEqual(OrderStatusEvent.objects.filter(order=order, status=Order.Status.CONFIRMED).count(), 1)

    def test_19_unknown_order_gives_200_unmatched_event_and_beat_processes_or_reviews_after_24h(self):
        body = json.dumps({
            "event_id": "evt_19_unknown",
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_19_unknown",
                        "order_id": "order_unknown_19",
                        "status": "captured",
                        "amount": 45000,
                        "currency": "INR",
                        "method": "card",
                    }
                }
            },
        }).encode("utf-8")
        res = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign_webhook(body))
        self.assertEqual(res.status_code, 200)

        event = PaymentEvent.objects.get(event_id="evt_19_unknown")
        self.assertEqual(event.state, PaymentEvent.State.UNMATCHED)

        # 1. Simulate 24 hours passing without order appearing -> opens UNMATCHED_EVENT
        PaymentEvent.objects.filter(pk=event.pk).update(
            received_at=timezone.now() - timedelta(hours=25),
            next_try_at=timezone.now() - timedelta(minutes=1),
        )
        reprocess_payment_events()
        self.assertTrue(PaymentReview.objects.filter(reason="UNMATCHED_EVENT", payment_id="pay_19_unknown").exists())

        # 2. When the order later appears, the beat job processes it
        order = self.make_order(razorpay_order_id="order_unknown_19")
        PaymentEvent.objects.filter(pk=event.pk).update(next_try_at=timezone.now() - timedelta(minutes=1))
        reprocess_payment_events()
        event.refresh_from_db()
        self.assertEqual(event.state, PaymentEvent.State.PROCESSED)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

    def test_20_save_payment_event_failure_returns_503_and_nothing_changes(self):
        order = self.make_order(razorpay_order_id="order_rzp_20")
        body = json.dumps({
            "event_id": "evt_20_fail",
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_20",
                        "order_id": "order_rzp_20",
                        "status": "captured",
                        "amount": int(order.total * 100),
                        "currency": "INR",
                        "method": "upi",
                    }
                }
            },
        }).encode("utf-8")

        with patch("orders.webhooks.PaymentEvent.objects.create", side_effect=DatabaseError("DB connection dropped")):
            res = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign_webhook(body))
            self.assertEqual(res.status_code, 503)

        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)
        self.assertEqual(PaymentEvent.objects.filter(event_id="evt_20_fail").count(), 0)

    def test_21_processing_failure_leaves_retry_returns_200_and_beat_processes_once(self):
        order = self.make_order(razorpay_order_id="order_rzp_21")
        body = json.dumps({
            "event_id": "evt_21_retry",
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_21",
                        "order_id": "order_rzp_21",
                        "status": "captured",
                        "amount": int(order.total * 100),
                        "currency": "INR",
                        "method": "upi",
                    }
                }
            },
        }).encode("utf-8")

        with patch("orders.webhooks.apply_provider_payment", side_effect=RuntimeError("Transient service error")):
            res = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign_webhook(body))
            self.assertEqual(res.status_code, 200)

        event = PaymentEvent.objects.get(event_id="evt_21_retry")
        self.assertEqual(event.state, PaymentEvent.State.RETRY)

        # Set next_try_at in the past so reprocess picks it up
        PaymentEvent.objects.filter(pk=event.pk).update(next_try_at=timezone.now() - timedelta(minutes=5))
        reprocess_payment_events()

        event.refresh_from_db()
        self.assertEqual(event.state, PaymentEvent.State.PROCESSED)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

    def test_22_event_left_received_is_processed_on_redelivery(self):
        order = self.make_order(razorpay_order_id="order_rzp_22")
        # Simulate a crash that left event in RECEIVED state
        PaymentEvent.objects.create(
            event_id="evt_22_crashed",
            event_type="payment.captured",
            razorpay_order_id="order_rzp_22",
            razorpay_payment_id="pay_22",
            amount=int(order.total * 100),
            currency="INR",
            payload={
                "event": "payment.captured",
                "payload": {
                    "payment": {
                        "entity": {
                            "id": "pay_22",
                            "order_id": "order_rzp_22",
                            "status": "captured",
                            "amount": int(order.total * 100),
                            "currency": "INR",
                            "method": "upi",
                        }
                    }
                },
            },
            state=PaymentEvent.State.RECEIVED,
        )
        body = json.dumps({
            "event_id": "evt_22_crashed",
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_22",
                        "order_id": "order_rzp_22",
                        "status": "captured",
                        "amount": int(order.total * 100),
                        "currency": "INR",
                        "method": "upi",
                    }
                }
            },
        }).encode("utf-8")
        res = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign_webhook(body))
        self.assertEqual(res.status_code, 200)

        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        event = PaymentEvent.objects.get(event_id="evt_22_crashed")
        self.assertEqual(event.state, PaymentEvent.State.PROCESSED)


@requires_postgres
@override_settings(
    RAZORPAY_KEY_ID=TEST_KEY_ID,
    RAZORPAY_KEY_SECRET=TEST_SECRET,
    RAZORPAY_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET,
)
class ExpiryAndRaceTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.city = City.objects.create(name="Postgres Surat", code="PG-SUR")
        self.school = School.objects.create(name="Postgres School", code="PG-SCH", city=self.city)
        self.parent = User.objects.create_user(
            username=f"pg_parent_{uuid.uuid4().hex[:6]}", password="Pass123456!", role="PARENT", city=self.city
        )
        self.student = Student.objects.create(
            name="PG Child", gr_number=f"PG-{uuid.uuid4().hex[:6]}", class_name="5", section="A", school=self.school, parent=self.parent
        )
        self.category = Category.objects.create(name=f"PG Cat {uuid.uuid4().hex[:4]}", slug=f"pg-cat-{uuid.uuid4().hex[:4]}")
        self.product = Product.objects.create(
            name="PG Uniform",
            category=self.category,
            school=self.school,
            cost_price=Decimal("100.00"),
            selling_price=Decimal("200.00"),
        )
        self.variant = ProductVariant.objects.create(product=self.product, sku=f"PG-SKU-{uuid.uuid4().hex[:6]}", size="L", school=self.school)
        apply_stock_movement(variant=self.variant, city_id=self.city.id, quantity_change=500, reason="INITIAL_STOCK")

    def _create_aged_order(self, rzp_order_id, quantity=1):
        apply_stock_movement(variant=self.variant, city_id=self.city.id, quantity_change=-quantity, reason="ORDER_PLACED")
        total = Decimal("200.00") * quantity
        order = Order.objects.create(
            order_number=f"ORD-PG-{uuid.uuid4().hex[:12].upper()}",
            idempotency_key=str(uuid.uuid4()),
            student=self.student,
            parent=self.parent,
            placed_by=self.parent,
            placed_by_role="PARENT",
            payer=self.parent,
            school=self.school,
            city=self.city,
            subtotal=total,
            total=total,
            status=Order.Status.PLACED,
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.ONLINE,
            razorpay_order_id=rzp_order_id,
            created_at=timezone.now() - timedelta(minutes=16),
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.category,
            quantity=quantity,
            unit_price_snapshot=Decimal("200.00"),
            unit_cost_snapshot=Decimal("100.00"),
            chosen_size="L",
        )
        return order

    def test_23_race_expiry_check_and_capture_handler_in_threads_barrier_50_times(self):
        """
        Run the expiry check and the capture handler for the same order at the same moment,
        in two threads with separate DB connections and a threading.Barrier.
        Repeat 50 times in each start order.
        Every run must end in exactly one of two valid states:
        - PAID and CONFIRMED (stock down once, no cancel movement)
        - PAID and CANCELLED (stock refunded once, exactly one REFUND_AFTER_RELEASE)
        """
        for iteration in range(50):
            rzp_id = f"rzp_order_race_{iteration}_{uuid.uuid4().hex[:6]}"
            order = self._create_aged_order(rzp_id, quantity=1)
            pay_id = f"pay_race_{iteration}_{uuid.uuid4().hex[:6]}"
            amount_paise = int(order.total * 100)
            initial_stock = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity

            barrier = threading.Barrier(2)
            errors = []

            def run_expiry():
                connection.close()
                try:
                    barrier.wait(timeout=5)
                    # When expiry checks Razorpay before release, return empty payments (unpaid at provider)
                    with patch.object(RazorpayGateway, "fetch_order_payments", return_value=[]):
                        release_expired_reservation(str(order.id))
                except Exception as e:
                    errors.append(("expiry", e))
                finally:
                    connection.close()

            def run_capture():
                connection.close()
                try:
                    barrier.wait(timeout=5)
                    apply_provider_payment(
                        order,
                        payment_id=pay_id,
                        status="captured",
                        amount=amount_paise,
                        currency="INR",
                        method="upi",
                        source=PaymentAttempt.Source.WEBHOOK,
                    )
                except Exception as e:
                    errors.append(("capture", e))
                finally:
                    connection.close()

            # Alternate start order: even iterations expiry thread first, odd capture thread first
            if iteration % 2 == 0:
                t1 = threading.Thread(target=run_expiry)
                t2 = threading.Thread(target=run_capture)
            else:
                t1 = threading.Thread(target=run_capture)
                t2 = threading.Thread(target=run_expiry)

            t1.start()
            t2.start()
            t1.join()
            t2.join()

            self.assertEqual(errors, [], f"Thread error in iteration {iteration}: {errors}")

            order.refresh_from_db()
            current_stock = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity
            cancel_movements = StockMovement.objects.filter(reference_order=order, reason="ORDER_CANCELLED").count()
            refund_reviews = PaymentReview.objects.filter(order=order, reason="REFUND_AFTER_RELEASE").count()

            # Order must always be marked PAID
            self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

            if order.status == Order.Status.CONFIRMED:
                # Capture won the race
                self.assertEqual(cancel_movements, 0)
                self.assertEqual(refund_reviews, 0)
                self.assertEqual(current_stock, initial_stock)
            elif order.status == Order.Status.CANCELLED:
                # Expiry won the race
                self.assertEqual(cancel_movements, 1)
                self.assertEqual(refund_reviews, 1)
                self.assertEqual(current_stock, initial_stock + 1)
            else:
                self.fail(f"Invalid order status {order.status} in iteration {iteration}")

    def test_24_expiry_with_no_payment_gives_cancelled_and_stock_back_once(self):
        order = self._create_aged_order("rzp_order_24")
        stock_before = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity

        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=[]):
            # Run countdown release and sweep simultaneously
            r1 = release_expired_reservation(str(order.id))
            r2 = release_expired_reservation(str(order.id))

        self.assertTrue(r1)
        self.assertFalse(r2)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)
        stock_after = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity
        self.assertEqual(stock_after, stock_before + 1)
        self.assertEqual(StockMovement.objects.filter(reference_order=order, reason="ORDER_CANCELLED").count(), 1)

    def test_25_expiry_when_razorpay_shows_capture_gives_paid_with_no_release(self):
        order = self._create_aged_order("rzp_order_25")
        stock_before = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity
        mock_payments = [
            {
                "id": "pay_25_captured",
                "order_id": "rzp_order_25",
                "status": "captured",
                "amount": int(order.total * 100),
                "currency": "INR",
                "method": "upi",
            }
        ]
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=mock_payments):
            released = release_expired_reservation(str(order.id))

        self.assertFalse(released)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.status, Order.Status.CONFIRMED)
        stock_after = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity
        self.assertEqual(stock_after, stock_before)
        self.assertEqual(StockMovement.objects.filter(reference_order=order, reason="ORDER_CANCELLED").count(), 0)

    def test_26_expiry_with_razorpay_unreachable_releases_nothing_and_opens_reconcile_stuck_after_2h(self):
        order = self._create_aged_order("rzp_order_26")
        stock_before = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity

        # Razorpay unreachable
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=None):
            released = release_expired_reservation(str(order.id))

        self.assertFalse(released)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PLACED)
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity, stock_before)

        # After 2 hours of age, unreachable gateway opens RECONCILE_STUCK
        Order.objects.filter(pk=order.pk).update(created_at=timezone.now() - timedelta(hours=3))
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=None):
            released2 = release_expired_reservation(str(order.id))

        self.assertFalse(released2)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PLACED)
        self.assertTrue(PaymentReview.objects.filter(order=order, reason="RECONCILE_STUCK").exists())

    def test_27_capture_after_release_delivered_twice_gives_one_refund_after_release_item(self):
        order = self._create_aged_order("rzp_order_27")
        # Release the order
        with patch.object(RazorpayGateway, "fetch_order_payments", return_value=[]):
            release_expired_reservation(str(order.id))
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)
        stock_after_release = StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity

        # Webhook delivery
        apply_provider_payment(
            order, payment_id="pay_27_late", status="captured", amount=int(order.total * 100), currency="INR", source=PaymentAttempt.Source.WEBHOOK
        )
        # Reconcile delivery
        apply_provider_payment(
            order, payment_id="pay_27_late", status="captured", amount=int(order.total * 100), currency="INR", source=PaymentAttempt.Source.RECONCILE
        )

        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.status, Order.Status.CANCELLED)
        self.assertEqual(PaymentReview.objects.filter(order=order, reason="REFUND_AFTER_RELEASE").count(), 1)
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity, stock_after_release)


@override_settings(
    RAZORPAY_KEY_ID=TEST_KEY_ID,
    RAZORPAY_KEY_SECRET=TEST_SECRET,
    RAZORPAY_WEBHOOK_SECRET=TEST_WEBHOOK_SECRET,
)
class PackingRuleTests(RazorpayTestBase):
    def test_28_unpaid_online_order_cannot_move_to_confirmed_processing_packed_dispatched(self):
        actors = [self.boss, self.city_admin, self.school_admin]
        restricted_statuses = [
            Order.Status.CONFIRMED,
            Order.Status.PROCESSING,
            Order.Status.PACKED,
            Order.Status.DISPATCHED,
        ]

        for actor in actors:
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(actor)['access']}")

            # Case A: PENDING
            order_pending = self.make_order(payment_status=Order.PaymentStatus.PENDING)
            for st in restricted_statuses:
                res = client.patch(f"/api/orders/{order_pending.pk}/", {"status": st}, format="json")
                self.assertEqual(res.status_code, 400, f"Actor {actor.role} moved PENDING order to {st}")

            # Case B: AUTHORIZED
            order_auth = self.make_order(payment_status=Order.PaymentStatus.AUTHORIZED)
            for st in restricted_statuses:
                res = client.patch(f"/api/orders/{order_auth.pk}/", {"status": st}, format="json")
                self.assertEqual(res.status_code, 400, f"Actor {actor.role} moved AUTHORIZED order to {st}")

            # Case C: PAID with open PaymentReview item
            order_review = self.make_order(payment_status=Order.PaymentStatus.PAID)
            PaymentReview.objects.create(order=order_review, reason="AMOUNT_MISMATCH", payment_id="pay_rev")
            for st in restricted_statuses:
                res = client.patch(f"/api/orders/{order_review.pk}/", {"status": st}, format="json")
                self.assertEqual(res.status_code, 400, f"Actor {actor.role} moved order with open review to {st}")

    def test_29_django_admin_posting_change_form_does_not_change_status_or_payment_status(self):
        from django.contrib.admin.sites import AdminSite
        from orders.admin import OrderAdmin

        order = self.make_order(payment_status=Order.PaymentStatus.PENDING, status=Order.Status.PLACED)
        site = AdminSite()
        admin_obj = OrderAdmin(Order, site)
        self.assertIn("status", admin_obj.readonly_fields)
        self.assertIn("payment_status", admin_obj.readonly_fields)
        self.assertIn("payment_method", admin_obj.readonly_fields)
        self.assertIn("total", admin_obj.readonly_fields)
        self.assertIn("razorpay_order_id", admin_obj.readonly_fields)

    def test_30_captured_online_order_can_move_to_packed_dispatched_and_cod_can_move(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(self.city_admin)['access']}")

        # 1. Paid online order
        paid_order = self.make_order(
            payment_status=Order.PaymentStatus.PAID, status=Order.Status.CONFIRMED, payment_method=Order.PaymentMethod.ONLINE
        )
        res_pack = client.patch(f"/api/orders/{paid_order.pk}/", {"status": Order.Status.PACKED}, format="json")
        self.assertEqual(res_pack.status_code, 200, res_pack.json())
        res_disp = client.patch(f"/api/orders/{paid_order.pk}/", {"status": Order.Status.DISPATCHED}, format="json")
        self.assertEqual(res_disp.status_code, 200, res_disp.json())

        # 2. COD order can move forward as today
        cod_order = self.make_order(
            payment_status=Order.PaymentStatus.PENDING, status=Order.Status.PLACED, payment_method=Order.PaymentMethod.CASH_ON_DELIVERY
        )
        res_cod = client.patch(f"/api/orders/{cod_order.pk}/", {"status": Order.Status.CONFIRMED}, format="json")
        self.assertEqual(res_cod.status_code, 200, res_cod.json())

        # 3. Mixed bulk request: only eligible orders move
        unpaid_online = self.make_order(
            payment_status=Order.PaymentStatus.PENDING, status=Order.Status.PLACED, payment_method=Order.PaymentMethod.ONLINE
        )
        cod_eligible = self.make_order(
            payment_status=Order.PaymentStatus.PENDING, status=Order.Status.PLACED, payment_method=Order.PaymentMethod.CASH_ON_DELIVERY
        )
        bulk_res = client.post(
            reverse("order-bulk-status"),
            {"order_ids": [str(unpaid_online.pk), str(cod_eligible.pk)], "status": Order.Status.CONFIRMED},
            format="json",
        )
        self.assertEqual(bulk_res.status_code, 200)
        self.assertEqual(bulk_res.json()["updated_count"], 1)
        self.assertIn(str(unpaid_online.pk), bulk_res.json()["skipped_ids"])
