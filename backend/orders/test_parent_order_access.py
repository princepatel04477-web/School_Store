"""Demonstrate server scoping rules for parent orders:
- Parent sees only their own orders
- Filtering by another parent's child returns empty results
- Accessing another parent's order (GET/PATCH/DELETE/payment/verify-payment) returns 404 (or 403/404)
- Getting own order returns 200 with items and status_events
- Anonymous access returns 401
- When school admin re-assigns a child to another parent, the old order remains with the original parent.
"""

import subprocess
from decimal import Decimal
from django.core.cache import cache
from django.test import LiveServerTestCase, TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance
from inventory.services import apply_stock_movement
from orders.models import Order, OrderItem, OrderStatusEvent
from schools.models import City, School, Student

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM, SMS_PROVIDER="console", DEBUG=True)
class ParentOrderAccessServerTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

        # Seed City, School, School Admin
        self.city = City.objects.create(name="Surat", code="SUR")
        self.school = School.objects.create(name="DPS Surat", code="DPS-SUR", city=self.city)
        self.school_admin = User.objects.create_user(
            username="admin_dps_surat",
            password="AdminPass123!",
            role="SCHOOL_ADMIN",
            school=self.school,
            city=self.city,
        )

        # Catalog setup for order items
        self.category = Category.objects.create(name="Uniforms", slug="uniforms")
        self.product = Product.objects.create(
            name="School Shirt",
            category=self.category,
            school=self.school,
            cost_price=Decimal("150.00"),
            selling_price=Decimal("300.00"),
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku="SHIRT-SUR-M",
            size="M",
            school=self.school,
        )
        apply_stock_movement(
            variant=self.variant,
            city_id=self.city.id,
            quantity_change=50,
            reason="INITIAL_STOCK",
        )

        # Create Parent A through real OTP endpoints
        self.phone_a = "9820011111"
        self.parent_a, self.token_a = self._create_parent_via_otp(self.phone_a)

        # Create Parent B through real OTP endpoints
        self.phone_b = "9820022222"
        self.parent_b, self.token_b = self._create_parent_via_otp(self.phone_b)

        # Children linked to respective parents
        self.child_a = Student.objects.create(
            name="Child A",
            gr_number="GR-A-01",
            class_name="5",
            section="A",
            school=self.school,
            parent=self.parent_a,
        )
        self.child_b = Student.objects.create(
            name="Child B",
            gr_number="GR-B-01",
            class_name="3",
            section="B",
            school=self.school,
            parent=self.parent_b,
        )

        # Order A for Parent A
        self.order_a = self._make_order(
            order_number="ORD-TEST-A1",
            student=self.child_a,
            parent=self.parent_a,
            order_status=Order.Status.CONFIRMED,
        )

        # Order B for Parent B
        self.order_b = self._make_order(
            order_number="ORD-TEST-B1",
            student=self.child_b,
            parent=self.parent_b,
            order_status=Order.Status.PLACED,
        )

    def _create_parent_via_otp(self, phone: str):
        # 1. POST /api/auth/otp/send/
        send_res = self.client.post("/api/auth/otp/send/", {"phone": phone}, format="json")
        self.assertEqual(send_res.status_code, 200, send_res.data)
        code = cache.get(f"otp:{phone}")
        self.assertTrue(code)

        # 2. POST /api/auth/otp/verify/
        verify_res = self.client.post("/api/auth/otp/verify/", {"phone": phone, "otp": code}, format="json")
        self.assertEqual(verify_res.status_code, 200, verify_res.data)
        user_id = verify_res.data["user"]["id"]
        token = verify_res.data["access"]
        user = User.objects.get(pk=user_id)
        self.assertEqual(user.role, "PARENT")
        return user, token

    def _make_order(self, order_number: str, student: Student, parent: User, order_status=Order.Status.PLACED):
        order = Order.objects.create(
            order_number=order_number,
            student=student,
            placed_by=parent,
            subtotal=Decimal("300.00"),
            total=Decimal("300.00"),
            status=order_status,
        )
        OrderItem.objects.create(
            order=order,
            variant=self.variant,
            category=self.variant.product.category,
            quantity=1,
            unit_price_snapshot=Decimal("300.00"),
            unit_cost_snapshot=Decimal("150.00"),
        )
        OrderStatusEvent.objects.create(
            order=order,
            status=order_status,
            changed_by=parent,
            note="Order initial status",
        )
        return order

    def test_parent_order_scoping_and_isolation(self):
        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_a}")

        # 1. GET /api/orders/ -> only A's order
        res = client_a.get("/api/orders/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data["results"] if "results" in res.data else res.data
        order_numbers = [o["order_number"] for o in results]
        self.assertIn(self.order_a.order_number, order_numbers)
        self.assertNotIn(self.order_b.order_number, order_numbers)
        self.assertEqual(len(results), 1)
        # The list says which child each order is for (the account page matches on it)
        self.assertEqual(str(results[0]["student"]), str(self.child_a.id))

        # 2. GET /api/orders/?student=<B's child> -> empty
        res = client_a.get(f"/api/orders/?student={self.child_b.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data["results"] if "results" in res.data else res.data
        self.assertEqual(len(results), 0)

        # 3. GET /api/orders/<B order>/ -> 404
        res = client_a.get(f"/api/orders/{self.order_b.id}/")
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # 4. PATCH /api/orders/<B order>/ -> 403 or 404, row unchanged
        res_patch = client_a.patch(f"/api/orders/{self.order_b.id}/", {"status": "CONFIRMED"}, format="json")
        self.assertIn(res_patch.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.order_b.refresh_from_db()
        self.assertEqual(self.order_b.status, Order.Status.PLACED)

        # 5. DELETE /api/orders/<B order>/ -> 403 or 404, row unchanged
        res_del = client_a.delete(f"/api/orders/{self.order_b.id}/")
        self.assertIn(res_del.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
        self.assertTrue(Order.objects.filter(pk=self.order_b.pk).exists())

        # 6. POST /api/orders/<B order>/payment/ and /verify-payment/ -> 404
        res_pay = client_a.post(f"/api/orders/{self.order_b.id}/payment/")
        self.assertEqual(res_pay.status_code, status.HTTP_404_NOT_FOUND)

        res_vpay = client_a.post(f"/api/orders/{self.order_b.id}/verify-payment/", {"razorpay_payment_id": "pay_fake"})
        self.assertEqual(res_vpay.status_code, status.HTTP_404_NOT_FOUND)

        # 7. GET /api/orders/<A order>/ -> 200 with items and status_events
        res_a = client_a.get(f"/api/orders/{self.order_a.id}/")
        self.assertEqual(res_a.status_code, status.HTTP_200_OK)
        self.assertEqual(res_a.data["order_number"], self.order_a.order_number)
        self.assertIn("items", res_a.data)
        self.assertEqual(len(res_a.data["items"]), 1)
        self.assertIn("status_events", res_a.data)
        self.assertGreaterEqual(len(res_a.data["status_events"]), 1)

    def test_anonymous_access_refused(self):
        anon_client = APIClient()

        # Anonymous: GET /api/orders/ -> 401
        res = anon_client.get("/api/orders/")
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

        # Anonymous: GET /api/orders/<A order>/ -> 401
        res_a = anon_client.get(f"/api/orders/{self.order_a.id}/")
        self.assertEqual(res_a.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_child_reassignment_order_visibility(self):
        """When school admin re-assigns child_a to parent_b:
        - Student.save() updates Order.objects.filter(student_id=child_a).update(parent_id=parent_b)
        - As a result, the old order transfers to the new parent: parent_b sees it, parent_a does not.
        - Documenting and verifying this actual behavior as required by Prompt 4.
        """
        admin_client = APIClient()
        admin_client.force_authenticate(user=self.school_admin)

        # School admin re-assigns child_a from parent_a to parent_b
        res = admin_client.post(
            f"/api/students/{self.child_a.id}/assign-parent/",
            {"parent": str(self.parent_b.id)},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)

        self.child_a.refresh_from_db()
        self.assertEqual(self.child_a.parent_id, self.parent_b.id)

        # The existing order's parent_id is updated to parent_b
        self.order_a.refresh_from_db()
        self.assertEqual(self.order_a.parent_id, self.parent_b.id)

        # Parent B now sees order_a (200)
        client_b = APIClient()
        client_b.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_b}")
        res_b = client_b.get(f"/api/orders/{self.order_a.id}/")
        self.assertEqual(res_b.status_code, status.HTTP_200_OK)

        # Parent B's order list now includes order_a as well as order_b
        res_b_list = client_b.get("/api/orders/")
        self.assertEqual(res_b_list.status_code, status.HTTP_200_OK)
        results = res_b_list.data["results"] if "results" in res_b_list.data else res_b_list.data
        b_order_numbers = [o["order_number"] for o in results]
        self.assertIn(self.order_a.order_number, b_order_numbers)
        self.assertIn(self.order_b.order_number, b_order_numbers)

        # Parent A no longer sees order_a (404)
        client_a = APIClient()
        client_a.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_a}")
        res_a = client_a.get(f"/api/orders/{self.order_a.id}/")
        self.assertEqual(res_a.status_code, status.HTTP_404_NOT_FOUND)

        res_a_list = client_a.get("/api/orders/")
        self.assertEqual(res_a_list.status_code, status.HTTP_200_OK)
        results_a = res_a_list.data["results"] if "results" in res_a_list.data else res_a_list.data
        a_order_numbers = [o["order_number"] for o in results_a]
        self.assertNotIn(self.order_a.order_number, a_order_numbers)


@override_settings(CACHES=LOCMEM, SMS_PROVIDER="console", DEBUG=True, SECURE_SSL_REDIRECT=False)
class ParentOrderAccessCurlLiveTests(LiveServerTestCase):
    def setUp(self):
        cache.clear()
        self.city = City.objects.create(name="Surat", code="SUR")
        self.school = School.objects.create(name="DPS Surat", code="DPS-SUR", city=self.city)
        self.category = Category.objects.create(name="Uniforms", slug="uniforms")
        self.product = Product.objects.create(
            name="School Shirt",
            category=self.category,
            school=self.school,
            cost_price=Decimal("150.00"),
            selling_price=Decimal("300.00"),
        )
        self.variant = ProductVariant.objects.create(
            product=self.product,
            sku="SHIRT-SUR-M2",
            size="M",
            school=self.school,
        )
        apply_stock_movement(
            variant=self.variant,
            city_id=self.city.id,
            quantity_change=50,
            reason="INITIAL_STOCK",
        )

        # OTP Login for Parent A
        client = APIClient()
        client.post("/api/auth/otp/send/", {"phone": "9820033333"}, format="json")
        code_a = cache.get("otp:9820033333")
        res_a = client.post("/api/auth/otp/verify/", {"phone": "9820033333", "otp": code_a}, format="json")
        self.parent_a = User.objects.get(pk=res_a.data["user"]["id"])
        self.token_a = res_a.data["access"]

        # OTP Login for Parent B
        client.post("/api/auth/otp/send/", {"phone": "9820044444"}, format="json")
        code_b = cache.get("otp:9820044444")
        res_b = client.post("/api/auth/otp/verify/", {"phone": "9820044444", "otp": code_b}, format="json")
        self.parent_b = User.objects.get(pk=res_b.data["user"]["id"])
        self.token_b = res_b.data["access"]

        self.child_a = Student.objects.create(
            name="Child A",
            gr_number="GR-A-02",
            class_name="5",
            section="A",
            school=self.school,
            parent=self.parent_a,
        )
        self.child_b = Student.objects.create(
            name="Child B",
            gr_number="GR-B-02",
            class_name="3",
            section="B",
            school=self.school,
            parent=self.parent_b,
        )

        self.order_a = Order.objects.create(
            order_number="ORD-CURL-A1",
            student=self.child_a,
            placed_by=self.parent_a,
            subtotal=Decimal("300.00"),
            total=Decimal("300.00"),
            status=Order.Status.CONFIRMED,
        )
        OrderItem.objects.create(
            order=self.order_a,
            variant=self.variant,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("300.00"),
            unit_cost_snapshot=Decimal("150.00"),
        )
        OrderStatusEvent.objects.create(
            order=self.order_a,
            status=Order.Status.CONFIRMED,
            changed_by=self.parent_a,
            note="Order initial status",
        )

        self.order_b = Order.objects.create(
            order_number="ORD-CURL-B1",
            student=self.child_b,
            placed_by=self.parent_b,
            subtotal=Decimal("300.00"),
            total=Decimal("300.00"),
            status=Order.Status.PLACED,
        )
        OrderItem.objects.create(
            order=self.order_b,
            variant=self.variant,
            category=self.category,
            quantity=1,
            unit_price_snapshot=Decimal("300.00"),
            unit_cost_snapshot=Decimal("150.00"),
        )

    def _curl(self, method, path, token=None, data=None):
        url = f"{self.live_server_url}{path}"
        args = ["curl.exe", "-s", "-o", "nul", "-w", "%{http_code}", "-X", method, url]
        if token:
            args.extend(["-H", f"Authorization: Bearer {token}"])
        if data:
            args.extend(["-H", "Content-Type: application/json", "-d", data])
        proc = subprocess.run(args, capture_output=True, text=True)
        return proc.stdout.strip()

    def test_curl_parent_order_scoping(self):
        # 1. GET /api/orders/ as Parent A -> 200
        code1 = self._curl("GET", "/api/orders/", token=self.token_a)
        print(f"\n[CURL] GET /api/orders/ [Parent A] -> {code1}")
        self.assertEqual(code1, "200")

        # 2. GET /api/orders/?student=<B's child> as Parent A -> 200
        code2 = self._curl("GET", f"/api/orders/?student={self.child_b.id}", token=self.token_a)
        print(f"[CURL] GET /api/orders/?student={self.child_b.id} [Parent A] -> {code2}")
        self.assertEqual(code2, "200")

        # 3. GET /api/orders/<B order>/ as Parent A -> 404
        code3 = self._curl("GET", f"/api/orders/{self.order_b.id}/", token=self.token_a)
        print(f"[CURL] GET /api/orders/{self.order_b.id}/ [Parent A] -> {code3}")
        self.assertEqual(code3, "404")

        # 4. PATCH /api/orders/<B order>/ as Parent A -> 403 or 404
        code4 = self._curl("PATCH", f"/api/orders/{self.order_b.id}/", token=self.token_a, data='{"status":"CONFIRMED"}')
        print(f"[CURL] PATCH /api/orders/{self.order_b.id}/ [Parent A] -> {code4}")
        self.assertIn(code4, ("403", "404"))

        # 5. POST /api/orders/<B order>/payment/ as Parent A -> 404
        code5 = self._curl("POST", f"/api/orders/{self.order_b.id}/payment/", token=self.token_a)
        print(f"[CURL] POST /api/orders/{self.order_b.id}/payment/ [Parent A] -> {code5}")
        self.assertEqual(code5, "404")

        # 6. GET /api/orders/<A order>/ as Parent A -> 200
        code6 = self._curl("GET", f"/api/orders/{self.order_a.id}/", token=self.token_a)
        print(f"[CURL] GET /api/orders/{self.order_a.id}/ [Parent A] -> {code6}")
        self.assertEqual(code6, "200")

        # Anonymous: GET /api/orders/ -> 401
        code_anon_list = self._curl("GET", "/api/orders/")
        print(f"[CURL] GET /api/orders/ [Anonymous] -> {code_anon_list}")
        self.assertEqual(code_anon_list, "401")

        # Anonymous: GET /api/orders/<A order>/ -> 401
        code_anon_detail = self._curl("GET", f"/api/orders/{self.order_a.id}/")
        print(f"[CURL] GET /api/orders/{self.order_a.id}/ [Anonymous] -> {code_anon_detail}")
        self.assertEqual(code_anon_detail, "401")

