from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from schools.models import City, School


class PortalStockApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # Cities
        cls.city_surat = City.objects.create(name="Surat", code="SUR-STK", state="Gujarat")
        cls.city_delhi = City.objects.create(name="Delhi", code="DEL-STK", state="Delhi")

        # School (generic KV with no city attached, or city-specific)
        cls.school = School.objects.create(
            name="Delhi Public School",
            code="DPS-STK",
            city=cls.city_surat,
            active=True,
        )

        cls.category = Category.objects.create(
            name="Uniforms",
            slug="uniforms-stock",
            display_order=1,
            active=True,
        )

        cls.product = Product.objects.create(
            name="School Shirt",
            category=cls.category,
            school=cls.school,
            city=cls.city_surat,
            gender=Product.Gender.UNISEX,
            cost_price=Decimal("150.00"),
            selling_price=Decimal("300.00"),
            active=True,
        )

        cls.variant = ProductVariant.objects.create(
            product=cls.product,
            size="M",
            sku="DPS-SHIRT-M",
            active=True,
        )

        # Users
        cls.boss = User.objects.create_user(
            username="stock_boss",
            password="testpassword",
            role="BOSS",
        )
        cls.admin_surat = User.objects.create_user(
            username="stock_admin_surat",
            password="testpassword",
            role="ADMIN",
            city=cls.city_surat,
        )
        cls.admin_delhi = User.objects.create_user(
            username="stock_admin_delhi",
            password="testpassword",
            role="ADMIN",
            city=cls.city_delhi,
        )
        cls.parent = User.objects.create_user(
            username="stock_parent",
            password="testpassword",
            role="PARENT",
            school=cls.school,
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _auth(self, user):
        token = build_tokens_for_user(user)["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_stock_movement_creates_initial_balance_and_updates_quantity(self):
        self._auth(self.boss)
        # Initially no balance row
        self.assertFalse(StockBalance.objects.filter(city=self.city_surat, variant=self.variant).exists())

        # Post initial restock of 50
        payload = {
            "variant": str(self.variant.id),
            "city": str(self.city_surat.id),
            "quantity_change": 50,
            "reason": StockMovement.Reason.INITIAL_STOCK,
        }
        res = self.client.post("/api/stock-movements/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)

        # Check balance
        bal = StockBalance.objects.get(city=self.city_surat, variant=self.variant)
        self.assertEqual(bal.stock_quantity, 50)

        # Additional restock of 20
        payload2 = {
            "variant": str(self.variant.id),
            "city": str(self.city_surat.id),
            "quantity_change": 20,
            "reason": StockMovement.Reason.RESTOCK,
        }
        res2 = self.client.post("/api/stock-movements/", payload2, format="json")
        self.assertEqual(res2.status_code, 201, res2.data)

        bal.refresh_from_db()
        self.assertEqual(bal.stock_quantity, 70)

    def test_mark_out_of_stock_brings_balance_to_zero(self):
        self._auth(self.admin_surat)
        # Set up balance of 15
        StockBalance.objects.create(city=self.city_surat, variant=self.variant, stock_quantity=15)

        # Mark out of stock with negative delta matching current balance
        payload = {
            "variant": str(self.variant.id),
            "city": str(self.city_surat.id),
            "quantity_change": -15,
            "reason": StockMovement.Reason.ADJUSTMENT,
        }
        res = self.client.post("/api/stock-movements/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)

        bal = StockBalance.objects.get(city=self.city_surat, variant=self.variant)
        self.assertEqual(bal.stock_quantity, 0)

    def test_admin_cannot_touch_another_city_stock(self):
        # Admin in Surat tries to create stock movement in Delhi
        self._auth(self.admin_surat)
        payload = {
            "variant": str(self.variant.id),
            "city": str(self.city_delhi.id),
            "quantity_change": 10,
            "reason": StockMovement.Reason.RESTOCK,
        }
        res = self.client.post("/api/stock-movements/", payload, format="json")
        self.assertEqual(res.status_code, 403)

    def test_parent_cannot_access_stock_balances_or_movements(self):
        self._auth(self.parent)
        res_bal = self.client.get("/api/stock-balances/")
        self.assertEqual(res_bal.status_code, 403)

        res_mov = self.client.post("/api/stock-movements/", {
            "variant": str(self.variant.id),
            "city": str(self.city_surat.id),
            "quantity_change": 10,
            "reason": StockMovement.Reason.RESTOCK,
        }, format="json")
        self.assertEqual(res_mov.status_code, 403)
