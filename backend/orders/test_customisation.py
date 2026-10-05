"""
End-to-end tests for generic personalised product customisation:
- Schema validation with list format (text, select, image)
- Direct object storage pre-signed upload URL generation
- Preventing large payloads / base64 in customisation_data
- Background image processing task (Pillow validation, print-ready 300 DPI, thumbnail)
- Signed expiring URLs for private access
- Proof with Photo Notebook and Student ID Card purely configured via data
"""

import io
from decimal import Decimal
from PIL import Image

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from orders.image_tasks import process_customisation_image
from orders.models import Order, OrderItem
from orders.serializers import OrderCreateSerializer
from orders.storage import (
    generate_presigned_download,
    generate_presigned_upload,
    get_object_bytes,
    put_object_bytes,
)
from schools.models import City, School, Student


class CustomisationEndToEndTests(TestCase):
    def setUp(self):
        self.city = City.objects.create(name="Surat", code="SUR")
        self.school = School.objects.create(name="Delhi Public School", code="DPS-SUR", city=self.city)
        self.parent_user = User.objects.create_user(
            username="parent_test",
            password="password123",
            role="PARENT",
            city=self.city,
            school=self.school,
        )
        self.admin_user = User.objects.create_user(
            username="admin_test",
            password="password123",
            role="ADMIN",
            city=self.city,
        )
        self.student = Student.objects.create(
            name="Aarav Patel",
            gr_number="DPS-001",
            class_name="5",
            section="A",
            school=self.school,
            parent=self.parent_user,
        )

        self.cat_stationery = Category.objects.create(name="Stationery", slug="stationery")
        self.cat_idcards = Category.objects.create(name="ID Cards", slug="id-cards")

        # Example 1: Photo Notebook (customisation_schema as JSON list of fields)
        self.notebook_product = Product.objects.create(
            name="Personalised Photo Notebook",
            category=self.cat_stationery,
            school=None,
            cost_price=Decimal("150.00"),
            selling_price=Decimal("250.00"),
            customisation_schema=[
                {
                    "key": "cover_photo",
                    "label": "Front Cover Photo",
                    "type": "image",
                    "required": True,
                    "limits": {"max_bytes": 1048576, "accept": ["image/jpeg", "image/png"]},
                },
                {
                    "key": "printed_student_name",
                    "label": "Name to Print on Cover",
                    "type": "text",
                    "required": True,
                    "max_length": 60,
                },
            ],
        )
        self.notebook_variant = ProductVariant.objects.create(
            product=self.notebook_product,
            size="A4",
            sku="NB-PHOTO-A4",
        )

        # Example 2: ID Card (student photo, name, class, blood group, emergency phone)
        self.idcard_product = Product.objects.create(
            name="Smart PVC Student ID Card",
            category=self.cat_idcards,
            school=None,
            cost_price=Decimal("40.00"),
            selling_price=Decimal("120.00"),
            customisation_schema=[
                {
                    "key": "student_photo",
                    "label": "Student Passport Photo",
                    "type": "image",
                    "required": True,
                    "limits": {"max_bytes": 1048576},
                },
                {
                    "key": "student_name",
                    "label": "Full Name (on ID)",
                    "type": "text",
                    "required": True,
                    "max_length": 60,
                },
                {
                    "key": "student_class",
                    "label": "Class & Section",
                    "type": "text",
                    "required": True,
                    "max_length": 20,
                },
                {
                    "key": "blood_group",
                    "label": "Blood Group",
                    "type": "select",
                    "required": True,
                    "options": ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
                },
                {
                    "key": "emergency_phone",
                    "label": "Emergency Phone",
                    "type": "text",
                    "required": False,
                    "max_length": 15,
                },
            ],
        )
        self.idcard_variant = ProductVariant.objects.create(
            product=self.idcard_product,
            size="Standard CR80",
            sku="ID-CR80-STD",
        )

        from inventory.models import StockBalance
        StockBalance.objects.create(
            city=self.city,
            variant=self.notebook_variant,
            stock_quantity=100,
        )
        StockBalance.objects.create(
            city=self.city,
            variant=self.idcard_variant,
            stock_quantity=100,
        )

    def test_presigned_upload_url_generation(self):
        """API issues short-lived pre-signed upload URL for direct storage upload."""
        client = APIClient()
        client.force_authenticate(user=self.parent_user)
        resp = client.post(
            "/api/orders/customisation-upload-url/",
            {"content_type": "image/jpeg", "file_size": 500000},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("upload_url", data)
        self.assertIn("file_key", data)
        self.assertTrue(data["file_key"].startswith("customisations/"))
        self.assertEqual(data["expires_in"], 300)

    def test_reject_base64_or_huge_payload_in_customisation_data(self):
        """Rejects raw base64 or large payloads in customisation_data to keep DB small."""
        client = APIClient()
        client.force_authenticate(user=self.parent_user)

        # Attempt to post base64 data
        resp = client.post(
            "/api/orders/",
            {
                "idempotency_key": "idem-1",
                "student": str(self.student.id),
                "items": [
                    {
                        "variant": str(self.notebook_variant.id),
                        "quantity": 1,
                        "customisation_data": {
                            "cover_photo": "data:image/jpeg;base64," + ("A" * 5000),
                            "printed_student_name": "Aarav",
                        },
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("customisation_data", str(resp.json()))

    def test_create_order_with_valid_customisation_keys_and_schema(self):
        """Proof 1: Photo Notebook order created with object storage key and text."""
        fake_photo_key = "customisations/2026/10/photo_nb_001.jpg"

        # Create dummy image in storage
        img = Image.new("RGB", (800, 600), color=(73, 109, 137))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        put_object_bytes(fake_photo_key, buf.getvalue(), content_type="image/jpeg")

        client = APIClient()
        client.force_authenticate(user=self.parent_user)

        resp = client.post(
            "/api/orders/",
            {
                "idempotency_key": "idem-notebook-order",
                "student": str(self.student.id),
                "items": [
                    {
                        "variant": str(self.notebook_variant.id),
                        "quantity": 1,
                        "customisation_data": {
                            "cover_photo": fake_photo_key,
                            "printed_student_name": "Aarav Patel",
                        },
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        order_data = resp.json()
        item = order_data["items"][0]
        self.assertEqual(item["customisation_data"]["cover_photo"], fake_photo_key)
        self.assertEqual(item["customisation_data"]["printed_student_name"], "Aarav Patel")

        # Execute background task
        order_item = OrderItem.objects.get(pk=item["id"])
        process_customisation_image(str(order_item.id), "cover_photo")

        # Reload and check processed derivatives
        order_item.refresh_from_db()
        self.assertEqual(order_item.customisation_data["cover_photo_status"], "PROCESSED")
        self.assertIn("cover_photo_print", order_item.customisation_data)
        self.assertIn("cover_photo_thumb", order_item.customisation_data)

    def test_proof_example_2_id_card(self):
        """Proof 2: ID Card with student photo, name, class, blood group, emergency phone."""
        fake_id_photo_key = "customisations/2026/10/id_photo_002.jpg"

        img = Image.new("RGB", (600, 800), color=(100, 150, 200))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        put_object_bytes(fake_id_photo_key, buf.getvalue(), content_type="image/jpeg")

        client = APIClient()
        client.force_authenticate(user=self.parent_user)

        resp = client.post(
            "/api/orders/",
            {
                "idempotency_key": "idem-idcard-order",
                "student": str(self.student.id),
                "items": [
                    {
                        "variant": str(self.idcard_variant.id),
                        "quantity": 1,
                        "customisation_data": {
                            "student_photo": fake_id_photo_key,
                            "student_name": "Aarav Patel",
                            "student_class": "Class 5 A",
                            "blood_group": "B+",
                            "emergency_phone": "+91 98765 43210",
                        },
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        order_data = resp.json()
        item_id = order_data["items"][0]["id"]

        # Run background processor
        process_customisation_image(str(item_id), "student_photo")

        # Check order detail via Admin
        admin_client = APIClient()
        admin_client.force_authenticate(user=self.admin_user)
        detail_resp = admin_client.get(f"/api/orders/{order_data['id']}/")
        self.assertEqual(detail_resp.status_code, 200)

        detail_data = detail_resp.json()
        item = detail_data["items"][0]
        self.assertIn("customisation_display", item)
        disp = item["customisation_display"]
        self.assertIn("student_photo", disp)
        self.assertEqual(disp["student_photo"]["type"], "image")
        self.assertTrue(disp["student_photo"]["url"])  # Signed URL generated
        self.assertTrue(disp["student_photo"]["full_url"])  # Signed 300 DPI URL
        self.assertEqual(disp["blood_group"]["value"], "B+")
        self.assertEqual(disp["student_class"]["value"], "Class 5 A")

    def test_signed_download_url_validity(self):
        """Signed URL must correctly authenticate access to private files."""
        fake_key = "customisations/2026/10/private_child.jpg"
        data = b"private-child-jpeg-bytes"
        put_object_bytes(fake_key, data)

        signed_url = generate_presigned_download(fake_key)
        self.assertTrue(signed_url)

        client = APIClient()
        # Fetching with signature succeeds
        resp = client.get(signed_url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.getvalue(), data)

        # Tampering with signature is forbidden
        tampered = signed_url + "tampered"
        tampered_resp = client.get(tampered)
        self.assertEqual(tampered_resp.status_code, 403)
