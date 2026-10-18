import uuid
from decimal import Decimal

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import ProductVariant, SizeChartRow
from schools.models import Student, StudentMeasurement

from .models import OrderItem, OrderItemExchange

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
SHIRT_CHART = {
    "DPS-SHIRT-28": (116, 128, 18, 26),
    "DPS-SHIRT-30": (129, 140, 24, 34),
    "DPS-SHIRT-32": (146, 155, 32, 45),
    "DPS-SHIRT-34": (156, 168, 42, 58),
}


@override_settings(CACHES=LOCMEM)
class FitLoggingTests(TestCase):
    """Height, weight and the recommendation are kept on the order line."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.student = Student.objects.get(gr_number="DPS-2026-001")  # DPS Surat, class 5, boy
        cls.shirt_30 = ProductVariant.objects.get(sku="DPS-SHIRT-30")
        cls.shirt_32 = ProductVariant.objects.get(sku="DPS-SHIRT-32")
        cls.shoes = ProductVariant.objects.filter(
            product__category__slug="school-shoes", product__school__isnull=True, active=True
        ).first()
        for sku, (h_min, h_max, w_min, w_max) in SHIRT_CHART.items():
            SizeChartRow.objects.create(
                variant=ProductVariant.objects.get(sku=sku),
                height_cm_min=h_min,
                height_cm_max=h_max,
                weight_kg_min=w_min,
                weight_kg_max=w_max,
            )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(self.parent)['access']}"
        )

    def place(self, items, fit=None, expect=201, line_fits=None):
        line_fits = line_fits or {}
        payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "payment_method": "COD",
            "items": [
                {"variant": str(v.id), "quantity": 1, **({"fit": line_fits[v]} if v in line_fits else {})}
                for v in items
            ],
        }
        if fit is not None:
            payload["fit"] = fit
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, expect, res.json())
        return res.json()

    def item(self, order, variant):
        return OrderItem.objects.get(order_id=order["id"], variant=variant)

    def test_fit_and_recommendation_are_stored_on_the_line(self):
        order = self.place([self.shirt_32], fit={"height_cm": 135, "weight_kg": "30.25"})
        line = self.item(order, self.shirt_32)
        self.assertEqual(line.fit_height_cm, Decimal("135.0"))
        self.assertEqual(line.fit_weight_kg, Decimal("30.3"))
        self.assertEqual(line.recommended_size, self.shirt_30.size)
        self.assertEqual(line.recommendation_status, "FIT")
        self.assertEqual(line.chosen_size, self.shirt_32.size)

    def test_shoulder_from_the_camera_step_is_logged(self):
        fit = {"height_cm": 135, "weight_kg": 30, "shoulder_cm": 30.4, "shoulder_confidence": 0.77}
        line = self.item(self.place([self.shirt_30], fit=fit), self.shirt_30)
        self.assertEqual((line.fit_shoulder_cm, line.fit_shoulder_confidence), (Decimal("30.4"), Decimal("0.770")))

    def test_between_sizes_logs_both(self):
        order = self.place([self.shirt_32], fit={"height_cm": 143, "weight_kg": 33})
        line = self.item(order, self.shirt_32)
        self.assertEqual(
            (line.recommendation_status, line.recommended_size, line.recommended_alt_size),
            ("BETWEEN", self.shirt_32.size, self.shirt_30.size),
        )

    def test_product_without_chart_logs_only_the_chosen_size(self):
        order = self.place([self.shirt_30, self.shoes], fit={"height_cm": 135, "weight_kg": 30})
        line = self.item(order, self.shoes)
        self.assertEqual(line.chosen_size, self.shoes.size)
        self.assertIsNone(line.fit_height_cm)
        self.assertEqual((line.recommended_size, line.recommendation_status), ("", ""))

    def test_order_without_fit_still_logs_the_chosen_size(self):
        order = self.place([self.shirt_30])
        line = self.item(order, self.shirt_30)
        self.assertEqual(line.chosen_size, self.shirt_30.size)
        self.assertIsNone(line.fit_height_cm)
        self.assertEqual(line.recommended_size, "")

    def test_recommendation_sent_by_the_phone_is_ignored(self):
        fit = {"height_cm": 135, "weight_kg": 30, "recommended_size": "34"}
        order = self.place([self.shirt_30], fit=fit)
        self.assertEqual(self.item(order, self.shirt_30).recommended_size, self.shirt_30.size)

    def test_out_of_range_fit_is_refused(self):
        before = OrderItem.objects.count()
        data = self.place([self.shirt_30], fit={"height_cm": 13.5, "weight_kg": 30}, expect=400)
        self.assertEqual(data["fit"]["height_cm"], ["OUT_OF_RANGE"])
        self.assertEqual(OrderItem.objects.count(), before)

    def test_line_fit_is_copied_even_without_a_chart(self):
        camera = {"height_cm": 135, "weight_kg": 30, "shoulder_cm": 31, "shoulder_confidence": 0.8,
                  "source": "CAMERA", "shoulder_edited": True}
        order = self.place([self.shirt_30, self.shoes], line_fits={self.shirt_30: camera, self.shoes: camera})
        shirt, shoes = self.item(order, self.shirt_30), self.item(order, self.shoes)
        self.assertEqual((shirt.fit_source, shirt.fit_shoulder_edited), ("CAMERA", True))
        self.assertEqual(shirt.recommendation_status, "FIT")
        self.assertEqual(shoes.fit_height_cm, Decimal("135.0"))  # no chart, numbers kept for the tailor
        self.assertEqual(shoes.recommendation_status, "")
        measurement = order["items"][0]["measurement"] or order["items"][1]["measurement"]
        self.assertEqual(measurement["source"], "CAMERA")

    def test_typed_shoulder_needs_no_confidence_and_is_never_edited(self):
        typed = {"height_cm": 135, "weight_kg": 30, "shoulder_cm": 31, "source": "MANUAL", "shoulder_edited": True}
        line = self.item(self.place([self.shirt_30], line_fits={self.shirt_30: typed}), self.shirt_30)
        self.assertEqual((line.fit_shoulder_cm, line.fit_shoulder_confidence), (Decimal("31.0"), None))
        self.assertEqual((line.fit_source, line.fit_shoulder_edited), ("MANUAL", False))

    def test_order_saves_the_measurement_on_the_child_once(self):
        fit = {"height_cm": 135, "weight_kg": 30, "source": "MANUAL"}
        self.place([self.shirt_30], line_fits={self.shirt_30: fit})
        self.place([self.shirt_32], line_fits={self.shirt_32: fit})  # same numbers: not saved again
        rows = StudentMeasurement.objects.filter(student=self.student)
        self.assertEqual(rows.count(), 1)
        self.assertEqual((rows.get().measured_by, rows.get().height_cm), (self.parent, Decimal("135.0")))
        self.place([self.shirt_30], line_fits={self.shirt_30: {**fit, "height_cm": 137}})
        self.assertEqual(rows.count(), 2)

    def test_bad_line_fit_is_refused(self):
        data = self.place([self.shirt_30], line_fits={self.shirt_30: {"height_cm": 300, "weight_kg": 30}}, expect=400)
        self.assertEqual(data["items"]["height_cm"], ["OUT_OF_RANGE"])

    def test_reimporting_the_chart_never_changes_order_history(self):
        order = self.place([self.shirt_30], fit={"height_cm": 135, "weight_kg": 30})
        SizeChartRow.objects.filter(variant__product=self.shirt_30.product).delete()
        SizeChartRow.objects.create(variant=self.shirt_30, height_cm_min=100, height_cm_max=110)
        line = self.item(order, self.shirt_30)
        self.assertEqual((line.recommended_size, line.recommendation_status), (self.shirt_30.size, "FIT"))


@override_settings(CACHES=LOCMEM)
class ExchangeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        parent = User.objects.get(username="parent_rahul")
        student = Student.objects.get(gr_number="DPS-2026-001")
        cls.shirt_30 = ProductVariant.objects.get(sku="DPS-SHIRT-30")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(parent)['access']}")
        res = client.post(
            "/api/orders/",
            {
                "idempotency_key": str(uuid.uuid4()),
                "student": str(student.id),
                "fulfillment_type": "SCHOOL_PICKUP",
                "payment_method": "COD",
                "items": [{"variant": str(cls.shirt_30.id), "quantity": 1}],
            },
            format="json",
        )
        cls.line = OrderItem.objects.get(order_id=res.json()["id"])

    def exchange(self, to_size, reason=OrderItemExchange.Reason.TOO_SMALL, from_size=""):
        exchange = OrderItemExchange(order_item=self.line, from_size=from_size, to_size=to_size, reason=reason)
        exchange.full_clean()
        exchange.save()
        return exchange

    def test_from_size_defaults_to_the_current_size(self):
        first = self.exchange("32 (Class 7-9)")
        self.assertEqual(first.from_size, "30 (Class 4-6)")
        second = self.exchange("34 (Class 10-12)")
        self.assertEqual(second.from_size, "32 (Class 7-9)")
        self.assertEqual(self.line.current_size, "34 (Class 10-12)")

    def test_to_size_must_be_a_size_of_the_product(self):
        with self.assertRaises(ValidationError) as ctx:
            self.exchange("XXL")
        self.assertIn("to_size", ctx.exception.message_dict)

    def test_size_exchange_must_change_the_size(self):
        with self.assertRaises(ValidationError):
            self.exchange("30 (Class 4-6)", OrderItemExchange.Reason.TOO_BIG)
        # A swap for a fault keeps the same size.
        self.exchange("30 (Class 4-6)", OrderItemExchange.Reason.NOT_SIZE)

    def test_exchanges_survive_a_chart_change(self):
        self.exchange("32 (Class 7-9)")
        SizeChartRow.objects.create(variant=self.shirt_30, height_cm_min=100, height_cm_max=110)
        SizeChartRow.objects.all().delete()
        self.assertEqual(self.line.exchanges.get().to_size, "32 (Class 7-9)")
