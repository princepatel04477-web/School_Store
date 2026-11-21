"""Unit and regression tests for Task 4: Real order tracking states and query efficiency."""

from decimal import Decimal
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from inventory.services import apply_stock_movement
from orders.models import Order, OrderItem, OrderStatusEvent, PaymentAttempt
from schools.models import City, School, Student


class OrderTrackingTests(TestCase):
    def setUp(self):
        self.city = City.objects.create(name="Ahmedabad", code="AMD")
        self.school = School.objects.create(
            name="DPS Bopal",
            code="DPS-AMD",
            city=self.city,
            address="School Main Office, Admin Block, Ground Floor",
        )
        self.admin = User.objects.create_user(
            username="admin_amd",
            password="Pass123456!",
            role="ADMIN",
            city=self.city,
        )
        self.parent = User.objects.create_user(
            username="parent_amd",
            password="Pass123456!",
            role="PARENT",
            city=self.city,
            school=self.school,
        )
        self.student = Student.objects.create(
            name="Aarav Sharma",
            gr_number="AMD-101",
            class_name="5",
            section="B",
            school=self.school,
            parent=self.parent,
        )
        category = Category.objects.create(name="Uniforms", slug="uniforms")
        product = Product.objects.create(
            name="School Shirt",
            category=category,
            school=self.school,
            cost_price=Decimal("150.00"),
            selling_price=Decimal("300.00"),
        )
        self.variant = ProductVariant.objects.create(
            product=product,
            sku="SHIRT-AMD-30",
            size="30",
            school=self.school,
        )
        apply_stock_movement(
            variant=self.variant,
            city_id=self.city.id,
            quantity_change=50,
            reason="INITIAL_STOCK",
        )

    def create_order(self, order_number, fulfillment_type="SCHOOL_PICKUP", payment_method="COD", payment_status="PENDING", order_status="PLACED"):
        apply_stock_movement(
            variant=self.variant,
            city_id=self.city.id,
            quantity_change=-1,
            reason="ORDER_PLACED",
        )
        raw_delivery = {"address": {"street": "123 SG Highway", "city": "Ahmedabad", "pin": "380054"}} if fulfillment_type == "HOME_DELIVERY" else {}
        order = Order.objects.create(
            order_number=order_number,
            student=self.student,
            placed_by=self.parent,
            school=self.school,
            city=self.city,
            fulfillment_type=fulfillment_type,
            payment_method=payment_method,
            payment_status=payment_status,
            status=order_status,
            subtotal=Decimal("300.00"),
            total=Decimal("300.00"),
            delivery_details=raw_delivery,
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.variant.product.category,
            quantity=1,
            unit_price_snapshot=Decimal("300.00"),
            unit_cost_snapshot=Decimal("150.00"),
        )
        OrderStatusEvent.objects.create(
            order=order,
            status=order_status,
            changed_by=self.parent,
            note="Order placed by parent",
        )
        return order

    def admin_client(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        return client

    def parent_client(self):
        client = APIClient()
        client.force_authenticate(user=self.parent)
        return client

    def test_pickup_lifecycle_transitions(self):
        """School pickup orders transition through CONFIRMED -> PROCESSING -> PACKED -> READY_FOR_PICKUP -> COLLECTED."""
        order = self.create_order("ORD-TEST-PU-01", fulfillment_type="SCHOOL_PICKUP", payment_method="COD")
        client = self.admin_client()

        # Step 1: CONFIRMED
        res = client.patch(f"/api/orders/{order.pk}/", {"status": "CONFIRMED"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Step 2: PROCESSING
        res = client.patch(f"/api/orders/{order.pk}/", {"status": "PROCESSING"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Step 3: PACKED
        res = client.patch(f"/api/orders/{order.pk}/", {"status": "PACKED"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Step 4: READY_FOR_PICKUP
        res = client.patch(f"/api/orders/{order.pk}/", {"status": "READY_FOR_PICKUP"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, "READY_FOR_PICKUP")

        # Step 5: COLLECTED
        res = client.patch(f"/api/orders/{order.pk}/", {"status": "COLLECTED"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        self.assertEqual(order.status, "COLLECTED")

        # Verify audit trail events exist
        events = list(order.status_events.values_list("status", flat=True))
        self.assertIn("READY_FOR_PICKUP", events)
        self.assertIn("COLLECTED", events)

    def test_packing_rule_refuses_unpaid_pickup_order(self):
        """Unpaid online orders cannot be moved into packing/pickup statuses."""
        order = self.create_order("ORD-TEST-PU-02", fulfillment_type="SCHOOL_PICKUP", payment_method="ONLINE", payment_status="PENDING")
        client = self.admin_client()

        # Cannot move directly to PACKED without payment
        res = client.patch(f"/api/orders/{order.pk}/", {"status": "PACKED"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Online orders must be PAID before moving to PACKED", str(res.data))

        # Cannot move to READY_FOR_PICKUP either
        res = client.patch(f"/api/orders/{order.pk}/", {"status": "READY_FOR_PICKUP"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_order_serializer_includes_tracking_and_actions(self):
        """List and detail serializers include status_events, parent_actions, delivery_details, and flags."""
        order = self.create_order(
            "ORD-TEST-TRK-01",
            fulfillment_type="SCHOOL_PICKUP",
            payment_method="ONLINE",
            payment_status="PENDING",
        )
        OrderStatusEvent.objects.create(
            order=order,
            status="CONFIRMED",
            changed_by=self.admin,
            note="Confirmed by staff",
        )
        PaymentAttempt.objects.create(
            order=order,
            razorpay_payment_id="pay_fake_failed_01",
            amount_paise=30000,
            currency="INR",
            status="FAILED",
            error_reason="Card declined",
            last_source="VERIFY",
        )

        client = self.parent_client()
        res = client.get(f"/api/orders/{order.pk}/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.data

        # Check tracking events
        self.assertIn("status_events", data)
        self.assertEqual(len(data["status_events"]), 2)
        event = data["status_events"][0]
        self.assertIn("status", event)
        self.assertIn("status_display", event)
        self.assertIn("changed_at", event)

        # Check delivery details
        self.assertIn("delivery_details", data)
        dd = data["delivery_details"]
        self.assertEqual(dd["delivery_type"], "SCHOOL_PICKUP")
        self.assertEqual(dd["pickup_location"], "School Main Office, Admin Block, Ground Floor")
        self.assertEqual(dd["pickup_timings"], "School office hours (Mon-Fri 8:30 AM - 2:30 PM)")

        # Check payment flags & parent actions
        self.assertTrue(data["can_pay_now"])
        self.assertFalse(data["has_in_progress_attempt"])
        self.assertTrue(data["last_attempt_failed"])

        actions = data.get("parent_actions", {})
        self.assertIn("pay_now", actions)
        self.assertTrue(actions["pay_now"]["allowed"])
        self.assertIn("switch_to_cod", actions)
        self.assertTrue(actions["switch_to_cod"]["allowed"])
        self.assertIn("cancel", actions)
        self.assertFalse(actions["cancel"]["allowed"])
        self.assertIn("contact the school office", actions["cancel"]["reason"])

    def test_no_n_plus_one_queries_on_order_list(self):
        """Listing orders executes a bounded, constant number of queries regardless of order count."""
        # Create 3 orders
        for i in range(1, 4):
            ord_obj = self.create_order(
                f"ORD-N1-{i:02d}",
                fulfillment_type="SCHOOL_PICKUP" if i % 2 == 0 else "HOME_DELIVERY",
                payment_method="ONLINE",
                payment_status="PENDING",
            )
            OrderStatusEvent.objects.create(order=ord_obj, status="CONFIRMED", changed_by=self.admin)
            PaymentAttempt.objects.create(
                order=ord_obj,
                razorpay_payment_id=f"pay_fake_n1_{i}",
                amount_paise=30000,
                currency="INR",
                status="CREATED",
                last_source="VERIFY",
            )

        client = self.parent_client()
        # Listing 3 orders runs in 3 queries (Orders with select_related, OrderStatusEvent prefetch, PaymentAttempt prefetch)
        with self.assertNumQueries(3):
            res1 = client.get("/api/orders/")
            self.assertEqual(res1.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res1.data.get("results", res1.data)), 3)

        # Create 2 more orders (total 5)
        for i in range(4, 6):
            ord_obj = self.create_order(
                f"ORD-N1-{i:02d}",
                fulfillment_type="SCHOOL_PICKUP",
                payment_method="COD",
                payment_status="PENDING",
            )
            OrderStatusEvent.objects.create(order=ord_obj, status="CONFIRMED", changed_by=self.admin)
            PaymentAttempt.objects.create(
                order=ord_obj,
                razorpay_payment_id=f"pay_fake_n1_{i}",
                amount_paise=30000,
                currency="INR",
                status="CREATED",
                last_source="VERIFY",
            )

        # The query count must remain exactly 3 queries, proving constant bounded queries with no N+1 query loop!
        with self.assertNumQueries(3):
            res2 = client.get("/api/orders/")
            self.assertEqual(res2.status_code, status.HTTP_200_OK)
            self.assertEqual(len(res2.data.get("results", res2.data)), 5)

    def test_legacy_statuses_serialization(self):
        """Legacy statuses (PENDING, SHIPPED, REFUNDED) serialize cleanly without server errors."""
        for leg_status in ["PENDING", "SHIPPED", "REFUNDED"]:
            order = self.create_order(f"ORD-LEG-{leg_status}", order_status=leg_status)
            client = self.parent_client()
            res = client.get(f"/api/orders/{order.pk}/")
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertEqual(res.data["status"], leg_status)
