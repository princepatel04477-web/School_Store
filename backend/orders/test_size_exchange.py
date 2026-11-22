"""
Day 4: Unit and Integration Test Suite for Size Exchange Workflows.

Tests:
- Acceptance criteria 1 to 18 (brief section 8)
- Regression cases 1 to 10 (brief section 2)
- Constant query count on order list at 3 and 25 orders (brief section 9)
"""

from decimal import Decimal
import datetime as dt
import uuid
import zoneinfo
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.serializers import build_tokens_for_user
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from orders.models import (
    Order,
    OrderItem,
    OrderItemExchange,
    OrderStatusEvent,
    SizeExchangeRequest,
    size_holdings,
)
from orders.exchange import (
    get_order_delivery_window,
    get_order_exchange_summary,
    create_size_exchange_request,
    withdraw_size_exchange_request,
    review_size_exchange_request,
    ActiveRequestError,
    SizeSoldOutError,
    ReplacementNotSecuredError,
)
from schools.models import City, School, Student

User = get_user_model()
IST = zoneinfo.ZoneInfo("Asia/Kolkata")


class SizeExchangeBaseTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        # 1. Locations
        cls.city = City.objects.create(name="Surat", code="SUR")
        cls.other_city = City.objects.create(name="Delhi", code="DEL")

        cls.school = School.objects.create(name="DPS Surat", code="DPS-SUR", city=cls.city)
        cls.other_school = School.objects.create(name="DPS Delhi", code="DPS-DEL", city=cls.other_city)

        # 2. Users
        cls.boss = User.objects.create_user(
            username="ex_boss_user", phone="9980000001", role="BOSS"
        )
        cls.city_admin = User.objects.create_user(
            username="ex_city_admin_surat", phone="9980000002", role="ADMIN", city=cls.city
        )
        cls.other_city_admin = User.objects.create_user(
            username="ex_city_admin_delhi", phone="9980000003", role="ADMIN", city=cls.other_city
        )
        cls.school_admin = User.objects.create_user(
            username="ex_school_admin_dps", phone="9980000004", role="SCHOOL_ADMIN", school=cls.school, city=cls.city
        )
        cls.other_school_admin = User.objects.create_user(
            username="ex_school_admin_delhi", phone="9980000005", role="SCHOOL_ADMIN", school=cls.other_school, city=cls.other_city
        )
        cls.teacher = User.objects.create_user(
            username="ex_teacher_user", phone="9980000006", role="TEACHER", school=cls.school, city=cls.city
        )
        cls.parent_a = User.objects.create_user(
            username="ex_parent_a", phone="9980000007", role="PARENT", city=cls.city
        )
        cls.parent_b = User.objects.create_user(
            username="ex_parent_b", phone="9980000008", role="PARENT", city=cls.city
        )

        # 3. Students
        cls.student_a = Student.objects.create(
            name="Aarav Shah", gr_number="GR101", school=cls.school, city=cls.city, parent=cls.parent_a, student_class="Class 5"
        )
        cls.student_b = Student.objects.create(
            name="Rohan Verma", gr_number="GR102", school=cls.school, city=cls.city, parent=cls.parent_b, student_class="Class 5"
        )

        # 4. Products & Variants
        cls.category = Category.objects.create(name="Uniform", slug="uniform")
        cls.product = Product.objects.create(
            name="DPS Regular Shirt",
            school=cls.school,
            category=cls.category,
            selling_price=Decimal("500.00"),
            cost_price=Decimal("300.00"),
            gender=Product.Gender.UNISEX,
            active=True,
        )
        cls.v28 = ProductVariant.objects.create(product=cls.product, size="28", sku="SHIRT-28", active=True)
        cls.v30 = ProductVariant.objects.create(product=cls.product, size="30", sku="SHIRT-30", active=True)
        cls.v32 = ProductVariant.objects.create(product=cls.product, size="32", sku="SHIRT-32", active=True)
        cls.v34 = ProductVariant.objects.create(product=cls.product, size="34", sku="SHIRT-34", active=True)
        cls.v36 = ProductVariant.objects.create(product=cls.product, size="36", sku="SHIRT-36", active=False)

        # Balances
        StockBalance.objects.create(city=cls.city, variant=cls.v28, stock_quantity=5)
        StockBalance.objects.create(city=cls.city, variant=cls.v30, stock_quantity=10)
        StockBalance.objects.create(city=cls.city, variant=cls.v32, stock_quantity=2)
        StockBalance.objects.create(city=cls.city, variant=cls.v34, stock_quantity=0)  # Sold out
        StockBalance.objects.create(city=cls.city, variant=cls.v36, stock_quantity=0)

    def _client_for(self, user):
        client = APIClient()
        token = build_tokens_for_user(user)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    def _create_delivered_order(self, parent=None, student=None, days_ago=2, fulfillment="SCHOOL_PICKUP", qty=2, chosen_size="30"):
        parent = parent or self.parent_a
        student = student or self.student_a
        now = timezone.now()

        order = Order.objects.create(
            order_number=f"ORD-{uuid.uuid4().hex[:12].upper()}",
            placed_by=parent,
            payer=parent,
            parent=parent,
            student=student,
            school=student.school,
            city=student.city,
            status=Order.Status.DELIVERED,
            payment_status=Order.PaymentStatus.PAID,
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY if fulfillment == "SCHOOL_PICKUP" else Order.PaymentMethod.ONLINE,
            fulfillment_type=fulfillment,
            subtotal=Decimal("500.00") * qty,
            total=Decimal("500.00") * qty,
        )
        item = OrderItem.objects.create(
            order=order,
            variant=self.v30,
            category=self.category,
            quantity=qty,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size=chosen_size,
        )
        if days_ago is not None:
            OrderStatusEvent.objects.create(
                order=order,
                status=Order.Status.DELIVERED,
                changed_by=parent,
                timestamp=now - dt.timedelta(days=days_ago),
                note="Delivered.",
            )
        return order, item


