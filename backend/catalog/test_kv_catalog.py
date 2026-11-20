from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase, override_settings

from schools.models import Grade, School

from .kv_catalog import KV_ITEMS, MOJIBAKE_DASH, apply_kv_catalog
from .models import Category, Product, ProductVariant

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


def run():
    return apply_kv_catalog(School, Grade, Category, Product, ProductVariant)


@override_settings(CACHES=LOCMEM)
class KvCatalogTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.kv = School.objects.create(name="Kendriya Vidyalaya", code="CHAIN-KV", active=True)

    def test_adds_every_item_once(self):
        self.assertEqual(run(), len(KV_ITEMS))
        self.assertEqual(run(), 0)
        self.assertEqual(Product.objects.filter(school=self.kv).count(), len(KV_ITEMS))
        expected_variants = sum(len(spec["variants"]) for spec in KV_ITEMS)
        self.assertEqual(ProductVariant.objects.filter(product__school=self.kv).count(), expected_variants)

    def test_four_house_tshirts_in_two_class_bands(self):
        run()
        tees = Product.objects.filter(school=self.kv, name__contains="House PT T-Shirt")
        self.assertEqual(tees.count(), 8)
        junior = Product.objects.get(school=self.kv, name="KV Red House PT T-Shirt (Class 1-5)")
        senior = Product.objects.get(school=self.kv, name="KV Red House PT T-Shirt (Class 6-12)")
        self.assertEqual(
            sorted(g.name for g in junior.grades.all()),
            sorted(f"Class {n}" for n in range(1, 6)),
        )
        self.assertEqual(senior.grades.count(), 7)
        self.assertEqual(junior.gender, "unisex")
        self.assertIn("20", junior.variants.values_list("size", flat=True))
        self.assertIn("44", senior.variants.values_list("size", flat=True))
        self.assertTrue(junior.images[0].endswith("kv-house-tshirt-red.webp"))

    def test_coatie_and_jackets_present(self):
        run()
        names = set(Product.objects.filter(school=self.kv).values_list("name", flat=True))
        for name in (
            "KV Grey Sleeveless Coatie (Class 1-5)",
            "KV Grey Sleeveless Coatie (Class 6-12)",
            "KV Grey Hooded Jacket, Half Sleeve (Class 6-12)",
            "KV Grey Hooded Jacket, Full Sleeve (Class 1-5)",
            "KV Navy PT Track Pants (Class 6-12)",
        ):
            self.assertIn(name, names)

    def test_repairs_garbled_dash_in_existing_names(self):
        uniform = Category.objects.get(slug="uniform")
        old = Product.objects.create(
            name=f"KV Boys Grey Shorts (Class 1{MOJIBAKE_DASH}5)",
            description=f"Girls wear it in classes 1{MOJIBAKE_DASH}8.",
            school=self.kv, category=uniform, gender="boy",
            cost_price=Decimal("5"), selling_price=Decimal("10"),
        )
        run()
        old.refresh_from_db()
        self.assertEqual(old.name, "KV Boys Grey Shorts (Class 1-5)")
        self.assertEqual(old.description, "Girls wear it in classes 1-8.")

    def test_no_kv_school_is_a_no_op(self):
        self.kv.delete()
        self.assertEqual(run(), 0)
