import io
import uuid
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import ProductVariant, SizeChartRow, SizingSample
from schools.models import Student

from .fit_retention import clear_fit_data
from .models import Order, OrderItem, OrderItemExchange, OrderStatusEvent

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM, FIT_DATA_RETENTION_DAYS=90, FIT_DATA_BACKSTOP_DAYS=180)
class FitRetentionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.student = Student.objects.get(gr_number="DPS-2026-001")  # DPS Surat, class 5
        cls.shirt_30 = ProductVariant.objects.get(sku="DPS-SHIRT-30")
        for i, sku in enumerate(["DPS-SHIRT-28", "DPS-SHIRT-30", "DPS-SHIRT-32", "DPS-SHIRT-34"]):
            SizeChartRow.objects.create(
                variant=ProductVariant.objects.get(sku=sku),
                height_cm_min=116 + i * 13,
                height_cm_max=128 + i * 13,
                weight_kg_min=18 + i * 8,
                weight_kg_max=26 + i * 8,
            )

    def setUp(self):
        cache.clear()
        self.now = timezone.now()

    def place(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(self.parent)['access']}")
        res = client.post(
            "/api/orders/",
            {
                "idempotency_key": str(uuid.uuid4()),
                "student": str(self.student.id),
                "fulfillment_type": "SCHOOL_PICKUP",
                "payment_method": "COD",
                "items": [{"variant": str(self.shirt_30.id), "quantity": 1}],
                "fit": {"height_cm": 135, "weight_kg": 30},
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.json())
        return OrderItem.objects.select_related("order").get(order_id=res.json()["id"])

    def end(self, item, status, days_ago):
        OrderStatusEvent.objects.create(
            order=item.order, status=status, timestamp=self.now - timedelta(days=days_ago)
        )

    def test_delivered_long_ago_is_copied_then_cleared(self):
        item = self.place()
        self.end(item, Order.Status.DELIVERED, 91)

        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 1)

        item.refresh_from_db()
        self.assertIsNone(item.fit_height_cm)
        self.assertIsNone(item.fit_weight_kg)
        # The sizes stay on the order line.
        self.assertEqual((item.recommended_size, item.chosen_size), (self.shirt_30.size, self.shirt_30.size))

        sample = SizingSample.objects.get()
        placed = timezone.localdate(item.order.created_at)
        self.assertEqual(sample.month, placed.replace(day=1))
        self.assertEqual(sample.product_id, self.shirt_30.product_id)
        self.assertEqual(sample.student_class, item.order.student_class)
        self.assertEqual((sample.height_cm, sample.weight_kg), (Decimal("135.0"), Decimal("30.0")))
        self.assertEqual(sample.recommended_size, self.shirt_30.size)
        self.assertEqual(sample.recommendation_status, "FIT")
        self.assertEqual((sample.chosen_size, sample.final_size), (self.shirt_30.size, self.shirt_30.size))
        self.assertEqual(sample.exchange_reason, "")

    def test_inside_the_retention_window_nothing_changes(self):
        item = self.place()
        self.end(item, Order.Status.DELIVERED, 89)
        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 0)
        item.refresh_from_db()
        self.assertEqual(item.fit_height_cm, Decimal("135.0"))
        self.assertFalse(SizingSample.objects.exists())

    def test_cancelled_and_returned_orders_start_the_clock_too(self):
        cancelled, returned = self.place(), self.place()
        self.end(cancelled, Order.Status.CANCELLED, 91)
        self.end(returned, Order.Status.RETURNED, 91)
        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 2)

    def test_latest_ending_counts(self):
        item = self.place()
        self.end(item, Order.Status.DELIVERED, 120)
        self.end(item, Order.Status.RETURNED, 10)
        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 0)

    def test_order_that_never_ended_is_cleared_after_the_backstop(self):
        item = self.place()
        Order.objects.filter(pk=item.order_id).update(created_at=self.now - timedelta(days=179))
        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 0)
        Order.objects.filter(pk=item.order_id).update(created_at=self.now - timedelta(days=181))
        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 1)

    def test_running_again_does_nothing(self):
        item = self.place()
        self.end(item, Order.Status.DELIVERED, 91)
        clear_fit_data(now=self.now)
        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 0)
        self.assertEqual(SizingSample.objects.count(), 1)

    @override_settings(FIT_DATA_RETENTION_DAYS=30)
    def test_retention_days_come_from_settings(self):
        item = self.place()
        self.end(item, Order.Status.DELIVERED, 31)
        self.assertEqual(clear_fit_data(now=self.now)["cleared"], 1)

    def test_exchange_reason_and_final_size(self):
        bigger = ProductVariant.objects.get(sku="DPS-SHIRT-32").size
        item = self.place()
        OrderItemExchange.objects.create(
            order_item=item, from_size=item.chosen_size, to_size=bigger,
            reason=OrderItemExchange.Reason.TOO_SMALL, created_at=self.now - timedelta(days=95),
        )
        OrderItemExchange.objects.create(
            order_item=item, from_size=bigger, to_size=bigger,
            reason=OrderItemExchange.Reason.NOT_SIZE, created_at=self.now - timedelta(days=94),
        )
        only_fault = self.place()
        OrderItemExchange.objects.create(
            order_item=only_fault, from_size=only_fault.chosen_size, to_size=only_fault.chosen_size,
            reason=OrderItemExchange.Reason.NOT_SIZE,
        )
        for line in (item, only_fault):
            self.end(line, Order.Status.DELIVERED, 91)

        clear_fit_data(now=self.now)
        samples = {s.final_size: s.exchange_reason for s in SizingSample.objects.all()}
        self.assertEqual(samples, {bigger: "TOO_SMALL", self.shirt_30.size: "NOT_SIZE"})

    def test_sample_has_no_link_to_student_order_or_user(self):
        links = {f.name for f in SizingSample._meta.get_fields() if f.is_relation}
        self.assertEqual(links, {"product"})
        dates = {f.name for f in SizingSample._meta.get_fields() if f.get_internal_type() == "DateField"}
        self.assertEqual(dates, {"month"})

    def test_dry_run_and_command(self):
        item = self.place()
        self.end(item, Order.Status.DELIVERED, 91)
        out = io.StringIO()
        call_command("clear_fit_data", "--dry-run", stdout=out)
        self.assertIn("Due: 1", out.getvalue())
        item.refresh_from_db()
        self.assertIsNotNone(item.fit_height_cm)

        call_command("clear_fit_data", stdout=out)
        self.assertIn("Cleared: 1", out.getvalue())
        item.refresh_from_db()
        self.assertIsNone(item.fit_height_cm)
