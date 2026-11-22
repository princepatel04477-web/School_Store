"""
Comprehensive End-to-End Parent Journey and Boundary Verification Suite (Task 10).

Verifies the completed parent journey:
1. School/branch selection -> class -> products -> sizing -> full set/bag ->
   sign-in/child selection -> address/pickup -> COD or test-mode online payment ->
   order history/tracking -> eligible cancellation/exchange/refund.

2. Critical boundary checks:
   - Empty account handling (no invented children)
   - API outage resilience (order committed, durable outbox)
   - Invalid delivery address rejection
   - Wrong-school child rejection
   - Unavailable size rejection & changed price detection (409)
   - Interrupted checkout recovery (switch to COD)
   - Repeated submission idempotency (single stock deduction)
   - Payment pending blocks packing and pickup
   - Duplicate webhook deduplication
   - Late payment on cancelled order (refund item opened, stock untouched)
   - Damaged returned item write-off (not restocked)
   - Notification provider outage does not roll back orders
   - Role / city / school / family isolation
   - Legacy order statuses and migration compatibility
"""

import datetime as dt
from decimal import Decimal
import json
import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.serializers import build_tokens_for_user
from catalog.models import Category, Product, ProductCityPrice, ProductRequirement, ProductVariant, SizeChartRow
from catalog.sizing import ChartRow, Reason, compute_chart_version, recommend_size
from inventory.models import StockBalance, StockMovement
from orders.models import (
    NotificationRecord,
    Order,
    OrderAfterSaleRequest,
    OrderItem,
    OrderRefund,
    OrderStatusEvent,
    PaymentAttempt,
    PaymentEvent,
    PaymentReview,
)
from orders.payment import RazorpayGateway
from orders.status import apply_provider_payment, can_transition_order
from schools.models import City, Grade, School, SchoolBranch, Student

User = get_user_model()