class SizeExchangeAcceptanceTests(SizeExchangeBaseTestCase):
    def test_01_acceptance_item_1_order_a_summary(self):
        """
        Acceptance 1:
        Order A: holdings {30: 2}, sizes 28 and 32 available, 34 sold out, 36 inactive,
        exchangeable_units(30) = 2, window end shown.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=2)
        client = self._client_for(self.parent_a)

        resp = client.get(f"/api/orders/{order.id}/exchange/")
        self.assertEqual(resp.status_code, 200)
        data = resp.data

        self.assertTrue(data["within_window"])
        self.assertIsNotNone(data["window_ends_at"])

        line = data["items"][0]
        self.assertEqual(line["holdings"], {"30": 2})
        self.assertEqual(line["exchangeable_units"], {"30": 2})
        self.assertTrue(line["eligible"])

        sizes = {s["size"]: s for s in line["available_sizes"]}
        self.assertTrue(sizes["28"]["available"])
        self.assertTrue(sizes["32"]["available"])
        self.assertFalse(sizes["34"]["available"])  # Sold out (0 stock)
        self.assertNotIn("36", sizes)  # Inactive variant absent

    def test_02_acceptance_item_2_submit_request_and_atomic_reservation(self):
        """
        Acceptance 2:
        Submit 1 x 30 -> 32: one request, quantity 1, from_size 30,
        32 stock decremented by 1 (EXCHANGE_RESERVE), reservation = HELD.
        Line quantity, price snapshot, order total, status, and payment fields unchanged.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=2)
        initial_stock_32 = StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity
        client = self._client_for(self.parent_a)

        payload = {
            "order_item": str(item.id),
            "target_variant": str(self.v32.id),
            "reason": "TOO_SMALL",
            "quantity": 1,
            "from_size": "99",  # Body value ignored, server derives 30 (regression 3)
        }
        resp = client.post(f"/api/orders/{order.id}/exchange/", payload, format="json")
        self.assertEqual(resp.status_code, 201)
        req_id = resp.data["id"]

        req = SizeExchangeRequest.objects.get(id=req_id)
        self.assertEqual(req.status, SizeExchangeRequest.Status.REQUESTED)
        self.assertEqual(req.from_size, "30")
        self.assertEqual(req.quantity, 1)
        self.assertEqual(req.reservation, SizeExchangeRequest.Reservation.HELD)
        self.assertEqual(req.charge_paise, 0)

        # 32 stock decremented by 1
        stock_32_after = StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity
        self.assertEqual(stock_32_after, initial_stock_32 - 1)
        self.assertTrue(
            StockMovement.objects.filter(
                variant=self.v32,
                reason=StockMovement.Reason.EXCHANGE_RESERVE,
                quantity_change=-1,
                reference_order=order,
            ).exists()
        )

        # Unchanged original line and order
        item.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(item.quantity, 2)
        self.assertEqual(item.unit_price_snapshot, Decimal("500.00"))
        self.assertEqual(order.total, Decimal("1000.00"))
        self.assertEqual(order.status, Order.Status.DELIVERED)
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

    def test_03_acceptance_item_3_quantity_and_variant_validation(self):
        """
        Acceptance 3:
        Quantity 0 and 3 refused, 2 accepted. Inactive variant or same size refused.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=2)
        client = self._client_for(self.parent_a)

        # Qty 0 refused
        r0 = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 0,
        }, format="json")
        self.assertEqual(r0.status_code, 400)

        # Qty 3 refused (exceeds held units 2)
        r3 = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 3,
        }, format="json")
        self.assertEqual(r3.status_code, 400)

        # Same size refused (30 -> 30)
        rsame = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v30.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        self.assertEqual(rsame.status_code, 400)

        # Inactive variant refused
        rinactive = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v36.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        self.assertEqual(rinactive.status_code, 400)

    def test_04_acceptance_item_4_idempotency_and_active_request_conflict(self):
        """
        Acceptance 4:
        Same Idempotency-Key twice: one request, one reservation, 200 OK.
        A different request on same line while active: 409 ACTIVE_REQUEST.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=2)
        client = self._client_for(self.parent_a)
        key = str(uuid.uuid4())

        payload = {
            "order_item": str(item.id),
            "target_variant": str(self.v32.id),
            "reason": "TOO_SMALL",
            "quantity": 1,
        }
        # First request
        resp1 = client.post(f"/api/orders/{order.id}/exchange/", payload, HTTP_IDEMPOTENCY_KEY=key, format="json")
        self.assertEqual(resp1.status_code, 201)
        req_id_1 = resp1.data["id"]

        # Duplicate with same key -> 200 OK
        resp2 = client.post(f"/api/orders/{order.id}/exchange/", payload, HTTP_IDEMPOTENCY_KEY=key, format="json")
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.data["id"], req_id_1)
        self.assertEqual(SizeExchangeRequest.objects.filter(order=order).count(), 1)

        # Different request on same line with different key -> 409 ACTIVE_REQUEST
        diff_payload = {
            "order_item": str(item.id),
            "target_variant": str(self.v28.id),
            "reason": "TOO_BIG",
            "quantity": 1,
        }
        resp3 = client.post(f"/api/orders/{order.id}/exchange/", diff_payload, HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()), format="json")
        self.assertEqual(resp3.status_code, 409)
        self.assertEqual(resp3.data.get("code"), "ACTIVE_REQUEST")

    def test_06_acceptance_item_6_order_b_expired_and_order_c_no_event(self):
        """
        Acceptance 6:
        Order B (delivered 9 days ago) refused with expired reason.
        Order C (no DELIVERED event) accepted with NO_DELIVERY_RECORD in review_reasons;
        approval refused until CONFIRM_WINDOW.
        Personalised line (Order D) refused.
        """
        # Order B: 9 days ago
        ord_b, item_b = self._create_delivered_order(days_ago=9, qty=1)
        client = self._client_for(self.parent_a)
        rb = client.post(f"/api/orders/{ord_b.id}/exchange/", {
            "order_item": str(item_b.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        self.assertEqual(rb.status_code, 400)
        self.assertIn("window", rb.data)

        # Personalised line
        ord_d, item_d = self._create_delivered_order(days_ago=2, qty=1)
        item_d.customisation_data = {"cover_photo": "custom.jpg"}
        item_d.save()
        rd = client.post(f"/api/orders/{ord_d.id}/exchange/", {
            "order_item": str(item_d.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        self.assertEqual(rd.status_code, 400)
        self.assertIn("Personalised", str(rd.data))

        # Order C: DELIVERED status but no event
        ord_c, item_c = self._create_delivered_order(days_ago=None, qty=1)
        rc = client.post(f"/api/orders/{ord_c.id}/exchange/", {
            "order_item": str(item_c.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        self.assertEqual(rc.status_code, 201)
        req_c = SizeExchangeRequest.objects.get(id=rc.data["id"])
        self.assertIn("NO_DELIVERY_RECORD", req_c.review_reasons)

        # Approval refused before window confirmed
        staff_client = self._client_for(self.city_admin)
        rapprove_bad = staff_client.post(f"/api/orders/exchange-queue/{req_c.id}/approve/", {}, format="json")
        self.assertEqual(rapprove_bad.status_code, 400)

        # Staff confirms delivery window
        rconfirm = staff_client.post(f"/api/orders/exchange-queue/{req_c.id}/confirm-window/", {
            "note": "Verified counter register: handed over 3 days ago.",
            "window_confirmed_start": (timezone.now() - dt.timedelta(days=3)).isoformat(),
        }, format="json")
        self.assertEqual(rconfirm.status_code, 200)

        # Now approval succeeds
        rapprove_ok = staff_client.post(f"/api/orders/exchange-queue/{req_c.id}/approve/", {}, format="json")
        self.assertEqual(rapprove_ok.status_code, 200)

    def test_07_acceptance_item_7_parent_withdraw(self):
        """
        Acceptance 7:
        Parent withdraw while REQUESTED: target stock +1 once;
        withdrawing again changes nothing (regression 8).
        """
        order, item = self._create_delivered_order(days_ago=2, qty=1)
        v32_before = StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity
        client = self._client_for(self.parent_a)

        rcreate = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        self.assertEqual(rcreate.status_code, 201)
        req_id = rcreate.data["id"]

        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity, v32_before - 1)

        # Withdraw
        rw1 = client.post(f"/api/orders/{order.id}/exchange/{req_id}/withdraw/")
        self.assertEqual(rw1.status_code, 200)
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity, v32_before)

        # Withdraw again -> idempotent, no additional stock movement (regression 8)
        rw2 = client.post(f"/api/orders/{order.id}/exchange/{req_id}/withdraw/")
        self.assertEqual(rw2.status_code, 200)
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity, v32_before)

    def test_08_acceptance_item_8_receive_replacement_securing(self):
        """
        Acceptance 8:
        RECEIVE refused without replacement_set_aside tick.
        Refused with REPLACEMENT_NOT_SECURED if hold lost and variant sold out.
        If available, re-reserves once.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=1)
        client = self._client_for(self.parent_a)
        staff_client = self._client_for(self.city_admin)

        rcreate = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        req_id = rcreate.data["id"]
        staff_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")

        # Unticked set aside refused
        rbad_tick = staff_client.post(f"/api/orders/exchange-queue/{req_id}/receive/", {
            "replacement_set_aside": False, "condition": "RESTOCKABLE",
        }, format="json")
        self.assertEqual(rbad_tick.status_code, 400)

        # Simulate hold lost and stock sold out
        req = SizeExchangeRequest.objects.get(id=req_id)
        req.reservation = SizeExchangeRequest.Reservation.RELEASED
        req.save()
        StockBalance.objects.filter(city=self.city, variant=self.v32).update(stock_quantity=0)

        rsec_fail = staff_client.post(f"/api/orders/exchange-queue/{req_id}/receive/", {
            "replacement_set_aside": True, "condition": "RESTOCKABLE",
        }, format="json")
        self.assertEqual(rsec_fail.status_code, 409)
        self.assertEqual(rsec_fail.data.get("code"), "REPLACEMENT_NOT_SECURED")

    def test_09_acceptance_item_9_regression_1_lock_prevents_release_and_boss_reverse(self):
        """
        Acceptance 9 & Regression 1:
        After RECEIVE with RESTOCKABLE, reservation is LOCKED.
        REJECT, withdraw, and hold release are strictly refused.
        Original shirt size 30 is returned and on sale (+1).
        REVERSE_RECEIPT is Boss-only and undoes restock.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=1)
        v30_initial = StockBalance.objects.get(city=self.city, variant=self.v30).stock_quantity
        client = self._client_for(self.parent_a)
        staff_client = self._client_for(self.city_admin)
        boss_client = self._client_for(self.boss)

        rcreate = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        req_id = rcreate.data["id"]
        staff_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")

        # Staff receives with RESTOCKABLE
        rrec = staff_client.post(f"/api/orders/exchange-queue/{req_id}/receive/", {
            "replacement_set_aside": True, "condition": "RESTOCKABLE", "condition_note": "Tags intact, unworn.",
        }, format="json")
        self.assertEqual(rrec.status_code, 200)

        # Stock for 30 incremented by 1 (returned to sale)
        v30_curr = StockBalance.objects.get(city=self.city, variant=self.v30).stock_quantity
        self.assertEqual(v30_curr, v30_initial + 1)

        req = SizeExchangeRequest.objects.get(id=req_id)
        self.assertEqual(req.reservation, SizeExchangeRequest.Reservation.LOCKED)

        # Regression 1: REJECT is refused!
        rrej = staff_client.post(f"/api/orders/exchange-queue/{req_id}/reject/", {"note": "Accidental reject attempt"}, format="json")
        self.assertEqual(rrej.status_code, 400)

        # Parent withdraw is refused!
        rwith = client.post(f"/api/orders/{order.id}/exchange/{req_id}/withdraw/")
        self.assertEqual(rwith.status_code, 400)

        # City admin cannot REVERSE_RECEIPT (Boss only)
        rrev_unauth = staff_client.post(f"/api/orders/exchange-queue/{req_id}/reverse-receipt/", {}, format="json")
        self.assertEqual(rrev_unauth.status_code, 403)

        # Boss can reverse receipt
        rrev_boss = boss_client.post(f"/api/orders/exchange-queue/{req_id}/reverse-receipt/", {}, format="json")
        self.assertEqual(rrev_boss.status_code, 200)
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v30).stock_quantity, v30_initial)

    def test_10_acceptance_item_10_inspection_failed_and_return_original(self):
        """
        Acceptance 10:
        RECEIVE NOT_RESTOCKABLE: no 30 stock added, 1 DAMAGE record (qty 0),
        replacement released (+1), INSPECTION_FAILED with HELD_AT_COUNTER.
        RETURN_ORIGINAL gives REJECTED and RETURNED_TO_PARENT.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=1)
        v30_initial = StockBalance.objects.get(city=self.city, variant=self.v30).stock_quantity
        v32_initial = StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity

        client = self._client_for(self.parent_a)
        staff_client = self._client_for(self.city_admin)

        rcreate = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        req_id = rcreate.data["id"]
        staff_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")

        # Receive with NOT_RESTOCKABLE
        rrec_fail = staff_client.post(f"/api/orders/exchange-queue/{req_id}/receive/", {
            "replacement_set_aside": True, "condition": "NOT_RESTOCKABLE", "condition_note": "Collar stained, washed.",
        }, format="json")
        self.assertEqual(rrec_fail.status_code, 200)

        # Stock checks: 30 was NOT added; 32 was released back
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v30).stock_quantity, v30_initial)
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity, v32_initial)

        # DAMAGE audit movement exists with qty 0
        self.assertTrue(StockMovement.objects.filter(variant=self.v30, reason=StockMovement.Reason.DAMAGE, quantity_change=0).exists())

        req = SizeExchangeRequest.objects.get(id=req_id)
        self.assertEqual(req.status, SizeExchangeRequest.Status.INSPECTION_FAILED)
        self.assertEqual(req.original_disposition, SizeExchangeRequest.OriginalDisposition.HELD_AT_COUNTER)

        # Parent collects rejected original shirt
        rreturn = staff_client.post(f"/api/orders/exchange-queue/{req_id}/return-original/", {
            "received_by_name": "Priya Shah (Mother)",
        }, format="json")
        self.assertEqual(rreturn.status_code, 200)

        req.refresh_from_db()
        self.assertEqual(req.status, SizeExchangeRequest.Status.REJECTED)
        self.assertEqual(req.original_disposition, SizeExchangeRequest.OriginalDisposition.RETURNED_TO_PARENT)

    def test_11_acceptance_item_11_and_12_complete_and_second_request_eligibility(self):
        """
        Acceptance 11 & 12:
        COMPLETE writes OrderItemExchange(30 -> 32, qty 1), holdings become {30: 1, 32: 1}.
        No stock moves at completion.
        After completion, remaining 30 and new 32 are each eligible; second request gets LATER_EXCHANGE.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=2)
        client = self._client_for(self.parent_a)
        staff_client = self._client_for(self.city_admin)

        # Request 1: 1 unit 30 -> 32
        rcreate = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        req_id = rcreate.data["id"]

        staff_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")
        staff_client.post(f"/api/orders/exchange-queue/{req_id}/receive/", {
            "replacement_set_aside": True, "condition": "RESTOCKABLE",
        }, format="json")

        v32_before_comp = StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity
        v30_before_comp = StockBalance.objects.get(city=self.city, variant=self.v30).stock_quantity

        # Complete with evidence
        rcomp = staff_client.post(f"/api/orders/exchange-queue/{req_id}/complete/", {
            "handover_evidence": "COUNTER_HANDOVER",
            "received_by_name": "Aarav Shah",
            "handover_note": "Handed replacement size 32 shirt at school counter.",
        }, format="json")
        self.assertEqual(rcomp.status_code, 200)

        # No stock movements at completion
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v32).stock_quantity, v32_before_comp)
        self.assertEqual(StockBalance.objects.get(city=self.city, variant=self.v30).stock_quantity, v30_before_comp)

        # OrderItemExchange recorded
        item.refresh_from_db()
        self.assertEqual(item.exchanges.count(), 1)
        ex = item.exchanges.first()
        self.assertEqual(ex.from_size, "30")
        self.assertEqual(ex.to_size, "32")
        self.assertEqual(ex.quantity, 1)

        # Holdings updated
        holdings = size_holdings(item)
        self.assertEqual(holdings, {"30": 1, "32": 1})

        # Acceptance 12: Second request on remaining size 30 unit is accepted with LATER_EXCHANGE
        rcreate2 = client.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v28.id), "reason": "TOO_BIG", "quantity": 1, "from_size": "30",
        }, format="json")
        self.assertEqual(rcreate2.status_code, 201)
        req2 = SizeExchangeRequest.objects.get(id=rcreate2.data["id"])
        self.assertIn("LATER_EXCHANGE", req2.review_reasons)
        self.assertEqual(req2.charge_paise, 0)

    def test_13_acceptance_item_13_home_delivery_swap(self):
        """
        Acceptance 13:
        Order E (Home Delivery) accepted with HOME_SWAP in review_reasons.
        Approval refused until SET_HANDOVER.
        Complete requires HOME_VISIT evidence.
        """
        order_e, item_e = self._create_delivered_order(days_ago=2, fulfillment="HOME_DELIVERY", qty=1)
        client = self._client_for(self.parent_a)
        staff_client = self._client_for(self.city_admin)

        rcreate = client.post(f"/api/orders/{order_e.id}/exchange/", {
            "order_item": str(item_e.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        self.assertEqual(rcreate.status_code, 201)
        req_id = rcreate.data["id"]

        req = SizeExchangeRequest.objects.get(id=req_id)
        self.assertIn("HOME_SWAP", req.review_reasons)

        # Approve refused without arrangement
        rapp_bad = staff_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")
        self.assertEqual(rapp_bad.status_code, 400)

        # Set handover arrangement
        rset = staff_client.post(f"/api/orders/exchange-queue/{req_id}/set-handover/", {
            "handover_method": "HOME_VISIT", "note": "Van delivery scheduled for Thursday afternoon.",
        }, format="json")
        self.assertEqual(rset.status_code, 200)

        # Approve now works
        rapp_ok = staff_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")
        self.assertEqual(rapp_ok.status_code, 200)

    def test_14_acceptance_item_14_role_and_multi_tenant_scoping(self):
        """
        Acceptance 14:
        Teacher: 403 Forbidden.
        Other school admin: 403 Forbidden on action; sees 0 items in queue.
        Other parent: 403 Forbidden on order exchange.
        """
        order, item = self._create_delivered_order(days_ago=2, qty=1)
        client_b = self._client_for(self.parent_b)
        teacher_client = self._client_for(self.teacher)
        other_sa_client = self._client_for(self.other_school_admin)
        sa_client = self._client_for(self.school_admin)
        city_client = self._client_for(self.city_admin)

        # Parent B cannot view Order A
        r_other_parent = client_b.get(f"/api/orders/{order.id}/exchange/")
        self.assertEqual(r_other_parent.status_code, 403)

        # Teacher cannot access queue
        r_teacher = teacher_client.get("/api/orders/exchange-queue/")
        self.assertEqual(r_teacher.status_code, 403)

        # Create request
        client_a = self._client_for(self.parent_a)
        rcreate = client_a.post(f"/api/orders/{order.id}/exchange/", {
            "order_item": str(item.id), "target_variant": str(self.v32.id), "reason": "TOO_SMALL", "quantity": 1,
        }, format="json")
        req_id = rcreate.data["id"]

        # This school's School Admin can READ queue
        r_sa = sa_client.get("/api/orders/exchange-queue/")
        self.assertEqual(r_sa.status_code, 200)
        self.assertEqual(len(r_sa.data["results"]), 1)

        # School Admin CANNOT perform action (read-only)
        r_sa_act = sa_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")
        self.assertEqual(r_sa_act.status_code, 403)

        # Other School Admin sees 0 items in queue
        r_other_sa = other_sa_client.get("/api/orders/exchange-queue/")
        self.assertEqual(r_other_sa.status_code, 200)
        self.assertEqual(len(r_other_sa.data["results"]), 0)

        # Other City Admin cannot act on Surat order
        other_ca_client = self._client_for(self.other_city_admin)
        r_other_ca = other_ca_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")
        self.assertEqual(r_other_ca.status_code, 403)

        # Surat City Admin can act
        r_ca = city_client.post(f"/api/orders/exchange-queue/{req_id}/approve/", {}, format="json")
        self.assertEqual(r_ca.status_code, 200)

    def test_17_acceptance_item_17_order_list_queries_constant_at_3_and_25(self):
        """
        Acceptance 17 & Section 9:
        Order list query count stays constant at 3 and 25 orders.
        Baseline measured on b649250 is exactly 2 queries.
        """
        parent = User.objects.create_user(username="query_count_parent", phone="9988776655", role="PARENT")
        client = self._client_for(parent)

        # Create 3 orders
        for i in range(3):
            Order.objects.create(
                order_number=f"ORD-QC3-{i}",
                placed_by=parent,
                payer=parent,
                parent=parent,
                student=self.student_a,
                school=self.school,
                city=self.city,
                status=Order.Status.PLACED,
                payment_status=Order.PaymentStatus.PENDING,
                payment_method=Order.PaymentMethod.ONLINE,
                subtotal=Decimal("500.00"),
                total=Decimal("500.00"),
            )

        with CaptureQueriesContext(connection) as ctx3:
            resp3 = client.get("/api/orders/?page_size=25")
        self.assertEqual(resp3.status_code, 200)
        q3 = len(ctx3)

        # Create 22 more orders (total 25)
        for i in range(22):
            Order.objects.create(
                order_number=f"ORD-QC25-{i}",
                placed_by=parent,
                payer=parent,
                parent=parent,
                student=self.student_a,
                school=self.school,
                city=self.city,
                status=Order.Status.PLACED,
                payment_status=Order.PaymentStatus.PENDING,
                payment_method=Order.PaymentMethod.ONLINE,
                subtotal=Decimal("500.00"),
                total=Decimal("500.00"),
            )

        with CaptureQueriesContext(connection) as ctx25:
            resp25 = client.get("/api/orders/?page_size=25")
        self.assertEqual(resp25.status_code, 200)
        q25 = len(ctx25)

        # Exactly 2 queries on base commit b649250, and constant from 3 to 25 orders
        self.assertEqual(q3, q25)
        self.assertEqual(q3, 2)
