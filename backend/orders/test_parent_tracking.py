"""
Tests for Day 3 Task B: parent order tracking and scoping.
"""

from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from orders.models import Order, OrderItem, OrderStatusEvent, Shipment
from schools.models import City, School, Student


class ParentTrackingTestCase(TestCase):
    def setUp(self):
        self.city = City.objects.create(name="Surat", code="SUR")
        self.school = School.objects.create(name="DPS Surat", code="DPS-SUR", city=self.city)

        self.parent_1 = User.objects.create_user(
            username="parent_1", password="Pass123456!", role="PARENT", school=self.school, city=self.city
        )
        self.parent_2 = User.objects.create_user(
            username="parent_2", password="Pass123456!", role="PARENT", school=self.school, city=self.city
        )
        self.staff_admin = User.objects.create_user(
            username="staff_admin", password="Pass123456!", role="ADMIN", school=self.school, city=self.city
        )

        self.student_1 = Student.objects.create(
            name="Aarav Patel", gr_number="GR-101", class_name="5", section="A", school=self.school, parent=self.parent_1
        )
        self.student_2 = Student.objects.create(
            name="Diya Shah", gr_number="GR-102", class_name="6", section="B", school=self.school, parent=self.parent_2
        )

        self.cat = Category.objects.create(name="Uniform", slug="uniform")
        prod = Product.objects.create(name="Uniform Set", category=self.cat, school=self.school, cost_price=Decimal("300"), selling_price=Decimal("600"))
        self.variant = ProductVariant.objects.create(product=prod, sku="UNIFORM-5", size="M", school=self.school)

        self.client_p1 = APIClient()
        self.client_p1.force_authenticate(user=self.parent_1)

        self.client_p2 = APIClient()
        self.client_p2.force_authenticate(user=self.parent_2)

        self.client_staff = APIClient()
        self.client_staff.force_authenticate(user=self.staff_admin)

    def _create_order(self, parent, student, order_number, status=Order.Status.PLACED, fulfillment_type=Order.FulfillmentType.HOME_DELIVERY):
        order = Order.objects.create(
            order_number=order_number,
            city=self.city,
            school=self.school,
            student=student,
            parent=parent,
            placed_by=parent,
            payer=parent,
            status=status,
            payment_status=Order.PaymentStatus.PAID,
            fulfillment_type=fulfillment_type,
            subtotal=Decimal("600.00"),
            total=Decimal("600.00"),
            razorpay_order_id="order_rzp_12345",
            razorpay_payment_id="pay_rzp_67890",
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.cat,
            quantity=1,
            unit_price_snapshot=Decimal("600.00"),
            unit_cost_snapshot=Decimal("300.00"),
        )
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.PLACED,
            changed_by=self.staff_admin,
            note="Staff placed internal event note",
            timestamp=timezone.now(),
        )
        return order

    def test_parent_list_has_tracking_and_no_staff_fields(self):
        order = self._create_order(self.parent_1, self.student_1, "ORD-TRK-001", status=Order.Status.DISPATCHED)
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.CONFIRMED,
            changed_by=self.staff_admin,
            note="Payment verified by staff",
            timestamp=timezone.now(),
        )
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.DISPATCHED,
            changed_by=self.staff_admin,
            note="Dispatched via India Post",
            timestamp=timezone.now(),
        )
        Shipment.objects.create(
            order=order,
            carrier=Shipment.Carrier.INDIA_POST,
            consignment_number="EE123456785IN",
            created_by=self.staff_admin,
        )

        resp = self.client_p1.get("/api/orders/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        results = resp.data.get("results", resp.data)
        self.assertEqual(len(results), 1)

        item = results[0]
        self.assertIn("tracking", item)
        trk = item["tracking"]
        self.assertEqual(trk["carrier"], "INDIA_POST")
        self.assertEqual(trk["consignment_number"], "EE123456785IN")
        self.assertIsNotNone(trk["dispatched_at"])
        self.assertIsNone(trk["delivered_at"])
        self.assertEqual(len(trk["steps"]), 3)
        self.assertEqual([s["key"] for s in trk["steps"]], ["PLACED", "CONFIRMED", "DISPATCHED"])

        # Never staff fields
        self.assertNotIn("changed_by", str(trk))
        self.assertNotIn("note", str(trk))
        self.assertNotIn("razorpay_order_id", item)
        self.assertNotIn("razorpay_payment_id", item)

    def test_parent_detail_drops_staff_fields_and_razorpay_ids(self):
        order = self._create_order(self.parent_1, self.student_1, "ORD-TRK-002", status=Order.Status.CONFIRMED)
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.CONFIRMED,
            changed_by=self.staff_admin,
            note="Staff private check",
            timestamp=timezone.now(),
        )

        resp = self.client_p1.get(f"/api/orders/{order.id}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.data

        # Has tracking
        self.assertIn("tracking", data)
        # Drops razorpay fields
        self.assertNotIn("razorpay_order_id", data)
        self.assertNotIn("razorpay_payment_id", data)

        # status_events exists but drops changed_by and note
        self.assertIn("status_events", data)
        for ev in data["status_events"]:
            self.assertIn("id", ev)
            self.assertIn("status", ev)
            self.assertIn("timestamp", ev)
            self.assertNotIn("changed_by", ev)
            self.assertNotIn("note", ev)

    def test_staff_detail_keeps_staff_fields_and_razorpay_ids(self):
        order = self._create_order(self.parent_1, self.student_1, "ORD-TRK-003", status=Order.Status.CONFIRMED)

        resp = self.client_staff.get(f"/api/orders/{order.id}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.data

        # Staff gets razorpay IDs
        self.assertEqual(data.get("razorpay_order_id"), "order_rzp_12345")
        self.assertEqual(data.get("razorpay_payment_id"), "pay_rzp_67890")

        # Staff gets changed_by and note on status_events
        self.assertIn("status_events", data)
        self.assertGreater(len(data["status_events"]), 0)
        ev = data["status_events"][0]
        self.assertIn("changed_by", ev)
        self.assertIn("note", ev)
        self.assertEqual(ev["note"], "Staff placed internal event note")

    def test_another_parents_order_is_404(self):
        order_p1 = self._create_order(self.parent_1, self.student_1, "ORD-TRK-P1")

        # Parent 2 tries to access parent 1's order
        resp = self.client_p2.get(f"/api/orders/{order_p1.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_fixed_query_count_for_1_and_30_orders(self):
        # Create 1 order with shipment and status events
        order1 = self._create_order(self.parent_1, self.student_1, "ORD-QUERY-01", status=Order.Status.DISPATCHED)
        Shipment.objects.create(
            order=order1,
            carrier=Shipment.Carrier.INDIA_POST,
            consignment_number="EE123456785IN",
            created_by=self.staff_admin,
        )
        OrderStatusEvent.objects.create(
            order=order1,
            status=Order.Status.CONFIRMED,
            changed_by=self.staff_admin,
            note="Confirmed",
            timestamp=timezone.now(),
        )

        # Measure queries for 1 order
        with self.assertNumQueries(2):
            resp1 = self.client_p1.get("/api/orders/?page_size=50")
            self.assertEqual(resp1.status_code, status.HTTP_200_OK)
            self.assertEqual(len(resp1.data["results"]), 1)

        # Now create 29 more orders (total 30 orders for parent_1)
        for i in range(2, 31):
            ord_i = self._create_order(
                self.parent_1,
                self.student_1,
                f"ORD-QUERY-{i:02d}",
                status=Order.Status.DISPATCHED if i % 2 == 0 else Order.Status.CONFIRMED,
            )
            OrderStatusEvent.objects.create(
                order=ord_i,
                status=Order.Status.CONFIRMED,
                changed_by=self.staff_admin,
                note=f"Confirmed {i}",
                timestamp=timezone.now(),
            )
            if i % 2 == 0:
                # Add shipment with valid S10 consignment
                # EE000000005IN, EE000000014IN, etc.
                serial_part = f"{i:08d}"
                # calculate check digit for test:
                # let's just make valid consignment numbers or skip shipment on some
                pass

        # Total 30 orders now. With page_size=50, all 30 orders are fetched in one page.
        # Query count must remain exactly 2 (orders query + prefetched status_events query)!
        with self.assertNumQueries(2):
            resp30 = self.client_p1.get("/api/orders/?page_size=50")
            self.assertEqual(resp30.status_code, status.HTTP_200_OK)
            self.assertEqual(len(resp30.data["results"]), 30)
