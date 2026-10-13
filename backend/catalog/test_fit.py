from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from catalog.models import FitReading, Product, SizeChartRow

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
class FitReadingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.product = Product.objects.filter(active=True, gender="boy").first()
        SizeChartRow.objects.create(
            product=cls.product,
            size_label="30",
            height_cm_min=Decimal("120.0"),
            height_cm_max=Decimal("135.0"),
            weight_kg_min=Decimal("20.0"),
            weight_kg_max=Decimal("30.0"),
            shoulder_cm_min=Decimal("28.0"),
            shoulder_cm_max=Decimal("32.0"),
        )

    def setUp(self):
        cache.clear()

    def test_public_products_include_size_chart(self):
        school = self.product.school
        grade = self.product.grades.first()
        self.assertIsNotNone(school)
        self.assertIsNotNone(grade)
        response = APIClient().get(
            "/api/public/products/",
            {"school": str(school.id), "class": str(grade.id), "gender": "boy"},
        )
        self.assertEqual(response.status_code, 200)
        match = next(item for item in response.json()["results"] if item["id"] == str(self.product.id))
        self.assertEqual(match["size_chart"][0]["size"], "30")
        self.assertEqual(match["size_chart"][0]["height_cm_min"], 120.0)

    def test_reading_stores_only_the_two_numbers(self):
        client = APIClient()
        created = client.post(
            "/api/catalog/fit-reading/",
            {"shoulder_cm": 32.4, "confidence": 0.82},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        reading = FitReading.objects.get()
        self.assertEqual(reading.shoulder_cm, Decimal("32.4"))
        self.assertEqual(reading.confidence, Decimal("0.820"))
        self.assertIsNone(reading.user_id)

        rejected = client.post(
            "/api/catalog/fit-reading/",
            {"shoulder_cm": 32.4, "confidence": 0.82, "photo": "data:image/jpeg;base64,AAAA"},
            format="json",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(FitReading.objects.count(), 1)
