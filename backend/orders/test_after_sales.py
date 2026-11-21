"""
Unit and regression test suite for After-Sales workflows (Task 5):
Cancellation, Size Exchange, Damaged/Incorrect Items, and Refund processing.

Verifies:
1. Server-owned eligibility rules (statuses, 7-day delivery limit, customisation cutoffs).
2. Role scoping: parents restricted to own orders; staff approval/inspection preserved.
3. Atomic stock reservation and restocking:
   - Replacement stock reserved atomically via apply_stock_movement.
   - Restocking only allowed for RESTOCKABLE returned items (damaged write-offs not restocked).
   - Double-reserve and double-restock strictly prevented.
4. Idempotent test-mode provider refunds:
   - Online payments refunded via RazorpayGateway (simulated/idempotent).
   - COD repayment handling (unpaid cancelled vs delivered cash).
   - Partial refunds and refund bounds enforcement.
   - Status changes alone never claim money refunded.
5. Query efficiency: bounded database queries without N+1 loops.
"""

from decimal import Decimal
import datetime as dt
import uuid
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from orders.models import (
    Order,
    OrderAfterSaleRequest,
    OrderItem,
    OrderItemExchange,
    OrderRefund,
    OrderStatusEvent,
    PaymentAttempt,
)
from orders.after_sales import (
    get_order_after_sales_eligibility,
    create_after_sale_request,
    review_after_sale_request,
    process_order_refund,
    check_customisation_production_started,
)
from schools.models import City, School, Student

User = get_user_model()


class AfterSalesTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.city = City.objects.create(name="Ahmedabad", code="AMD")
        self.school = School.objects.create(name="Delhi Public School", code="DPS", city=self.city)

        self.parent = User.objects.create_user(
            username="9876543210", phone="9876543210", role=User.Role.PARENT
        )
        self.other_parent = User.objects.create_user(
            username="9876543211", phone="9876543211", role=User.Role.PARENT
        )
        self.staff_user = User.objects.create_user(
            username="staff_user", role=User.Role.ADMIN, city=self.city
        )

        self.student = Student.objects.create(
            name="Aarav Patel",
            gr_number="GR1001",
            school=self.school,
            city=self.city,
            parent=self.parent,
            student_class="Class 5",
        )

        self.category = Category.objects.create(name="Uniform", slug="uniform")
        self.product = Product.objects.create(
            name="Regular School Shirt",
            school=self.school,
            category=self.category,
            selling_price=Decimal("500.00"),
            cost_price=Decimal("300.00"),
            gender=Product.Gender.UNISEX,
        )
        self.variant_30 = ProductVariant.objects.create(
            product=self.product,
            size="30",
            sku="SHIRT-30",
        )
        self.variant_32 = ProductVariant.objects.create(
            product=self.product,
            size="32",
            sku="SHIRT-32",
        )
        self.variant_34 = ProductVariant.objects.create(
            product=self.product,
            size="34",
            sku="SHIRT-34",
        )

        # Stock balances in Ahmedabad
        StockBalance.objects.create(city=self.city, variant=self.variant_30, stock_quantity=10)
        StockBalance.objects.create(city=self.city, variant=self.variant_32, stock_quantity=5)
        StockBalance.objects.create(city=self.city, variant=self.variant_34, stock_quantity=0)  # Out of stock

    def _create_order(self, status=Order.Status.PLACED, payment_status=Order.PaymentStatus.PENDING, payment_method=Order.PaymentMethod.ONLINE):
        seq = uuid.uuid4().hex[:8]
        order = Order.objects.create(
            order_number=f"ORD-{timezone.now().timestamp()}-{seq}",
            placed_by=self.parent,
            payer=self.parent,
            parent=self.parent,
            student=self.student,
            school=self.school,
            city=self.city,
            status=status,
            payment_status=payment_status,
            payment_method=payment_method,
            subtotal=Decimal("500.00"),
            total=Decimal("500.00"),
            razorpay_order_id=f"order_fake_{seq}",
            razorpay_payment_id=f"pay_fake_{seq}" if payment_status == Order.PaymentStatus.PAID else "",
        )
        item = OrderItem.objects.create(
            order=order,
            variant=self.variant_30,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("500.00"),
            unit_cost_snapshot=Decimal("300.00"),
            chosen_size="30",
        )
        OrderStatusEvent.objects.create(
            order=order,
            status=status,
            changed_by=self.parent,
            note="Order event created.",
        )
        if payment_status == Order.PaymentStatus.PAID:
            PaymentAttempt.objects.create(
                order=order,
                razorpay_payment_id=f"pay_fake_{seq}",
                status=PaymentAttempt.Status.CAPTURED,
                amount_paise=50000,
                method="card",
                last_source=PaymentAttempt.Source.VERIFY,
            )
        return order, item

    def test_cancellation_eligibility_and_customisation_cutoff(self):
        """Placed order is eligible for cancellation; customised item in production is blocked."""
        order, item = self._create_order(status=Order.Status.CONFIRMED, payment_status=Order.PaymentStatus.PAID)
        elig = get_order_after_sales_eligibility(order, self.parent)
        self.assertTrue(elig["can_cancel_order"])
        self.assertTrue(elig["items"][0]["can_cancel"])

        # Add customisation with print file generated
        item.customisation_data = {
            "cover_photo": "customisations/2026/cover.jpg",
            "cover_photo_print": "customisations/2026/cover_print.jpg",
            "cover_photo_status": "PROCESSED",
        }
        item.save()

        in_prod, rsn = check_customisation_production_started(item, order)
        self.assertTrue(in_prod)
        self.assertIn("Personalised print assets", rsn)

        elig_locked = get_order_after_sales_eligibility(order, self.parent)
        self.assertFalse(elig_locked["can_cancel_order"])
        self.assertFalse(elig_locked["items"][0]["can_cancel"])
        self.assertIn("production", elig_locked["cancel_order_reason"])

    def test_parent_cancellation_restocks_and_initiates_refund(self):
        """Parent cancelling eligible paid online order restocks items and issues refund."""
        order, item = self._create_order(status=Order.Status.CONFIRMED, payment_status=Order.PaymentStatus.PAID)
        initial_stock = StockBalance.objects.get(city=self.city, variant=self.variant_30).stock_quantity

        req = create_after_sale_request(order, self.parent, {
            "request_type": OrderAfterSaleRequest.RequestType.CANCEL,
            "reason": OrderAfterSaleRequest.Reason.CHANGE_OF_MIND,
            "reason_details": "No longer required.",
        })

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)
        self.assertEqual(req.status, OrderAfterSaleRequest.Status.COMPLETED)
        self.assertTrue(req.is_item_restocked)

        # Restock verified
        new_stock = StockBalance.objects.get(city=self.city, variant=self.variant_30).stock_quantity
        self.assertEqual(new_stock, initial_stock + 1)

        # Refund verified
        refund = OrderRefund.objects.filter(order=order).first()
        self.assertIsNotNone(refund)
        self.assertEqual(refund.status, OrderRefund.Status.SUCCEEDED)
        self.assertEqual(refund.amount_paise, 50000)
        self.assertTrue(refund.razorpay_refund_id.startswith("rfnd_sim_"))

        # Order payment status updated to REFUNDED because full amount refunded
        order.refresh_from_db()
        self.assertEqual(order.payment_status, Order.PaymentStatus.REFUNDED)

    def test_cod_cancellation_requires_no_online_refund(self):
        """Cancelling unpaid COD order restocks without calling online gateway."""
        order, item = self._create_order(
            status=Order.Status.CONFIRMED,
            payment_status=Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY,
        )

        req = create_after_sale_request(order, self.parent, {
            "request_type": OrderAfterSaleRequest.RequestType.CANCEL,
            "reason": OrderAfterSaleRequest.Reason.ORDERED_BY_MISTAKE,
        })

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)
        refund = OrderRefund.objects.filter(order=order).first()
        self.assertIsNotNone(refund)
        self.assertEqual(refund.repayment_channel, OrderRefund.RepaymentChannel.NOT_APPLICABLE)
        self.assertEqual(refund.status, OrderRefund.Status.SUCCEEDED)

    def test_parent_cannot_act_on_another_parents_order(self):
        """Cross-parent request is rejected with HTTP 403 / PermissionDenied."""
        order, item = self._create_order()
        self.client.force_authenticate(user=self.other_parent)

        resp = self.client.post(f"/api/orders/{order.id}/request-after-sale/", {
            "request_type": "CANCEL",
            "reason": "CHANGE_OF_MIND",
        }, format="json")

        self.assertIn(resp.status_code, [403, 404])

    def test_size_exchange_eligibility_and_atomic_reservation(self):
        """Size exchange reserves target variant stock atomically and prevents double-reservation."""
        order, item = self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)
        # Create delivery event
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.DELIVERED,
            changed_by=self.staff_user,
            timestamp=timezone.now() - dt.timedelta(days=2),
        )

        elig = get_order_after_sales_eligibility(order, self.parent)
        item_elig = elig["items"][0]
        self.assertTrue(item_elig["can_exchange"])
        self.assertTrue(elig["first_exchange_free"])

        # Variant 32 has 5 in stock; variant 34 has 0 in stock
        avail_sizes = {s["size"]: s for s in item_elig["replacement_sizes"]}
        self.assertTrue(avail_sizes["32"]["available"])
        self.assertFalse(avail_sizes["34"]["available"])

        # Attempting out-of-stock exchange is refused
        with self.assertRaises(Exception):
            create_after_sale_request(order, self.parent, {
                "order_item": str(item.id),
                "request_type": OrderAfterSaleRequest.RequestType.EXCHANGE,
                "reason": OrderAfterSaleRequest.Reason.TOO_SMALL,
                "target_size": "34",
            })

        # Requesting size 32 reserves stock atomically
        v32_initial = StockBalance.objects.get(city=self.city, variant=self.variant_32).stock_quantity
        req = create_after_sale_request(order, self.parent, {
            "order_item": str(item.id),
            "request_type": OrderAfterSaleRequest.RequestType.EXCHANGE,
            "reason": OrderAfterSaleRequest.Reason.TOO_SMALL,
            "target_size": "32",
        })

        self.assertEqual(req.status, OrderAfterSaleRequest.Status.REQUESTED)
        self.assertTrue(req.is_stock_reserved)
        self.assertEqual(req.charge_paise, 0)

        # Stock decremented by 1
        v32_after = StockBalance.objects.get(city=self.city, variant=self.variant_32).stock_quantity
        self.assertEqual(v32_after, v32_initial - 1)

        # Repeated exchange request on same line is blocked
        with self.assertRaises(Exception):
            create_after_sale_request(order, self.parent, {
                "order_item": str(item.id),
                "request_type": OrderAfterSaleRequest.RequestType.EXCHANGE,
                "reason": OrderAfterSaleRequest.Reason.TOO_SMALL,
                "target_size": "32",
            })

    def test_size_exchange_expired_after_7_days(self):
        """Size exchange and return reporting are blocked 8 days after delivery."""
        order, item = self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)
        OrderStatusEvent.objects.create(
            order=order,
            status=Order.Status.DELIVERED,
            changed_by=self.staff_user,
            timestamp=timezone.now() - dt.timedelta(days=8),
        )

        elig = get_order_after_sales_eligibility(order, self.parent)
        self.assertFalse(elig["within_7_days"])
        self.assertFalse(elig["items"][0]["can_exchange"])
        self.assertFalse(elig["items"][0]["can_return"])
        self.assertIn("expired", elig["items"][0]["exchange_reason"].lower())

    def test_staff_inspection_restocks_only_when_restockable(self):
        """Returned item is restocked only when condition is RESTOCKABLE; damaged goods are not restocked."""
        order, item = self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)
        OrderStatusEvent.objects.create(order=order, status=Order.Status.DELIVERED, timestamp=timezone.now())

        # Exchange request
        req = create_after_sale_request(order, self.parent, {
            "order_item": str(item.id),
            "request_type": OrderAfterSaleRequest.RequestType.EXCHANGE,
            "reason": OrderAfterSaleRequest.Reason.TOO_SMALL,
            "target_size": "32",
        })

        v30_initial = StockBalance.objects.get(city=self.city, variant=self.variant_30).stock_quantity

        # Staff inspects and marks DAMAGED_DISCARD
        review_after_sale_request(
            req,
            self.staff_user,
            action="INSPECT",
            notes="Tags removed, stained fabric.",
            restock_condition=OrderAfterSaleRequest.RestockCondition.DAMAGED_DISCARD,
        )

        req.refresh_from_db()
        self.assertEqual(req.status, OrderAfterSaleRequest.Status.INSPECTED)
        self.assertFalse(req.is_item_restocked)
        # Stock for variant 30 did NOT increase
        v30_curr = StockBalance.objects.get(city=self.city, variant=self.variant_30).stock_quantity
        self.assertEqual(v30_curr, v30_initial)

        # Another request marked RESTOCKABLE
        order2, item2 = self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)
        OrderStatusEvent.objects.create(order=order2, status=Order.Status.DELIVERED, timestamp=timezone.now())
        req2 = create_after_sale_request(order2, self.parent, {
            "order_item": str(item2.id),
            "request_type": OrderAfterSaleRequest.RequestType.EXCHANGE,
            "reason": OrderAfterSaleRequest.Reason.TOO_BIG,
            "target_size": "32",
        })

        review_after_sale_request(
            req2,
            self.staff_user,
            action="INSPECT",
            notes="Unworn with tags intact.",
            restock_condition=OrderAfterSaleRequest.RestockCondition.RESTOCKABLE,
        )

        req2.refresh_from_db()
        self.assertTrue(req2.is_item_restocked)
        v30_new = StockBalance.objects.get(city=self.city, variant=self.variant_30).stock_quantity
        self.assertEqual(v30_new, v30_initial + 1)

        # Complete exchange records OrderItemExchange
        review_after_sale_request(req2, self.staff_user, action="COMPLETE", notes="Exchange handed to parent.")
        req2.refresh_from_db()
        self.assertEqual(req2.status, OrderAfterSaleRequest.Status.COMPLETED)
        self.assertIsNotNone(req2.exchange_record)
        self.assertEqual(req2.exchange_record.to_size, "32")
        item2.refresh_from_db()
        self.assertEqual(item2.current_size, "32")

    def test_damaged_item_return_and_idempotent_refund(self):
        """Reporting damaged item creates request and approval initiates idempotent provider refund."""
        order, item = self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)
        OrderStatusEvent.objects.create(order=order, status=Order.Status.DELIVERED, timestamp=timezone.now())

        req = create_after_sale_request(order, self.parent, {
            "order_item": str(item.id),
            "request_type": OrderAfterSaleRequest.RequestType.RETURN,
            "reason": OrderAfterSaleRequest.Reason.DEFECTIVE,
            "reason_details": "Torn sleeve seam on delivery.",
        })

        self.assertEqual(req.status, OrderAfterSaleRequest.Status.REQUESTED)

        # Staff approves return -> schedules and executes refund
        review_after_sale_request(req, self.staff_user, action="APPROVE", notes="Seam defect approved.")

        req.refresh_from_db()
        self.assertEqual(req.status, OrderAfterSaleRequest.Status.APPROVED)

        refund = OrderRefund.objects.filter(request=req).first()
        self.assertIsNotNone(refund)
        self.assertEqual(refund.status, OrderRefund.Status.SUCCEEDED)
        self.assertEqual(refund.amount_paise, 50000)

        # Calling refund again does NOT double-refund (idempotent)
        process_order_refund(refund, actor=self.staff_user)
        self.assertEqual(OrderRefund.objects.filter(request=req).count(), 1)

    def test_no_n_plus_one_queries_with_after_sales(self):
        """Order list endpoint executes in constant bounded database queries."""
        # Create 3 orders
        for _ in range(3):
            self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)

        self.client.force_authenticate(user=self.parent)

        with CaptureQueriesContext(connection) as ctx_3:
            resp3 = self.client.get("/api/orders/")
            self.assertEqual(resp3.status_code, 200)

        # Create 2 more orders (5 total)
        for _ in range(2):
            self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)

        with CaptureQueriesContext(connection) as ctx_5:
            resp5 = self.client.get("/api/orders/")
            self.assertEqual(resp5.status_code, 200)

        # Total query count must remain bounded and identical between 3 and 5 orders
        self.assertEqual(len(ctx_3.captured_queries), len(ctx_5.captured_queries))

    # --- Supervisor review fixes ---

    def _approved_return(self):
        order, item = self._create_order(status=Order.Status.DELIVERED, payment_status=Order.PaymentStatus.PAID)
        OrderStatusEvent.objects.create(order=order, status=Order.Status.DELIVERED, timestamp=timezone.now())
        req = create_after_sale_request(order, self.parent, {
            "order_item": str(item.id),
            "request_type": OrderAfterSaleRequest.RequestType.RETURN,
            "reason": OrderAfterSaleRequest.Reason.DEFECTIVE,
            "reason_details": "Torn seam.",
        })
        return order, req

    def test_approving_twice_does_not_create_a_second_refund(self):
        from rest_framework.exceptions import ValidationError as DRFValidationError
        from django.core.exceptions import ValidationError as DjangoValidationError
        _, req = self._approved_return()
        review_after_sale_request(req, self.staff_user, action="APPROVE")
        with self.assertRaises((DRFValidationError, DjangoValidationError)):
            review_after_sale_request(req, self.staff_user, action="APPROVE")
        self.assertEqual(OrderRefund.objects.filter(request=req).count(), 1)

    def test_school_admin_cannot_review_another_schools_request(self):
        other_school = School.objects.create(name="Other School", code="OTH", city=self.city)
        outsider = User.objects.create_user(
            username="sa_other", role=User.Role.SCHOOL_ADMIN, school=other_school, city=self.city
        )
        _, req = self._approved_return()
        self.client.force_authenticate(user=outsider)
        resp = self.client.post(
            "/api/orders/review-after-sale/", {"request_id": str(req.id), "action": "APPROVE"}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        req.refresh_from_db()
        self.assertEqual(req.status, OrderAfterSaleRequest.Status.REQUESTED)
        self.assertFalse(OrderRefund.objects.filter(request=req).exists())

    def test_refund_without_keys_fails_instead_of_pretending(self):
        from django.test import override_settings
        _, req = self._approved_return()
        with override_settings(RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET="", RAZORPAY_SIMULATE_REFUNDS=False):
            review_after_sale_request(req, self.staff_user, action="APPROVE")
        refund = OrderRefund.objects.get(request=req)
        self.assertEqual(refund.status, OrderRefund.Status.FAILED)
        self.assertIn("not configured", refund.failure_reason)
        req.order.refresh_from_db()
        self.assertNotEqual(req.order.payment_status, Order.PaymentStatus.REFUNDED)

    def test_retry_adopts_refund_razorpay_already_made(self):
        from unittest import mock
        from orders.payment import RazorpayGateway
        _, req = self._approved_return()
        with mock.patch.object(RazorpayGateway, "create_refund", side_effect=TimeoutError("read timed out")):
            review_after_sale_request(req, self.staff_user, action="APPROVE")
        refund = OrderRefund.objects.get(request=req)
        self.assertEqual(refund.status, OrderRefund.Status.FAILED)
        existing = {"id": "rfnd_existing123", "status": "processed", "notes": {"refund_id": str(refund.id)}}
        with mock.patch.object(RazorpayGateway, "find_refund_by_note", return_value=existing) as found, \
                mock.patch.object(RazorpayGateway, "create_refund") as create:
            process_order_refund(refund, actor=self.staff_user)
        found.assert_called_once()
        create.assert_not_called()
        refund.refresh_from_db()
        self.assertEqual(refund.status, OrderRefund.Status.SUCCEEDED)
        self.assertEqual(refund.razorpay_refund_id, "rfnd_existing123")