"""Size chart view, edit and copy for the Boss, Admin and School Admin panels (Prompt 20)."""

from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from schools.models import City, School

from .models import Category, Product, ProductVariant, SizeChartRow

URL = "/api/size-charts/"


def login(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {build_tokens_for_user(user)['access']}")
    return client


class SizeChartManageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.surat = City.objects.create(name="Surat", code="SUR")
        cls.ahmedabad = City.objects.create(name="Ahmedabad", code="AMD")
        cls.school = School.objects.create(city=cls.surat, name="Alpha School", code="ALPHA")
        cls.far_school = School.objects.create(city=cls.ahmedabad, name="Beta School", code="BETA")
        uniform = Category.objects.create(name="Uniform", slug="uniform")

        def product(name, school, sizes, prefix):
            item = Product.objects.create(
                category=uniform, school=school, name=name, cost_price=100, selling_price=200
            )
            for size in sizes:
                ProductVariant.objects.create(product=item, size=size, sku=f"{prefix}-{size}")
            return item

        cls.shirt = product("Half Shirt", cls.school, ["26", "28", "30"], "A-HS")
        cls.full_shirt = product("Full Shirt", cls.school, ["26 (Class 1-2)", "28", "30 ", "32"], "A-FS")
        cls.belt = product("Belt", cls.school, ["One size"], "A-BELT")
        cls.far_shirt = product("Beta Shirt", cls.far_school, ["26", "28"], "B-HS")
        cls.shared = product("Socks", None, ["S", "M"], "SOCK")

        for i, variant in enumerate(cls.shirt.variants.order_by("size")):
            SizeChartRow.objects.create(
                variant=variant,
                height_cm_min=110 + i * 10,
                height_cm_max=119 + i * 10,
                shoulder_cm_min=Decimal("26") + i * 2,
                shoulder_cm_max=Decimal("27.9") + i * 2,
            )

        def user(username, role, **extra):
            return User.objects.create_user(username=f"c_{username}", password="x", role=role, **extra)

        cls.boss = user("boss", User.Role.BOSS)
        cls.admin = user("admin", User.Role.ADMIN, city=cls.surat)
        cls.school_admin = user("sa", User.Role.SCHOOL_ADMIN, school=cls.school, city=cls.surat)
        cls.far_school_admin = user("sa_far", User.Role.SCHOOL_ADMIN, school=cls.far_school, city=cls.ahmedabad)
        cls.teacher = user("teacher", User.Role.TEACHER, school=cls.school, city=cls.surat)

    def test_list_shows_sized_items_with_a_row_per_size(self):
        res = login(self.admin).get(URL, {"school": str(self.school.id)})
        self.assertEqual(res.status_code, 200, res.data)
        names = [p["product_name"] for p in res.data["results"]]
        self.assertEqual(names, ["Full Shirt", "Half Shirt"])  # the one-size belt is left out
        half = res.data["results"][1]
        self.assertTrue(half["has_chart"])
        self.assertEqual([r["size"] for r in half["rows"]], ["26", "28", "30"])
        self.assertEqual(half["rows"][0]["height_cm_min"], 110.0)
        self.assertFalse(res.data["results"][0]["has_chart"])

    def test_scope_by_role(self):
        school = {"school": str(self.school.id)}
        self.assertEqual(login(self.school_admin).get(URL).status_code, 200)
        self.assertEqual(login(self.far_school_admin).get(URL, school).status_code, 403)
        self.assertEqual(login(self.admin).get(URL, {"school": str(self.far_school.id)}).status_code, 403)
        self.assertEqual(login(self.admin).get(URL, {"school": "generic"}).status_code, 403)
        self.assertEqual(login(self.admin).get(URL).status_code, 400)
        self.assertEqual(login(self.teacher).get(URL, school).status_code, 403)
        shared = login(self.boss).get(URL, {"school": "generic"})
        self.assertEqual([p["product_name"] for p in shared.data["results"]], ["Socks"])

    def test_city_admin_can_use_the_import_too(self):
        res = login(self.admin).get("/api/size-chart-imports/template/", {"school": str(self.school.id)})
        self.assertEqual(res.status_code, 200)
        far = login(self.admin).get("/api/size-chart-imports/template/", {"school": str(self.far_school.id)})
        self.assertEqual(far.status_code, 403)

    def test_add_edit_and_remove_one_row(self):
        variant = self.full_shirt.variants.get(size="26 (Class 1-2)")
        client = login(self.school_admin)
        created = client.post(f"{URL}rows/", {"variant": str(variant.id), "height_cm_min": 110, "height_cm_max": 119}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        again = client.post(f"{URL}rows/", {"variant": str(variant.id), "height_cm_min": 110, "height_cm_max": 119}, format="json")
        self.assertEqual(again.status_code, 400)

        row_url = f"{URL}rows/{created.data['id']}/"
        edited = client.patch(row_url, {"weight_kg_min": 18, "weight_kg_max": 24}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["weight_kg_max"], 24.0)
        self.assertEqual(edited.data["height_cm_min"], 110.0)

        bad = client.patch(row_url, {"height_cm_min": 130}, format="json")  # above the max
        self.assertEqual(bad.status_code, 400)
        self.assertIn("height_cm_max", bad.data)
        missing = client.patch(row_url, {"height_cm_min": None}, format="json")
        self.assertEqual(missing.status_code, 400)

        self.assertEqual(client.delete(row_url).status_code, 204)
        self.assertFalse(SizeChartRow.objects.filter(variant=variant).exists())

    def test_cannot_touch_another_schools_rows(self):
        far_variant = self.far_shirt.variants.first()
        res = login(self.school_admin).post(
            f"{URL}rows/", {"variant": str(far_variant.id), "height_cm_min": 110, "height_cm_max": 119}, format="json"
        )
        self.assertEqual(res.status_code, 403)
        row = SizeChartRow.objects.filter(variant__product=self.shirt).first()
        self.assertEqual(login(self.far_school_admin).patch(f"{URL}rows/{row.id}/", {"height_cm_min": 111}, format="json").status_code, 403)
        self.assertEqual(login(self.boss).patch(f"{URL}rows/{row.id}/", {"height_cm_min": 111}, format="json").status_code, 200)

    def test_copy_one_chart_to_other_items(self):
        res = login(self.admin).post(
            f"{URL}copy/?school={self.school.id}",
            {"source_product": str(self.shirt.id), "target_products": [str(self.full_shirt.id)]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        report = res.data["products"][0]
        self.assertEqual(report["rows_written"], 3)
        self.assertEqual(report["sizes_not_in_source"], ["32"])
        copied = SizeChartRow.objects.get(variant__product=self.full_shirt, variant__size="28")
        self.assertEqual((copied.height_cm_min, copied.shoulder_cm_max), (Decimal("120.0"), Decimal("29.9")))

    def test_copy_stays_inside_the_school(self):
        res = login(self.admin).post(
            f"{URL}copy/?school={self.school.id}",
            {"source_product": str(self.shirt.id), "target_products": [str(self.far_shirt.id)]},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertFalse(SizeChartRow.objects.filter(variant__product=self.far_shirt).exists())

    def test_remove_a_whole_chart(self):
        res = login(self.school_admin).delete(f"{URL}{self.shirt.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["rows_removed"], 3)
        self.assertFalse(SizeChartRow.objects.filter(variant__product=self.shirt).exists())
