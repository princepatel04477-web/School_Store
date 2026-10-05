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
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.dps = School.objects.get(code="DPS-SUR")
        cls.surat = City.objects.get(code="SUR")
        cls.grade5 = cls.dps.students.filter(class_name="5").first().grade
        if not cls.grade5:
            from schools.models import Grade
            cls.grade5 = Grade.objects.get(sort_order=4)

    def setUp(self):
        cache.clear()

    def test_anonymous_without_params_is_rejected_with_400(self):
        res = APIClient().get("/api/public/products/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("School, city, and grade parameters are all required", str(res.json()))

    def test_public_step_schools_sorted_a_to_z(self):
        res = APIClient().get("/api/public/schools/")
        self.assertEqual(res.status_code, 200)
        schools = res.json()
        self.assertGreater(len(schools), 0)
        names = [s["name"] for s in schools]
        self.assertEqual(names, sorted(names))

    def test_public_step_school_cities(self):
        res = APIClient().get(f"/api/public/schools/{self.dps.id}/cities/")
        self.assertEqual(res.status_code, 200)
        cities = res.json()
        self.assertTrue(any(c["id"] == str(self.surat.id) for c in cities))

    def test_public_step_grades_ordered(self):
        res = APIClient().get("/api/public/grades/")
        self.assertEqual(res.status_code, 200)
        grades = res.json()
        self.assertEqual(len(grades), 15)
        self.assertEqual(grades[0]["name"], "Nursery")
        self.assertEqual(grades[1]["name"], "Junior KG")

    def test_public_products_with_school_city_grade_and_gender_filter(self):
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&category=Uniform"
        res = APIClient().get(url)
        self.assertEqual(res.status_code, 200)
        products = res.json()["results"]
        self.assertGreater(len(products), 0)

        # Test male filter
        res_male = APIClient().get(url + "&gender=MALE")
        self.assertEqual(res_male.status_code, 200)
        male_prods = res_male.json()["results"]
        for p in male_prods:
            self.assertIn(p["gender"], ("MALE", "BOTH"))

        # Test female filter
        res_female = APIClient().get(url + "&gender=FEMALE")
        self.assertEqual(res_female.status_code, 200)
        female_prods = res_female.json()["results"]
        for p in female_prods:
            self.assertIn(p["gender"], ("FEMALE", "BOTH"))

    def test_invalid_token_is_ignored(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}"
        self.assertEqual(client.get(url).status_code, 200)

    def test_public_endpoint_is_read_only(self):
        self.assertEqual(APIClient().post("/api/public/products/", {}).status_code, 405)


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
