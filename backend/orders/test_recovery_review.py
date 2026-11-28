"""Review of the payment recovery branch: staff scope and COD through fulfilment."""

import uuid
from decimal import Decimal
from unittest.mock import patch

from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Product, ProductVariant
from inventory.services import apply_stock_movement
from orders.models import Order, OrderItem, PaymentReview
from orders.payment import RazorpayGateway
from orders.payment_view import payment_view
from orders.test_razorpay_checkout import RazorpayTestBase
from schools.models import City, School, Student

QUEUE = "/api/panel/payments/needs-reconciliation/"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


class StaffQueueScopeTests(RazorpayTestBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        uid = uuid.uuid4().hex[:6]
        cls.other_city = City.objects.create(name=f"Vadodara {uid}", code=f"V{uid[:3]}")
        cls.other_school = School.objects.create(name="Other School", code=f"OTH-{uid}", city=cls.other_city)
        cls.second_school = School.objects.create(name="Second Surat School", code=f"SEC-{uid}", city=cls.city)
        cls.teacher = User.objects.create_user(
            username=f"teacher_{uid}", password="Pass123456!", role="TEACHER", school=cls.school, city=cls.city,
        )

    def order_at(self, school):
        """An unpaid online order with an open review at another school."""
        student = Student.objects.create(
            name="Other Child", gr_number=f"G-{uuid.uuid4().hex[:6]}", class_name="5", section="A",
            gender="boy", school=school, parent=self.parent,
        )
        product = Product.objects.create(
            name="Shirt", category=self.category, school=school, gender="unisex", needs_review=False,
            cost_price=Decimal("200.00"), selling_price=Decimal("400.00"),
        )
        variant = ProductVariant.objects.create(product=product, sku=f"S-{uuid.uuid4().hex[:6]}", size="M", school=school)
        apply_stock_movement(variant=variant, city_id=school.city_id, quantity_change=5, reason="INITIAL_STOCK")
        order = Order.objects.create(
            order_number=f"ORD-{uuid.uuid4().hex[:12].upper()}", idempotency_key=str(uuid.uuid4()),
            student=student, parent=self.parent, placed_by=self.parent, placed_by_role="PARENT", payer=self.parent,
            school=school, city=school.city, subtotal=Decimal("400.00"), total=Decimal("400.00"),
            payment_method=Order.PaymentMethod.ONLINE, razorpay_order_id=f"order_{uuid.uuid4().hex[:10]}",
        )
        OrderItem.objects.create(
            order=order, variant=variant, category=self.category, quantity=1,
            unit_price_snapshot=Decimal("400.00"), unit_cost_snapshot=Decimal("200.00"),
        )
        PaymentReview.objects.create(order=order, reason=PaymentReview.Reason.RECONCILE_STUCK)
        return order

    def queue_ids(self, user):
        response = client_for(user).get(QUEUE)
        self.assertEqual(response.status_code, 200)
        return {row["id"] for row in response.json()["results"]}

    def test_queue_stays_inside_each_role_scope(self):
        here = self.make_order(razorpay_order_id="order_here_review")
        PaymentReview.objects.create(order=here, reason=PaymentReview.Reason.RECONCILE_STUCK)
        same_city = self.order_at(self.second_school)
        elsewhere = self.order_at(self.other_school)

        self.assertEqual(self.queue_ids(self.boss), {str(here.pk), str(same_city.pk), str(elsewhere.pk)})
        self.assertEqual(self.queue_ids(self.city_admin), {str(here.pk), str(same_city.pk)})
        self.assertEqual(self.queue_ids(self.school_admin), {str(here.pk)})

    def test_staff_check_outside_scope_is_refused_without_calling_razorpay(self):
        elsewhere = self.order_at(self.other_school)
        same_city = self.order_at(self.second_school)
        with patch.object(RazorpayGateway, "fetch_order_payments") as gateway:
            self.assertEqual(
                client_for(self.city_admin).post(f"/api/panel/orders/{elsewhere.pk}/reconcile-payment/").status_code, 404,
            )
            self.assertEqual(
                client_for(self.school_admin).post(f"/api/panel/orders/{same_city.pk}/reconcile-payment/").status_code, 404,
            )
        gateway.assert_not_called()

    def test_parent_and_teacher_cannot_read_the_queue_or_check(self):
        here = self.make_order(razorpay_order_id="order_here_denied")
        for user in (self.parent, self.teacher):
            with self.subTest(role=user.role):
                with patch.object(RazorpayGateway, "fetch_order_payments") as gateway:
                    self.assertEqual(client_for(user).get(QUEUE).status_code, 403)
                    self.assertEqual(
                        client_for(user).post(f"/api/panel/orders/{here.pk}/reconcile-payment/").status_code, 403,
                    )
                gateway.assert_not_called()


class CashOnDeliveryViewTests(RazorpayTestBase):
    def test_cod_amount_is_due_until_delivery_and_never_asks_razorpay(self):
        order = self.make_order(payment_method=Order.PaymentMethod.CASH_ON_DELIVERY)
        url = f"/api/orders/{order.pk}/"
        with patch.object(RazorpayGateway, "fetch_order_payments") as fetch, \
                patch.object(RazorpayGateway, "create_order") as create:
            for status in ("PLACED", "CONFIRMED", "PROCESSING", "PACKED", "DISPATCHED"):
                Order.objects.filter(pk=order.pk).update(status=status)
                with self.subTest(status=status):
                    view = self.parent_client.get(url).json()["payment_view"]
                    self.assertEqual(view["state"], "COD_DUE")
                    self.assertEqual(view["amount_due_paise"], 45000)
                    self.assertFalse(view["can_pay_now"])
            Order.objects.filter(pk=order.pk).update(status="DELIVERED")
            delivered = self.parent_client.get(url).json()
            # Cash was handed over at the door: nothing is still due.
            self.assertEqual(delivered["payment_view"]["state"], "COD_DUE")
            self.assertEqual(delivered["payment_view"]["amount_due_paise"], 0)
            self.assertEqual(delivered["payment_status"], "PENDING")
            self.assertEqual(self.parent_client.post(url + "reconcile-payment/").status_code, 200)
            self.assertEqual(self.parent_client.post(url + "payment/").status_code, 409)
        fetch.assert_not_called()
        create.assert_not_called()

    def test_staff_cancelled_orders_are_not_shown_as_released(self):
        cod = self.make_order(payment_method=Order.PaymentMethod.CASH_ON_DELIVERY, status=Order.Status.CANCELLED)
        online = self.make_order(status=Order.Status.CANCELLED)
        expired = self.make_order(status=Order.Status.CANCELLED, cancel_reason="PAYMENT_EXPIRED")

        cod_view = payment_view(cod)
        self.assertEqual(cod_view["state"], "COD_DUE")
        self.assertEqual(cod_view["amount_due_paise"], 0)
        online_view = payment_view(online)
        self.assertNotEqual(online_view["state"], "RELEASED")
        self.assertFalse(online_view["can_pay_now"])
        self.assertFalse(online_view["can_switch_to_cod"])
        self.assertEqual(payment_view(expired)["state"], "RELEASED")