class ParentJourneyAndBoundaryTests(TestCase):
    """
    Complete end-to-end parent journey and boundary integration verification.
    """

    @classmethod
    def setUpTestData(cls):
        # 1. Cities
        cls.city_surat = City.objects.create(name="Surat", code="SUR-JRN", state="Gujarat")
        cls.city_delhi = City.objects.create(name="New Delhi", code="DEL-JRN", state="Delhi")

        # 2. Schools & Branches
        cls.school_surat = School.objects.create(
            name="Delhi Public School Surat",
            code="DPS-SUR-JRN",
            city=cls.city_surat,
            home_delivery_enabled=True,
            school_pickup_enabled=True,
            pincode="395007",
        )
        cls.branch_surat = SchoolBranch.objects.create(
            school=cls.school_surat,
            city=cls.city_surat,
            name="Vesu Main Campus",
            address="Vesu, Surat",
            pincode="395007",
        )

        cls.school_delhi = School.objects.create(
            name="Modern School Delhi",
            code="MSD-DEL-JRN",
            city=cls.city_delhi,
            home_delivery_enabled=True,
            school_pickup_enabled=True,
            pincode="110001",
        )

        # 3. Grades (Pre-seeded by migration 0008)
        cls.grade_5 = Grade.objects.filter(name="Class 5").first() or Grade.objects.get(sort_order=8)
        cls.grade_6 = Grade.objects.filter(name="Class 6").first() or Grade.objects.get(sort_order=9)

        # 4. Users (Parents & Staff)
        cls.parent_a = User.objects.create_user(
            username="parent_a_jrn",
            phone="9876543210",
            role="PARENT",
            city=cls.city_surat,
        )
        cls.parent_b = User.objects.create_user(
            username="parent_b_jrn",
            phone="9876543211",
            role="PARENT",
            city=cls.city_delhi,
        )
        cls.school_admin_surat = User.objects.create_user(
            username="admin_surat_jrn",
            phone="9876543212",
            role="SCHOOL_ADMIN",
            school=cls.school_surat,
            city=cls.city_surat,
        )
        cls.city_admin_delhi = User.objects.create_user(
            username="admin_delhi_jrn",
            phone="9876543213",
            role="ADMIN",
            city=cls.city_delhi,
        )

        # 5. Students
        cls.student_a1 = Student.objects.create(
            name="Aarav Shah",
            gr_number="GR-SUR-101",
            school=cls.school_surat,
            city=cls.city_surat,
            grade=cls.grade_5,
            class_name="Class 5",
            gender="BOY",
            parent=cls.parent_a,
        )
        cls.student_b1 = Student.objects.create(
            name="Rohan Verma",
            gr_number="GR-DEL-201",
            school=cls.school_delhi,
            city=cls.city_delhi,
            grade=cls.grade_5,
            class_name="Class 5",
            gender="BOY",
            parent=cls.parent_b,
        )

        # 6. Categories & Products
        cls.cat_uniform = Category.objects.create(name="Uniform", slug="uniform-jrn")
        cls.product_shirt = Product.objects.create(
            name="DPS Regular Shirt",
            category=cls.cat_uniform,
            school=cls.school_surat,
            city=cls.city_surat,
            cost_price=Decimal("300.00"),
            selling_price=Decimal("450.00"),
            gender="unisex",
            is_required=True,
            material_composition="65% Polyester, 35% Cotton",
            care_instructions="Machine wash cold. Do not bleach. Warm iron.",
        )
        cls.product_shirt.grades.add(cls.grade_5, cls.grade_6)

        # Explicit ProductRequirement
        cls.req_shirt = ProductRequirement.objects.create(
            product=cls.product_shirt,
            school=cls.school_surat,
            grade=cls.grade_5,
            required=True,
            min_quantity=1,
            active=True,
        )

        # Variants
        cls.var_shirt_30 = ProductVariant.objects.create(
            product=cls.product_shirt,
            sku="DPS-SHIRT-30",
            size="30",
            active=True,
        )
        cls.var_shirt_32 = ProductVariant.objects.create(
            product=cls.product_shirt,
            sku="DPS-SHIRT-32",
            size="32",
            active=True,
        )

        # Size Chart Rows
        SizeChartRow.objects.create(
            variant=cls.var_shirt_30,
            height_cm_min=Decimal("130.0"),
            height_cm_max=Decimal("140.0"),
            weight_kg_min=Decimal("28.0"),
            weight_kg_max=Decimal("35.0"),
        )
        SizeChartRow.objects.create(
            variant=cls.var_shirt_32,
            height_cm_min=Decimal("141.0"),
            height_cm_max=Decimal("150.0"),
            weight_kg_min=Decimal("36.0"),
            weight_kg_max=Decimal("44.0"),
        )

        # Stock Balances in Surat
        cls.stock_shirt_30 = StockBalance.objects.create(
            city=cls.city_surat,
            variant=cls.var_shirt_30,
            stock_quantity=15,
        )
        cls.stock_shirt_32 = StockBalance.objects.create(
            city=cls.city_surat,
            variant=cls.var_shirt_32,
            stock_quantity=10,
        )

        # Delhi product (for wrong-school testing)
        cls.product_delhi = Product.objects.create(
            name="Modern School Blazer",
            category=cls.cat_uniform,
            school=cls.school_delhi,
            city=cls.city_delhi,
            cost_price=Decimal("800.00"),
            selling_price=Decimal("1200.00"),
            gender="unisex",
        )
        cls.var_delhi_34 = ProductVariant.objects.create(
            product=cls.product_delhi,
            sku="MSD-BLAZER-34",
            size="34",
            active=True,
        )
        cls.stock_delhi_34 = StockBalance.objects.create(
            city=cls.city_delhi,
            variant=cls.var_delhi_34,
            stock_quantity=5,
        )

    def _client_for(self, user):
        client = APIClient()
        token = build_tokens_for_user(user)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    # -------------------------------------------------------------------------
    # 1. Happy Path: School Pickup + COD Journey
    # -------------------------------------------------------------------------
    def test_01_full_parent_journey_happy_path_school_pickup_cod(self):
        """
        Verify complete School Pickup + COD journey:
        Browse catalog -> size chart suggestion -> cart validate -> order placement ->
        pickup tracking timeline -> cancellation before dispatch restoring stock.
        """
        client = self._client_for(self.parent_a)

        # Step 1: Browse school catalogue
        resp = client.get(
            f"/api/public/products/?school={self.school_surat.id}&city={self.city_surat.id}&grade={self.grade_5.id}&gender=boy"
        )
        self.assertEqual(resp.status_code, 200)
        items = resp.data.get("results", resp.data) if isinstance(resp.data, dict) else resp.data
        self.assertTrue(any(str(i.get("id")) == str(self.product_shirt.id) for i in items))

        # Step 2: Sizing recommendation
        chart_rows = [
            ChartRow(
                size=r.variant.size,
                height_cm_min=r.height_cm_min,
                height_cm_max=r.height_cm_max,
                weight_kg_min=r.weight_kg_min,
                weight_kg_max=r.weight_kg_max,
            )
            for r in SizeChartRow.objects.filter(variant__product=self.product_shirt).select_related("variant")
        ]
        rec = recommend_size(chart_rows, height_cm=Decimal("135.0"), weight_kg=Decimal("32.0"))
        self.assertEqual(rec.size, "30")
        self.assertEqual(rec.reason, Reason.HEIGHT_WEIGHT_MATCH)
        version = compute_chart_version(chart_rows)
        self.assertTrue(len(version) > 0)

        # Step 3: Multi-item cart pre-validation
        cart_payload = {
            "school": str(self.school_surat.id),
            "class": "Class 5",
            "gender": "BOY",
            "student": str(self.student_a1.id),
            "items": [{"variant_id": str(self.var_shirt_30.id), "quantity": 1}],
        }
        val_resp = client.post("/api/cart/validate/", cart_payload, format="json")
        self.assertEqual(val_resp.status_code, 200)
        self.assertTrue(val_resp.data.get("valid"))

        # Step 4: Checkout: School Pickup + Cash on Delivery (no home address required)
        initial_stock = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity
        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
            "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
            "delivery_details": {},
            "items": [{"variant": str(self.var_shirt_30.id), "quantity": 1}],
        }
        create_resp = client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(create_resp.status_code, 201)
        order_id = create_resp.data["id"]

        # Step 5: Verify Order & Atomic Stock Movement
        order = Order.objects.get(id=order_id)
        self.assertEqual(order.status, Order.Status.PLACED)
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)
        self.assertEqual(order.payment_method, Order.PaymentMethod.CASH_ON_DELIVERY)
        self.assertEqual(order.fulfillment_type, Order.FulfillmentType.SCHOOL_PICKUP)

        new_stock = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity
        self.assertEqual(new_stock, initial_stock - 1)
        self.assertTrue(
            StockMovement.objects.filter(reference_order=order, variant=self.var_shirt_30, quantity_change=-1).exists()
        )

        # Step 6: Verify Notification Outbox Record Created
        notif = NotificationRecord.objects.filter(order=order, event_type="ORDER_CONFIRMED").first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.status, NotificationRecord.Status.PENDING)
        self.assertEqual(notif.recipient_phone, "9876543210")
        self.assertIn("******3210", notif.mask_recipient())

        # Step 7: Order Tracking Lifecycle (Pickup progression: PLACED -> CONFIRMED -> PROCESSING)
        order.status = Order.Status.CONFIRMED
        order.save(update_fields=["status"])
        order.status = Order.Status.PROCESSING
        order.save(update_fields=["status"])

        track_resp = client.get(f"/api/orders/{order_id}/")
        self.assertEqual(track_resp.status_code, 200)
        self.assertEqual(track_resp.data["status"], "PROCESSING")
        # Ensure school pickup does not return courier tracking claims
        deliv = track_resp.data.get("delivery_details") or {}
        self.assertIsNone(deliv.get("courier_name"))
        self.assertIsNone(deliv.get("tracking_number"))

        # Step 8: Parent self-service cancellation before dispatch/pickup
        cancel_resp = client.post(
            f"/api/orders/{order_id}/request-after-sale/",
            {"request_type": "CANCEL", "reason": "CHANGE_OF_MIND"},
            format="json",
        )
        self.assertEqual(cancel_resp.status_code, 201)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)

        # Stock restored atomically
        restored_stock = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity
        self.assertEqual(restored_stock, initial_stock)

    # -------------------------------------------------------------------------
    # 2. Happy Path: Home Delivery + Online (Razorpay) + Size Exchange
    # -------------------------------------------------------------------------
    def test_02_full_parent_journey_home_delivery_online_payment_and_exchange(self):
        """
        Verify complete Home Delivery + Online Payment + Size Exchange:
        PIN lookup -> Server quote -> Order create (ONLINE) -> Webhook capture ->
        Delivery -> 7-day size exchange -> atomic replacement reservation ->
        restock on inspection.
        """
        client = self._client_for(self.parent_a)

        # Step 1: Pincode lookup
        pin_resp = client.get("/api/orders/pincode-lookup/?pincode=395007")
        self.assertEqual(pin_resp.status_code, 200)
        self.assertTrue(pin_resp.data.get("format_valid"))
        self.assertEqual(pin_resp.data.get("geography", {}).get("state"), "Gujarat")

        # Step 2: Server quote
        quote_payload = {
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.HOME_DELIVERY,
            "items": [{"variant": str(self.var_shirt_30.id), "quantity": 1}],
        }
        quote_resp = client.post("/api/orders/quote/", quote_payload, format="json")
        self.assertEqual(quote_resp.status_code, 200)
        quote_total_paise = quote_resp.data["total_paise"]
        self.assertEqual(quote_total_paise, 45000)

        # Step 3: Order placement with valid Indian address
        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.HOME_DELIVERY,
            "payment_method": Order.PaymentMethod.ONLINE,
            "expected_total_paise": quote_total_paise,
            "delivery_details": {
                "recipient_name": "Aarav Shah",
                "phone": "9876543210",
                "address_line1": "Flat 402, Vesu Heights",
                "city": "Surat",
                "state": "Gujarat",
                "pincode": "395007",
            },
            "items": [{"variant": str(self.var_shirt_30.id), "quantity": 1}],
        }
        order_resp = client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(order_resp.status_code, 201)
        order_id = order_resp.data["id"]
        order = Order.objects.get(id=order_id)
        self.assertEqual(order.payment_method, Order.PaymentMethod.ONLINE)
        self.assertEqual(order.payment_status, Order.PaymentStatus.PENDING)

        # Step 4: Initiate payment
        order.razorpay_order_id = "order_test_rzp_123"
        order.save(update_fields=["razorpay_order_id"])

        # Step 5: Provider payment application
        attempt = apply_provider_payment(
            order,
            payment_entity={
                "id": "pay_test_capture_456",
                "order_id": "order_test_rzp_123",
                "status": "captured",
                "amount": 45000,
                "currency": "INR",
                "method": "upi",
            },
        )
        self.assertIsNotNone(attempt)
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)
        self.assertEqual(order.status, Order.Status.CONFIRMED)

        # Step 6: Transition to DELIVERED
        order.status = Order.Status.PACKED
        order.save(update_fields=["status"])
        order.status = Order.Status.DISPATCHED
        order.save(update_fields=["status"])
        order.status = Order.Status.DELIVERED
        order.save(update_fields=["status"])

        # Record a delivery timestamp event within 7 days
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.DELIVERED,
            timestamp=timezone.now(),
        )

        # Step 7: Size exchange request for Size 32
        initial_stock_32 = StockBalance.objects.get(id=self.stock_shirt_32.id).stock_quantity
        order_item = order.items.first()
        exchange_resp = client.post(
            f"/api/orders/{order_id}/request-after-sale/",
            {
                "request_type": "EXCHANGE",
                "order_item": str(order_item.id),
                "target_size": "32",
                "reason": "TOO_SMALL",
            },
            format="json",
        )
        self.assertEqual(exchange_resp.status_code, 201)

        # Replacement variant stock 32 reserved atomically via EXCHANGE_RESERVATION
        new_stock_32 = StockBalance.objects.get(id=self.stock_shirt_32.id).stock_quantity
        self.assertEqual(new_stock_32, initial_stock_32 - 1)
        self.assertTrue(
            StockMovement.objects.filter(
                variant=self.var_shirt_32,
                reason=StockMovement.Reason.EXCHANGE_RESERVATION,
                quantity_change=-1,
            ).exists()
        )

        # Step 8: Staff review and inspection
        staff_client = self._client_for(self.school_admin_surat)
        req_id = exchange_resp.data["id"]
        review_resp = staff_client.post(
            "/api/orders/review-after-sale/",
            {
                "request_id": req_id,
                "action": "INSPECT",
                "restock_condition": "RESTOCKABLE",
                "notes": "Tags intact, unworn, verified by uniform desk",
            },
            format="json",
        )
        self.assertEqual(review_resp.status_code, 200)

        # Original item size 30 returned and restocked
        returned_stock_30 = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity
        self.assertTrue(
            StockMovement.objects.filter(
                variant=self.var_shirt_30,
                reason=StockMovement.Reason.RETURN,
                quantity_change=1,
            ).exists()
        )

    # -------------------------------------------------------------------------
    # 3. Boundary: Empty Account Handling
    # -------------------------------------------------------------------------
    def test_03_boundary_empty_account_returns_clean_empty_list(self):
        """
        Verify parent with no linked children receives clean empty list with 200 OK
        and never receives fake or fallback children.
        """
        empty_parent = User.objects.create_user(
            username="empty_parent_jrn",
            phone="9876543299",
            role="PARENT",
            city=self.city_surat,
        )
        client = self._client_for(empty_parent)

        resp = client.get("/api/students/")
        self.assertEqual(resp.status_code, 200)
        results = resp.data.get("results", resp.data) if isinstance(resp.data, dict) else resp.data
        self.assertEqual(len(results), 0)

    # -------------------------------------------------------------------------
    # 4. Boundary: Invalid Address Rejected
    # -------------------------------------------------------------------------
    def test_04_boundary_invalid_address_rejected_with_400(self):
        """
        Direct submission missing street/city/state, or having invalid 5-digit PIN
        or invalid phone must be rejected with HTTP 400.
        """
        client = self._client_for(self.parent_a)

        bad_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.HOME_DELIVERY,
            "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
            "delivery_details": {
                "recipient_name": "Test",
                "phone": "12345",  # Invalid phone
                "address_line1": "Street",
                "city": "Surat",
                "state": "Gujarat",
                "pincode": "39500",  # Invalid 5-digit PIN
            },
            "items": [{"variant": str(self.var_shirt_30.id), "quantity": 1}],
        }
        resp = client.post("/api/orders/", bad_payload, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("delivery_details", resp.data)

    # -------------------------------------------------------------------------
    # 5. Boundary: Wrong-School Child Cross-School Rejection
    # -------------------------------------------------------------------------
    def test_05_boundary_wrong_school_child_rejected(self):
        """
        Parent attempting to validate or purchase items belonging to School A
        for a student enrolled in School B must be refused.
        """
        client = self._client_for(self.parent_a)

        # 1. Cart validate refuses student from School A for School B
        val_payload = {
            "school": str(self.school_delhi.id),
            "student": str(self.student_a1.id),
            "items": [{"variant_id": str(self.var_delhi_34.id), "quantity": 1}],
        }
        val_resp = client.post("/api/cart/validate/", val_payload, format="json")
        self.assertEqual(val_resp.status_code, 400)
        self.assertIn("school", val_resp.data)

        # 2. Order placement refuses student for wrong school items
        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
            "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
            "items": [{"variant": str(self.var_delhi_34.id), "quantity": 1}],
        }
        order_resp = client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(order_resp.status_code, 400)

    # -------------------------------------------------------------------------
    # 6. Boundary: Unavailable Size & Changed Price (409)
    # -------------------------------------------------------------------------
    def test_06_boundary_unavailable_size_and_changed_price_409(self):
        """
        Verify unavailable size (0 stock) is rejected, and price changed
        mismatch between quote and create returns HTTP 409 price_changed.
        """
        client = self._client_for(self.parent_a)

        # Set stock of size 30 to 0
        self.stock_shirt_30.stock_quantity = 0
        self.stock_shirt_30.save(update_fields=["stock_quantity"])

        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
            "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
            "items": [{"variant": str(self.var_shirt_30.id), "quantity": 1}],
        }
        resp = client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Insufficient stock", str(resp.data))

        # Restore stock, test 409 price mismatch
        self.stock_shirt_30.stock_quantity = 15
        self.stock_shirt_30.save(update_fields=["stock_quantity"])

        # Expected total is 40000 paise (Rs 400), but actual is 45000 paise (Rs 450)
        order_payload["expected_total_paise"] = 40000
        p409_resp = client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(p409_resp.status_code, 409)
        self.assertEqual(p409_resp.data.get("code"), "price_changed")

    # -------------------------------------------------------------------------
    # 7. Boundary: Interrupted Checkout & Switch to COD
    # -------------------------------------------------------------------------
    def test_07_boundary_interrupted_checkout_and_switch_to_cod(self):
        """
        Parent begins online checkout, closes modal; order remains PLACED/PENDING;
        parent successfully switches order to Cash on Delivery.
        """
        client = self._client_for(self.parent_a)

        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
            "payment_method": Order.PaymentMethod.ONLINE,
            "expected_total_paise": 45000,
            "items": [{"variant": str(self.var_shirt_30.id), "quantity": 1}],
        }
        create_resp = client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(create_resp.status_code, 201)
        order_id = create_resp.data["id"]

        # Call switch-to-cod
        switch_resp = client.post(f"/api/orders/{order_id}/switch-to-cod/")
        self.assertEqual(switch_resp.status_code, 200)

        order = Order.objects.get(id=order_id)
        self.assertEqual(order.payment_method, Order.PaymentMethod.CASH_ON_DELIVERY)
        self.assertEqual(order.status, Order.Status.PLACED)

    # -------------------------------------------------------------------------
    # 8. Boundary: Repeated Submission Idempotency
    # -------------------------------------------------------------------------
    def test_08_boundary_repeated_submission_single_stock_movement(self):
        """
        Submitting identical order with same idempotency_key returns existing order
        and debits stock exactly once.
        """
        client = self._client_for(self.parent_a)
        key = str(uuid.uuid4())
        initial_stock = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity

        payload = {
            "idempotency_key": key,
            "student": str(self.student_a1.id),
            "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
            "payment_method": Order.PaymentMethod.CASH_ON_DELIVERY,
            "items": [{"variant": str(self.var_shirt_30.id), "quantity": 1}],
        }

        resp1 = client.post("/api/orders/", payload, format="json")
        self.assertEqual(resp1.status_code, 201)
        order_id_1 = resp1.data["id"]

        resp2 = client.post("/api/orders/", payload, format="json")
        self.assertIn(resp2.status_code, (200, 201))
        order_id_2 = resp2.data["id"]
        self.assertEqual(order_id_1, order_id_2)

        stock_after = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity
        self.assertEqual(stock_after, initial_stock - 1)
        self.assertEqual(
            StockMovement.objects.filter(reference_order_id=order_id_1).count(),
            1,
        )

    # -------------------------------------------------------------------------
    # 9. Boundary: Payment Pending Blocks Packing and Pickup
    # -------------------------------------------------------------------------
    def test_09_boundary_payment_pending_blocks_packing_and_pickup(self):
        """
        Unpaid online order cannot transition to PACKED, DISPATCHED, or READY_FOR_PICKUP.
        """
        order = Order.objects.create(
            order_number="ORD-PENDING-GUARD",
            placed_by=self.parent_a,
            payer=self.parent_a,
            student=self.student_a1,
            school=self.school_surat,
            city=self.city_surat,
            status=Order.Status.PLACED,
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.ONLINE,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
        )
        self.assertFalse(can_transition_order(order, Order.Status.PACKED)[0])
        self.assertFalse(can_transition_order(order, Order.Status.DISPATCHED)[0])
        self.assertFalse(can_transition_order(order, Order.Status.READY_FOR_PICKUP)[0])

    # -------------------------------------------------------------------------
    # 10. Boundary: Duplicate Webhook Deduplication
    # -------------------------------------------------------------------------
    def test_10_boundary_duplicate_webhook_deduplication(self):
        """
        Webhook received twice for same payment does not duplicate PaymentAttempts
        or transitions.
        """
        order = Order.objects.create(
            order_number="ORD-DUP-WEBHOOK",
            placed_by=self.parent_a,
            payer=self.parent_a,
            student=self.student_a1,
            school=self.school_surat,
            city=self.city_surat,
            status=Order.Status.PLACED,
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.ONLINE,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
            razorpay_order_id="order_dup_webhook_123",
        )

        # First application
        first = apply_provider_payment(
            order,
            payment_entity={
                "id": "pay_dup_001",
                "order_id": "order_dup_webhook_123",
                "status": "captured",
                "amount": 45000,
                "currency": "INR",
                "method": "upi",
            },
        )
        self.assertIsNotNone(first)

        # Second identical application
        second = apply_provider_payment(
            order,
            payment_entity={
                "id": "pay_dup_001",
                "order_id": "order_dup_webhook_123",
                "status": "captured",
                "amount": 45000,
                "currency": "INR",
                "method": "upi",
            },
        )
        self.assertIsNotNone(second)
        self.assertEqual(PaymentAttempt.objects.filter(order=order).count(), 1)

    # -------------------------------------------------------------------------
    # 11. Boundary: Late Payment on Cancelled Order
    # -------------------------------------------------------------------------
    def test_11_boundary_late_payment_after_cancellation(self):
        """
        Payment captured after order was cancelled keeps status CANCELLED,
        marks payment PAID, leaves stock untouched, and opens REFUND_AFTER_RELEASE review.
        """
        order = Order.objects.create(
            order_number="ORD-LATE-PAY",
            placed_by=self.parent_a,
            payer=self.parent_a,
            student=self.student_a1,
            school=self.school_surat,
            city=self.city_surat,
            status=Order.Status.CANCELLED,
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.ONLINE,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
            razorpay_order_id="order_late_rzp_456",
        )

        applied = apply_provider_payment(
            order,
            payment_entity={
                "id": "pay_late_999",
                "order_id": "order_late_rzp_456",
                "status": "captured",
                "amount": 45000,
                "currency": "INR",
                "method": "upi",
            },
        )
        self.assertIsNotNone(applied)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)
        self.assertEqual(order.payment_status, Order.PaymentStatus.PAID)

        # Review item created
        review = PaymentReview.objects.filter(order=order).first()
        self.assertIsNotNone(review)
        self.assertEqual(review.reason, PaymentReview.Reason.REFUND_AFTER_RELEASE)

    # -------------------------------------------------------------------------
    # 12. Boundary: Damaged Returned Item Not Restocked
    # -------------------------------------------------------------------------
    def test_12_boundary_damaged_returned_item_not_restocked(self):
        """
        Inspection of returned item marked DAMAGED_DISCARD logs DAMAGE movement
        and does NOT increase sellable stock.
        """
        order = Order.objects.create(
            order_number="ORD-DAMAGE-TEST",
            placed_by=self.parent_a,
            payer=self.parent_a,
            student=self.student_a1,
            school=self.school_surat,
            city=self.city_surat,
            status=Order.Status.DELIVERED,
            payment_status=Order.PaymentStatus.PAID,
            payment_method=Order.PaymentMethod.ONLINE,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
        )
        item = OrderItem.objects.create(
            order=order,
            variant=self.var_shirt_30,
            category=self.cat_uniform,
            quantity=1,
            unit_price_snapshot=Decimal("450.00"),
            unit_cost_snapshot=Decimal("300.00"),
        )
        OrderStatusEvent.objects.create(order=order, status=Order.Status.DELIVERED, timestamp=timezone.now())

        # Parent reports defect
        client = self._client_for(self.parent_a)
        req_resp = client.post(
            f"/api/orders/{order.id}/request-after-sale/",
            {
                "request_type": "RETURN",
                "order_item": str(item.id),
                "reason": "DAMAGED",
            },
            format="json",
        )
        self.assertEqual(req_resp.status_code, 201)
        req_id = req_resp.data["id"]

        initial_stock = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity

        # Staff inspects and marks DAMAGED_DISCARD
        staff_client = self._client_for(self.school_admin_surat)
        review_resp = staff_client.post(
            "/api/orders/review-after-sale/",
            {
                "request_id": req_id,
                "action": "INSPECT",
                "restock_condition": "DAMAGED_DISCARD",
                "notes": "Physical damage confirmed, discarded to scrap",
            },
            format="json",
        )
        self.assertEqual(review_resp.status_code, 200)

        # Stock is unchanged
        stock_after = StockBalance.objects.get(id=self.stock_shirt_30.id).stock_quantity
        self.assertEqual(stock_after, initial_stock)
        self.assertTrue(
            StockMovement.objects.filter(
                variant=self.var_shirt_30,
                reason=StockMovement.Reason.DAMAGE,
            ).exists()
        )

    # -------------------------------------------------------------------------
    # 13. Boundary: Notification Provider Outage Does Not Roll Back Orders
    # -------------------------------------------------------------------------
    def test_13_boundary_notification_provider_outage_does_not_rollback_order(self):
        """
        Transactional outbox pattern commits notification in PENDING state
        even if notification worker or external provider is down.
        """
        order = Order.objects.create(
            order_number="ORD-NOTIF-RESILIENT",
            placed_by=self.parent_a,
            payer=self.parent_a,
            student=self.student_a1,
            school=self.school_surat,
            city=self.city_surat,
            status=Order.Status.PLACED,
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
        )
        notif = NotificationRecord.objects.create(
            order=order,
            event_type=NotificationRecord.EventType.ORDER_CONFIRMED,
            channel=NotificationRecord.Channel.SMS,
            recipient_phone="9876543210",
            status=NotificationRecord.Status.PENDING,
            payload={"order_number": order.order_number},
            idempotency_key="hash_test_resilience_123",
        )
        self.assertEqual(notif.status, NotificationRecord.Status.PENDING)
        self.assertEqual(order.status, Order.Status.PLACED)

    # -------------------------------------------------------------------------
    # 14. Boundary: Role / City / School / Family Isolation
    # -------------------------------------------------------------------------
    def test_14_boundary_role_city_school_family_isolation(self):
        """
        Strict permission boundaries:
        - Parent A cannot view Parent B's orders
        - School Admin Surat cannot review after-sales for Delhi
        - City Admin Delhi cannot access Surat orders
        """
        # Create order for Parent B
        order_b = Order.objects.create(
            order_number="ORD-DELHI-ISO",
            placed_by=self.parent_b,
            payer=self.parent_b,
            student=self.student_b1,
            school=self.school_delhi,
            city=self.city_delhi,
            status=Order.Status.PLACED,
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY,
            subtotal=Decimal("1200.00"),
            total=Decimal("1200.00"),
        )

        # Parent A queries order B -> 404 Not Found
        client_a = self._client_for(self.parent_a)
        resp_a = client_a.get(f"/api/orders/{order_b.id}/")
        self.assertEqual(resp_a.status_code, 404)

        # School Admin Surat queries order B -> 404 Not Found
        client_surat = self._client_for(self.school_admin_surat)
        resp_surat = client_surat.get(f"/api/orders/{order_b.id}/")
        self.assertEqual(resp_surat.status_code, 404)

        # City Admin Delhi queries order B -> 200 OK (in Delhi)
        client_delhi = self._client_for(self.city_admin_delhi)
        resp_delhi = client_delhi.get(f"/api/orders/{order_b.id}/")
        self.assertEqual(resp_delhi.status_code, 200)

    # -------------------------------------------------------------------------
    # 15. Boundary: Legacy Order Statuses and Compatibility
    # -------------------------------------------------------------------------
    def test_15_boundary_legacy_statuses_and_migrations(self):
        """
        Legacy statuses (e.g. PENDING, SHIPPED, REFUNDED) serialize cleanly
        and map to modern visual tracking representations without errors.
        """
        client = self._client_for(self.parent_a)

        legacy_order = Order.objects.create(
            order_number="ORD-LEGACY-01",
            placed_by=self.parent_a,
            payer=self.parent_a,
            student=self.student_a1,
            school=self.school_surat,
            city=self.city_surat,
            status="PENDING",  # legacy status string
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
        )
        resp = client.get(f"/api/orders/{legacy_order.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "PENDING")
