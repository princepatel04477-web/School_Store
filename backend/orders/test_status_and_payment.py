"""Order status transitions, cancel restock, and payment verification safety."""

import hashlib
import hmac
import json
from decimal import Decimal

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from inventory.services import apply_stock_movement
from orders.models import Order, OrderItem, OrderStatusEvent
from schools.models import City, School, Student

SECRET = "test_secret"


def sign(message: bytes) -> str:
    return hmac.new(SECRET.encode(), message, hashlib.sha256).hexdigest()


class OrderFixture(TestCase):
    def setUp(self):
        self.city = City.objects.create(name="Pune", code="PNQ")
        self.school = School.objects.create(name="DPS Pune", code="DPS-PNQ", city=self.city)
        self.admin = User.objects.create_user(username="admin_pnq", password="Pass123456!", role="ADMIN", city=self.city)
        self.parent = User.objects.create_user(username="parent_pnq", password="Pass123456!", role="PARENT", city=self.city, school=self.school)
        self.student = Student.objects.create(name="Child PNQ", gr_number="PNQ-01", class_name="4", section="A", school=self.school, parent=self.parent)
        category = Category.objects.create(name="Belts", slug="belts")
        product = Product.objects.create(name="Belt", category=category, school=self.school, cost_price=Decimal("50.00"), selling_price=Decimal("100.00"))
        self.variant = ProductVariant.objects.create(product=product, sku="BELT-PNQ", size="M", school=self.school)
        apply_stock_movement(variant=self.variant, city_id=self.city.id, quantity_change=10, reason="INITIAL_STOCK")

    def make_order(self, number, order_status=Order.Status.PLACED, quantity=3, **extra):
        # Mirrors checkout: the stock was debited when the order was placed.
        apply_stock_movement(variant=self.variant, city_id=self.city.id, quantity_change=-quantity, reason="ORDER_PLACED")
        order = Order.objects.create(
            order_number=number, student=self.student, placed_by=self.parent,
            subtotal=Decimal("300.00"), total=Decimal("300.00"), status=order_status, **extra,
        )
        OrderItem.objects.create(
            order=order, variant=self.variant, category=self.variant.product.category, quantity=quantity,
            unit_price_snapshot=Decimal("100.00"), unit_cost_snapshot=Decimal("50.00"),
        )
        return order

    def stock(self):
        return StockBalance.objects.get(city=self.city, variant=self.variant).stock_quantity

    def admin_client(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        return client


class StatusTransitionTests(OrderFixture):
    def test_single_order_patch_changes_status_and_writes_event(self):
        order = self.make_order("ORD-PNQ-1")
        res = self.admin_client().patch(f"/api/orders/{order.pk}/", {"status": "CONFIRMED"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CONFIRMED)
        self.assertTrue(OrderStatusEvent.objects.filter(order=order, status="CONFIRMED", changed_by=self.admin).exists())

    def test_illegal_transition_is_refused(self):
        order = self.make_order("ORD-PNQ-2", order_status=Order.Status.DELIVERED)
        res = self.admin_client().patch(f"/api/orders/{order.pk}/", {"status": "PLACED"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DELIVERED)

    def test_bulk_cancel_returns_stock_once_and_skips_final_orders(self):
        open_order = self.make_order("ORD-PNQ-3", quantity=3)
        already_cancelled = self.make_order("ORD-PNQ-4", order_status=Order.Status.CANCELLED, quantity=2)
        self.assertEqual(self.stock(), 5)

        res = self.admin_client().post(
            reverse("order-bulk-status"),
            {"order_ids": [str(open_order.pk), str(already_cancelled.pk)], "status": "CANCELLED"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertEqual(res.data["updated_count"], 1)
        self.assertEqual(res.data["skipped_ids"], [str(already_cancelled.pk)])
        # Only the open order's 3 units come back; the already-cancelled one is untouched.
        self.assertEqual(self.stock(), 8)
        self.assertEqual(
            StockMovement.objects.filter(reference_order=open_order, reason="ORDER_CANCELLED").count(), 1
        )

        # Cancelling again changes nothing and returns no stock twice.
        self.admin_client().post(reverse("order-bulk-status"), {"order_ids": [str(open_order.pk)], "status": "CANCELLED"}, format="json")
        self.assertEqual(self.stock(), 8)


@override_settings(RAZORPAY_KEY_ID="rzp_test", RAZORPAY_KEY_SECRET=SECRET)
class PaymentSafetyTests(OrderFixture):
    def parent_client(self):
        client = APIClient()
        client.force_authenticate(user=self.parent)
        return client

    def test_signature_from_another_razorpay_order_cannot_pay_this_one(self):
        expensive = self.make_order("ORD-PNQ-5", payer=self.parent, razorpay_order_id="order_expensive")
        # A genuine signature, but for a different (cheaper) Razorpay order.
        res = self.parent_client().post(
            reverse("order-verify-payment", kwargs={"pk": expensive.pk}),
            {"razorpay_order_id": "order_cheap", "razorpay_payment_id": "pay_1", "razorpay_signature": sign(b"order_cheap|pay_1")},
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        expensive.refresh_from_db()
        self.assertEqual(expensive.payment_status, Order.PaymentStatus.PENDING)

    def test_valid_signature_for_this_order_marks_it_paid(self):
        order = self.make_order("ORD-PNQ-6", payer=self.parent, razorpay_order_id="order_ok")
        res = self.parent_client().post(
            reverse("order-verify-payment", kwargs={"pk": order.pk}),
            {"razorpay_order_id": "order_ok", "razorpay_payment_id": "pay_2", "razorpay_signature": sign(b"order_ok|pay_2")},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.status, Order.Status.CONFIRMED)

    def test_retrying_payment_reuses_the_razorpay_order(self):
        order = self.make_order("ORD-PNQ-7", payer=self.parent, razorpay_order_id="order_first")
        res = self.parent_client().post(reverse("order-payment", kwargs={"pk": order.pk}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["order_id"], "order_first")

    def test_late_webhook_does_not_revive_a_cancelled_order(self):
        order = self.make_order("ORD-PNQ-8", order_status=Order.Status.CANCELLED, payer=self.parent, razorpay_order_id="order_late")
        body = json.dumps({"payload": {"payment": {"entity": {"id": "pay_late", "order_id": "order_late"}}}}).encode()
        res = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign(body))
        self.assertEqual(res.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.status, Order.Status.CANCELLED)
        self.assertTrue(OrderStatusEvent.objects.filter(order=order, note__icontains="Refund needed").exists())

        # Gateways resend: the second delivery changes nothing.
        self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sign(body))
        self.assertEqual(OrderStatusEvent.objects.filter(order=order).count(), 1)


@override_settings(RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", DEBUG=False)
class MissingSecretTests(OrderFixture):
    def test_webhook_is_refused_without_a_secret(self):
        order = self.make_order("ORD-PNQ-9", razorpay_order_id="order_nosecret")
        body = json.dumps({"payload": {"payment": {"entity": {"id": "pay_x", "order_id": "order_nosecret"}}}}).encode()
        forged = hmac.new(b"", body, hashlib.sha256).hexdigest()
        res = self.client.post(reverse("razorpay-webhook"), body, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=forged)
        self.assertEqual(res.status_code, 400)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)
