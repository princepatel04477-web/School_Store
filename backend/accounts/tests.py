import uuid
from decimal import Decimal
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from catalog.models import Category, Product, ProductVariant
from common.scoping import apply_user_scope
from orders.models import Order, OrderItem
from schools.models import City, School, Student


class RolesPermissionsAndScopingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.surat = City.objects.get(code="SUR")
        cls.ahmedabad = City.objects.get(code="AMD")

        cls.dps_surat = School.objects.get(code="DPS-SUR")
        cls.fhs_surat = School.objects.get(code="FHS-SUR")
        cls.udgam_amd = School.objects.get(code="UDG-AMD")

        cls.boss = User.objects.get(username="boss")
        cls.admin_surat = User.objects.get(username="admin_surat")
        cls.school_admin_dps = User.objects.get(username="school_admin_dps")
        cls.teacher_dps = User.objects.get(username="teacher_dps")
        cls.parent_rahul = User.objects.get(username="parent_rahul")
        cls.parent_priya = User.objects.get(username="parent_priya")

        # Create an Admin in City B (Ahmedabad) and School Admin in School B (FHS-SUR & UDG-AMD)
        cls.admin_amd = User.objects.create_user(
            username="admin_amd",
            password="Password@123",
            role=User.Role.ADMIN,
            city=cls.ahmedabad,
            is_staff=True,
        )
        cls.school_admin_fhs = User.objects.create_user(
            username="school_admin_fhs",
            password="Password@123",
            role=User.Role.SCHOOL_ADMIN,
            city=cls.surat,
            school=cls.fhs_surat,
        )

        # Ensure orders exist in both School A (DPS-SUR in Surat) and School B (UDG-AMD in Ahmedabad)
        cls.student_dps = Student.objects.filter(school=cls.dps_surat, parent=cls.parent_rahul).first()
        cls.student_fhs = Student.objects.filter(school=cls.fhs_surat).first()
        cls.student_udg = Student.objects.filter(school=cls.udgam_amd, parent=cls.parent_priya).first()

        cls.variant_dps = ProductVariant.objects.filter(school=cls.dps_surat).first()
        cls.variant_udg = ProductVariant.objects.filter(school=cls.udgam_amd).first()

        cls.order_dps = Order.objects.filter(school=cls.dps_surat).first()
        cls.order_udg = Order.objects.create(
            order_number="ORD-UDG-0001",
            placed_by=cls.parent_priya,
            placed_by_role=User.Role.PARENT,
            student=cls.student_udg,
            parent=cls.parent_priya,
            school=cls.udgam_amd,
            city=cls.ahmedabad,
            status=Order.Status.CONFIRMED,
            payment_status=Order.PaymentStatus.PAID,
            subtotal=Decimal("1350.00"),
            total=Decimal("1350.00"),
        )
        OrderItem.objects.create(
            order=cls.order_udg,
            variant=cls.variant_udg,
            category=cls.variant_udg.product.category,
            quantity=1,
            unit_price_snapshot=cls.variant_udg.product.selling_price,
            unit_cost_snapshot=cls.variant_udg.product.cost_price,
        )

    def _jwt_client(self, user: User) -> APIClient:
        client = APIClient()
        tokens = build_tokens_for_user(user)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        return client

    def test_jwt_claims_contain_role_city_and_school_and_cost_zero_db_queries(self):
        client = self._jwt_client(self.school_admin_dps)
        with CaptureQueriesContext(connection) as ctx:
            # A forbidden write action checks JWT auth + RoleScopedPermission without hitting DB
            res = client.post("/api/categories/", {"name": "Blocked", "slug": "blocked"})
            self.assertEqual(res.status_code, 403)
        self.assertEqual(
            len(ctx.captured_queries),
            0,
            "JWT authentication and permission checks must cost 0 database queries!",
        )

    def test_scope_filters_use_single_where_clause_without_joins_or_subqueries(self):
        for user in (
            self.admin_surat,
            self.school_admin_dps,
            self.teacher_dps,
            self.parent_rahul,
        ):
            for model in (Order, Student):
                qs = apply_user_scope(model.objects.all(), user)
                sql = str(qs.query)
                self.assertNotIn(
                    "JOIN",
                    sql.upper(),
                    f"Scope query on {model.__name__} for {user.role} must not use a JOIN: {sql}",
                )
                # Ensure no nested SELECT subquery in WHERE clause
                where_part = sql.upper().split("WHERE", 1)[-1]
                self.assertNotIn(
                    "SELECT ",
                    where_part,
                    f"Scope query on {model.__name__} for {user.role} must not use a subquery: {sql}",
                )

    def test_school_a_user_cannot_read_or_modify_school_b_data(self):
        """
        Requirement 7: Prove a user from School A (DPS-SUR) cannot read or modify
        any data from School B (FHS-SUR or UDG-AMD).
        """
        for school_a_user in (self.school_admin_dps, self.teacher_dps):
            client = self._jwt_client(school_a_user)

            # 1. Students list only returns DPS-SUR students
            res_students = client.get("/api/students/")
            self.assertEqual(res_students.status_code, 200)
            school_ids = {str(row["school"]) for row in res_students.data["results"]}
            self.assertEqual(school_ids, {str(self.dps_surat.id)})

            # 2. Reading School B student directly returns 404
            self.assertEqual(
                client.get(f"/api/students/{self.student_fhs.id}/").status_code,
                404,
            )
            self.assertEqual(
                client.get(f"/api/students/{self.student_udg.id}/").status_code,
                404,
            )

            # 3. Modifying School B student returns 404/403 and leaves DB untouched
            patch_res = client.patch(
                f"/api/students/{self.student_fhs.id}/",
                {"name": "Hacked Name"},
                format="json",
            )
            self.assertIn(patch_res.status_code, (403, 404))
            self.student_fhs.refresh_from_db()
            self.assertNotEqual(self.student_fhs.name, "Hacked Name")

            # 4. Orders list only returns DPS-SUR orders
            res_orders = client.get("/api/orders/")
            self.assertEqual(res_orders.status_code, 200)
            order_schools = {row["school_code"] for row in res_orders.data["results"]}
            self.assertEqual(order_schools, {"DPS-SUR"})
            visible_order_ids = {row["id"] for row in res_orders.data["results"]}
            school_a_order_ids = {
                str(oid)
                for oid in Order.objects.filter(school=self.dps_surat).values_list(
                    "id", flat=True
                )
            }
            self.assertTrue(visible_order_ids.issubset(school_a_order_ids))
            self.assertNotIn(str(self.order_udg.id), visible_order_ids)

            # 5. Reading or modifying School B order returns 404/403
            self.assertEqual(
                client.get(f"/api/orders/{self.order_udg.id}/").status_code,
                404,
            )
            order_patch = client.patch(
                f"/api/orders/{self.order_udg.id}/",
                {"status": "CANCELLED"},
                format="json",
            )
            self.assertIn(order_patch.status_code, (403, 404))
            self.order_udg.refresh_from_db()
            self.assertEqual(self.order_udg.status, Order.Status.CONFIRMED)

            # 6. Placing an order for a student in School B is rejected with 403
            bad_order = client.post(
                "/api/orders/",
                {
                    "student": str(self.student_fhs.id),
                    "items": [{"variant": str(self.variant_dps.id), "quantity": 1}],
                },
                format="json",
            )
            self.assertEqual(bad_order.status_code, 403)

    def test_admin_from_city_a_cannot_see_or_modify_city_b(self):
        """
        Requirement 7: Prove an Admin from City A (Surat) cannot see or modify City B (Ahmedabad).
        """
        client = self._jwt_client(self.admin_surat)

        # 1. Schools list only contains Surat schools (never Ahmedabad)
        res_schools = client.get("/api/schools/")
        self.assertEqual(res_schools.status_code, 200)
        city_ids = {str(row["city"]) for row in res_schools.data["results"]}
        self.assertEqual(city_ids, {str(self.surat.id)})
        self.assertEqual(
            client.get(f"/api/schools/{self.udgam_amd.id}/").status_code,
            404,
        )
        self.assertEqual(
            client.patch(
                f"/api/schools/{self.udgam_amd.id}/",
                {"name": "Tampered"},
                format="json",
            ).status_code,
            404,
        )

        # 2. Students list only contains Surat students
        res_students = client.get("/api/students/")
        self.assertEqual(res_students.status_code, 200)
        student_cities = {str(row["city"]) for row in res_students.data["results"]}
        self.assertEqual(student_cities, {str(self.surat.id)})
        self.assertEqual(
            client.get(f"/api/students/{self.student_udg.id}/").status_code,
            404,
        )

        # 3. Orders list only contains Surat orders
        res_orders = client.get("/api/orders/")
        self.assertEqual(res_orders.status_code, 200)
        order_cities = {row["city_name"] for row in res_orders.data["results"]}
        self.assertEqual(order_cities, {"Surat"})
        surat_order_ids = {
            str(oid)
            for oid in Order.objects.filter(city=self.surat).values_list("id", flat=True)
        }
        self.assertTrue(
            {row["id"] for row in res_orders.data["results"]}.issubset(surat_order_ids)
        )
        self.assertEqual(
            client.get(f"/api/orders/{self.order_udg.id}/").status_code,
            404,
        )

        # 4. Stock variants list only contains Surat school variants
        res_variants = client.get("/api/variants/")
        self.assertEqual(res_variants.status_code, 200)
        variant_cities = {str(row["city"]) for row in res_variants.data["results"]}
        self.assertEqual(variant_cities, {str(self.surat.id)})
        self.assertEqual(
            client.get(f"/api/variants/{self.variant_udg.id}/").status_code,
            404,
        )

    def test_parent_only_sees_own_children_and_their_orders(self):
        client = self._jwt_client(self.parent_rahul)

        res_students = client.get("/api/students/")
        self.assertEqual(res_students.status_code, 200)
        parent_ids = {str(row["parent"]) for row in res_students.data["results"]}
        self.assertEqual(parent_ids, {str(self.parent_rahul.id)})
        self.assertEqual(
            client.get(f"/api/students/{self.student_udg.id}/").status_code,
            404,
        )

        res_orders = client.get("/api/orders/")
        self.assertEqual(res_orders.status_code, 200)
        own_order_ids = {
            str(oid)
            for oid in Order.objects.filter(parent=self.parent_rahul).values_list(
                "id", flat=True
            )
        }
        visible_order_ids = {row["id"] for row in res_orders.data["results"]}
        self.assertTrue(visible_order_ids.issubset(own_order_ids))
        self.assertTrue(visible_order_ids, "Parent should see their own children's orders")
        self.assertNotIn(str(self.order_udg.id), visible_order_ids)
        self.assertEqual(
            client.get(f"/api/orders/{self.order_udg.id}/").status_code,
            404,
        )

    def test_account_creation_hierarchy_and_parent_self_registration(self):
        """
        Requirement 6:
        - Boss creates Admins.
        - Admins create School Admin logins for schools in their city.
        - School Admins create Teacher logins.
        - Parents self-register with phone number and OTP or password.
        """
        # 1. Boss creates an Admin for Surat
        boss_client = self._jwt_client(self.boss)
        res_admin = boss_client.post(
            "/api/accounts/users/",
            {
                "username": "new_admin_surat",
                "password": "Password@123",
                "role": "ADMIN",
                "city": str(self.surat.id),
                "phone": "9811111111",
            },
            format="json",
        )
        self.assertEqual(res_admin.status_code, 201)
        self.assertEqual(res_admin.data["role"], "ADMIN")
        self.assertEqual(str(res_admin.data["city"]), str(self.surat.id))

        # 2. Admin creates School Admin in their own city (Surat) -> 201
        admin_client = self._jwt_client(self.admin_surat)
        res_sa = admin_client.post(
            "/api/accounts/users/",
            {
                "username": "new_school_admin_dps",
                "password": "Password@123",
                "role": "SCHOOL_ADMIN",
                "school": str(self.dps_surat.id),
                "phone": "9822222222",
            },
            format="json",
        )
        self.assertEqual(res_sa.status_code, 201)
        self.assertEqual(res_sa.data["role"], "SCHOOL_ADMIN")
        self.assertEqual(str(res_sa.data["school"]), str(self.dps_surat.id))

        # Admin CANNOT create a School Admin for a school in City B (Ahmedabad) -> 403
        res_sa_other_city = admin_client.post(
            "/api/accounts/users/",
            {
                "username": "illegal_sa_amd",
                "password": "Password@123",
                "role": "SCHOOL_ADMIN",
                "school": str(self.udgam_amd.id),
            },
            format="json",
        )
        self.assertEqual(res_sa_other_city.status_code, 403)

        # Admin CANNOT create another Admin or Boss -> 403
        res_admin_escalate = admin_client.post(
            "/api/accounts/users/",
            {
                "username": "illegal_admin",
                "password": "Password@123",
                "role": "ADMIN",
                "city": str(self.surat.id),
            },
            format="json",
        )
        self.assertEqual(res_admin_escalate.status_code, 403)

        # 3. School Admin creates Teacher in their own school -> 201
        sa_client = self._jwt_client(self.school_admin_dps)
        res_teacher = sa_client.post(
            "/api/accounts/users/",
            {
                "username": "new_teacher_dps",
                "password": "Password@123",
                "phone": "9833333333",
            },
            format="json",
        )
        self.assertEqual(res_teacher.status_code, 201)
        self.assertEqual(res_teacher.data["role"], "TEACHER")
        self.assertEqual(str(res_teacher.data["school"]), str(self.dps_surat.id))

        # School Admin CANNOT create a Teacher for School B -> 403
        res_teacher_other = sa_client.post(
            "/api/accounts/users/",
            {
                "username": "illegal_teacher_fhs",
                "password": "Password@123",
                "school": str(self.fhs_surat.id),
            },
            format="json",
        )
        self.assertEqual(res_teacher_other.status_code, 403)

        # 4. Parent self-registers with phone + password -> 201
        anon = APIClient()
        reg_pw = anon.post(
            "/api/auth/register/",
            {
                "phone": "9844444444",
                "password": "Password@123",
                "first_name": "Kiran",
                "last_name": "Patel",
                "school": str(self.dps_surat.id),
            },
            format="json",
        )
        self.assertEqual(reg_pw.status_code, 201)
        self.assertEqual(reg_pw.data["user"]["role"], "PARENT")
        self.assertIn("access", reg_pw.data)

        # 5. Parent self-registers with phone + OTP -> 201
        otp_res = anon.post(
            "/api/auth/otp/send/",
            {"phone": "9855555555"},
            format="json",
        )
        self.assertEqual(otp_res.status_code, 200)
        otp_code = otp_res.data.get("otp_debug") or cache.get("otp:9855555555")

        reg_otp = anon.post(
            "/api/auth/register/",
            {
                "phone": "9855555555",
                "otp": otp_code,
                "first_name": "Meena",
                "last_name": "Joshi",
            },
            format="json",
        )
        self.assertEqual(reg_otp.status_code, 201)
        self.assertEqual(reg_otp.data["user"]["role"], "PARENT")
        self.assertIn("access", reg_otp.data)

    def test_query_count_of_each_list_endpoint_stays_constant_as_rows_grow(self):
        """
        Requirement 7: Assert the query count of each list endpoint stays constant
        as rows grow (no N+1).
        """
        client = self._jwt_client(self.boss)
        endpoints = [
            "/api/schools/",
            "/api/students/",
            "/api/products/",
            "/api/variants/",
            "/api/orders/",
            "/api/accounts/users/",
        ]

        baseline_counts = {}
        for ep in endpoints:
            with CaptureQueriesContext(connection) as ctx:
                res = client.get(ep)
                self.assertEqual(res.status_code, 200)
            baseline_counts[ep] = len(ctx.captured_queries)

        # Grow rows across every table (+15 schools, +15 students, +15 products/variants, +15 orders, +15 users)
        cat = Category.objects.first()
        for i in range(15):
            sch = School.objects.create(
                city=self.surat,
                name=f"Scale Test School {i}",
                code=f"SCALE-SCH-{i:03d}",
                active=True,
            )
            u = User.objects.create_user(
                username=f"scale_parent_{i}",
                password="Password@123",
                role=User.Role.PARENT,
                city=self.surat,
                school=sch,
                phone=f"9700000{i:03d}",
            )
            st = Student.objects.create(
                name=f"Scale Student {i}",
                gr_number=f"GR-SCALE-{i:03d}",
                class_name="6",
                section="A",
                gender=Student.Gender.MALE,
                school=sch,
                city=self.surat,
                parent=u,
            )
            prod = Product.objects.create(
                category=cat,
                school=sch,
                city=self.surat,
                name=f"Scale Product {i}",
                cost_price=Decimal("100.00"),
                selling_price=Decimal("200.00"),
                active=True,
            )
            var = ProductVariant.objects.create(
                product=prod,
                school=sch,
                city=self.surat,
                size="M",
                sku=f"SCALE-SKU-{i:03d}",
                stock_quantity=100,
            )
            ord_obj = Order.objects.create(
                order_number=f"ORD-SCALE-{i:05d}",
                placed_by=u,
                placed_by_role=User.Role.PARENT,
                student=st,
                parent=u,
                school=sch,
                city=self.surat,
                status=Order.Status.CONFIRMED,
                payment_status=Order.PaymentStatus.PAID,
                subtotal=Decimal("200.00"),
                total=Decimal("200.00"),
            )
            OrderItem.objects.create(
                order=ord_obj,
                variant=var,
                category=cat,
                quantity=1,
                unit_price_snapshot=Decimal("200.00"),
                unit_cost_snapshot=Decimal("100.00"),
            )

        for ep in endpoints:
            with CaptureQueriesContext(connection) as ctx:
                res = client.get(ep)
                self.assertEqual(res.status_code, 200)
            grown_count = len(ctx.captured_queries)
            self.assertEqual(
                grown_count,
                baseline_counts[ep],
                f"N+1 detected on {ep}: query count grew from {baseline_counts[ep]} to {grown_count}",
            )
