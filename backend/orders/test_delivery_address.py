import uuid
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.serializers import build_tokens_for_user
from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance
from schools.models import City, School, Student

from .delivery import clean_delivery_details, normalize_indian_state, pin_service, validate_indian_phone, validate_pincode_format
from .models import Order, OrderItem
from .serializers import OrderCreateSerializer, OrderDetailSerializer


class DeliveryAddressValidationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.city_gujarat = City.objects.create(name="Surat", code="SUR-DELIV", state="Gujarat")
        cls.city_punjab = City.objects.create(name="Jalandhar", code="JAL-DELIV", state="Punjab")
        cls.city_delhi = City.objects.create(name="New Delhi", code="DEL-DELIV", state="Delhi")

        cls.school_gujarat = School.objects.create(
            name="Delhi Public School Surat",
            code="DPS-SUR-DELIV",
            city=cls.city_gujarat,
            home_delivery_enabled=True,
            school_pickup_enabled=True,
            pincode="395007",
        )
        cls.school_punjab = School.objects.create(
            name="Cambridge International School Jalandhar",
            code="CIS-JAL-DELIV",
            city=cls.city_punjab,
            home_delivery_enabled=True,
            school_pickup_enabled=True,
            pincode="144008",
        )

        cls.parent = User.objects.create(
            username="parent_deliv@schoolstore.test",
            role="PARENT",
            first_name="Ramesh",
            last_name="Patel",
            phone="9876543210",
        )

        cls.student_gujarat = Student.objects.create(
            name="Aarav Patel",
            gr_number="GR-DELIV-01",
            school=cls.school_gujarat,
            city=cls.city_gujarat,
            parent=cls.parent,
            gender="boy",
            class_name="5",
        )
        cls.student_punjab = Student.objects.create(
            name="Simran Kaur",
            gr_number="GR-DELIV-02",
            school=cls.school_punjab,
            city=cls.city_punjab,
            parent=cls.parent,
            gender="girl",
            class_name="6",
        )

        cls.category = Category.objects.create(name="Uniforms", slug="uniforms-deliv")
        cls.product_gujarat = Product.objects.create(
            name="School Shirt Surat",
            category=cls.category,
            school=cls.school_gujarat,
            selling_price=Decimal("450.00"),
            cost_price=Decimal("200.00"),
            gender="unisex",
            needs_review=False,
        )
        cls.variant_gujarat = ProductVariant.objects.create(
            product=cls.product_gujarat,
            sku="SHIRT-SUR-32",
            size="32",
        )
        StockBalance.objects.create(
            city=cls.city_gujarat,
            variant=cls.variant_gujarat,
            stock_quantity=100,
        )

        cls.product_punjab = Product.objects.create(
            name="School Shirt Punjab",
            category=cls.category,
            school=cls.school_punjab,
            selling_price=Decimal("480.00"),
            cost_price=Decimal("220.00"),
            gender="unisex",
            needs_review=False,
        )
        cls.variant_punjab = ProductVariant.objects.create(
            product=cls.product_punjab,
            sku="SHIRT-PUN-34",
            size="34",
        )
        StockBalance.objects.create(
            city=cls.city_punjab,
            variant=cls.variant_punjab,
            stock_quantity=100,
        )

    def setUp(self):
        self.client = APIClient()
        tokens = build_tokens_for_user(self.parent)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    def _base_payload(self, student, variant):
        return {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(student.id),
            "fulfillment_type": "HOME_DELIVERY",
            "payment_method": "COD",
            "items": [{"variant": str(variant.id), "quantity": 1}],
        }

    # ================= 1. HOME DELIVERY VALIDATION =================

    def test_01_home_delivery_without_delivery_details_rejected(self):
        payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("delivery_details", res.json())

    def test_02_home_delivery_with_empty_delivery_details_rejected(self):
        payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
        payload["delivery_details"] = {}
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 400)
        errors = res.json()["delivery_details"]
        self.assertIn("recipient_name", errors)
        self.assertIn("phone", errors)
        self.assertIn("address", errors)
        self.assertIn("city", errors)
        self.assertIn("state", errors)
        self.assertIn("pincode", errors)

    def test_03_home_delivery_non_dict_delivery_details_rejected(self):
        payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
        payload["delivery_details"] = "101 Sunrise Apt"
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("delivery_details", res.json())

    def test_04_malformed_phone_numbers_rejected(self):
        invalid_phones = ["12345", "5555555555", "abcdefghij", "009876543210", "+14155552671"]
        for bad_phone in invalid_phones:
            payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
            payload["delivery_details"] = {
                "recipient_name": "Ramesh Patel",
                "phone": bad_phone,
                "address": "101 Sunrise Apt, Vesu",
                "city": "Surat",
                "state": "Gujarat",
                "pincode": "395007",
            }
            res = self.client.post("/api/orders/", payload, format="json")
            self.assertEqual(res.status_code, 400, f"Expected 400 for phone {bad_phone}")
            self.assertIn("phone", res.json()["delivery_details"])

    def test_05_valid_indian_phone_normalized(self):
        valid_phones = ["+91 9876543210", "98765-43210", "09876543210", "9876543210", "6300000001", "7900000002", "8800000003"]
        for phone in valid_phones:
            normalized = validate_indian_phone(phone)
            self.assertEqual(len(normalized), 10)
            self.assertTrue(normalized[0] in "6789")

    def test_06_malformed_pincodes_rejected(self):
        invalid_pins = ["012345", "12345", "1234567", "abcdef", " 39500A "]
        for bad_pin in invalid_pins:
            payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
            payload["delivery_details"] = {
                "recipient_name": "Ramesh Patel",
                "phone": "9876543210",
                "address": "101 Sunrise Apt, Vesu",
                "city": "Surat",
                "state": "Gujarat",
                "pincode": bad_pin,
            }
            res = self.client.post("/api/orders/", payload, format="json")
            self.assertEqual(res.status_code, 400, f"Expected 400 for pin {bad_pin}")
            self.assertIn("pincode", res.json()["delivery_details"])

    def test_07_invalid_or_non_indian_state_rejected(self):
        invalid_states = ["Narnia", "California", "12345", "UnknownState"]
        for bad_state in invalid_states:
            payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
            payload["delivery_details"] = {
                "recipient_name": "Ramesh Patel",
                "phone": "9876543210",
                "address": "101 Sunrise Apt, Vesu",
                "city": "Surat",
                "state": bad_state,
                "pincode": "395007",
            }
            res = self.client.post("/api/orders/", payload, format="json")
            self.assertEqual(res.status_code, 400, f"Expected 400 for state {bad_state}")
            self.assertIn("state", res.json()["delivery_details"])

    def test_08_input_trimmed_and_bounded(self):
        raw = {
            "recipient_name": "   " + "A" * 200 + "   ",
            "phone": "+91 9876543210",
            "address": "   " + "B" * 500 + "   ",
            "city": "   Surat   ",
            "state": "  gujarat  ",
            "pincode": "  395007  ",
            "notes": "   " + "C" * 1000 + "   ",
        }
        cleaned = clean_delivery_details(raw, Order.FulfillmentType.HOME_DELIVERY)
        self.assertEqual(len(cleaned["recipient_name"]), 120)
        self.assertEqual(cleaned["phone"], "9876543210")
        self.assertEqual(len(cleaned["address"]), 300)
        self.assertEqual(cleaned["city"], "Surat")
        self.assertEqual(cleaned["state"], "Gujarat")
        self.assertEqual(cleaned["pincode"], "395007")
        self.assertEqual(len(cleaned["notes"]), 500)

    # ================= 2. NON-GUJARAT ORDERS DO NOT INHERIT GUJARAT =================

    def test_09_non_gujarat_order_preserves_punjab_state(self):
        payload = self._base_payload(self.student_punjab, self.variant_punjab)
        payload["delivery_details"] = {
            "recipient_name": "Harpreet Singh",
            "phone": "9814012345",
            "address": "Plot 45, Model Town, Near Gurudwara",
            "city": "Jalandhar",
            "state": "Punjab",
            "pincode": "144008",
        }
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        data = res.json()
        saved_details = data["delivery_details"]
        self.assertEqual(saved_details["state"], "Punjab")
        self.assertEqual(saved_details["city"], "Jalandhar")
        self.assertEqual(saved_details["pincode"], "144008")
        self.assertNotEqual(saved_details["state"], "Gujarat")

    def test_10_non_gujarat_order_preserves_delhi_state(self):
        payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
        payload["delivery_details"] = {
            "recipient_name": "Amit Sharma",
            "phone": "9811012345",
            "address": "C-14, Connaught Place",
            "city": "New Delhi",
            "state": "Delhi",
            "pincode": "110001",
        }
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        saved_details = res.json()["delivery_details"]
        self.assertEqual(saved_details["state"], "Delhi")
        self.assertEqual(saved_details["city"], "New Delhi")
        self.assertNotEqual(saved_details["state"], "Gujarat")

    # ================= 3. SCHOOL PICKUP WORKS WITHOUT HOME ADDRESS =================

    def test_11_pickup_works_without_home_address(self):
        payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
        payload["fulfillment_type"] = "SCHOOL_PICKUP"
        payload["delivery_details"] = {}
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        data = res.json()
        self.assertEqual(data["fulfillment_type"], "SCHOOL_PICKUP")

    def test_12_pickup_with_recipient_and_phone_cleaned(self):
        payload = self._base_payload(self.student_gujarat, self.variant_gujarat)
        payload["fulfillment_type"] = "SCHOOL_PICKUP"
        payload["delivery_details"] = {
            "recipient_name": "Ramesh Patel",
            "phone": "+91 9876543210",
        }
        res = self.client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        data = res.json()
        saved = data["delivery_details"]
        self.assertEqual(saved["recipient_name"], "Ramesh Patel")
        self.assertEqual(saved["phone"], "9876543210")
        self.assertNotIn("address", saved)
        self.assertNotIn("city", saved)
        self.assertNotIn("pincode", saved)

    # ================= 4. EXISTING ORDER SNAPSHOT READABILITY =================

    def test_13_existing_order_snapshot_remains_readable(self):
        order = Order.objects.create(
            order_number="ORD-LEGACY-01",
            idempotency_key=str(uuid.uuid4()),
            student=self.student_gujarat,
            parent=self.parent,
            placed_by=self.parent,
            placed_by_role="PARENT",
            payer=self.parent,
            school=self.school_gujarat,
            city=self.city_gujarat,
            subtotal=Decimal("450.00"),
            total=Decimal("450.00"),
            fulfillment_type=Order.FulfillmentType.HOME_DELIVERY,
            delivery_details={"pickup": "school", "note": "Old seed record format"},
        )
        res = self.client.get(f"/api/orders/{order.id}/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["delivery_details"]["pickup"], "school")
        self.assertEqual(data["delivery_details"]["note"], "Old seed record format")

    # ================= 5. PINCODE LOOKUP & SERVICEABILITY SEPARATION =================

    def test_14_pincode_lookup_separates_format_geography_and_serviceability(self):
        # 395007 Surat, Gujarat
        res = self.client.get("/api/orders/pincode-lookup/?pincode=395007")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["pincode"], "395007")
        self.assertTrue(data["format_valid"])
        self.assertTrue(data["geography"]["found"])
        self.assertEqual(data["geography"]["city"], "Surat")
        self.assertEqual(data["geography"]["state"], "Gujarat")
        # Serviceability remains UNKNOWN when no provider credentials exist
        self.assertEqual(data["serviceability"]["status"], "UNKNOWN")

    def test_15_invalid_pincode_format_lookup(self):
        res = self.client.get("/api/orders/pincode-lookup/?pincode=012345")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["format_valid"])
        self.assertFalse(data["geography"]["found"])
        self.assertEqual(data["serviceability"]["status"], "UNKNOWN")

    def test_16_unavailable_lookup_shows_unknown_not_serviceable(self):
        # Even for a valid PIN format, unconfigured/unavailable provider never promises delivery
        with override_settings(DELIVERY_PROVIDER_URL="", DELIVERY_PROVIDER_API_KEY=""):
            res = self.client.get("/api/orders/pincode-lookup/?pincode=144008")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["format_valid"])
            self.assertEqual(data["serviceability"]["status"], "UNKNOWN")
            self.assertNotEqual(data["serviceability"]["status"], "SERVICEABLE")

    def test_17_mock_courier_serviceable_response(self):
        with override_settings(DELIVERY_PROVIDER_URL="https://courier.test/check", DELIVERY_PROVIDER_API_KEY="test_key"):
            with patch("requests.get") as mock_get:
                mock_get.return_value.status_code = 200
                mock_get.return_value.json.return_value = {"serviceable": True}
                res = self.client.get("/api/orders/pincode-lookup/?pincode=395007")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertEqual(data["serviceability"]["status"], "SERVICEABLE")

    def test_18_mock_courier_unserviceable_response(self):
        with override_settings(DELIVERY_PROVIDER_URL="https://courier.test/check", DELIVERY_PROVIDER_API_KEY="test_key"):
            with patch("requests.get") as mock_get:
                mock_get.return_value.status_code = 200
                mock_get.return_value.json.return_value = {"serviceable": False}
                res = self.client.get("/api/orders/pincode-lookup/?pincode=190001")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertEqual(data["serviceability"]["status"], "UNSERVICEABLE")

    def test_19_mock_courier_provider_failure_returns_unknown(self):
        with override_settings(DELIVERY_PROVIDER_URL="https://courier.test/check", DELIVERY_PROVIDER_API_KEY="test_key"):
            with patch("requests.get", side_effect=Exception("Courier connection timeout")):
                res = self.client.get("/api/orders/pincode-lookup/?pincode=395007")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertEqual(data["serviceability"]["status"], "UNKNOWN")
                self.assertNotEqual(data["serviceability"]["status"], "SERVICEABLE")
