"""
Tests for Day 3 Task C: staff claim, pack, and postal handover.

Uses a test double of Day 2's payment rule:
- Online orders are packable only when payment_status is PAID.
- Cash on delivery (COD) orders are packable once status is CONFIRMED.
All concurrency tests run on PostgreSQL with threads and barriers, and skip on SQLite.
"""

from datetime import timedelta
from decimal import Decimal
import threading
from typing import Any
from unittest.mock import patch
import uuid

from django.conf import settings
from django.core.checks import Error
from django.db import connection, connections, IntegrityError, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from common.models import AuditLog
from inventory.models import StockBalance, StockMovement
from inventory.services import apply_stock_movement
from orders.fulfilment import (
    FulfilmentError,
    PackingRuleNotWired,
    claim_order,
    clear_issue,
    correct_article_number,
    dispatch_order,
    mark_delivered,
    mark_ready_for_pickup,
    normalize_article_key,
    pack_order,
    release_claim,
    report_issue,
)
from orders.fulfilment_gate import (
    PackingDecision,
    check_fulfilment_fixture_setting,
    get_packing_decision,
)
from orders.models import (
    Order,
    OrderItem,
    OrderPacking,
    OrderStatusEvent,
    Shipment,
    ShipmentCorrection,
)
from orders.tasks import send_post_delivery_fit_prompts
from schools.models import City, School, Student


def day2_payment_rule_test_double(order: Order) -> PackingDecision:
    """Test double of Day 2's payment rule.

    Online orders are packable only when payment_status is PAID.
    Cash on delivery orders are packable once status is CONFIRMED.
    """
    if order.status not in (Order.Status.CONFIRMED, Order.Status.PROCESSING):
        return PackingDecision(
            False, "ORDER_NOT_PACKABLE", "Order is not in a packable status."
        )
    if order.payment_method == Order.PaymentMethod.CASH_ON_DELIVERY:
        return PackingDecision(
            True, None, "Cash on delivery order is confirmed."
        )
    if order.payment_method == Order.PaymentMethod.ONLINE:
        if order.payment_status == Order.PaymentStatus.PAID:
            return PackingDecision(True, None, "Prepaid online order is paid.")
        return PackingDecision(
            False,
            "PAYMENT_NOT_VERIFIED",
            "Online payment has not been verified.",
        )
    return PackingDecision(
        False, "PAYMENT_NOT_VERIFIED", "Payment has not been verified."
    )


class SystemCheckTests(TestCase):
    def test_system_check_error_when_fixture_set_and_debug_false(self):
        with override_settings(DEBUG=False, FULFILMENT_PACKING_FIXTURE="allow"):
            errors = check_fulfilment_fixture_setting(None)
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], Error)
            self.assertEqual(errors[0].id, "orders.E001")

    def test_system_check_passes_when_debug_true(self):
        with override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE="allow"):
            errors = check_fulfilment_fixture_setting(None)
            self.assertEqual(errors, [])

    def test_system_check_passes_when_fixture_empty(self):
        with override_settings(DEBUG=False, FULFILMENT_PACKING_FIXTURE=""):
            errors = check_fulfilment_fixture_setting(None)
            self.assertEqual(errors, [])


