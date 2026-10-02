from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import Category, Product, ProductVariant


LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
class PublicCatalogTests(TestCase):
    def setUp(self):
        cat = Category.objects.create(name="Uniforms", slug="uniforms")
        shown = Product.objects.create(
            category=cat, name="White shirt", cost_price=Decimal("300"), selling_price=Decimal("650")
        )
        ProductVariant.objects.create(product=shown, size="30", sku="SHIRT-30", stock_quantity=5)
        ProductVariant.objects.create(product=shown, size="32", sku="SHIRT-32", stock_quantity=2, active=False)
        Product.objects.create(
            category=cat, name="Retired tie", cost_price=Decimal("1"), selling_price=Decimal("2"), active=False
        )

    def test_anonymous_can_browse_without_sensitive_fields(self):
        res = APIClient().get("/api/public/products/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([p["name"] for p in res.json()], ["White shirt"])
        product = res.json()[0]
        self.assertEqual(product["price"], 650.0)
        self.assertEqual([v["size"] for v in product["variants"]], ["30"])
        self.assertNotIn("cost_price", product)
        self.assertNotIn("sku", product["variants"][0])

    def test_invalid_token_is_ignored(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        self.assertEqual(client.get("/api/public/products/").status_code, 200)

    def test_public_endpoint_is_read_only(self):
        self.assertEqual(APIClient().post("/api/public/products/", {}).status_code, 405)

    def test_private_catalogue_still_requires_login(self):
        self.assertEqual(APIClient().get("/api/products/").status_code, 401)
