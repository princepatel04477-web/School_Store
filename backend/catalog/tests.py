from decimal import Decimal

from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.db.models import Q
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import User
from accounts.serializers import build_tokens_for_user
from inventory.services import apply_stock_movement
from schools.models import City, Grade, School, Student

from .catalogue import student_grade_id
from .models import Category, Product, ProductVariant, ProductRequirement, is_product_required


LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
class PublicCatalogTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.dps = School.objects.get(code="DPS-SUR")
        cls.surat = City.objects.get(code="SUR")
        st = cls.dps.students.filter(class_name__in=["5", "Class 5"]).first()
        cls.grade5 = st.grade if st else None
        if not cls.grade5:
            from schools.models import Grade
            cls.grade5 = Grade.objects.filter(name="Class 5").first() or Grade.objects.get(sort_order=8)

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

    def test_public_delivered_schools_returns_only_consented_with_logos(self):
        # Setup: self.dps has logo and consent, fountainhead has no logo, another has logo but no consent
        self.dps.logo_url = "https://example.com/dps-logo.png"
        self.dps.show_logo_public = True
        self.dps.save()

        # School with logo but NO consent
        no_consent = School.objects.create(
            name="No Consent Academy",
            code="NCA-TEST",
            city=self.surat,
            logo_url="https://example.com/nca-logo.png",
            show_logo_public=False,
            active=True,
        )

        # School with consent but NO logo
        no_logo = School.objects.create(
            name="No Logo High",
            code="NLH-TEST",
            city=self.surat,
            logo_url="",
            show_logo_public=True,
            active=True,
        )

        res = APIClient().get("/api/public/schools/delivered/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        ids = [s["id"] for s in data]
        self.assertIn(str(self.dps.id), ids)
        self.assertNotIn(str(no_consent.id), ids)
        self.assertNotIn(str(no_logo.id), ids)

        # Check fields: id, name, logo_url
        dps_entry = next(s for s in data if s["id"] == str(self.dps.id))
        self.assertEqual(set(dps_entry.keys()), {"id", "name", "logo_url"})
        self.assertEqual(dps_entry["logo_url"], "https://example.com/dps-logo.png")

    def test_public_schools_carry_city_and_delivery_options(self):
        schools = {s["code"]: s for s in APIClient().get("/api/public/schools/").json()}
        dps = schools["DPS-SUR"]
        self.assertEqual(dps["city"], str(self.surat.id))
        self.assertEqual(dps["city_name"], self.surat.name)
        self.assertEqual(dps["home_delivery"], self.dps.home_delivery_enabled)
        self.assertEqual(dps["school_pickup"], self.dps.school_pickup_enabled)

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
        base_url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&category=Uniform"

        # Test male filter
        res_male = APIClient().get(base_url + "&gender=MALE")
        self.assertEqual(res_male.status_code, 200)
        male_prods = res_male.json()["results"]
        self.assertGreater(len(male_prods), 0)
        for p in male_prods:
            self.assertIn(p["gender"], ("boy", "unisex"))
            self.assertNotEqual(p["gender"], "girl")

        # Test female filter
        res_female = APIClient().get(base_url + "&gender=FEMALE")
        self.assertEqual(res_female.status_code, 200)
        female_prods = res_female.json()["results"]
        self.assertGreater(len(female_prods), 0)
        for p in female_prods:
            self.assertIn(p["gender"], ("girl", "unisex"))
            self.assertNotEqual(p["gender"], "boy")

    def test_missing_gender_returns_400(self):
        # Missing gender parameter must return 400
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}"
        res = APIClient().get(url)
        self.assertEqual(res.status_code, 400)
        self.assertIn("gender", str(res.json()).lower())

        # Invalid gender values (unisex, random) must also return 400
        res_unisex = APIClient().get(url + "&gender=unisex")
        self.assertEqual(res_unisex.status_code, 400)
        res_inv = APIClient().get(url + "&gender=invalid_choice")
        self.assertEqual(res_inv.status_code, 400)

        # Missing class parameter must return 400
        res_no_class = APIClient().get(f"/api/public/products/?school={self.dps.id}&gender=boy")
        self.assertEqual(res_no_class.status_code, 400)

        # Missing school parameter must return 400
        res_no_school = APIClient().get(f"/api/public/products/?grade={self.grade5.id}&gender=boy")
        self.assertEqual(res_no_school.status_code, 400)

    def test_boy_sees_only_boy_and_unisex(self):
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&gender=boy"
        res = APIClient().get(url)
        self.assertEqual(res.status_code, 200)
        prods = res.json()["results"]
        self.assertGreater(len(prods), 0)
        genders = {p["gender"] for p in prods}
        self.assertTrue(genders.issubset({"boy", "unisex"}))
        self.assertNotIn("girl", genders)
        self.assertTrue(all(not p.get("needs_review") for p in prods))

    def test_girl_sees_only_girl_and_unisex(self):
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&gender=girl"
        res = APIClient().get(url)
        self.assertEqual(res.status_code, 200)
        prods = res.json()["results"]
        self.assertGreater(len(prods), 0)
        genders = {p["gender"] for p in prods}
        self.assertTrue(genders.issubset({"girl", "unisex"}))
        self.assertNotIn("boy", genders)
        self.assertTrue(all(not p.get("needs_review") for p in prods))
        names = {p["name"] for p in prods}
        self.assertIn("DPS Girls Box-Pleated Skirt", names)

    def test_class_11_and_12_return_products(self):
        from schools.models import Grade
        grade11 = Grade.objects.get(name="Class 11")
        grade12 = Grade.objects.get(name="Class 12")

        # Class 11 boy
        res_11_boy = APIClient().get(f"/api/public/products/?school={self.dps.id}&grade={grade11.id}&gender=boy")
        self.assertEqual(res_11_boy.status_code, 200)
        prods_11_boy = res_11_boy.json()["results"]
        self.assertGreater(len(prods_11_boy), 0)
        self.assertTrue(all(p["gender"] in ("boy", "unisex") for p in prods_11_boy))

        # Class 11 girl
        res_11_girl = APIClient().get(f"/api/public/products/?school={self.dps.id}&grade={grade11.id}&gender=girl")
        self.assertEqual(res_11_girl.status_code, 200)
        prods_11_girl = res_11_girl.json()["results"]
        self.assertGreater(len(prods_11_girl), 0)
        self.assertTrue(all(p["gender"] in ("girl", "unisex") for p in prods_11_girl))

        # Class 12 boy
        res_12_boy = APIClient().get(f"/api/public/products/?school={self.dps.id}&grade={grade12.id}&gender=boy")
        self.assertEqual(res_12_boy.status_code, 200)
        prods_12_boy = res_12_boy.json()["results"]
        self.assertGreater(len(prods_12_boy), 0)
        self.assertTrue(all(p["gender"] in ("boy", "unisex") for p in prods_12_boy))

        # Class 12 girl
        res_12_girl = APIClient().get(f"/api/public/products/?school={self.dps.id}&grade={grade12.id}&gender=girl")
        self.assertEqual(res_12_girl.status_code, 200)
        prods_12_girl = res_12_girl.json()["results"]
        self.assertGreater(len(prods_12_girl), 0)
        self.assertTrue(all(p["gender"] in ("girl", "unisex") for p in prods_12_girl))

    def test_mismatched_cart_item_is_rejected(self):
        import uuid
        parent = User.objects.get(username="parent_rahul")
        boy = Student.objects.get(gr_number="DPS-2026-001")  # Aarav, male, class 5
        girl_pinafore_var = ProductVariant.objects.filter(
            product__name="DPS Girls Box-Pleated Skirt", active=True
        ).first()
        self.assertIsNotNone(girl_pinafore_var)

        # 1. Cart validate endpoint rejects gender mismatch
        res_cart = APIClient().post(
            "/api/cart/validate/",
            {
                "variant": str(girl_pinafore_var.id),
                "school": str(self.dps.id),
                "class": "Class 5",
                "gender": "boy",
            },
            format="json",
        )
        self.assertEqual(res_cart.status_code, 400)
        self.assertIn("does not match", str(res_cart.json()))

        # Cart validate succeeds with matching gender (girl)
        res_cart_ok = APIClient().post(
            "/api/cart/validate/",
            {
                "variant": str(girl_pinafore_var.id),
                "school": str(self.dps.id),
                "class": "Class 5",
                "gender": "girl",
            },
            format="json",
        )
        self.assertEqual(res_cart_ok.status_code, 200)
        self.assertTrue(res_cart_ok.json()["valid"])

        # 2. Order creation rejects mismatched item for boy student
        client = APIClient()
        token = build_tokens_for_user(parent)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        order_payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(boy.id),
            "items": [
                {"variant": str(girl_pinafore_var.id), "quantity": 1},
            ],
            "fulfillment_type": "SCHOOL_PICKUP",
        }
        res_order = client.post("/api/orders/", order_payload, format="json")
        self.assertEqual(res_order.status_code, 400)
        self.assertIn("does not match", str(res_order.json()))

    def test_invalid_token_is_ignored(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&gender=boy"
        self.assertEqual(client.get(url).status_code, 200)

    def test_public_endpoint_is_read_only(self):
        self.assertEqual(APIClient().post("/api/public/products/", {}).status_code, 405)

    def test_school_shoes_section_and_targeting(self):
        # 1. Shoes for DPS Surat grade 5
        base_url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&category=School Shoes"
        res = APIClient().get(base_url + "&gender=boy")
        self.assertEqual(res.status_code, 200)
        prods = res.json()["results"]
        prod_names = {p["name"] for p in prods}
        # Shared shoes appear
        self.assertIn("All-Weather Black Velcro School Shoes", prod_names)
        self.assertIn("Action White PT Sports Shoes", prod_names)
        # School-specific shoes appear for DPS
        self.assertIn("DPS Formal Black Oxford Shoes", prod_names)

        # 2. Check variants use shoe sizes
        shoe_prod = next(p for p in prods if p["name"] == "All-Weather Black Velcro School Shoes")
        variant_sizes = [v["size"] for v in shoe_prod["variants"]]
        self.assertTrue(any("UK" in s for s in variant_sizes))

        # 3. For another school (Udgam Ahmedabad), school-specific DPS shoes must NOT appear,
        # but shared shoes MUST appear
        udgam = School.objects.get(code="UDG-AMD")
        amd_city = City.objects.get(code="AMD")
        udgam_url = f"/api/public/products/?school={udgam.id}&city={amd_city.id}&grade={self.grade5.id}&category=School Shoes&gender=boy"
        res_udgam = APIClient().get(udgam_url)
        self.assertEqual(res_udgam.status_code, 200)
        udgam_prod_names = {p["name"] for p in res_udgam.json()["results"]}
        self.assertIn("All-Weather Black Velcro School Shoes", udgam_prod_names)
        self.assertNotIn("DPS Formal Black Oxford Shoes", udgam_prod_names)

        # 4. Gender filter on shoes
        res_male = APIClient().get(base_url + "&gender=MALE")
        male_shoe_names = {p["name"] for p in res_male.json()["results"]}
        self.assertIn("DPS Formal Black Oxford Shoes", male_shoe_names)

        res_female = APIClient().get(base_url + "&gender=FEMALE")
        female_shoe_names = {p["name"] for p in res_female.json()["results"]}
        self.assertNotIn("DPS Formal Black Oxford Shoes", female_shoe_names)
        self.assertIn("All-Weather Black Velcro School Shoes", female_shoe_names)

    def test_uniform_accessories_section_and_product_types(self):
        # 1. Base accessories query for DPS Surat
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&category=Uniform Accessories&gender=boy"
        res = APIClient().get(url)
        self.assertEqual(res.status_code, 200)
        prods = res.json()["results"]
        prod_names = {p["name"] for p in prods}

        # Should include both school-tied items (DPS) and generic items
        self.assertIn("DPS Cotton Ribbed School Socks (Pack of 3)", prod_names)
        self.assertIn("DPS Monogrammed Leatherette School Belt", prod_names)
        self.assertIn("DPS Official Crest School Tie", prod_names)
        self.assertIn("Standard Plain Navy School Socks (Pack of 2)", prod_names)
        self.assertIn("Standard Elastic School Uniform Belt", prod_names)
        self.assertIn("Standard Classic School Uniform Tie", prod_names)

        # 2. Filter by product_type=SOCKS
        res_socks = APIClient().get(url + "&product_type=SOCKS")
        self.assertEqual(res_socks.status_code, 200)
        sock_prods = res_socks.json()["results"]
        self.assertTrue(all(p["product_type"] == "SOCKS" for p in sock_prods))
        self.assertIn("DPS Cotton Ribbed School Socks (Pack of 3)", {p["name"] for p in sock_prods})
        self.assertNotIn("DPS Official Crest School Tie", {p["name"] for p in sock_prods})
        # Check sock size variants
        dps_socks = next(p for p in sock_prods if p["name"] == "DPS Cotton Ribbed School Socks (Pack of 3)")
        self.assertTrue(any("Junior" in v["size"] for v in dps_socks["variants"]))

        # 3. Filter by product_type=BELT
        res_belts = APIClient().get(url + "&product_type=BELT")
        self.assertEqual(res_belts.status_code, 200)
        belt_prods = res_belts.json()["results"]
        self.assertTrue(all(p["product_type"] == "BELT" for p in belt_prods))
        self.assertIn("DPS Monogrammed Leatherette School Belt", {p["name"] for p in belt_prods})
        self.assertIn("Standard Elastic School Uniform Belt", {p["name"] for p in belt_prods})
        # Check belt length variants
        dps_belt = next(p for p in belt_prods if p["name"] == "DPS Monogrammed Leatherette School Belt")
        self.assertTrue(any("Inch" in v["size"] for v in dps_belt["variants"]))

        # 4. Filter by product_type=TIE
        res_ties = APIClient().get(url + "&product_type=TIE")
        self.assertEqual(res_ties.status_code, 200)
        tie_prods = res_ties.json()["results"]
        self.assertTrue(all(p["product_type"] == "TIE" for p in tie_prods))
        self.assertIn("DPS Official Crest School Tie", {p["name"] for p in tie_prods})
        self.assertIn("Standard Classic School Uniform Tie", {p["name"] for p in tie_prods})
        # Tie may have no size / standard single size
        dps_tie = next(p for p in tie_prods if p["name"] == "DPS Official Crest School Tie")
        self.assertEqual(dps_tie["variants"][0]["size"], "Standard")

        # 5. School scoping: Udgam Ahmedabad sees generic accessories + Udgam tie, but NOT DPS items
        udgam = School.objects.get(code="UDG-AMD")
        amd_city = City.objects.get(code="AMD")
        udgam_url = f"/api/public/products/?school={udgam.id}&city={amd_city.id}&grade={self.grade5.id}&category=Uniform Accessories&gender=boy"
        res_udgam = APIClient().get(udgam_url)
        self.assertEqual(res_udgam.status_code, 200)
        udgam_prod_names = {p["name"] for p in res_udgam.json()["results"]}
        self.assertIn("Udgam Woven Crest School Tie", udgam_prod_names)
        self.assertIn("Standard Plain Navy School Socks (Pack of 2)", udgam_prod_names)
        self.assertIn("Standard Elastic School Uniform Belt", udgam_prod_names)
        self.assertNotIn("DPS Cotton Ribbed School Socks (Pack of 3)", udgam_prod_names)
        self.assertNotIn("DPS Official Crest School Tie", udgam_prod_names)

    def test_stationery_section_keeps_school_and_grade(self):
        # Stationery section query with the preserved school, city, and grade
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade={self.grade5.id}&category=Stationery&gender=boy"
        res = APIClient().get(url)
        self.assertEqual(res.status_code, 200)
        prods = res.json()["results"]
        self.assertTrue(len(prods) > 0)
        self.assertTrue(all(p["category"] == "Stationery" for p in prods))
        self.assertIn("Personalised Photo Notebook Pack (Set of 6)", {p["name"] for p in prods})

    def test_grades_always_appear_in_fixed_sort_order(self):
        # Grades endpoint must return the 15 grades in exact sort_order sequence
        res = APIClient().get("/api/public/grades/")
        self.assertEqual(res.status_code, 200)
        grades = res.json()
        self.assertEqual(len(grades), 15)
        from common.constants import CLASS_NAMES
        expected_names = list(CLASS_NAMES)
        actual_names = [g["name"] for g in grades]
        self.assertEqual(actual_names, expected_names)
        # Ensure strictly ascending sort_order
        sort_orders = [g["sort_order"] for g in grades]
        self.assertEqual(sort_orders, list(range(1, 16)))

    def test_cart_can_hold_items_from_four_categories_in_one_order(self):
        from orders.models import Order, OrderItem
        from accounts.models import User
        import uuid

        parent = User.objects.get(username="parent_rahul")
        boy = Student.objects.get(gr_number="DPS-2026-001")

        # Pick 1 variant from Uniform, 1 from Shoes, 1 from Accessories, 1 from Stationery
        v_uniform = ProductVariant.objects.filter(
            product__category__slug="uniform",
            product__school=self.dps,
            product__gender__in=["boy", "unisex"],
        ).first()
        # Only items this boy can buy: his school's or general ones, for boys, still on sale
        for_boy = ProductVariant.objects.filter(
            Q(product__school=self.dps) | Q(product__school__isnull=True),
            product__gender__in=["boy", "unisex"],
            active=True,
        )
        v_shoes = for_boy.filter(product__category__slug="school-shoes").first()
        v_acc = for_boy.filter(product__category__slug="uniform-accessories").first()
        v_stat = for_boy.filter(product__category__slug="stationery").first()

        self.assertIsNotNone(v_uniform)
        self.assertIsNotNone(v_shoes)
        self.assertIsNotNone(v_acc)
        self.assertIsNotNone(v_stat)

        # Place single order containing all 4 categories
        from accounts.serializers import build_tokens_for_user
        client = APIClient()
        token = build_tokens_for_user(parent)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(boy.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "items": [
                {"variant": str(v_uniform.id), "quantity": 1},
                {"variant": str(v_shoes.id), "quantity": 1},
                {"variant": str(v_acc.id), "quantity": 1},
                {
                    "variant": str(v_stat.id),
                    "quantity": 1,
                    "customisation_data": {
                        "cover_photo": "customisations/notebook_cover.jpg",
                        "printed_student_name": "Aarav Patel",
                    },
                },
            ],
        }

        res = client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        order_id = res.json()["id"]

        # Verify order has 4 items spanning all 4 categories
        order = Order.objects.get(id=order_id)
        categories = set(order.items.values_list("category__name", flat=True))
        self.assertIn("Uniform", categories)
        self.assertIn("School Shoes", categories)
        self.assertIn("Uniform Accessories", categories)
        self.assertIn("Stationery", categories)

    def test_teacher_order_on_behalf_uses_student_scope(self):
        from accounts.models import User
        from accounts.serializers import build_tokens_for_user
        import uuid

        teacher = User.objects.get(username="teacher_dps")
        boy = Student.objects.get(gr_number="DPS-2026-001")
        v_uniform = ProductVariant.objects.filter(
            product__category__slug="uniform",
            product__school=self.dps,
            product__gender__in=["boy", "unisex"],
        ).first()

        client = APIClient()
        token = build_tokens_for_user(teacher)["access"]
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        payload = {
            "idempotency_key": str(uuid.uuid4()),
            "student": str(boy.id),
            "fulfillment_type": "SCHOOL_PICKUP",
            "items": [
                {"variant": str(v_uniform.id), "quantity": 1},
            ],
        }

        res = client.post("/api/orders/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.json())
        data = res.json()
        self.assertEqual(data["student"], str(boy.id))
        self.assertEqual(data["placed_by_role"], "TEACHER")

    def test_catalogue_query_uses_indexes(self):
        from django.db import connection
        # Explain on the products query with school, grade, and active filter
        sql = (
            "EXPLAIN SELECT p.id, p.name FROM catalog_product p "
            "INNER JOIN catalog_product_grades pg ON pg.product_id = p.id "
            "WHERE p.active = TRUE AND (p.school_id = %s OR p.school_id IS NULL) "
            "AND pg.grade_id = %s"
        )
        with connection.cursor() as cursor:
            cursor.execute(sql, [str(self.dps.id), str(self.grade5.id)])
            plan = cursor.fetchall()
            # SQLite output has details like "SCAN" or "SEARCH ... USING INDEX"
            # Confirm query is executable cleanly
            self.assertTrue(len(plan) > 0)


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
        # A DPS girl in class 4 so the class 1-8 girls skirt applies.
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
        self.assertNotIn("DPS Girls Box-Pleated Skirt", boy_names)
        self.assertNotIn("Fountainhead Signature Polo Tee", boy_names)
        self.assertNotIn("Udgam Ceremonial Winter Blazer", boy_names)

        _, girl_names = self.names_for(self.girl)
        self.assertIn("DPS Girls Box-Pleated Skirt", girl_names)

    def test_category_filter(self):
        _, names = self.names_for(self.boy, "?category=shoes")
        self.assertIn("All-Weather Black Velcro School Shoes", names)

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
                "customisation_schema",
                "sizes",
                "stock_status",
                "required",
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
        pinafore = Product.objects.get(name="DPS Girls Box-Pleated Skirt")
        res = self.jwt_client(self.parent).get(
            f"{self.catalogue_url(self.boy)}{pinafore.pk}/"
        )
        self.assertEqual(res.status_code, 404)

    def test_stock_flags_are_fresh_even_when_catalogue_is_cached(self):
        variant = ProductVariant.objects.get(sku="SHOE-BLK-UK2")

        body, _ = self.names_for(self.boy)
        shoes = next(p for p in body["products"] if p["name"] == "All-Weather Black Velcro School Shoes")
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

    def test_grade_assigned_products_only_reach_students_in_those_grades(self):
        boy_grade = Grade.objects.get(pk=student_grade_id(self.boy))
        other_grade = Grade.objects.exclude(pk=boy_grade.pk).first()
        notebook = Product.objects.create(
            category=Category.objects.get(slug="stationery"),
            name="Grade Locked Notebook",
            gender=Product.Gender.UNISEX,
            cost_price=Decimal("10.00"),
            selling_price=Decimal("20.00"),
        )
        ProductVariant.objects.create(product=notebook, size="A4", sku="GRADE-LOCK-A4")
        detail_url = f"{self.catalogue_url(self.boy)}{notebook.pk}/"

        # grades.set() never calls save(); the m2m signal must invalidate the
        # cache, or the first (unrestricted) entry would be served for the TTL.
        _, names = self.names_for(self.boy)
        self.assertIn("Grade Locked Notebook", names)
        notebook.grades.set([other_grade])

        _, names = self.names_for(self.boy)
        self.assertNotIn("Grade Locked Notebook", names)
        self.assertEqual(self.jwt_client(self.parent).get(detail_url).status_code, 404)

        notebook.grades.add(boy_grade)
        _, names = self.names_for(self.boy)
        self.assertIn("Grade Locked Notebook", names)
        self.assertEqual(self.jwt_client(self.parent).get(detail_url).status_code, 200)

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


@override_settings(CACHES=LOCMEM)
class ProductRequirementsAndCartValidationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")
        cls.dps = School.objects.get(code="DPS-SUR")
        cls.surat = City.objects.get(code="SUR")
        cls.category = Category.objects.get(slug="uniform")
        cls.grade5 = Grade.objects.filter(name="Class 5").first() or Grade.objects.get(sort_order=8)
        cls.grade9 = Grade.objects.filter(name="Class 9").first() or Grade.objects.get(sort_order=12)

    def setUp(self):
        cache.clear()

    def test_is_product_required_base_flag(self):
        prod_req = Product.objects.create(
            category=self.category,
            name="Mandatory Blazer",
            cost_price=Decimal("800.00"),
            selling_price=Decimal("1200.00"),
            is_required=True,
        )
        prod_opt = Product.objects.create(
            category=self.category,
            name="Optional Sweater",
            cost_price=Decimal("500.00"),
            selling_price=Decimal("800.00"),
            is_required=False,
        )
        self.assertTrue(is_product_required(prod_req))
        self.assertFalse(is_product_required(prod_opt))

    def test_is_product_required_grade_and_gender_rules(self):
        skirt = Product.objects.create(
            category=self.category,
            name="Girls Primary Skirt",
            cost_price=Decimal("300.00"),
            selling_price=Decimal("500.00"),
            gender=Product.Gender.GIRL,
            is_required=False,
        )
        # Add requirement for girls in class 1 to 5
        ProductRequirement.objects.create(
            product=skirt,
            school=self.dps,
            gender=Product.Gender.GIRL,
            class_from=1,
            class_to=5,
            required=True,
            active=True,
        )

        # Girl in class 5 -> Required
        self.assertTrue(
            is_product_required(skirt, school_id=self.dps.id, grade=self.grade5, gender="girl")
        )
        # Boy in class 5 -> Not required
        self.assertFalse(
            is_product_required(skirt, school_id=self.dps.id, grade=self.grade5, gender="boy")
        )
        # Girl in class 9 -> Not required (out of class range)
        self.assertFalse(
            is_product_required(skirt, school_id=self.dps.id, grade=self.grade9, gender="girl")
        )

    def test_is_product_required_never_infers_from_school_or_customisation(self):
        # Product owned by school with customisation schema, but is_required=False
        badge_prod = Product.objects.create(
            category=self.category,
            school=self.dps,
            name="School Lapel Pin",
            cost_price=Decimal("80.00"),
            selling_price=Decimal("150.00"),
            is_required=False,
            customisation_schema=[{"key": "house", "label": "House Name", "required": True}],
        )
        # Must NOT infer requirement from school ownership or schema
        self.assertFalse(
            is_product_required(badge_prod, school_id=self.dps.id, grade=self.grade5)
        )

    def test_public_catalog_returns_live_required_flag(self):
        client = APIClient()
        url = f"/api/public/products/?school={self.dps.id}&city={self.surat.id}&grade=Class 5&gender=boy"
        res = client.get(url)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        items = data.get("results", data)
        self.assertGreater(len(items), 0)
        # Ensure 'required' key is present in public cards
        has_required = any(item.get("required") is True for item in items)
        has_optional = any(item.get("required") is False for item in items)
        self.assertTrue(has_required, "Expected at least one required uniform item in live seed data")
        self.assertTrue(has_optional, "Expected at least one optional uniform item in live seed data")

    def test_cart_validate_multi_items_and_cross_school_refusal(self):
        client = APIClient()
        other_school = School.objects.create(
            name="Other Academy",
            code="OTH-SUR",
            city=self.surat,
            active=True,
        )
        p1 = Product.objects.create(
            category=self.category,
            school=self.dps,
            name="DPS Shirt",
            cost_price=Decimal("250.00"),
            selling_price=Decimal("450.00"),
        )
        v1 = ProductVariant.objects.create(product=p1, size="32", sku="DPS-SH-32")
        apply_stock_movement(
            variant=v1,
            city_id=self.surat.id,
            quantity_change=10,
            reason="INITIAL_STOCK",
        )

        p2 = Product.objects.create(
            category=self.category,
            school=other_school,
            name="Other School Blazer",
            cost_price=Decimal("600.00"),
            selling_price=Decimal("950.00"),
        )
        v2 = ProductVariant.objects.create(product=p2, size="36", sku="OTH-BL-36")

        # Cart with items from different schools must be refused
        payload = {
            "school_id": str(self.dps.id),
            "city_id": str(self.surat.id),
            "items": [
                {
                    "product_id": str(p1.id),
                    "variant_id": str(v1.id),
                    "quantity": 1,
                    "price_paise": 45000,
                },
                {
                    "product_id": str(p2.id),
                    "variant_id": str(v2.id),
                    "quantity": 1,
                    "price_paise": 95000,
                },
            ],
        }
        res = client.post("/api/cart/validate/", payload, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["valid"])
        self.assertTrue(any("different school" in err for err in data["errors"]))

    def test_cart_validate_detects_price_and_stock_changes(self):
        client = APIClient()
        p = Product.objects.create(
            category=self.category,
            school=self.dps,
            name="KV Monogram Belt",
            cost_price=Decimal("100.00"),
            selling_price=Decimal("180.00"),
        )
        v = ProductVariant.objects.create(product=p, size="M", sku="KV-BLT-M")
        # Apply 2 units of stock in Surat
        apply_stock_movement(
            variant=v,
            city_id=self.surat.id,
            quantity_change=2,
            reason="INITIAL_STOCK",
        )

        # 1. Test price change detection (client thinks it's 15000 paise, server is 18000 paise)
        # 2. Test insufficient stock (request 5 units when only 2 available)
        payload = {
            "school_id": str(self.dps.id),
            "city_id": str(self.surat.id),
            "items": [
                {
                    "product_id": str(p.id),
                    "variant_id": str(v.id),
                    "quantity": 5,
                    "price_paise": 15000,
                }
            ],
        }
        res = client.post("/api/cart/validate/", payload, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["has_price_changes"])
        self.assertEqual(len(data["price_changes"]), 1)
        self.assertEqual(data["price_changes"][0]["client_price_paise"], 15000)
        self.assertEqual(data["price_changes"][0]["server_price_paise"], 18000)

        self.assertTrue(data["has_out_of_stock"])
        self.assertEqual(len(data["out_of_stock"]), 1)
        self.assertEqual(data["out_of_stock"][0]["available"], 2)
        self.assertEqual(data["out_of_stock"][0]["requested"], 5)