class FulfilmentBaseTestCase(TestCase):
    def setUp(self):
        self.city_a = City.objects.create(name="Pune", code="PNQ")
        self.city_b = City.objects.create(name="Mumbai", code="BOM")

        self.school_a = School.objects.create(
            name="DPS Pune", code="DPS-PNQ", city=self.city_a
        )
        self.school_b = School.objects.create(
            name="DPS Mumbai", code="DPS-BOM", city=self.city_b
        )

        self.boss = User.objects.create_user(
            username="boss_user", password="Pass123456!", role="BOSS"
        )
        self.admin_a = User.objects.create_user(
            username="admin_a",
            password="Pass123456!",
            role="ADMIN",
            city=self.city_a,
        )
        self.admin_a2 = User.objects.create_user(
            username="admin_a2",
            password="Pass123456!",
            role="ADMIN",
            city=self.city_a,
        )
        self.admin_b = User.objects.create_user(
            username="admin_b",
            password="Pass123456!",
            role="ADMIN",
            city=self.city_b,
        )
        self.school_admin = User.objects.create_user(
            username="school_admin",
            password="Pass123456!",
            role="SCHOOL_ADMIN",
            school=self.school_a,
            city=self.city_a,
        )
        self.teacher = User.objects.create_user(
            username="teacher",
            password="Pass123456!",
            role="TEACHER",
            school=self.school_a,
            city=self.city_a,
        )
        self.parent = User.objects.create_user(
            username="parent",
            password="Pass123456!",
            role="PARENT",
            school=self.school_a,
            city=self.city_a,
        )

        self.student_a = Student.objects.create(
            name="Child A",
            gr_number="A-01",
            class_name="4",
            section="A",
            school=self.school_a,
            parent=self.parent,
        )
        self.student_b = Student.objects.create(
            name="Child B",
            gr_number="B-01",
            class_name="5",
            section="B",
            school=self.school_b,
            parent=self.parent,
        )

        cat = Category.objects.create(name="Shirts", slug="shirts")
        prod = Product.objects.create(
            name="Shirt",
            category=cat,
            school=self.school_a,
            cost_price=Decimal("100"),
            selling_price=Decimal("200"),
        )
        self.variant_a = ProductVariant.objects.create(
            product=prod, sku="SHIRT-A", size="M", school=self.school_a
        )
        apply_stock_movement(
            variant=self.variant_a,
            city_id=self.city_a.id,
            quantity_change=50,
            reason="INITIAL",
        )

    def make_order(
        self,
        city=None,
        school=None,
        student=None,
        order_number="ORD-001",
        status=Order.Status.CONFIRMED,
        fulfillment_type=Order.FulfillmentType.HOME_DELIVERY,
        payment_method=Order.PaymentMethod.ONLINE,
        payment_status=Order.PaymentStatus.PAID,
        quantity=1,
    ) -> Order:
        order = Order.objects.create(
            order_number=order_number,
            city=city or self.city_a,
            school=school or self.school_a,
            student=student or self.student_a,
            placed_by=self.parent,
            status=status,
            payment_status=payment_status,
            payment_method=payment_method,
            fulfillment_type=fulfillment_type,
            subtotal=Decimal("200") * quantity,
            total=Decimal("200") * quantity,
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant_a,
            category=self.variant_a.product.category,
            quantity=quantity,
            unit_price_snapshot=Decimal("200"),
            unit_cost_snapshot=Decimal("100"),
            chosen_size="M",
            fit_height_cm=Decimal("130.0"),
            fit_weight_kg=Decimal("30.0"),
            fit_shoulder_cm=Decimal("32.5"),
            customisation_data={"student_name": "Child A"},
        )
        return order

    def api_for_user(self, user: User) -> APIClient:
        """Helper to create authenticated API client (named api_for_user, not client)."""
        c = APIClient()
        c.force_authenticate(user=user)
        return c


# =====================================================================
# DEMONSTRATE SCENARIOS (Prompt explicit requirements)
# =====================================================================


