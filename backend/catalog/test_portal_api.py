import io
import shutil
import tempfile
from decimal import Decimal
from pathlib import Path
from PIL import Image

from django.conf import settings
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import Category, Product, ProductVariant
from schools.models import City, Grade, School


def _make_image_bytes(format="JPEG", size=(400, 300), color=(120, 200, 100)):
    buf = io.BytesIO()
    img = Image.new("RGB", size, color=color)
    img.save(buf, format=format)
    return buf.getvalue()


class PortalCatalogApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.temp_media = tempfile.mkdtemp()

        # Seed cities
        cls.city_surat = City.objects.create(name="Surat", code="SUR-PORTAL", state="Gujarat")
        cls.city_pune = City.objects.create(name="Pune", code="PUN-PORTAL", state="Maharashtra")

        # Seed schools
        cls.school_surat = School.objects.create(
            name="Surat Model School",
            code="SMS-01",
            city=cls.city_surat,
            active=True,
        )
        cls.school_pune = School.objects.create(
            name="Pune Academy",
            code="PA-01",
            city=cls.city_pune,
            active=True,
        )

        # Seed category
        cls.category = Category.objects.create(
            name="Portal Uniforms",
            slug="portal-uniforms",
            display_order=1,
            active=True,
        )

        # Seed grades Class 1 to Class 5
        for i in range(1, 13):
            Grade.objects.get_or_create(name=f"Class {i}", defaults={"sort_order": i + 3})

        # Seed users
        cls.boss = User.objects.create_user(
            username="portal_boss",
            password="testpassword",
            role="BOSS",
        )
        cls.admin_surat = User.objects.create_user(
            username="portal_admin_surat",
            password="testpassword",
            role="ADMIN",
            city=cls.city_surat,
        )
        cls.admin_pune = User.objects.create_user(
            username="portal_admin_pune",
            password="testpassword",
            role="ADMIN",
            city=cls.city_pune,
        )
        cls.parent = User.objects.create_user(
            username="portal_parent",
            password="testpassword",
            role="PARENT",
            school=cls.school_surat,
        )
        cls.teacher = User.objects.create_user(
            username="portal_teacher",
            password="testpassword",
            role="TEACHER",
            school=cls.school_surat,
        )

        # Seed a test product
        cls.product_surat = Product.objects.create(
            name="Surat Blazer",
            category=cls.category,
            school=cls.school_surat,
            city=cls.city_surat,
            gender=Product.Gender.UNISEX,
            cost_price=Decimal("400.00"),
            selling_price=Decimal("650.00"),
            class_from=1,
            class_to=5,
            active=True,
        )

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp_media, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _auth(self, user):
        token = build_tokens_for_user(user)["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_photo_endpoint_rejects_anonymous(self):
        url = f"/api/products/{self.product_surat.id}/photo/"
        res = self.client.post(url, {})
        self.assertIn(res.status_code, (401, 403))

    def test_photo_endpoint_rejects_parent_and_teacher(self):
        url = f"/api/products/{self.product_surat.id}/photo/"
        fake_img = SimpleUploadedFile("pic.jpg", _make_image_bytes(), content_type="image/jpeg")

        self._auth(self.parent)
        res = self.client.post(url, {"photo": fake_img}, format="multipart")
        self.assertEqual(res.status_code, 403)

        self._auth(self.teacher)
        res = self.client.post(url, {"photo": fake_img}, format="multipart")
        self.assertEqual(res.status_code, 403)

    def test_photo_endpoint_rejects_non_image(self):
        self._auth(self.boss)
        url = f"/api/products/{self.product_surat.id}/photo/"
        bad_file = SimpleUploadedFile("doc.txt", b"this is not an image", content_type="text/plain")
        res = self.client.post(url, {"photo": bad_file}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("photo", res.json())

    def test_photo_endpoint_rejects_file_over_8mb(self):
        self._auth(self.boss)
        url = f"/api/products/{self.product_surat.id}/photo/"
        big_file = SimpleUploadedFile("big.jpg", b"0" * (8 * 1024 * 1024 + 10), content_type="image/jpeg")
        res = self.client.post(url, {"photo": big_file}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("8 MB", str(res.json()))

    def test_photo_endpoint_stores_square_900_webp_and_puts_url_first(self):
        with override_settings(MEDIA_ROOT=self.temp_media):
            self._auth(self.boss)
            url = f"/api/products/{self.product_surat.id}/photo/"
            img_bytes = _make_image_bytes(format="PNG", size=(1200, 800), color=(50, 100, 150))
            upload = SimpleUploadedFile("sample.png", img_bytes, content_type="image/png")

            res = self.client.post(url, {"photo": upload}, format="multipart")
            self.assertEqual(res.status_code, 200, res.data)

            self.product_surat.refresh_from_db()
            self.assertGreater(len(self.product_surat.images), 0)
            first_url = self.product_surat.images[0]
            self.assertTrue(first_url.startswith(
                f"https://school-store.aqualite.workers.dev/media/products/{self.product_surat.id}/"
            ))
            self.assertTrue(first_url.endswith(".webp"))

            # Verify saved file on disk
            filename = first_url.split("/")[-1]
            saved_path = Path(self.temp_media) / "products" / str(self.product_surat.id) / filename
            self.assertTrue(saved_path.exists())

            with Image.open(saved_path) as saved_img:
                self.assertEqual(saved_img.format, "WEBP")
                self.assertEqual(saved_img.size, (900, 900))

    def test_admin_cannot_upload_photo_for_other_city_product(self):
        # Product in Pune, but admin is Surat
        pune_product = Product.objects.create(
            name="Pune Skirt",
            category=self.category,
            school=self.school_pune,
            city=self.city_pune,
            gender=Product.Gender.GIRL,
            cost_price=Decimal("200.00"),
            selling_price=Decimal("350.00"),
            active=True,
        )
        self._auth(self.admin_surat)
        url = f"/api/products/{pune_product.id}/photo/"
        upload = SimpleUploadedFile("sample.jpg", _make_image_bytes(), content_type="image/jpeg")
        res = self.client.post(url, {"photo": upload}, format="multipart")
        self.assertIn(res.status_code, (403, 404))

    def test_product_create_and_update_with_class_range_fills_grades(self):
        self._auth(self.boss)
        payload = {
            "name": "Portal Track Pants",
            "category": str(self.category.id),
            "school": str(self.school_surat.id),
            "gender": "unisex",
            "cost_price": "250.00",
            "selling_price": "450.00",
            "class_from": 1,
            "class_to": 3,
            "product_type": "SOCKS",
            "active": True,
        }
        res = self.client.post("/api/products/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        prod_id = res.data["id"]

        prod = Product.objects.get(id=prod_id)
        self.assertEqual(prod.product_type, "SOCKS")
        grade_names = set(prod.grades.values_list("name", flat=True))
        self.assertEqual(grade_names, {"Class 1", "Class 2", "Class 3"})

        # Update class range to 1..4
        patch_res = self.client.patch(f"/api/products/{prod_id}/", {"class_to": 4}, format="json")
        self.assertEqual(patch_res.status_code, 200, patch_res.data)
        prod.refresh_from_db()
        grade_names_updated = set(prod.grades.values_list("name", flat=True))
        self.assertEqual(grade_names_updated, {"Class 1", "Class 2", "Class 3", "Class 4"})

    def test_product_create_refused_for_parent_and_teacher(self):
        payload = {
            "name": "Unauthorized Item",
            "category": str(self.category.id),
            "school": str(self.school_surat.id),
            "gender": "unisex",
            "selling_price": "100.00",
            "active": True,
        }
        self._auth(self.parent)
        res = self.client.post("/api/products/", payload, format="json")
        self.assertEqual(res.status_code, 403)

        self._auth(self.teacher)
        res = self.client.post("/api/products/", payload, format="json")
        self.assertEqual(res.status_code, 403)

    def test_variant_create_and_update_for_boss_and_admin(self):
        self._auth(self.boss)
        var_payload = {
            "product": str(self.product_surat.id),
            "size": "32",
            "sku": "SMS-01-BLAZER-32",
            "active": True,
        }
        res = self.client.post("/api/variants/", var_payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        var_id = res.data["id"]

        # Admin in Surat can update variant
        self._auth(self.admin_surat)
        patch_res = self.client.patch(f"/api/variants/{var_id}/", {"active": False}, format="json")
        self.assertEqual(patch_res.status_code, 200, patch_res.data)
        var = ProductVariant.objects.get(id=var_id)
        self.assertFalse(var.active)

    def test_product_delete_soft_deletes_item_and_variants(self):
        self._auth(self.boss)
        self.assertTrue(self.product_surat.active)
        res = self.client.delete(f"/api/products/{self.product_surat.id}/")
        self.assertEqual(res.status_code, 204)
        self.product_surat.refresh_from_db()
        self.assertFalse(self.product_surat.active)

    def test_product_delete_refused_for_parent_and_cross_city_admin(self):
        self._auth(self.parent)
        res = self.client.delete(f"/api/products/{self.product_surat.id}/")
        self.assertEqual(res.status_code, 403)

        self._auth(self.admin_pune)
        res = self.client.delete(f"/api/products/{self.product_surat.id}/")
        self.assertIn(res.status_code, (403, 404))

    def test_city_price_override_crud_and_public_reflection(self):
        # 1. Base price is 650.00
        self.assertEqual(float(self.product_surat.selling_price), 650.0)

        # 2. Parent cannot create city price
        self._auth(self.parent)
        res = self.client.post(
            "/api/city-prices/",
            {
                "product": str(self.product_surat.id),
                "city": str(self.city_surat.id),
                "selling_price": "700.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

        # 3. Boss sets custom price for Surat (₹700.00, ₹50 higher)
        self._auth(self.boss)
        res = self.client.post(
            "/api/city-prices/",
            {
                "product": str(self.product_surat.id),
                "city": str(self.city_surat.id),
                "selling_price": "700.00",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        cp_id = res.data["id"]
        self.assertEqual(res.data["selling_price"], "700.00")

        # 4. Upsert check: posting again updates the price
        res_update = self.client.post(
            "/api/city-prices/",
            {
                "product": str(self.product_surat.id),
                "city": str(self.city_surat.id),
                "selling_price": "710.00",
            },
            format="json",
        )
        self.assertEqual(res_update.status_code, 201)
        self.assertEqual(res_update.data["selling_price"], "710.00")

        # 5. Public endpoint reflects city price when Surat is passed
        pub_res = self.client.get(
            f"/api/public/products/?school={self.school_surat.id}&class=1&gender=boy&city={self.city_surat.id}"
        )
        self.assertEqual(pub_res.status_code, 200)
        found = next((p for p in pub_res.data["results"] if p["id"] == str(self.product_surat.id)), None)
        if found:
            self.assertEqual(found["price"], 710.0)

        # 6. Delete city override reverts to base price
        del_res = self.client.delete(f"/api/city-prices/{cp_id}/")
        self.assertEqual(del_res.status_code, 204)

        pub_res2 = self.client.get(
            f"/api/public/products/?school={self.school_surat.id}&class=1&gender=boy&city={self.city_surat.id}"
        )
        self.assertEqual(pub_res2.status_code, 200)
        found2 = next((p for p in pub_res2.data["results"] if p["id"] == str(self.product_surat.id)), None)
        if found2:
            self.assertEqual(found2["price"], 650.0)
