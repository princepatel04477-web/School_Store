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
from inventory.models import StockBalance
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
        prod = Product.objects.create(
            name="Uniform Set",
            category=self.cat,
            school=self.school,
            cost_price=Decimal("300"),
            selling_price=Decimal("600"),
            needs_review=False,
            gender="boy",
        )
        self.variant = ProductVariant.objects.create(product=prod, sku="UNIFORM-5", size="M", school=self.school)
        StockBalance.objects.create(city=self.city, variant=self.variant, stock_quantity=50)

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
        order_p1 = self._create_order(self.parent_1, self.student_1, "ORD-TRK-P1", status=Order.Status.DISPATCHED)
        Shipment.objects.create(
            order=order_p1,
            carrier=Shipment.Carrier.INDIA_POST,
            consignment_number="EE999999999IN",
            created_by=self.staff_admin,
        )

        # Parent 2 tries to access parent 1's order
        resp = self.client_p2.get(f"/api/orders/{order_p1.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        # Verify no tracking details leaked in 404 response
        self.assertNotIn("EE999999999IN", str(resp.content))

    def assert_no_forbidden_keys(self, data, forbidden=None):
        if forbidden is None:
            forbidden = {"changed_by", "note", "razorpay_order_id", "razorpay_payment_id"}
        if isinstance(data, dict):
            for k, v in data.items():
                self.assertNotIn(k, forbidden, f"Forbidden key '{k}' found in payload: {data}")
                self.assert_no_forbidden_keys(v, forbidden)
        elif isinstance(data, list):
            for item in data:
                self.assert_no_forbidden_keys(item, forbidden)

    def test_parent_detail_items_include_fit_fields_and_no_staff_data(self):
        order = self._create_order(self.parent_1, self.student_1, "ORD-TRK-ITEMS", status=Order.Status.CONFIRMED)
        item = order.items.first()
        item.fit_height_cm = Decimal("132.50")
        item.fit_weight_kg = Decimal("28.00")
        item.fit_shoulder_cm = Decimal("32.00")
        item.fit_model_version = "v1"
        item.fit_source = "MANUAL"
        item.chosen_size = "M"
        item.recommended_size = "M"
        item.fit_feedback = "FITS_WELL"
        item.unit_cost_snapshot = Decimal("180.00")
        item.customisation_data = {"student_name": "Aarav", "house": "Red"}
        item.save()

        # Parent detail call
        resp = self.client_p1.get(f"/api/orders/{order.id}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["items"]), 1)
        parent_item = resp.data["items"][0]

        # Allowed fields & fit fields
        self.assertEqual(parent_item["product_name"], "Uniform Set")
        self.assertEqual(parent_item["size"], "M")
        self.assertEqual(parent_item["variant_size"], "M")
        self.assertEqual(parent_item["quantity"], 1)
        self.assertEqual(parent_item["unit_price_snapshot"], "600.00")
        self.assertEqual(parent_item["chosen_size"], "M")
        self.assertEqual(parent_item["recommended_size"], "M")
        self.assertEqual(parent_item["category"], self.cat.id)
        self.assertEqual(parent_item["fit_feedback"], "FITS_WELL")
        self.assertIn("customisation_display", parent_item)
        self.assertEqual(parent_item["customisation_display"]["student_name"]["value"], "Aarav")
        self.assertEqual(parent_item["customisation_display"]["house"]["value"], "Red")

        # Items include measurement when line had one
        self.assertIn("measurement", parent_item)
        self.assertIsNotNone(parent_item["measurement"])
        self.assertEqual(parent_item["measurement"]["height_cm"], 132.5)
        self.assertEqual(parent_item["measurement"]["weight_kg"], 28.0)
        self.assertEqual(parent_item["measurement"]["shoulder_cm"], 32.0)
        self.assertEqual(parent_item["measurement"]["source"], "MANUAL")

        # Walk entire response recursively to ensure no staff leaks anywhere
        self.assert_no_forbidden_keys(resp.data)

        # Internal cost and raw model versions never leak
        self.assertNotIn("unit_cost_snapshot", parent_item)
        self.assertNotIn("fit_model_version", parent_item)

    def test_parent_detail_and_list_never_expose_internal_audit_fields(self):
        order = self._create_order(self.parent_1, self.student_1, "ORD-TRK-AUDIT", status=Order.Status.PACKED)
        from orders.models import OrderPacking
        OrderPacking.objects.create(
            order=order,
            claimed_by=self.staff_admin,
            claimed_at=timezone.now(),
            packed_by=self.staff_admin,
            packed_at=timezone.now(),
            issue_note="Internal staff packaging remark",
        )

        # Parent detail
        resp_detail = self.client_p1.get(f"/api/orders/{order.id}/")
        self.assertEqual(resp_detail.status_code, status.HTTP_200_OK)
        detail_data = resp_detail.data
        self.assertNotIn("packing", detail_data)
        self.assertNotIn("claimed_by", str(detail_data))
        self.assertNotIn("packed_by", str(detail_data))
        self.assertNotIn("issue_note", str(detail_data))
        self.assertNotIn("Internal staff packaging remark", str(detail_data))
        self.assertNotIn("razorpay_order_id", detail_data)
        self.assertNotIn("razorpay_payment_id", detail_data)

        # Parent list
        resp_list = self.client_p1.get("/api/orders/")
        self.assertEqual(resp_list.status_code, status.HTTP_200_OK)
        list_data = resp_list.data["results"][0]
        self.assertNotIn("packing", list_data)
        self.assertNotIn("claimed_by", str(list_data))
        self.assertNotIn("issue_note", str(list_data))
        self.assertNotIn("razorpay_order_id", list_data)

    def test_consignment_number_only_set_when_shipment_exists(self):
        # Order without shipment
        order_no_shipment = self._create_order(self.parent_1, self.student_1, "ORD-NO-SHIP", status=Order.Status.CONFIRMED)
        resp = self.client_p1.get(f"/api/orders/{order_no_shipment.id}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIsNone(resp.data["tracking"]["consignment_number"])
        self.assertIsNone(resp.data["tracking"]["carrier"])

        # Older order marked DISPATCHED before tracking was introduced (no shipment row)
        order_old_dispatched = self._create_order(self.parent_1, self.student_1, "ORD-OLD-DISP", status=Order.Status.DISPATCHED)
        resp_old = self.client_p1.get(f"/api/orders/{order_old_dispatched.id}/")
        self.assertEqual(resp_old.status_code, status.HTTP_200_OK)
        self.assertIsNone(resp_old.data["tracking"]["consignment_number"])
        self.assertIsNone(resp_old.data["tracking"]["carrier"])

        # Order with shipment
        Shipment.objects.create(
            order=order_old_dispatched,
            carrier=Shipment.Carrier.INDIA_POST,
            consignment_number="EM123456789IN",
            created_by=self.staff_admin,
        )
        resp_with_shipment = self.client_p1.get(f"/api/orders/{order_old_dispatched.id}/")
        self.assertEqual(resp_with_shipment.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_with_shipment.data["tracking"]["consignment_number"], "EM123456789IN")
        self.assertEqual(resp_with_shipment.data["tracking"]["carrier"], "INDIA_POST")

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
                # Add shipment for even-indexed order (India Post article number)
                pass

        # Total 30 orders now. With page_size=50, all 30 orders are fetched in one page.
        # Query count must remain exactly 2 (orders query + prefetched status_events query)!
        with self.assertNumQueries(2):
            resp30 = self.client_p1.get("/api/orders/?page_size=50")
            self.assertEqual(resp30.status_code, status.HTTP_200_OK)
            self.assertEqual(len(resp30.data["results"]), 30)

    def test_parent_order_create_response_drops_internal_fields(self):
        payload = {
            "idempotency_key": "test-key-p1-create-privacy",
            "student": str(self.student_1.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "payment_method": "COD",
            "items": [
                {
                    "variant": str(self.variant.id),
                    "quantity": 1,
                    "fit": {"height_cm": 135, "weight_kg": 30, "source": "MANUAL"},
                }
            ],
            "fit": {"height_cm": 135, "weight_kg": 30},
        }
        resp = self.client_p1.post("/api/orders/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        data = resp.data

        # Required fields for checkout to work
        self.assertIn("id", data)
        self.assertIn("order_number", data)
        self.assertIn("total", data)
        self.assertEqual(data["student_name"], self.student_1.name)
        self.assertEqual(data["fulfillment_type"], "SCHOOL_PICKUP")

        # Items include measurement, chosen_size, recommended_size, category, fit_feedback
        self.assertTrue(len(data.get("items", [])) > 0)
        item = data["items"][0]
        self.assertIn("measurement", item)
        self.assertIsNotNone(item["measurement"])
        self.assertEqual(item["measurement"]["height_cm"], 135.0)
        self.assertEqual(item["measurement"]["weight_kg"], 30.0)
        self.assertIn("chosen_size", item)
        self.assertIn("recommended_size", item)
        self.assertIn("category", item)
        self.assertIn("fit_feedback", item)

        # Must NOT leak razorpay ids or staff fields anywhere in payload recursively
        self.assert_no_forbidden_keys(data)

    def test_staff_order_create_response_retains_internal_fields(self):
        payload = {
            "idempotency_key": "test-key-staff-create-privacy",
            "student": str(self.student_1.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "payment_method": "COD",
            "items": [{"variant": str(self.variant.id), "quantity": 1}],
        }
        resp = self.client_staff.post("/api/orders/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        data = resp.data

        # Staff gets OrderDetailSerializer
        self.assertIn("razorpay_order_id", data)
        self.assertIn("razorpay_payment_id", data)
        self.assertTrue(len(data.get("status_events", [])) > 0)
        for ev in data["status_events"]:
            self.assertIn("changed_by", ev)
            self.assertIn("note", ev)

        # Detail response for staff also retains them
        detail_resp = self.client_staff.get(f"/api/orders/{data['id']}/")
        self.assertEqual(detail_resp.status_code, status.HTTP_200_OK)
        detail_data = detail_resp.data
        self.assertIn("razorpay_order_id", detail_data)
        self.assertIn("razorpay_payment_id", detail_data)
        for ev in detail_data["status_events"]:
            self.assertIn("changed_by", ev)
            self.assertIn("note", ev)