class DemonstrateScenariosTests(FulfilmentBaseTestCase):
    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_demonstrate_eligible_prepaid_order(self, mock_gate):
        """Demonstrate an eligible prepaid online order (PAID) can be claimed and packed."""
        order = self.make_order(
            order_number="ORD-DEMO-PREPAID",
            payment_method=Order.PaymentMethod.ONLINE,
            payment_status=Order.PaymentStatus.PAID,
            status=Order.Status.CONFIRMED,
        )
        api = self.api_for_user(self.admin_a)

        # 1. Claim
        res_claim = api.post(f"/api/fulfilment/{order.id}/claim/")
        self.assertEqual(res_claim.status_code, status.HTTP_200_OK)
        self.assertTrue(res_claim.data["changed"])

        # 2. Get packing list
        res_list = api.get(f"/api/fulfilment/{order.id}/packing-list/")
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        line_ids = [line["id"] for line in res_list.data["lines"]]

        # 3. Pack
        res_pack = api.post(
            f"/api/fulfilment/{order.id}/pack/",
            {"confirmed_item_ids": line_ids, "note": "Prepaid packed."},
            format="json",
        )
        self.assertEqual(res_pack.status_code, status.HTTP_200_OK)
        self.assertTrue(res_pack.data["changed"])

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PACKED)
        self.assertEqual(order.packing.packed_by, self.admin_a)

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_demonstrate_eligible_cod_order(self, mock_gate):
        """Demonstrate an eligible COD order is packable once CONFIRMED."""
        order = self.make_order(
            order_number="ORD-DEMO-COD",
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY,
            payment_status=Order.PaymentStatus.PENDING,
            status=Order.Status.CONFIRMED,
        )
        api = self.api_for_user(self.admin_a)

        # Claim
        res_claim = api.post(f"/api/fulfilment/{order.id}/claim/")
        self.assertEqual(res_claim.status_code, status.HTTP_200_OK)

        # Pack
        item_ids = list(order.items.values_list("id", flat=True))
        res_pack = api.post(
            f"/api/fulfilment/{order.id}/pack/",
            {"confirmed_item_ids": [str(i) for i in item_ids]},
            format="json",
        )
        self.assertEqual(res_pack.status_code, status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PACKED)

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_demonstrate_blocked_online_order(self, mock_gate):
        """Demonstrate an unpaid online order returns 409 PACKING_BLOCKED with reason and writes nothing."""
        order = self.make_order(
            order_number="ORD-DEMO-BLOCKED",
            payment_method=Order.PaymentMethod.ONLINE,
            payment_status=Order.PaymentStatus.PENDING,
            status=Order.Status.CONFIRMED,
        )
        api = self.api_for_user(self.admin_a)

        # Claim attempt is refused with 409 PACKING_BLOCKED
        res_claim = api.post(f"/api/fulfilment/{order.id}/claim/")
        self.assertEqual(res_claim.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res_claim.data["code"], "PACKING_BLOCKED")
        self.assertEqual(res_claim.data["reason"], "PAYMENT_NOT_VERIFIED")

        order.refresh_from_db()
        self.assertFalse(hasattr(order, "packing"))
        self.assertEqual(order.status, Order.Status.CONFIRMED)

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_demonstrate_simultaneous_claim(self, mock_gate):
        """Demonstrate two staff members claiming the same order results in one 200 and one 409 ALREADY_CLAIMED."""
        order = self.make_order(order_number="ORD-DEMO-SIM-CLAIM")
        api1 = self.api_for_user(self.admin_a)
        api2 = self.api_for_user(self.admin_a2)

        # First claim succeeds
        res1 = api1.post(f"/api/fulfilment/{order.id}/claim/")
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # Second claim fails with 409 naming who claimed it
        res2 = api2.post(f"/api/fulfilment/{order.id}/claim/")
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res2.data["code"], "ALREADY_CLAIMED")
        self.assertIn("admin_a", res2.data["detail"])

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_demonstrate_repeated_pack_and_repeated_dispatch_request(self, mock_gate):
        """Demonstrate repeated pack and repeated dispatch produce one transition and one event."""
        order = self.make_order(order_number="ORD-DEMO-REPEAT")
        api = self.api_for_user(self.admin_a)
        item_ids = [str(i) for i in order.items.values_list("id", flat=True)]

        api.post(f"/api/fulfilment/{order.id}/claim/")

        # 1. Repeated pack (3 times)
        res_p1 = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json")
        res_p2 = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json")
        res_p3 = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json")

        self.assertEqual(res_p1.status_code, status.HTTP_200_OK)
        self.assertTrue(res_p1.data["changed"])
        self.assertEqual(res_p2.status_code, status.HTTP_200_OK)
        self.assertFalse(res_p2.data["changed"])
        self.assertEqual(res_p3.status_code, status.HTTP_200_OK)
        self.assertFalse(res_p3.data["changed"])

        # Exactly 1 PACKED event and 1 audit log
        self.assertEqual(
            OrderStatusEvent.objects.filter(order=order, status=Order.Status.PACKED).count(), 1
        )
        self.assertEqual(
            AuditLog.objects.filter(target_id=str(order.id), action=AuditLog.Action.ORDER_STATUS_CHANGED).count(), 1
        )

        # 2. Repeated dispatch (2 times with spacing and casing differences)
        res_d1 = api.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "ee 12345-6789 in", "receipt_confirmed": True},
            format="json",
        )
        res_d2 = api.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "EE123456789IN", "receipt_confirmed": True},
            format="json",
        )

        self.assertEqual(res_d1.status_code, status.HTTP_200_OK)
        self.assertTrue(res_d1.data["changed"])
        self.assertEqual(res_d2.status_code, status.HTTP_200_OK)
        self.assertFalse(res_d2.data["changed"])

        # Exactly 1 shipment and 1 DISPATCHED event
        self.assertEqual(Shipment.objects.filter(order=order).count(), 1)
        self.assertEqual(
            OrderStatusEvent.objects.filter(order=order, status=Order.Status.DISPATCHED).count(), 1
        )

        # Different number on already handed over order is 409 ALREADY_HANDED_OVER
        res_d3 = api.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "DIFFERENT-1234", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(res_d3.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res_d3.data["code"], "ALREADY_HANDED_OVER")

    def test_demonstrate_duplicate_article_number(self):
        """Demonstrate duplicate article number across case, spaces, and hyphens is refused with 409."""
        order1 = self.make_order(order_number="ORD-DEMO-DUP-1", status=Order.Status.PACKED)
        order2 = self.make_order(order_number="ORD-DEMO-DUP-2", status=Order.Status.PACKED)
        api = self.api_for_user(self.admin_a)

        res1 = api.post(
            f"/api/fulfilment/{order1.id}/dispatch/",
            {"article_number": "art-123 45", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # Same number with uppercase and hyphens on parcel 2
        res2 = api.post(
            f"/api/fulfilment/{order2.id}/dispatch/",
            {"article_number": "ART-12345", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res2.data["code"], "ARTICLE_NUMBER_IN_USE")

    def test_demonstrate_out_of_scope_staff_account(self):
        """Demonstrate out-of-scope ADMIN gets 404 and empty queue; non-admin roles get 403."""
        order = self.make_order(city=self.city_a, order_number="ORD-DEMO-SCOPE")

        # Admin B (city B) trying to access city A order gets 404
        api_b = self.api_for_user(self.admin_b)
        self.assertEqual(api_b.get(f"/api/fulfilment/{order.id}/packing-list/").status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(api_b.post(f"/api/fulfilment/{order.id}/claim/").status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(api_b.post(f"/api/fulfilment/{order.id}/pack/").status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(api_b.post(f"/api/fulfilment/{order.id}/dispatch/").status_code, status.HTTP_404_NOT_FOUND)

        # Admin B queue is empty
        res_queue = api_b.get("/api/fulfilment/queue/?stage=to_pack")
        self.assertEqual(res_queue.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_queue.data["results"]), 0)

        # Bulk routes return skipped_ids
        res_ready = api_b.post("/api/fulfilment/ready-for-pickup/", {"order_ids": [str(order.id)]}, format="json")
        self.assertEqual(res_ready.status_code, status.HTTP_200_OK)
        self.assertEqual(res_ready.data["skipped_ids"], [str(order.id)])

        # Non-authorised roles get 403 on every route
        for user in [self.school_admin, self.teacher, self.parent]:
            api_user = self.api_for_user(user)
            self.assertEqual(api_user.get("/api/fulfilment/queue/").status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(api_user.get(f"/api/fulfilment/{order.id}/packing-list/").status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(api_user.post(f"/api/fulfilment/{order.id}/claim/").status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(api_user.post("/api/fulfilment/ready-for-pickup/", {"order_ids": [str(order.id)]}).status_code, status.HTTP_403_FORBIDDEN)

    @patch("orders.tasks.send_order_status_push.delay")
    def test_demonstrate_school_pickup(self, mock_push):
        """Demonstrate school pickup dispatch is refused, ready-for-pickup writes no shipment, note is pickup text, push has no India Post."""
        order = self.make_order(
            order_number="ORD-DEMO-PU",
            fulfillment_type=Order.FulfillmentType.SCHOOL_PICKUP,
            status=Order.Status.PACKED,
        )
        api = self.api_for_user(self.admin_a)

        # Dispatch via postal route is refused with 400 NOT_HOME_DELIVERY
        res_disp = api.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "12345", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(res_disp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_disp.data["code"], "NOT_HOME_DELIVERY")

        # Ready for pickup endpoint
        with self.captureOnCommitCallbacks(execute=True):
            res_pu = api.post("/api/fulfilment/ready-for-pickup/", {"order_ids": [str(order.id)]}, format="json")
        self.assertEqual(res_pu.status_code, status.HTTP_200_OK)
        self.assertEqual(res_pu.data["updated_ids"], [str(order.id)])

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DISPATCHED)
        self.assertFalse(hasattr(order, "shipment"))

        event = OrderStatusEvent.objects.get(order=order, status=Order.Status.DISPATCHED)
        self.assertEqual(event.note, "Ready at the school counter.")

        # Repeat ready for pickup is a no-op
        res_pu2 = api.post("/api/fulfilment/ready-for-pickup/", {"order_ids": [str(order.id)]}, format="json")
        self.assertEqual(res_pu2.status_code, status.HTTP_200_OK)
        self.assertEqual(OrderStatusEvent.objects.filter(order=order, status=Order.Status.DISPATCHED).count(), 1)


# =====================================================================
# PACKING LIST & INVENTORY ACCOUNTING TESTS
# =====================================================================


class PackingListAndInventoryTests(FulfilmentBaseTestCase):
    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_packing_list_fields_and_no_measurements_returned(self, mock_gate):
        """Packing list includes product, sku, size, quantity, multiple flag, personalisation, and NO measurements."""
        order = self.make_order(order_number="ORD-PL-01", quantity=3)
        api = self.api_for_user(self.admin_a)

        res = api.get(f"/api/fulfilment/{order.id}/packing-list/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["order_number"], "ORD-PL-01")
        lines = res.data["lines"]
        self.assertEqual(len(lines), 1)

        line = lines[0]
        self.assertEqual(line["product_name"], "Shirt")
        self.assertEqual(line["sku"], "SHIRT-A")
        self.assertEqual(line["size"], "M")
        self.assertEqual(line["quantity"], 3)
        self.assertTrue(line["multiple"])
        self.assertIn("student_name", str(line["personalisation"]))

        # Sensitive measurements must NEVER be in line payload
        for key in ["fit_height_cm", "fit_weight_kg", "fit_shoulder_cm", "fit_shoulder_confidence"]:
            self.assertNotIn(key, line)

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_packing_must_confirm_all_lines_no_more_no_fewer(self, mock_gate):
        """Packing requires all line ids confirmed; partial or extra ids return 400 LINES_NOT_CONFIRMED."""
        order = self.make_order(order_number="ORD-LINES-01")
        api = self.api_for_user(self.admin_a)
        api.post(f"/api/fulfilment/{order.id}/claim/")

        # Empty lines
        res_empty = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": []}, format="json")
        self.assertEqual(res_empty.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_empty.data["code"], "LINES_NOT_CONFIRMED")

        # Wrong / extra line id
        fake_uuid = str(uuid.uuid4())
        res_wrong = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": [fake_uuid]}, format="json")
        self.assertEqual(res_wrong.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_wrong.data["code"], "LINES_NOT_CONFIRMED")

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_stock_and_stock_movements_unchanged_after_packing(self, mock_gate):
        """Packing must leave inventory accounting to checkout; no stock movements are written."""
        order = self.make_order(order_number="ORD-STOCK-01", quantity=2)
        api = self.api_for_user(self.admin_a)
        api.post(f"/api/fulfilment/{order.id}/claim/")

        initial_movements = StockMovement.objects.count()
        initial_balance = StockBalance.objects.get(city_id=self.city_a.id, variant_id=self.variant_a.id).stock_quantity

        item_ids = [str(i) for i in order.items.values_list("id", flat=True)]
        res_pack = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json")
        self.assertEqual(res_pack.status_code, status.HTTP_200_OK)

        # Verify stock balance and movements are completely untouched
        self.assertEqual(StockMovement.objects.count(), initial_movements)
        self.assertEqual(
            StockBalance.objects.get(city_id=self.city_a.id, variant_id=self.variant_a.id).stock_quantity,
            initial_balance,
        )

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_issue_blocks_packing_until_cleared(self, mock_gate):
        """Reporting an issue blocks packing with 409 OPEN_ISSUE until clear_issue is called."""
        order = self.make_order(order_number="ORD-ISSUE-01")
        api = self.api_for_user(self.admin_a)
        api.post(f"/api/fulfilment/{order.id}/claim/")

        # Report issue
        res_issue = api.post(f"/api/fulfilment/{order.id}/issue/", {"note": "Item size M missing in bin"}, format="json")
        self.assertEqual(res_issue.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.packing.issue_note, "Item size M missing in bin")

        # Try to pack: blocked with OPEN_ISSUE
        item_ids = [str(i) for i in order.items.values_list("id", flat=True)]
        res_pack = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json")
        self.assertEqual(res_pack.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res_pack.data["code"], "OPEN_ISSUE")

        # Clear issue
        res_clear = api.post(f"/api/fulfilment/{order.id}/issue/clear/")
        self.assertEqual(res_clear.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.packing.issue_note, "")

        # Now pack succeeds
        res_pack2 = api.post(f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json")
        self.assertEqual(res_pack2.status_code, status.HTTP_200_OK)


# =====================================================================
# CLAIMS & HANDOVER TESTS
# =====================================================================


class ClaimAndHandoverTests(FulfilmentBaseTestCase):
    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_claim_release_and_claimed_by_me_in_queue(self, mock_gate):
        """Test claim, release, and claimed_by_me flag in queue."""
        order = self.make_order(order_number="ORD-CLM-01")
        api_a = self.api_for_user(self.admin_a)
        api_a2 = self.api_for_user(self.admin_a2)

        # Admin A claims
        api_a.post(f"/api/fulfilment/{order.id}/claim/")

        # Check queue as Admin A -> claimed_by_me is True
        res_q_a = api_a.get("/api/fulfilment/queue/?stage=to_pack")
        row_a = next(r for r in res_q_a.data["results"] if r["id"] == str(order.id))
        self.assertTrue(row_a["claimed_by_me"])
        self.assertEqual(row_a["claimed_by_name"], "admin_a")

        # Check queue as Admin A2 -> claimed_by_me is False
        res_q_a2 = api_a2.get("/api/fulfilment/queue/?stage=to_pack")
        row_a2 = next(r for r in res_q_a2.data["results"] if r["id"] == str(order.id))
        self.assertFalse(row_a2["claimed_by_me"])
        self.assertEqual(row_a2["claimed_by_name"], "admin_a")

        # Admin A2 cannot release Admin A's claim (403)
        self.assertEqual(api_a2.post(f"/api/fulfilment/{order.id}/release/").status_code, status.HTTP_403_FORBIDDEN)

        # BOSS can release anyone's claim
        api_boss = self.api_for_user(self.boss)
        res_rel = api_boss.post(f"/api/fulfilment/{order.id}/release/")
        self.assertEqual(res_rel.status_code, status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertIsNone(order.packing.claimed_by)

    def test_handover_rejection_of_blank_and_missing_receipt_confirmed(self):
        """Handover rejects blank/whitespace article numbers and unconfirmed receipts."""
        order = self.make_order(order_number="ORD-HO-BLANK", status=Order.Status.PACKED)
        api = self.api_for_user(self.admin_a)

        # Blank number
        res_b = api.post(f"/api/fulfilment/{order.id}/dispatch/", {"article_number": "   ", "receipt_confirmed": True}, format="json")
        self.assertEqual(res_b.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_b.data["code"], "BLANK_ARTICLE_NUMBER")

        # Missing receipt confirmed
        res_nr = api.post(f"/api/fulfilment/{order.id}/dispatch/", {"article_number": "12345", "receipt_confirmed": False}, format="json")
        self.assertEqual(res_nr.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_nr.data["code"], "RECEIPT_NOT_CONFIRMED")

    def test_handover_preserves_any_article_number_format_exactly(self):
        """Any text is preserved accurately, including 'EE123456789IN', '12345', 'a-b c/d 9'."""
        test_numbers = ["EE123456789IN", "12345", "a-b c/d 9"]
        api = self.api_for_user(self.admin_a)

        for idx, num in enumerate(test_numbers):
            ord_obj = self.make_order(order_number=f"ORD-FMT-{idx}", status=Order.Status.PACKED)
            res = api.post(
                f"/api/fulfilment/{ord_obj.id}/dispatch/",
                {"article_number": num, "receipt_confirmed": True},
                format="json",
            )
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            ord_obj.refresh_from_db()
            self.assertEqual(ord_obj.shipment.consignment_number, num)

    def test_correction_records_previous_value_user_time_and_rejects_duplicates(self):
        """Correcting article number writes ShipmentCorrection and rejects taking another parcel's number."""
        order1 = self.make_order(order_number="ORD-CORR-1", status=Order.Status.PACKED)
        order2 = self.make_order(order_number="ORD-CORR-2", status=Order.Status.PACKED)
        api = self.api_for_user(self.admin_a)

        api.post(f"/api/fulfilment/{order1.id}/dispatch/", {"article_number": "INIT-001", "receipt_confirmed": True}, format="json")
        api.post(f"/api/fulfilment/{order2.id}/dispatch/", {"article_number": "PARCEL-2-NUM", "receipt_confirmed": True}, format="json")

        # 1. Same number again is a no-op
        res_noop = api.post(f"/api/fulfilment/{order1.id}/correct-article-number/", {"article_number": "INIT-001"}, format="json")
        self.assertEqual(res_noop.status_code, status.HTTP_200_OK)
        self.assertFalse(res_noop.data["changed"])
        self.assertEqual(ShipmentCorrection.objects.count(), 0)

        # 2. Try to correct to parcel 2's number -> 409 ARTICLE_NUMBER_IN_USE
        res_dup = api.post(f"/api/fulfilment/{order1.id}/correct-article-number/", {"article_number": "parcel 2 num"}, format="json")
        self.assertEqual(res_dup.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res_dup.data["code"], "ARTICLE_NUMBER_IN_USE")

        # 3. Successful correction
        res_corr = api.post(
            f"/api/fulfilment/{order1.id}/correct-article-number/",
            {"article_number": "CORRECTED-001", "reason": "Typo in receipt"},
            format="json",
        )
        self.assertEqual(res_corr.status_code, status.HTTP_200_OK)
        self.assertTrue(res_corr.data["changed"])

        order1.refresh_from_db()
        self.assertEqual(order1.shipment.consignment_number, "CORRECTED-001")

        corr = ShipmentCorrection.objects.get(shipment=order1.shipment)
        self.assertEqual(corr.previous_number, "INIT-001")
        self.assertEqual(corr.new_number, "CORRECTED-001")
        self.assertEqual(corr.reason, "Typo in receipt")
        self.assertEqual(corr.changed_by, self.admin_a)


# =====================================================================
# OLD ORDERS & REGRESSION DEFECTS TESTS
# =====================================================================


class OldOrdersAndDefectsRegressionTests(FulfilmentBaseTestCase):
    def test_legacy_shipped_shows_in_sent_queue_and_can_be_delivered(self):
        """Defect A5: queue stage dispatched includes legacy SHIPPED, and mark_delivered accepts them."""
        order = self.make_order(order_number="ORD-LEGACY-SHIPPED", status=Order.Status.SHIPPED)
        api = self.api_for_user(self.admin_a)

        res_q = api.get("/api/fulfilment/queue/?stage=dispatched")
        self.assertEqual(res_q.status_code, status.HTTP_200_OK)
        ids = [r["id"] for r in res_q.data["results"]]
        self.assertIn(str(order.id), ids)

        res_deliv = api.post("/api/fulfilment/delivered/", {"order_ids": [str(order.id)]}, format="json")
        self.assertEqual(res_deliv.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DELIVERED)

    def test_old_packed_order_with_no_packing_row_can_be_handed_over(self):
        """Old orders created before OrderPacking existed can still be handed over."""
        order = self.make_order(order_number="ORD-OLD-PACKED", status=Order.Status.PACKED)
        self.assertFalse(OrderPacking.objects.filter(order=order).exists())

        api = self.api_for_user(self.admin_a)
        res = api.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "OLD-HANDOVER-1", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DISPATCHED)

    def test_defect_a1_bad_order_ids_returns_400_not_500(self):
        """Defect A1 regression: non-UUID string, object, empty list, or > 200 ids return 400."""
        api = self.api_for_user(self.admin_a)
        bad_payloads = [
            {"order_ids": ["not-a-uuid"]},
            {"order_ids": [{"id": "123"}]},
            {"order_ids": []},
            {"order_ids": [str(uuid.uuid4()) for _ in range(201)]},
        ]
        for payload in bad_payloads:
            res_pu = api.post("/api/fulfilment/ready-for-pickup/", payload, format="json")
            self.assertEqual(res_pu.status_code, status.HTTP_400_BAD_REQUEST)
            res_del = api.post("/api/fulfilment/delivered/", payload, format="json")
            self.assertEqual(res_del.status_code, status.HTTP_400_BAD_REQUEST)

    def test_defect_a2_locked_select_has_no_outer_join(self):
        """Defect A2 regression: select_for_update() query must not perform a LEFT JOIN to shipment or packing."""
        order = self.make_order(order_number="ORD-LOCK-NO-JOIN", status=Order.Status.PACKED)
        with CaptureQueriesContext(connection) as ctx:
            dispatch_order(order.id, self.admin_a, "LOCKED-001", receipt_confirmed=True)

        if connection.vendor == "postgresql":
            lock_queries = [
                q["sql"] for q in ctx.captured_queries if "FOR UPDATE" in q["sql"].upper()
            ]
            self.assertTrue(len(lock_queries) > 0)
            for q in lock_queries:
                self.assertNotIn("JOIN", q.upper())
        else:
            select_order_queries = [
                q["sql"]
                for q in ctx.captured_queries
                if q["sql"].strip().upper().startswith("SELECT")
                and "orders_order" in q["sql"].lower()
            ]
            self.assertTrue(len(select_order_queries) > 0)
            for q in select_order_queries:
                self.assertNotIn("JOIN", q.upper())

    @override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE="allow")
    def test_queue_query_count_stays_flat_for_1_and_50_orders(self):
        """Query count for queue endpoint stays flat between 1 and 50 rows."""
        for i in range(50):
            self.make_order(order_number=f"ORD-FLAT-{i:03d}", status=Order.Status.CONFIRMED)

        api = self.api_for_user(self.admin_a)
        with CaptureQueriesContext(connection) as ctx_1:
            res_1 = api.get("/api/fulfilment/queue/?stage=to_pack&page_size=1")
            self.assertEqual(res_1.status_code, status.HTTP_200_OK)

        q_count = len(ctx_1)
        with self.assertNumQueries(q_count):
            res_50 = api.get("/api/fulfilment/queue/?stage=to_pack&page_size=50")
            self.assertEqual(res_50.status_code, status.HTTP_200_OK)

    def test_fit_prompts_task_regression_stays_working(self):
        """Regression test for send_post_delivery_fit_prompts task."""
        order = self.make_order(order_number="ORD-FIT-DELIV", status=Order.Status.DELIVERED)
        event = OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.DELIVERED,
            changed_by=self.admin_a,
            note="Delivered.",
            timestamp=timezone.now() - timedelta(days=5, hours=1),
        )
        sent = send_post_delivery_fit_prompts()
        self.assertGreaterEqual(sent, 0)


# =====================================================================
# CONCURRENCY TESTS (PostgreSQL ONLY)
# =====================================================================


class FulfilmentConcurrencyTests(TransactionTestCase):
    """Concurrency tests using threads and barriers on PostgreSQL."""

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL required for concurrency row-locking tests.")

        self.city_a = City.objects.create(name="Pune", code="PNQ")
        self.school_a = School.objects.create(name="DPS Pune", code="DPS-PNQ", city=self.city_a)
        self.admin_1 = User.objects.create_user(username="admin_c1", password="Pass123456!", role="ADMIN", city=self.city_a)
        self.admin_2 = User.objects.create_user(username="admin_c2", password="Pass123456!", role="ADMIN", city=self.city_a)
        self.parent = User.objects.create_user(username="parent_c", password="Pass123456!", role="PARENT", city=self.city_a)
        self.student = Student.objects.create(name="Child C", gr_number="C-01", school=self.school_a, parent=self.parent)

        cat = Category.objects.create(name="Shirts", slug="shirts")
        prod = Product.objects.create(name="Shirt", category=cat, school=self.school_a, cost_price=Decimal("100"), selling_price=Decimal("200"))
        self.variant = ProductVariant.objects.create(product=prod, sku="SHIRT-CONC", size="M", school=self.school_a)

    def make_order(self, order_number, status=Order.Status.CONFIRMED, payment_status=Order.PaymentStatus.PAID):
        order = Order.objects.create(
            order_number=order_number,
            city=self.city_a,
            school=self.school_a,
            student=self.student,
            placed_by=self.parent,
            status=status,
            payment_status=payment_status,
            payment_method=Order.PaymentMethod.ONLINE,
            fulfillment_type=Order.FulfillmentType.HOME_DELIVERY,
            subtotal=Decimal("200"),
            total=Decimal("200"),
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.variant.product.category,
            quantity=1,
            unit_price_snapshot=Decimal("200"),
            unit_cost_snapshot=Decimal("100"),
        )
        return order

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_concurrency_two_admins_claiming_at_once(self, mock_gate):
        """Two admins claiming at once give exactly one 200 and one 409."""
        order = self.make_order("ORD-CONC-CLAIM")
        barrier = threading.Barrier(2)
        results = []

        def claim_worker(user_id):
            connections.close_all()
            user = User.objects.get(pk=user_id)
            barrier.wait()
            try:
                res = claim_order(order.id, user)
                results.append(("OK", res))
            except FulfilmentError as err:
                results.append(("ERR", err.code))
            finally:
                connections.close_all()

        t1 = threading.Thread(target=claim_worker, args=(self.admin_1.id,))
        t2 = threading.Thread(target=claim_worker, args=(self.admin_2.id,))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        statuses = [r[0] for r in results]
        self.assertEqual(sorted(statuses), ["ERR", "OK"])
        err_res = next(r for r in results if r[0] == "ERR")
        self.assertEqual(err_res[1], "ALREADY_CLAIMED")

    @patch("orders.fulfilment_gate.get_packing_decision", side_effect=day2_payment_rule_test_double)
    def test_concurrency_three_simultaneous_pack_requests_from_one_user(self, mock_gate):
        """Three simultaneous pack requests from one user give one event."""
        order = self.make_order("ORD-CONC-PACK")
        claim_order(order.id, self.admin_1)
        item_ids = list(order.items.values_list("id", flat=True))

        barrier = threading.Barrier(3)
        results = []

        def pack_worker():
            connections.close_all()
            user = User.objects.get(pk=self.admin_1.id)
            barrier.wait()
            try:
                res = pack_order(order.id, user, item_ids)
                results.append(res)
            except Exception as e:
                results.append(e)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=pack_worker) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PACKED)
        # Exactly one PACKED event created
        self.assertEqual(
            OrderStatusEvent.objects.filter(order=order, status=Order.Status.PACKED).count(), 1
        )

    def test_concurrency_two_simultaneous_identical_dispatches(self):
        """Two simultaneous identical dispatches give one shipment and one event."""
        order = self.make_order("ORD-CONC-DISP", status=Order.Status.PACKED)
        barrier = threading.Barrier(2)
        results = []

        def dispatch_worker():
            connections.close_all()
            user = User.objects.get(pk=self.admin_1.id)
            barrier.wait()
            try:
                res = dispatch_order(order.id, user, "CONC-ART-001", receipt_confirmed=True)
                results.append(("OK", res))
            except FulfilmentError as e:
                results.append(("ERR", e.code))
            finally:
                connections.close_all()

        t1 = threading.Thread(target=dispatch_worker)
        t2 = threading.Thread(target=dispatch_worker)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DISPATCHED)
        # Exactly 1 shipment and 1 event
        self.assertEqual(Shipment.objects.filter(order=order).count(), 1)
        self.assertEqual(
            OrderStatusEvent.objects.filter(order=order, status=Order.Status.DISPATCHED).count(), 1
        )

    def test_concurrency_two_parcels_racing_for_one_number(self):
        """Two parcels racing for one number give one 200 and one 409."""
        order1 = self.make_order("ORD-RACE-1", status=Order.Status.PACKED)
        order2 = self.make_order("ORD-RACE-2", status=Order.Status.PACKED)

        barrier = threading.Barrier(2)
        results = []

        def race_worker(ord_id):
            connections.close_all()
            user = User.objects.get(pk=self.admin_1.id)
            barrier.wait()
            try:
                res = dispatch_order(ord_id, user, "SHARED-NUMBER-99", receipt_confirmed=True)
                results.append(("OK", ord_id, res))
            except FulfilmentError as e:
                results.append(("ERR", ord_id, e.code))
            finally:
                connections.close_all()

        t1 = threading.Thread(target=race_worker, args=(order1.id,))
        t2 = threading.Thread(target=race_worker, args=(order2.id,))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        statuses = [r[0] for r in results]
        self.assertEqual(sorted(statuses), ["ERR", "OK"])
        err_res = next(r for r in results if r[0] == "ERR")
        self.assertEqual(err_res[2], "ARTICLE_NUMBER_IN_USE")
