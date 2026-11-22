"""
Tests for Notification Outbox, Provider Decoupling, Deduplication,
Bounded Retries, and Privacy Controls (Task 9).
"""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from schools.models import City, School, SchoolBranch, Student
from orders.models import (
    NotificationPreference,
    NotificationRecord,
    Order,
    OrderItem,
    OrderAfterSaleRequest,
    OrderRefund,
)
from orders.notifications import (
    MockNotificationAdapter,
    ProviderResult,
    enqueue_notification,
    mask_phone_number,
    mask_email_address,
    sanitize_operational_error,
)
from orders.status import change_order_status
from orders.tasks import deliver_notification_task, sweep_pending_notifications

User = get_user_model()


class NotificationSystemTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.city = City.objects.filter(code="SUR").first()
        if not cls.city:
            cls.city = City.objects.create(name="Surat", code="SUR")

        cls.school = School.objects.filter(code="DPS-SUR").first()
        if not cls.school:
            cls.school = School.objects.create(
                name="Delhi Public School",
                code="DPS-SUR",
                city=cls.city,
                home_delivery_enabled=True,
                school_pickup_enabled=True,
            )

        cls.branch = SchoolBranch.objects.filter(school=cls.school).first()
        if not cls.branch:
            cls.branch = SchoolBranch.objects.create(
                school=cls.school,
                city=cls.city,
                name="Main Campus",
            )

        cls.boss = User.objects.filter(username="notif_boss").first()
        if not cls.boss:
            cls.boss = User.objects.create_user(
                username="notif_boss",
                role=User.Role.BOSS,
                password="securepassword123",
            )

        cls.admin_surat = User.objects.filter(username="notif_admin_surat").first()
        if not cls.admin_surat:
            cls.admin_surat = User.objects.create_user(
                username="notif_admin_surat",
                role=User.Role.ADMIN,
                city=cls.city,
                password="securepassword123",
            )

        cls.parent_user = User.objects.filter(username="notif_parent").first()
        if not cls.parent_user:
            cls.parent_user = User.objects.create_user(
                username="notif_parent",
                role=User.Role.PARENT,
                phone="9876543210",
                email="parent@example.com",
                password="securepassword123",
            )

        cls.student = Student.objects.create(
            name="Aarav Patel",
            school=cls.school,
            student_class="Class 5",
        )

        cls.category = Category.objects.filter(slug="uniforms-notif").first()
        if not cls.category:
            cls.category = Category.objects.create(name="Uniforms Notif", slug="uniforms-notif")

        cls.product = Product.objects.filter(name="School Shirt Notif").first()
        if not cls.product:
            cls.product = Product.objects.create(
                name="School Shirt Notif",
                category=cls.category,
                cost_price=Decimal("300.00"),
                selling_price=Decimal("450.00"),
            )

        cls.var_30 = ProductVariant.objects.filter(sku="SHIRT-NOTIF-30").first()
        if not cls.var_30:
            cls.var_30 = ProductVariant.objects.create(
                product=cls.product,
                sku="SHIRT-NOTIF-30",
                size="30",
            )

        cls.var_32 = ProductVariant.objects.filter(sku="SHIRT-NOTIF-32").first()
        if not cls.var_32:
            cls.var_32 = ProductVariant.objects.create(
                product=cls.product,
                sku="SHIRT-NOTIF-32",
                size="32",
            )

        StockBalance.objects.get_or_create(
            city=cls.city,
            variant=cls.var_30,
            defaults={"stock_quantity": 50, "low_stock_threshold": 10},
        )
        StockBalance.objects.get_or_create(
            city=cls.city,
            variant=cls.var_32,
            defaults={"stock_quantity": 50, "low_stock_threshold": 10},
        )

    def setUp(self):
        MockNotificationAdapter.reset()
        self.client = APIClient()

    def _create_order(self, status=Order.Status.PLACED):
        import uuid
        seq = uuid.uuid4().hex[:8]
        order = Order.objects.create(
            city=self.city,
            school=self.school,
            branch=self.branch,
            student=self.student,
            placed_by=self.parent_user,
            parent=self.parent_user,
            payer=self.parent_user,
            status=status,
            payment_status=Order.PaymentStatus.PAID if status != Order.Status.PLACED else Order.PaymentStatus.PENDING,
            payment_method=Order.PaymentMethod.ONLINE,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
            order_number=f"ORD-{timezone.now().timestamp()}-{seq}",
        )
        OrderItem.objects.create(
            order=order,
            variant=self.var_30,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("450.00"),
            unit_cost_snapshot=Decimal("300.00"),
        )
        return order

    def test_outbox_enqueue_and_deduplication(self):
        """Retries cannot duplicate customer messages (idempotency key uniqueness)."""
        order = self._create_order()

        # Enqueue order confirmation
        rec1 = enqueue_notification(
            order,
            NotificationRecord.EventType.ORDER_CONFIRMED,
            payload={"order_number": order.order_number, "amount": "450.00"},
        )
        self.assertIsNotNone(rec1)
        self.assertEqual(rec1.status, NotificationRecord.Status.PENDING)
        self.assertEqual(rec1.recipient_phone, "9876543210")

        # Second attempt with same event and order must return existing record, never duplicate
        rec2 = enqueue_notification(
            order,
            NotificationRecord.EventType.ORDER_CONFIRMED,
            payload={"order_number": order.order_number, "amount": "450.00"},
        )
        self.assertEqual(rec1.id, rec2.id)
        self.assertEqual(
            NotificationRecord.objects.filter(
                order=order,
                event_type=NotificationRecord.EventType.ORDER_CONFIRMED,
            ).count(),
            1,
        )

    def test_notification_delivery_accepted_is_sent_not_delivered(self):
        """Accepted provider request is recorded as SENT, NEVER as DELIVERED."""
        order = self._create_order()
        rec = enqueue_notification(
            order,
            NotificationRecord.EventType.ORDER_CONFIRMED,
        )

        success = deliver_notification_task(str(rec.id))
        self.assertTrue(success)

        rec.refresh_from_db()
        self.assertEqual(rec.status, NotificationRecord.Status.SENT)
        self.assertNotEqual(rec.status, NotificationRecord.Status.DELIVERED)
        self.assertIsNotNone(rec.sent_at)
        self.assertIsNone(rec.delivered_at)
        self.assertTrue(rec.provider_message_id.startswith("mock_"))

        # Re-delivering an already SENT record is a safe no-op (idempotent)
        res = deliver_notification_task(str(rec.id))
        self.assertTrue(res)
        self.assertEqual(rec.attempt_count, 1)

    def test_broker_failure_resilience_and_sweeper_recovery(self):
        """Broker failures after commit leave outbox in PENDING, sweeper recovers delivery."""
        order = self._create_order()

        # Simulate broken Celery broker where delay() raises an exception during transaction.on_commit
        with patch("orders.tasks.deliver_notification_task.delay", side_effect=ConnectionError("Redis broker offline")):
            with transaction.atomic():
                rec = enqueue_notification(
                    order,
                    NotificationRecord.EventType.DISPATCHED,
                    payload={"order_number": order.order_number, "tracking_number": "TRK12345"},
                )

        # The DB transaction succeeded, order is safe, outbox record persisted
        rec.refresh_from_db()
        self.assertEqual(rec.status, NotificationRecord.Status.PENDING)
        self.assertEqual(rec.attempt_count, 0)

        # Sweeper runs via periodic Celery beat and recovers pending records
        results = sweep_pending_notifications()
        self.assertIn(True, results)

        rec.refresh_from_db()
        self.assertEqual(rec.status, NotificationRecord.Status.SENT)
        self.assertEqual(rec.attempt_count, 1)

    def test_bounded_retry_and_exponential_backoff(self):
        """Failed delivery backs off with exponential delay and terminates at EXHAUSTED."""
        order = self._create_order()
        rec = enqueue_notification(
            order,
            NotificationRecord.EventType.ORDER_CONFIRMED,
        )

        failing_adapter = MockNotificationAdapter()
        with patch("orders.notifications.get_notification_adapter", return_value=failing_adapter):
            with patch.object(
                failing_adapter,
                "send",
                return_value=ProviderResult(success=False, error_message="Network Gateway 502 Bad Gateway"),
            ):
                # 1st attempt -> FAILED (retry scheduled)
                now_before = timezone.now()
                deliver_notification_task(str(rec.id))
                rec.refresh_from_db()
                self.assertEqual(rec.status, NotificationRecord.Status.FAILED)
                self.assertEqual(rec.attempt_count, 1)
                self.assertGreater(rec.next_attempt_at, now_before)
                self.assertIn("Gateway 502", rec.error_message)

                # 2nd attempt -> FAILED
                deliver_notification_task(str(rec.id))
                rec.refresh_from_db()
                self.assertEqual(rec.status, NotificationRecord.Status.FAILED)
                self.assertEqual(rec.attempt_count, 2)

                # 3rd attempt -> Reaches max_attempts (3) -> EXHAUSTED
                deliver_notification_task(str(rec.id))
                rec.refresh_from_db()
                self.assertEqual(rec.status, NotificationRecord.Status.EXHAUSTED)
                self.assertEqual(rec.attempt_count, 3)

                # Further delivery attempts do not run when EXHAUSTED
                res = deliver_notification_task(str(rec.id))
                self.assertFalse(res)
                rec.refresh_from_db()
                self.assertEqual(rec.attempt_count, 3)

    def test_lifecycle_events_dispatch_pickup_delivered(self):
        """Meaningful dispatch, pickup-ready, and delivery transitions enqueue notifications."""
        # 1. Dispatch
        order = self._create_order(status=Order.Status.PACKED)
        change_order_status(Order.objects.filter(pk=order.pk), Order.Status.DISPATCHED, user=self.admin_surat)
        disp_notif = NotificationRecord.objects.filter(
            order=order,
            event_type=NotificationRecord.EventType.DISPATCHED,
        ).first()
        self.assertIsNotNone(disp_notif)

        # 2. Pickup Ready
        order2 = self._create_order(status=Order.Status.PACKED)
        change_order_status(Order.objects.filter(pk=order2.pk), Order.Status.READY_FOR_PICKUP, user=self.admin_surat)
        pickup_notif = NotificationRecord.objects.filter(
            order=order2,
            event_type=NotificationRecord.EventType.PICKUP_READY,
        ).first()
        self.assertIsNotNone(pickup_notif)

        # 3. Delivered
        change_order_status(Order.objects.filter(pk=order.pk), Order.Status.DELIVERED, user=self.admin_surat)
        deliv_notif = NotificationRecord.objects.filter(
            order=order,
            event_type=NotificationRecord.EventType.DELIVERED,
        ).first()
        self.assertIsNotNone(deliv_notif)

    def test_after_sales_exchange_and_refund_notifications(self):
        """Exchange updates and refunds trigger dedicated outbox notifications."""
        from orders.after_sales import create_after_sale_request, process_order_refund

        order = self._create_order(status=Order.Status.DELIVERED)
        item = order.items.first()

        # Exchange request
        req = create_after_sale_request(
            order=order,
            user=self.parent_user,
            data={
                "request_type": OrderAfterSaleRequest.RequestType.EXCHANGE,
                "order_item": str(item.id),
                "reason": OrderAfterSaleRequest.Reason.TOO_SMALL,
                "target_size": "32",
            },
        )
        exch_notif = NotificationRecord.objects.filter(
            order=order,
            event_type=NotificationRecord.EventType.EXCHANGE_UPDATE,
        ).first()
        self.assertIsNotNone(exch_notif)
        self.assertEqual(exch_notif.payload.get("status"), "REQUESTED")

        # Refund processed
        order.payment_method = Order.PaymentMethod.CASH_ON_DELIVERY
        order.save(update_fields=["payment_method"])
        refund = OrderRefund.objects.create(
            order=order,
            request=req,
            amount_paise=45000,
            payment_method=Order.PaymentMethod.CASH_ON_DELIVERY,
            repayment_channel=OrderRefund.RepaymentChannel.CASH,
            status=OrderRefund.Status.PENDING,
        )
        process_order_refund(refund, actor=self.admin_surat)

        ref_notif = NotificationRecord.objects.filter(
            order=order,
            event_type=NotificationRecord.EventType.REFUND_PROCESSED,
        ).first()
        self.assertIsNotNone(ref_notif)

    def test_privacy_controls_masking_and_secret_redaction(self):
        """Customer phone/email are masked, secrets redacted, child data excluded."""
        self.assertEqual(mask_phone_number("9876543210"), "******3210")
        self.assertEqual(mask_email_address("parent@school.com"), "p***@school.com")

        error_with_secrets = "Auth failed: authkey=secret_xyz123 on recipient 9876543210 with Bearer abcde_token"
        sanitized = sanitize_operational_error(error_with_secrets)
        self.assertNotIn("secret_xyz123", sanitized)
        self.assertNotIn("abcde_token", sanitized)
        self.assertNotIn("9876543210", sanitized)
        self.assertIn("[REDACTED]", sanitized)

        # Outbox payload does not contain student name or child info
        order = self._create_order()
        rec = enqueue_notification(
            order,
            NotificationRecord.EventType.ORDER_CONFIRMED,
            payload={
                "order_number": order.order_number,
                "amount": "450.00",
                "student_name": "Arjun Sharma",  # Sensitive child PII
                "child_measurements": "chest 28",  # Sensitive child PII
            },
        )
        self.assertNotIn("student_name", rec.payload)
        self.assertNotIn("child_measurements", rec.payload)
        self.assertIn("order_number", rec.payload)

    def test_channel_preferences_and_marketing_separation(self):
        """Honours preferred channels and separates marketing from transactional."""
        # 1. Custom preferred channel
        NotificationPreference.objects.create(
            user=self.parent_user,
            preferred_channel=NotificationPreference.PreferredChannel.WHATSAPP,
            allow_whatsapp=True,
            allow_sms=True,
            allow_marketing=False,
        )

        order = self._create_order()
        rec = enqueue_notification(order, NotificationRecord.EventType.ORDER_CONFIRMED)
        self.assertEqual(rec.channel, NotificationRecord.Channel.WHATSAPP)

        # 2. Marketing notification without consent is suppressed
        mkt_rec = enqueue_notification(
            order,
            NotificationRecord.EventType.ORDER_CONFIRMED,
            category=NotificationRecord.Category.MARKETING,
            idempotency_key="promo_winter_sale_1",
        )
        self.assertIsNone(mkt_rec)

    def test_staff_retry_control_endpoint(self):
        """Staff can inspect outbox with masked details and retry failed notifications."""
        order = self._create_order()
        rec = NotificationRecord.objects.create(
            order=order,
            event_type=NotificationRecord.EventType.ORDER_CONFIRMED,
            status=NotificationRecord.Status.EXHAUSTED,
            attempt_count=3,
            recipient_phone="9876543210",
            error_message="Gateway rejected message",
            idempotency_key="retry_test_key_1",
        )

        # PARENT cannot access staff notification diagnostics
        self.client.force_authenticate(user=self.parent_user)
        res_parent = self.client.get("/api/notifications/")
        self.assertEqual(res_parent.status_code, status.HTTP_403_FORBIDDEN)

        # STAFF can access and see masked recipient
        self.client.force_authenticate(user=self.admin_surat)
        res_staff = self.client.get(f"/api/notifications/{rec.id}/")
        self.assertEqual(res_staff.status_code, status.HTTP_200_OK)
        self.assertEqual(res_staff.data["recipient"], "******3210")
        self.assertNotIn("9876543210", res_staff.data["recipient"])

        # STAFF triggers retry action
        retry_res = self.client.post(f"/api/notifications/{rec.id}/retry/")
        self.assertEqual(retry_res.status_code, status.HTTP_200_OK)

        rec.refresh_from_db()
        self.assertEqual(rec.status, NotificationRecord.Status.SENT)
        self.assertEqual(rec.attempt_count, 1)
        self.assertEqual(rec.error_message, "")
