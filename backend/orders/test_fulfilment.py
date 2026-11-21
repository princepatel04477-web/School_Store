"""
Tests for Day 3 Task A: staff packing and India Post dispatch.
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.core.checks import Error
from django.db import connection, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from common.models import AuditLog
from inventory.services import apply_stock_movement
from orders.fulfilment import (
    PackingRuleNotWired,
    dispatch_order,
    mark_delivered,
    mark_ready_for_pickup,
    pack_orders,
)
from orders.fulfilment_gate import (
    PackingDecision,
    check_fulfilment_fixture_setting,
    get_packing_decision,
)
from orders.models import (
    Order,
    OrderItem,
    OrderStatusEvent,
    Shipment,
    validate_s10_check_digit,
)
from orders.tasks import send_post_delivery_fit_prompts
from schools.models import City, School, Student


class S10CheckDigitTests(TestCase):
    def test_valid_numbers(self):
        # Check digit 5
        self.assertTrue(validate_s10_check_digit("EE123456785IN"))
        self.assertTrue(validate_s10_check_digit("EE000000005IN"))
        # Check digit 0 (remainder 1 -> 11 - 1 = 10 -> 0)
        self.assertTrue(validate_s10_check_digit("EE000000080IN"))
        # Check digit 4
        self.assertTrue(validate_s10_check_digit("EE000000014IN"))

    def test_invalid_check_digit(self):
        self.assertFalse(validate_s10_check_digit("EE123456789IN"))
        self.assertFalse(validate_s10_check_digit("EE000000081IN"))

    def test_invalid_format(self):
        self.assertFalse(validate_s10_check_digit("EE12345678IN"))  # too short
        self.assertFalse(validate_s10_check_digit("EE123456785INA"))  # too long
        self.assertFalse(validate_s10_check_digit("12123456785IN"))  # digits at start
        self.assertFalse(validate_s10_check_digit("EE12345678512"))  # digits at end
        self.assertFalse(validate_s10_check_digit(""))


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

        self.school_a = School.objects.create(name="DPS Pune", code="DPS-PNQ", city=self.city_a)
        self.school_b = School.objects.create(name="DPS Mumbai", code="DPS-BOM", city=self.city_b)

        self.boss = User.objects.create_user(username="boss_user", password="Pass123456!", role="BOSS")
        self.admin_a = User.objects.create_user(username="admin_a", password="Pass123456!", role="ADMIN", city=self.city_a)
        self.admin_b = User.objects.create_user(username="admin_b", password="Pass123456!", role="ADMIN", city=self.city_b)
        self.school_admin = User.objects.create_user(username="school_admin", password="Pass123456!", role="SCHOOL_ADMIN", school=self.school_a, city=self.city_a)
        self.teacher = User.objects.create_user(username="teacher", password="Pass123456!", role="TEACHER", school=self.school_a, city=self.city_a)
        self.parent = User.objects.create_user(username="parent", password="Pass123456!", role="PARENT", school=self.school_a, city=self.city_a)

        self.student_a = Student.objects.create(name="Child A", gr_number="A-01", class_name="4", section="A", school=self.school_a, parent=self.parent)
        self.student_b = Student.objects.create(name="Child B", gr_number="B-01", class_name="5", section="B", school=self.school_b, parent=self.parent)

        cat = Category.objects.create(name="Shirts", slug="shirts")
        prod = Product.objects.create(name="Shirt", category=cat, school=self.school_a, cost_price=Decimal("100"), selling_price=Decimal("200"))
        self.variant_a = ProductVariant.objects.create(product=prod, sku="SHIRT-A", size="M", school=self.school_a)
        apply_stock_movement(variant=self.variant_a, city_id=self.city_a.id, quantity_change=50, reason="INITIAL")

    def make_order(self, city, school, student, order_number, status=Order.Status.CONFIRMED, fulfillment_type=Order.FulfillmentType.HOME_DELIVERY, payment_status=Order.PaymentStatus.PAID):
        order = Order.objects.create(
            order_number=order_number,
            city=city,
            school=school,
            student=student,
            placed_by=self.parent,
            status=status,
            payment_status=payment_status,
            fulfillment_type=fulfillment_type,
            subtotal=Decimal("200"),
            total=Decimal("200"),
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant_a,
            category=self.variant_a.product.category,
            quantity=1,
            unit_price_snapshot=Decimal("200"),
            unit_cost_snapshot=Decimal("100"),
        )
        return order

    def auth_client(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c


class GateAndPackTests(FulfilmentBaseTestCase):
    def test_missing_rule_returns_not_wired_and_pack_endpoint_returns_503(self):
        order = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-503-1")
        with override_settings(DEBUG=False, FULFILMENT_PACKING_FIXTURE=""):
            # Ensure the gate returns not wired
            decision = get_packing_decision(order)
            self.assertFalse(decision.allowed)
            self.assertEqual(decision.reason, "PACKING_RULE_NOT_WIRED")

            # Pack endpoint returns 503 and changes nothing
            client = self.auth_client(self.admin_a)
            res = client.post("/api/fulfilment/pack/", {"order_ids": [str(order.id)]}, format="json")
            self.assertEqual(res.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
            self.assertEqual(res.data.get("code"), "PACKING_RULE_NOT_WIRED")

            order.refresh_from_db()
            self.assertEqual(order.status, Order.Status.CONFIRMED)
            self.assertFalse(OrderStatusEvent.objects.filter(order=order, status=Order.Status.PACKED).exists())

    @override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE="allow")
    @patch("orders.tasks.send_order_status_push.delay")
    @patch("orders.tasks.refresh_order_summary.delay")
    def test_fixture_allowed_packs_order_with_event_audit_and_push(self, mock_refresh, mock_push):
        order = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-PACK-1")
        client = self.auth_client(self.admin_a)
        with self.captureOnCommitCallbacks(execute=True):
            res = client.post("/api/fulfilment/pack/", {"order_ids": [str(order.id)], "note": "Checked and packed."}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["packed_ids"], [str(order.id)])
        self.assertEqual(res.data["blocked"], [])

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PACKED)

        event = OrderStatusEvent.objects.get(order=order, status=Order.Status.PACKED)
        self.assertEqual(event.changed_by, self.admin_a)
        self.assertEqual(event.note, "Checked and packed.")

        audit = AuditLog.objects.filter(target_id=str(order.id), action=AuditLog.Action.ORDER_STATUS_CHANGED).latest("created_at")
        self.assertEqual(audit.actor, self.admin_a)
        self.assertEqual(audit.details["new_status"], Order.Status.PACKED)

        mock_push.assert_called_once_with(str(order.id), Order.Status.PACKED)
        mock_refresh.assert_called_once_with(str(order.id))

    def test_each_blocked_reason_leaves_order_unchanged(self):
        blocked_codes = [
            "PAYMENT_NOT_VERIFIED",
            "PAYMENT_FAILED",
            "RESERVATION_RELEASED",
            "REFUND_PENDING",
            "ORDER_NOT_PACKABLE",
        ]
        for code in blocked_codes:
            with override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE=code):
                order = self.make_order(self.city_a, self.school_a, self.student_a, f"ORD-BLK-{code}")
                client = self.auth_client(self.admin_a)
                res = client.post("/api/fulfilment/pack/", {"order_ids": [str(order.id)]}, format="json")
                self.assertEqual(res.status_code, status.HTTP_200_OK)
                self.assertEqual(res.data["packed_ids"], [])
                self.assertEqual(len(res.data["blocked"]), 1)
                self.assertEqual(res.data["blocked"][0]["order_id"], str(order.id))
                self.assertEqual(res.data["blocked"][0]["reason"], code)

                order.refresh_from_db()
                self.assertEqual(order.status, Order.Status.CONFIRMED)
                self.assertFalse(OrderStatusEvent.objects.filter(order=order, status=Order.Status.PACKED).exists())

    def test_gate_called_with_order_locked_inside_atomic_block(self):
        order = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-LOCK-1")
        gate_calls = []

        def fake_gate(ord_obj):
            in_atomic = connection.in_atomic_block
            gate_calls.append({"order_id": ord_obj.id, "in_atomic": in_atomic})
            return PackingDecision(True, None, "Allowed")

        with patch("orders.fulfilment.get_packing_decision", side_effect=fake_gate):
            res = pack_orders(Order.objects.filter(id=order.id), self.admin_a)
            self.assertEqual(len(gate_calls), 1)
            self.assertTrue(gate_calls[0]["in_atomic"])
            self.assertEqual(gate_calls[0]["order_id"], order.id)
            self.assertEqual(res.packed_ids, [str(order.id)])


class GenericPathBypassTests(FulfilmentBaseTestCase):
    def test_unpaid_placed_order_cannot_reach_packed(self):
        order = self.make_order(
            self.city_a, self.school_a, self.student_a, "ORD-BYPASS-1",
            status=Order.Status.PLACED, payment_status=Order.PaymentStatus.PENDING
        )
        client = self.auth_client(self.admin_a)

        # 1. PATCH /api/orders/{id}/
        res_patch = client.patch(f"/api/orders/{order.id}/", {"status": "PACKED"}, format="json")
        self.assertEqual(res_patch.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Use the fulfilment actions for this step.", str(res_patch.data.get("status", [])))

        # 2. POST /api/orders/bulk-status/
        res_bulk = client.post("/api/orders/bulk-status/", {"order_ids": [str(order.id)], "status": "PACKED"}, format="json")
        self.assertEqual(res_bulk.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. POST /api/fulfilment/pack/ (pack_orders only filters CONFIRMED and PROCESSING)
        with override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE="allow"):
            res_pack = client.post("/api/fulfilment/pack/", {"order_ids": [str(order.id)]}, format="json")
            self.assertEqual(res_pack.status_code, status.HTTP_200_OK)
            self.assertEqual(res_pack.data["packed_ids"], [])

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PLACED)

    def test_generic_change_status_refuses_processing_packed_dispatched_delivered(self):
        client = self.auth_client(self.admin_a)
        order = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-REFUSE-1", status=Order.Status.CONFIRMED)

        for st in ["PROCESSING", "PACKED", "DISPATCHED", "DELIVERED"]:
            res = client.patch(f"/api/orders/{order.id}/", {"status": st}, format="json")
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("Use the fulfilment actions for this step.", str(res.data.get("status", [])))

        # Cancel still works in generic path
        res_cancel = client.patch(f"/api/orders/{order.id}/", {"status": "CANCELLED"}, format="json")
        self.assertEqual(res_cancel.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)


class ScopingAndRolePermissionTests(FulfilmentBaseTestCase):
    @override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE="allow")
    def test_admin_city_a_cannot_see_or_act_on_city_b_orders(self):
        order_b = self.make_order(self.city_b, self.school_b, self.student_b, "ORD-B-1", status=Order.Status.CONFIRMED)
        client_a = self.auth_client(self.admin_a)

        # Queue: city B order does not appear
        res_queue = client_a.get("/api/fulfilment/queue/?stage=to_pack")
        self.assertEqual(res_queue.status_code, status.HTTP_200_OK)
        results = res_queue.data.get("results", [])
        self.assertNotIn(str(order_b.id), [r["id"] for r in results])

        # Pack: reported as skipped, not 403 error
        res_pack = client_a.post("/api/fulfilment/pack/", {"order_ids": [str(order_b.id)]}, format="json")
        self.assertEqual(res_pack.status_code, status.HTTP_200_OK)
        self.assertIn(str(order_b.id), res_pack.data["skipped_ids"])
        self.assertEqual(res_pack.data["packed_ids"], [])

        # Dispatch: 404 (scoped get_queryset returns 404, not 403 detail)
        res_dispatch = client_a.post(f"/api/fulfilment/{order_b.id}/dispatch/", {"consignment_number": "EE123456785IN"}, format="json")
        self.assertEqual(res_dispatch.status_code, status.HTTP_404_NOT_FOUND)

        order_b.refresh_from_db()
        self.assertEqual(order_b.status, Order.Status.CONFIRMED)

    def test_disallowed_roles_get_403_on_all_fulfilment_endpoints(self):
        order = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-403-1")
        disallowed_users = [self.school_admin, self.teacher, self.parent]

        for user in disallowed_users:
            client = self.auth_client(user)
            self.assertEqual(client.get("/api/fulfilment/queue/?stage=to_pack").status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(client.post("/api/fulfilment/pack/", {"order_ids": [str(order.id)]}, format="json").status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(client.post(f"/api/fulfilment/{order.id}/dispatch/", {"consignment_number": "EE123456785IN"}, format="json").status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(client.post("/api/fulfilment/ready-for-pickup/", {"order_ids": [str(order.id)]}, format="json").status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(client.post("/api/fulfilment/delivered/", {"order_ids": [str(order.id)]}, format="json").status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE="allow")
    def test_boss_can_act_on_all_cities(self):
        order_a = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-BOSS-A", status=Order.Status.CONFIRMED)
        order_b = self.make_order(self.city_b, self.school_b, self.student_b, "ORD-BOSS-B", status=Order.Status.CONFIRMED)
        client = self.auth_client(self.boss)

        res = client.post("/api/fulfilment/pack/", {"order_ids": [str(order_a.id), str(order_b.id)]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(set(res.data["packed_ids"]), {str(order_a.id), str(order_b.id)})


class DispatchPickupDeliveredEndpointsTests(FulfilmentBaseTestCase):
    def test_dispatch_home_delivery_success_and_case_insensitivity(self):
        order = self.make_order(
            self.city_a, self.school_a, self.student_a, "ORD-DISP-1",
            status=Order.Status.PACKED, fulfillment_type=Order.FulfillmentType.HOME_DELIVERY
        )
        client = self.auth_client(self.admin_a)

        # Pass lowercase consignment number
        res = client.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"consignment_number": "ee123456785in"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["consignment_number"], "EE123456785IN")

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DISPATCHED)
        self.assertEqual(order.shipment.consignment_number, "EE123456785IN")

        event = OrderStatusEvent.objects.get(order=order, status=Order.Status.DISPATCHED)
        self.assertEqual(event.note, "India Post EE123456785IN")
        self.assertEqual(event.changed_by, self.admin_a)

    def test_dispatch_refuses_pickup_order(self):
        order = self.make_order(
            self.city_a, self.school_a, self.student_a, "ORD-DISP-PU",
            status=Order.Status.PACKED, fulfillment_type=Order.FulfillmentType.SCHOOL_PICKUP
        )
        client = self.auth_client(self.admin_a)
        res = client.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"consignment_number": "EE123456785IN"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PACKED)

    def test_dispatch_refuses_non_packed_order(self):
        order = self.make_order(
            self.city_a, self.school_a, self.student_a, "ORD-DISP-CONF",
            status=Order.Status.CONFIRMED, fulfillment_type=Order.FulfillmentType.HOME_DELIVERY
        )
        client = self.auth_client(self.admin_a)
        res = client.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"consignment_number": "EE123456785IN"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_dispatch_duplicate_consignment_number_refused_with_409(self):
        order1 = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-DUP-1", status=Order.Status.PACKED)
        order2 = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-DUP-2", status=Order.Status.PACKED)
        client = self.auth_client(self.admin_a)

        res1 = client.post(f"/api/fulfilment/{order1.id}/dispatch/", {"consignment_number": "EE123456785IN"}, format="json")
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        res2 = client.post(f"/api/fulfilment/{order2.id}/dispatch/", {"consignment_number": "EE123456785IN"}, format="json")
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)

    def test_dispatch_invalid_check_digit_returns_400(self):
        order = self.make_order(self.city_a, self.school_a, self.student_a, "ORD-BAD-S10", status=Order.Status.PACKED)
        client = self.auth_client(self.admin_a)
        res = client.post(f"/api/fulfilment/{order.id}/dispatch/", {"consignment_number": "EE123456789IN"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_ready_for_pickup_endpoint(self):
        order_pickup = self.make_order(
            self.city_a, self.school_a, self.student_a, "ORD-PU-1",
            status=Order.Status.PACKED, fulfillment_type=Order.FulfillmentType.SCHOOL_PICKUP
        )
        order_home = self.make_order(
            self.city_a, self.school_a, self.student_a, "ORD-PU-HOME",
            status=Order.Status.PACKED, fulfillment_type=Order.FulfillmentType.HOME_DELIVERY
        )
        client = self.auth_client(self.admin_a)

        res = client.post("/api/fulfilment/ready-for-pickup/", {"order_ids": [str(order_pickup.id), str(order_home.id)]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["updated_ids"], [str(order_pickup.id)])

        order_pickup.refresh_from_db()
        self.assertEqual(order_pickup.status, Order.Status.DISPATCHED)
        self.assertFalse(hasattr(order_pickup, "shipment"))
        event = OrderStatusEvent.objects.get(order=order_pickup, status=Order.Status.DISPATCHED)
        self.assertEqual(event.note, "Ready at the school counter.")

        order_home.refresh_from_db()
        self.assertEqual(order_home.status, Order.Status.PACKED)

    def test_delivered_endpoint_and_fit_prompts_task_regression(self):
        order = self.make_order(
            self.city_a, self.school_a, self.student_a, "ORD-DELIV-1",
            status=Order.Status.DISPATCHED
        )
        client = self.auth_client(self.admin_a)

        res = client.post("/api/fulfilment/delivered/", {"order_ids": [str(order.id)]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["updated_ids"], [str(order.id)])

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.DELIVERED)
        event = OrderStatusEvent.objects.get(order=order, status=Order.Status.DELIVERED)
        self.assertEqual(event.note, "Delivered.")

        # Test regression for send_post_delivery_fit_prompts:
        # Move event.timestamp into the 5-day delivery window
        target_time = timezone.now() - timedelta(days=5, hours=1)
        OrderStatusEvent.objects.filter(id=event.id).update(timestamp=target_time)

        # Running the task should succeed without raising FieldError (was created_at, now timestamp)
        sent = send_post_delivery_fit_prompts()
        self.assertGreaterEqual(sent, 0)


class QueueQueryCountAndSerializationTests(FulfilmentBaseTestCase):
    @override_settings(DEBUG=True, FULFILMENT_PACKING_FIXTURE="allow")
    def test_queue_query_count_stays_flat_for_1_and_50_orders(self):
        # Create 50 orders
        for i in range(50):
            self.make_order(
                self.city_a, self.school_a, self.student_a,
                f"ORD-FLAT-{i:03d}", status=Order.Status.CONFIRMED
            )

        client = self.auth_client(self.admin_a)

        # Call with page_size=1
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx_1:
            res_1 = client.get("/api/fulfilment/queue/?stage=to_pack&page_size=1")
            self.assertEqual(res_1.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res_1.data["results"]), 1)

        q_count = len(ctx_1)

        # Call with page_size=50: query count should stay flat
        with self.assertNumQueries(q_count):
            res_50 = client.get("/api/fulfilment/queue/?stage=to_pack&page_size=50")
            self.assertEqual(res_50.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res_50.data["results"]), 50)
