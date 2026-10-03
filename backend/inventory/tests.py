from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import ProductVariant
from orders.models import Order
from schools.models import City, Student

from .models import StockBalance, StockMovement


class CityStockTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.surat = City.objects.get(code="SUR")
        cls.ahmedabad = City.objects.get(code="AMD")
        cls.student = Student.objects.get(gr_number="DPS-2026-001")
        cls.teacher = User.objects.get(username="teacher_dps")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.admin_surat = User.objects.get(username="admin_surat")
        cls.variant = ProductVariant.objects.get(sku="SHOE-BLK-UK2")

    def jwt_client(self, user):
        client = APIClient()
        token = build_tokens_for_user(user)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    def test_a_variant_has_independent_city_balances(self):
        surat_balance = StockBalance.objects.get(city=self.surat, variant=self.variant)
        ahmedabad_balance = StockBalance.objects.get(city=self.ahmedabad, variant=self.variant)
        self.assertEqual(surat_balance.stock_quantity, 400)
        self.assertEqual(ahmedabad_balance.stock_quantity, 400)
        self.assertNotEqual(surat_balance.pk, ahmedabad_balance.pk)

    def test_city_admin_only_sees_their_stock_balances(self):
        response = self.jwt_client(self.admin_surat).get("/api/stock-balances/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["results"])
        self.assertEqual(
            {row["city"] for row in response.data["results"]},
            {str(self.surat.pk)},
        )

    def test_teacher_order_debits_school_city_and_records_payer_and_placer(self):
        surat_balance = StockBalance.objects.get(city=self.surat, variant=self.variant)
        ahmedabad_balance = StockBalance.objects.get(city=self.ahmedabad, variant=self.variant)
        before_surat = surat_balance.stock_quantity
        before_ahmedabad = ahmedabad_balance.stock_quantity

        response = self.jwt_client(self.teacher).post(
            "/api/orders/",
            {
                "idempotency_key": "teacher-city-stock-test-001",
                "student": str(self.student.pk),
                "fulfillment_type": Order.FulfillmentType.SCHOOL_PICKUP,
                "items": [{"variant": str(self.variant.pk), "quantity": 2}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["placed_by_role"], User.Role.TEACHER)
        self.assertEqual(response.data["payer"], str(self.teacher.pk))
        self.assertEqual(response.data["parent"], str(self.parent.pk))
        self.assertEqual(response.data["fulfillment_type"], Order.FulfillmentType.SCHOOL_PICKUP)

        surat_balance.refresh_from_db()
        ahmedabad_balance.refresh_from_db()
        self.assertEqual(surat_balance.stock_quantity, before_surat - 2)
        self.assertEqual(ahmedabad_balance.stock_quantity, before_ahmedabad)
        self.assertTrue(
            StockMovement.objects.filter(
                reference_order_id=response.data["id"],
                city=self.surat,
                quantity_change=-2,
                reason=StockMovement.Reason.ORDER_PLACED,
            ).exists()
        )

    def test_school_fulfillment_setting_is_enforced_at_checkout(self):
        school = self.student.school
        school.home_delivery_enabled = False
        school.school_pickup_enabled = True
        school.save(update_fields=["home_delivery_enabled", "school_pickup_enabled"])

        response = self.jwt_client(self.parent).post(
            "/api/orders/",
            {
                "idempotency_key": "delivery-disabled-test-001",
                "student": str(self.student.pk),
                "fulfillment_type": Order.FulfillmentType.HOME_DELIVERY,
                "items": [{"variant": str(self.variant.pk), "quantity": 1}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fulfillment_type", response.data)
