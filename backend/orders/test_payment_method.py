import uuid
from datetime import timedelta

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import ProductVariant
from inventory.models import StockBalance
from schools.models import Student

from .models import Order
from .tasks import release_expired_reservation

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
class PaymentMethodTests(TestCase):
    """Cash-on-delivery orders are paid at the door, so the unpaid-order timer must skip them."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.student = Student.objects.get(gr_number="DPS-2026-001")  # Aarav, DPS Surat, class 5, boy
        cls.variant = ProductVariant.objects.filter(
            product__category__slug="school-shoes", active=True
        ).first()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        token = build_tokens_for_user(self.parent)["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def _place(self, **extra):
        payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(self.student.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "items": [{"variant": str(self.variant.id), "quantity": 1}],
            **extra,
        }
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        return res.json()

    def _stock(self, order):
        return StockBalance.objects.get(city_id=order.city_id, variant=self.variant).stock_quantity

    def _age(self, order):
        Order.objects.filter(pk=order.pk).update(created_at=timezone.now() - timedelta(minutes=16))

    def test_cash_on_delivery_order_survives_the_unpaid_timer(self):
        data = self._place(payment_method="COD")
        self.assertEqual(data["payment_method"], "COD")
        order = Order.objects.get(pk=data["id"])
        stock_before = self._stock(order)
        self._age(order)

        self.assertFalse(release_expired_reservation(str(order.pk)))

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PLACED)
        self.assertEqual(self._stock(order), stock_before)

    def test_unpaid_online_order_still_expires(self):
        data = self._place()
        self.assertEqual(data["payment_method"], "ONLINE")
        order = Order.objects.get(pk=data["id"])
        stock_before = self._stock(order)
        self._age(order)

        self.assertTrue(release_expired_reservation(str(order.pk)))

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)
        self.assertEqual(self._stock(order), stock_before + 1)

    def test_unknown_payment_method_is_rejected(self):
        res = self.client.post(
            "/api/orders/",
            {
                "idempotency_key": str(uuid.uuid4()),
                "student": str(self.student.id),
                "payment_method": "BARTER",
                "items": [{"variant": str(self.variant.id), "quantity": 1}],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("payment_method", res.json())
