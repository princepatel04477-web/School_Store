"""
Day 2 + Day 3 Integration Test Suite.

Verifies end-to-end integration between Day 2 (payment verification, stock accounting, packing rules)
and Day 3 (fulfilment claim, packing, India Post handover, parent tracking, scoping).

When orders.payment_rules.packing_decision is importable, runs against the real Day 2 rules.
Otherwise, cases 1 and 2 are skipped with 'Day 2 not merged', while cases 3 to 6 provide SIMULATED
variants utilizing the Task C packing rule test double to exercise the Day 3 half now.
"""

import hashlib
import hmac
import unittest
from decimal import Decimal
from unittest import mock

from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from orders.fulfilment_gate import PackingDecision
from orders.models import Order, OrderItem, OrderStatusEvent, Shipment, OrderPacking, PaymentAttempt
from orders.payment import RazorpayGateway
from schools.models import City, School, Student

try:
    from orders.payment_rules import packing_decision as real_packing_decision
    HAS_DAY2 = True
except ImportError:
    real_packing_decision = None
    HAS_DAY2 = False


@override_settings(RAZORPAY_KEY_ID="rzp_test_key", RAZORPAY_KEY_SECRET="rzp_test_secret")
class Day2Day3IntegrationTests(TestCase):
    def setUp(self):
        self.city = City.objects.create(name="Surat", code="SUR")
        self.school = School.objects.create(name="DPS Surat", code="DPS-SUR", city=self.city)

        self.parent_1 = User.objects.create_user(
            username="parent_one", password="Password123!", role="PARENT", school=self.school, city=self.city
        )
        self.parent_2 = User.objects.create_user(
            username="parent_two", password="Password123!", role="PARENT", school=self.school, city=self.city
        )
        self.city_admin = User.objects.create_user(
            username="surat_admin", password="Password123!", role="ADMIN", school=self.school, city=self.city
        )

        self.student_1 = Student.objects.create(
            name="Aarav Patel", gr_number="GR-1001", class_name="5", section="A", school=self.school, parent=self.parent_1
        )
        self.student_2 = Student.objects.create(
            name="Diya Shah", gr_number="GR-1002", class_name="6", section="B", school=self.school, parent=self.parent_2
        )

        self.cat = Category.objects.create(name="Uniform", slug="uniform")
        prod = Product.objects.create(
            name="Uniform Shirt", category=self.cat, school=self.school, cost_price=Decimal("250.00"), selling_price=Decimal("500.00")
        )
        self.variant = ProductVariant.objects.create(product=prod, sku="SHIRT-5", size="M", school=self.school)

        # Inventory setup: initial stock of 10
        self.stock_balance = StockBalance.objects.create(
            city=self.city,
            variant=self.variant,
            stock_quantity=10,
        )

        self.client_p1 = APIClient()
        self.client_p1.force_authenticate(user=self.parent_1)

        self.client_p2 = APIClient()
        self.client_p2.force_authenticate(user=self.parent_2)

        self.client_staff = APIClient()
        self.client_staff.force_authenticate(user=self.city_admin)

    def _create_order(
        self,
        parent,
        student,
        order_number,
        status_val=Order.Status.PLACED,
        payment_status_val=Order.PaymentStatus.PENDING,
        fulfillment_type=Order.FulfillmentType.HOME_DELIVERY,
        payment_method="ONLINE",
        qty=2,
    ):
        order = Order.objects.create(
            order_number=order_number,
            city=self.city,
            school=self.school,
            student=student,
            parent=parent,
            placed_by=parent,
            payer=parent,
            status=status_val,
            payment_status=payment_status_val,
            fulfillment_type=fulfillment_type,
            payment_method=payment_method,
            subtotal=Decimal("500.00") * qty,
            total=Decimal("500.00") * qty,
            razorpay_order_id=f"order_{order_number}",
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.cat,
            quantity=qty,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("250.00"),
        )
        OrderStatusEvent.objects.create(
            order=order,
            status=status_val,
            changed_by=parent,
            note="Order placed",
            timestamp=timezone.now(),
        )
        # Record checkout stock deduction (ORDER_PLACED)
        StockMovement.objects.create(
            variant=self.variant,
            city=self.city,
            school=self.school,
            reference_order=order,
            quantity_change=-qty,
            reason=StockMovement.Reason.ORDER_PLACED,
            created_by=parent,
        )
        self.stock_balance.stock_quantity -= qty
        self.stock_balance.save(update_fields=["stock_quantity"])

        if payment_method == "ONLINE" and payment_status_val == Order.PaymentStatus.PAID:
            pay_id = f"pay_{order_number}"
            order.razorpay_payment_id = pay_id
            order.payment_checked_at = timezone.now()
            order.payment_check_ok = True
            order.save(update_fields=["razorpay_payment_id", "payment_checked_at", "payment_check_ok"])
            PaymentAttempt.objects.create(
                order=order,
                razorpay_payment_id=pay_id,
                status=PaymentAttempt.Status.CAPTURED,
                amount_paise=int(order.total * 100),
                currency="INR",
                last_source=PaymentAttempt.Source.VERIFY,
            )

        return order

    def _generate_signature(self, order_id: str, payment_id: str) -> str:
        secret = getattr(settings, "RAZORPAY_KEY_SECRET", "rzp_test_secret")
        msg = f"{order_id}|{payment_id}".encode()
        return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()

    # -------------------------------------------------------------------------
    # Day 2 Dependent Tests (skipped when Day 2 not merged)
    # -------------------------------------------------------------------------

    @unittest.skipUnless(HAS_DAY2, "Day 2 not merged")
    def test_case_1_verified_payment_survives_closure_and_fulfils(self):
        """Case 1: Verified test payment survives browser closure, staff claim/pack, postal dispatch, stock deducted once."""
        order = self._create_order(self.parent_1, self.student_1, "ORD-INT-001", qty=2)
        initial_movements = StockMovement.objects.filter(variant=self.variant).count()
        self.assertEqual(initial_movements, 1)
        self.assertEqual(self.stock_balance.stock_quantity, 8)

        # Drive payment verification endpoint
        payment_id = "pay_test_123456"
        signature = self._generate_signature(order.razorpay_order_id, payment_id)
        fake_payment = {
            "id": payment_id,
            "order_id": order.razorpay_order_id,
            "status": "captured",
            "amount": int(order.total * 100),
            "currency": "INR",
            "method": "card",
        }
        with mock.patch.object(RazorpayGateway, "fetch_payment", return_value=fake_payment):
            verify_resp = self.client_p1.post(
                f"/api/orders/{order.id}/verify-payment/",
                {"razorpay_order_id": order.razorpay_order_id, "razorpay_payment_id": payment_id, "razorpay_signature": signature},
            )
        self.assertEqual(verify_resp.status_code, status.HTTP_200_OK)

        # Simulate browser closure: brand new APIClient, fresh token
        fresh_parent_client = APIClient()
        fresh_parent_client.force_authenticate(user=self.parent_1)
        detail_resp = fresh_parent_client.get(f"/api/orders/{order.id}/")
        self.assertEqual(detail_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_resp.data["payment_status"], "PAID")
        self.assertEqual(detail_resp.data["status"], "CONFIRMED")

        # Staff claim order
        claim_resp = self.client_staff.post(f"/api/fulfilment/{order.id}/claim/")
        self.assertEqual(claim_resp.status_code, status.HTTP_200_OK)

        # Packing list verification: garments and quantities equal what was ordered
        packlist_resp = self.client_staff.get(f"/api/fulfilment/{order.id}/packing-list/")
        self.assertEqual(packlist_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(packlist_resp.data["lines"]), 1)
        self.assertEqual(packlist_resp.data["lines"][0]["sku"], "SHIRT-5")
        self.assertEqual(packlist_resp.data["lines"][0]["quantity"], 2)

        # Staff pack
        item_ids = [str(it.id) for it in order.items.all()]
        pack_resp = self.client_staff.post(
            f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json"
        )
        self.assertEqual(pack_resp.status_code, status.HTTP_200_OK)

        # Postal handover
        dispatch_resp = self.client_staff.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "EM123456789IN", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(dispatch_resp.status_code, status.HTTP_200_OK)

        # Fresh client sees article number
        post_handover_resp = fresh_parent_client.get(f"/api/orders/{order.id}/")
        self.assertEqual(post_handover_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(post_handover_resp.data["tracking"]["consignment_number"], "EM123456789IN")

        # Stock check: deducted exactly once (ORDER_PLACED once, nothing added by packing or dispatch)
        final_movements = StockMovement.objects.filter(variant=self.variant)
        self.assertEqual(final_movements.count(), 1)
        self.assertEqual(final_movements.first().reason, StockMovement.Reason.ORDER_PLACED)
        self.stock_balance.refresh_from_db()
        self.assertEqual(self.stock_balance.stock_quantity, 8)

    @unittest.skipUnless(HAS_DAY2, "Day 2 not merged")
    def test_case_2_pending_payment_blocked_and_late_capture_refund_blocked(self):
        """Case 2: Pending online payment blocked from pack. Late capture awaiting refund blocked too."""
        # Unverified online order: claim is blocked by packing gate
        pending_order = self._create_order(self.parent_1, self.student_1, "ORD-INT-PENDING", status_val=Order.Status.CONFIRMED)
        claim_resp = self.client_staff.post(f"/api/fulfilment/{pending_order.id}/claim/")
        self.assertEqual(claim_resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(claim_resp.data["code"], "PACKING_BLOCKED")

        # Even if claim exists, packing itself is blocked by packing gate
        OrderPacking.objects.create(order=pending_order, claimed_by=self.city_admin, claimed_at=timezone.now())
        item_ids = [str(it.id) for it in pending_order.items.all()]
        pack_resp = self.client_staff.post(
            f"/api/fulfilment/{pending_order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json"
        )
        self.assertEqual(pack_resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(pack_resp.data["code"], "PACKING_BLOCKED")

        # Late capture after cancellation
        cancelled_order = self._create_order(
            self.parent_1, self.student_1, "ORD-INT-LATE", status_val=Order.Status.CANCELLED, payment_status_val=Order.PaymentStatus.PAID
        )
        self.client_staff.post(f"/api/fulfilment/{cancelled_order.id}/claim/")
        pack_late_resp = self.client_staff.post(
            f"/api/fulfilment/{cancelled_order.id}/pack/", {"confirmed_item_ids": [str(it.id) for it in cancelled_order.items.all()]}, format="json"
        )
        self.assertEqual(pack_late_resp.status_code, status.HTTP_409_CONFLICT)

    @unittest.skipUnless(HAS_DAY2, "Day 2 not merged")
    def test_case_3_eligible_cod_reaches_packing_parent_api_shows_unpaid(self):
        """Case 3 (Day 2): Eligible COD reaches packing and parent API shows it as unpaid with amount due."""
        self._run_case_3_logic()

    @unittest.skipUnless(HAS_DAY2, "Day 2 not merged")
    def test_case_4_school_pickup_no_postal_data(self):
        """Case 4 (Day 2): School pickup completes claim, pack, ready, delivered with no postal data."""
        self._run_case_4_logic()

    @unittest.skipUnless(HAS_DAY2, "Day 2 not merged")
    def test_case_5_repeated_pack_and_repeated_dispatch_single_events(self):
        """Case 5 (Day 2): Repeated pack and repeated dispatch give exactly one PACKED and one DISPATCHED event."""
        self._run_case_5_logic()

    @unittest.skipUnless(HAS_DAY2, "Day 2 not merged")
    def test_case_6_another_family_cannot_read_order_or_article_number(self):
        """Case 6 (Day 2): Another family gets 404 on detail and absent from list."""
        self._run_case_6_logic()

    # -------------------------------------------------------------------------
    # Simulated Variants for Cases 3 to 6 (Run today with packing rule test double)
    # -------------------------------------------------------------------------

    @mock.patch("orders.fulfilment_gate.get_packing_decision", return_value=PackingDecision(allowed=True, reason=None, message="Allowed"))
    def test_case_3_eligible_cod_simulated(self, _mock_gate):
        """Case 3 [SIMULATED]: Eligible COD reaches packing and parent API shows it as unpaid with amount due."""
        self._run_case_3_logic()

    @mock.patch("orders.fulfilment_gate.get_packing_decision", return_value=PackingDecision(allowed=True, reason=None, message="Allowed"))
    def test_case_4_school_pickup_simulated(self, _mock_gate):
        """Case 4 [SIMULATED]: School pickup completes claim, pack, ready, delivered with no postal data."""
        self._run_case_4_logic()

    @mock.patch("orders.fulfilment_gate.get_packing_decision", return_value=PackingDecision(allowed=True, reason=None, message="Allowed"))
    def test_case_5_repeated_pack_and_repeated_dispatch_simulated(self, _mock_gate):
        """Case 5 [SIMULATED]: Repeated pack and repeated dispatch give exactly one PACKED and one DISPATCHED event."""
        self._run_case_5_logic()

    @mock.patch("orders.fulfilment_gate.get_packing_decision", return_value=PackingDecision(allowed=True, reason=None, message="Allowed"))
    def test_case_6_another_family_cannot_read_order_simulated(self, _mock_gate):
        """Case 6 [SIMULATED]: Another family gets 404 on detail and absent from list."""
        self._run_case_6_logic()

    # -------------------------------------------------------------------------
    # Shared Test Logic for Cases 3 to 6
    # -------------------------------------------------------------------------

    def _run_case_3_logic(self):
        cod_order = self._create_order(
            self.parent_1,
            self.student_1,
            "ORD-SIM-COD",
            status_val=Order.Status.CONFIRMED,
            payment_status_val=Order.PaymentStatus.PENDING,
            payment_method="COD",
            qty=1,
        )
        self.client_staff.post(f"/api/fulfilment/{cod_order.id}/claim/")
        item_ids = [str(it.id) for it in cod_order.items.all()]
        pack_resp = self.client_staff.post(
            f"/api/fulfilment/{cod_order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json"
        )
        self.assertEqual(pack_resp.status_code, status.HTTP_200_OK)

        # Parent reads detail: status PACKED, payment_status PENDING, amount due ₹500.00
        parent_resp = self.client_p1.get(f"/api/orders/{cod_order.id}/")
        self.assertEqual(parent_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(parent_resp.data["status"], "PACKED")
        self.assertEqual(parent_resp.data["payment_status"], "PENDING")
        self.assertEqual(parent_resp.data["payment_method"], "COD")
        self.assertEqual(parent_resp.data["total"], "500.00")

    def _run_case_4_logic(self):
        pickup_order = self._create_order(
            self.parent_1,
            self.student_1,
            "ORD-SIM-PICKUP",
            status_val=Order.Status.CONFIRMED,
            payment_status_val=Order.PaymentStatus.PAID,
            fulfillment_type=Order.FulfillmentType.SCHOOL_PICKUP,
            qty=1,
        )
        # Claim and pack
        self.client_staff.post(f"/api/fulfilment/{pickup_order.id}/claim/")
        item_ids = [str(it.id) for it in pickup_order.items.all()]
        pack_resp = self.client_staff.post(
            f"/api/fulfilment/{pickup_order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json"
        )
        self.assertEqual(pack_resp.status_code, status.HTTP_200_OK)

        # Mark ready for pickup
        ready_resp = self.client_staff.post(
            "/api/fulfilment/ready-for-pickup/", {"order_ids": [str(pickup_order.id)]}, format="json"
        )
        self.assertEqual(ready_resp.status_code, status.HTTP_200_OK)

        # Mark delivered
        deliv_resp = self.client_staff.post(
            "/api/fulfilment/delivered/", {"order_ids": [str(pickup_order.id)]}, format="json"
        )
        self.assertEqual(deliv_resp.status_code, status.HTTP_200_OK)

        # Parent view: no article number, no carrier, no postal text
        parent_resp = self.client_p1.get(f"/api/orders/{pickup_order.id}/")
        self.assertEqual(parent_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(parent_resp.data["status"], "DELIVERED")
        self.assertIsNone(parent_resp.data["tracking"]["consignment_number"])
        self.assertIsNone(parent_resp.data["tracking"]["carrier"])
        self.assertNotIn("INDIA_POST", str(parent_resp.data))

    def _run_case_5_logic(self):
        order = self._create_order(
            self.parent_1,
            self.student_1,
            "ORD-SIM-REPEAT",
            status_val=Order.Status.CONFIRMED,
            payment_status_val=Order.PaymentStatus.PAID,
            qty=1,
        )
        self.client_staff.post(f"/api/fulfilment/{order.id}/claim/")

        # First pack
        item_ids = [str(it.id) for it in order.items.all()]
        pack1 = self.client_staff.post(
            f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json"
        )
        self.assertEqual(pack1.status_code, status.HTTP_200_OK)
        self.assertTrue(pack1.data["changed"])

        # Repeated pack: returns 200, changed=False
        pack2 = self.client_staff.post(
            f"/api/fulfilment/{order.id}/pack/", {"confirmed_item_ids": item_ids}, format="json"
        )
        self.assertEqual(pack2.status_code, status.HTTP_200_OK)
        self.assertFalse(pack2.data["changed"])

        # Verify exactly one PACKED event
        packed_events = OrderStatusEvent.objects.filter(order=order, status=Order.Status.PACKED)
        self.assertEqual(packed_events.count(), 1)

        # First dispatch
        disp1 = self.client_staff.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "EM555555555IN", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(disp1.status_code, status.HTTP_200_OK)
        self.assertTrue(disp1.data["changed"])

        # Repeated dispatch with same number: returns 200, changed=False
        disp2 = self.client_staff.post(
            f"/api/fulfilment/{order.id}/dispatch/",
            {"article_number": "EM555555555IN", "receipt_confirmed": True},
            format="json",
        )
        self.assertEqual(disp2.status_code, status.HTTP_200_OK)
        self.assertFalse(disp2.data["changed"])

        # Verify exactly one DISPATCHED event and one Shipment
        disp_events = OrderStatusEvent.objects.filter(order=order, status=Order.Status.DISPATCHED)
        self.assertEqual(disp_events.count(), 1)
        self.assertEqual(Shipment.objects.filter(order=order).count(), 1)

    def _run_case_6_logic(self):
        order = self._create_order(
            self.parent_1,
            self.student_1,
            "ORD-SIM-SECURE",
            status_val=Order.Status.DISPATCHED,
            payment_status_val=Order.PaymentStatus.PAID,
            qty=1,
        )
        Shipment.objects.create(
            order=order,
            carrier=Shipment.Carrier.INDIA_POST,
            consignment_number="EM888888888IN",
            created_by=self.city_admin,
        )

        # Parent 2 detail call: must be 404
        resp_detail = self.client_p2.get(f"/api/orders/{order.id}/")
        self.assertEqual(resp_detail.status_code, status.HTTP_404_NOT_FOUND)
        self.assertNotIn("EM888888888IN", str(resp_detail.content))

        # Parent 2 list call: must not contain order or article number
        resp_list = self.client_p2.get("/api/orders/")
        self.assertEqual(resp_list.status_code, status.HTTP_200_OK)
        results = resp_list.data.get("results", resp_list.data)
        ids = [item["id"] for item in results]
        self.assertNotIn(str(order.id), ids)
        self.assertNotIn("EM888888888IN", str(resp_list.content))
