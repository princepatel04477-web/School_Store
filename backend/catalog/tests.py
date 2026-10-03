from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from inventory.services import apply_stock_movement
from schools.models import City, School, Student

from .models import Category, Product, ProductVariant


LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
class PublicCatalogTests(TestCase):
    def setUp(self):
        cat = Category.objects.create(name="Uniforms", slug="uniforms")
        shown = Product.objects.create(
            category=cat, name="White shirt", cost_price=Decimal("300"), selling_price=Decimal("650")
        )
        ProductVariant.objects.create(product=shown, size="30", sku="SHIRT-30")
        ProductVariant.objects.create(product=shown, size="32", sku="SHIRT-32", active=False)
        Product.objects.create(
            category=cat, name="Retired tie", cost_price=Decimal("1"), selling_price=Decimal("2"), active=False
        )

    def test_anonymous_can_browse_without_sensitive_fields(self):
        res = APIClient().get("/api/public/products/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([p["name"] for p in res.json()["results"]], ["White shirt"])
        product = res.json()["results"][0]
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


@override_settings(CACHES=LOCMEM)
class StudentCatalogueTests(TestCase):
    """The ordering read path: /api/catalog/students/<id>/products/."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.parent = User.objects.get(username="parent_rahul")
        cls.other_parent = User.objects.get(username="parent_priya")
        cls.dps = School.objects.get(code="DPS-SUR")
        cls.surat = City.objects.get(code="SUR")
        # Aarav: DPS Surat, class 5, MALE, child of parent_rahul
        cls.boy = Student.objects.get(gr_number="DPS-2026-001")
        # A DPS girl in class 4 so the class 1-5 girls pinafore applies.
        cls.girl = Student.objects.create(
            name="Riya Patel",
            gr_number="DPS-2026-099",
            class_name="4",
            section="A",
            gender=Student.Gender.FEMALE,
            school=cls.dps,
            parent=cls.parent,
        )

    def setUp(self):
        cache.clear()

    def jwt_client(self, user):
        client = APIClient()
        client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}"
        )
        return client

    def catalogue_url(self, student):
        return f"/api/catalog/students/{student.pk}/products/"

    def names_for(self, student, query=""):
        res = self.jwt_client(self.parent).get(self.catalogue_url(student) + query)
        self.assertEqual(res.status_code, 200)
        return res.json(), {p["name"] for p in res.json()["products"]}

    def test_catalogue_targets_school_class_and_gender_plus_shared(self):
        _, boy_names = self.names_for(self.boy)
        # His school's unisex uniform and every shared product
        self.assertIn("DPS Everyday Formal Half-Sleeve Shirt", boy_names)
        self.assertIn("All-Weather Black Velcro School Shoes", boy_names)
        self.assertIn("Personalised Photo Notebook Pack (Set of 6)", boy_names)
        self.assertIn("Smart RFID PVC Student ID Card with Lanyard", boy_names)
        # Girls-only uniform and other schools' uniforms are hidden
        self.assertNotIn("DPS Girls Pleated Pinafore (Class 1-5)", boy_names)
        self.assertNotIn("Fountainhead Signature Polo Tee", boy_names)
        self.assertNotIn("Udgam Ceremonial Winter Blazer", boy_names)

        _, girl_names = self.names_for(self.girl)
        self.assertIn("DPS Girls Pleated Pinafore (Class 1-5)", girl_names)

    def test_category_filter(self):
        _, names = self.names_for(self.boy, "?category=shoes")
        self.assertEqual(names, {"All-Weather Black Velcro School Shoes"})

    def test_card_carries_only_what_the_card_shows(self):
        body, _ = self.names_for(self.boy)
        card = body["products"][0]
        self.assertEqual(
            set(card.keys()),
            {
                "id",
                "name",
                "category",
                "category_slug",
                "price",
                "thumbnail",
                "sizes",
                "stock_status",
            },
        )
        self.assertNotIn("description", card)
        self.assertNotIn("cost_price", card)
        self.assertEqual(
            set(card["sizes"][0].keys()), {"variant_id", "size", "stock_status"}
        )
        # Thumbnail is a CDN resize URL, not a Django-served file.
        self.assertTrue(card["thumbnail"].startswith("https://"))
        self.assertIn("width=", card["thumbnail"])

    def test_detail_returns_full_description_and_images(self):
        shirt = Product.objects.get(name="DPS Everyday Formal Half-Sleeve Shirt")
        res = self.jwt_client(self.parent).get(
            f"{self.catalogue_url(self.boy)}{shirt.pk}/"
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["description"])
        self.assertTrue(body["images"])
        self.assertNotIn("cost_price", body)
        self.assertEqual(
            set(body["sizes"][0].keys()), {"variant_id", "size", "sku", "stock_status"}
        )

    def test_detail_hides_products_not_valid_for_the_student(self):
        pinafore = Product.objects.get(name="DPS Girls Pleated Pinafore (Class 1-5)")
        res = self.jwt_client(self.parent).get(
            f"{self.catalogue_url(self.boy)}{pinafore.pk}/"
        )
        self.assertEqual(res.status_code, 404)

    def test_stock_flags_are_fresh_even_when_catalogue_is_cached(self):
        variant = ProductVariant.objects.get(sku="SHOE-BLK-UK2")

        body, _ = self.names_for(self.boy)
        shoes = next(p for p in body["products"] if "Shoes" == p["category"])
        size = next(s for s in shoes["sizes"] if s["variant_id"] == str(variant.pk))
        self.assertEqual(size["stock_status"], "IN_STOCK")

        # Rename via queryset.update() to bypass save() (and therefore cache
        # invalidation), then sell almost all stock: the next response must
        # come from the cached catalogue (old name) yet show the new flag.
        Product.objects.filter(pk=shoes["id"]).update(name="RENAMED DIRECTLY")
        apply_stock_movement(
            variant=variant,
            city_id=self.surat.pk,
            quantity_change=-395,  # 400 seeded, threshold 20 -> now 5 = LOW
            reason="ADJUSTMENT",
        )

        body, names = self.names_for(self.boy)
        self.assertIn(shoes["name"], names)  # cached name still served
        self.assertNotIn("RENAMED DIRECTLY", names)
        shoes_again = next(p for p in body["products"] if p["id"] == shoes["id"])
        size = next(s for s in shoes_again["sizes"] if s["variant_id"] == str(variant.pk))
        self.assertEqual(size["stock_status"], "LOW_STOCK")

    def test_price_change_explicitly_invalidates_the_cache(self):
        body, _ = self.names_for(self.boy)
        shirt = Product.objects.get(name="DPS Everyday Formal Half-Sleeve Shirt")

        shirt.selling_price = Decimal("475.00")
        shirt.save()  # bumps the catalogue cache version

        body, _ = self.names_for(self.boy)
        card = next(p for p in body["products"] if p["id"] == str(shirt.pk))
        self.assertEqual(card["price"], "475.00")

    def test_fixed_query_count_regardless_of_product_count(self):
        client = self.jwt_client(self.parent)
        url = self.catalogue_url(self.boy)

        cache.clear()
        with CaptureQueriesContext(connection) as before:
            self.assertEqual(client.get(url).status_code, 200)

        category = Category.objects.get(slug="stationery")
        for i in range(8):
            product = Product.objects.create(
                category=category,
                name=f"Bulk product {i}",
                cost_price=Decimal("10.00"),
                selling_price=Decimal("20.00"),
            )
            for size in ("A", "B", "C"):
                ProductVariant.objects.create(
                    product=product, size=size, sku=f"BULK-{i}-{size}"
                )

        cache.clear()
        with CaptureQueriesContext(connection) as after:
            self.assertEqual(client.get(url).status_code, 200)

        self.assertEqual(len(before.captured_queries), len(after.captured_queries))

    def test_parent_cannot_shop_for_someone_elses_child(self):
        res = self.jwt_client(self.other_parent).get(self.catalogue_url(self.boy))
        self.assertEqual(res.status_code, 403)
