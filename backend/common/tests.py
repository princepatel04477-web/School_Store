import uuid
from django.contrib import admin
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import User
from analytics.models import DailySalesSummary
from catalog.models import Category, Product, ProductVariant
from inventory.models import StockBalance, StockMovement
from common.cache_utils import (
    CATALOG_CACHE_VERSION_KEY,
    SCHOOL_LIST_CACHE_VERSION_KEY,
    get_cache_version,
)
from orders.models import Order, OrderItem, OrderStatusEvent
from schools.models import City, School, Student


class FoundationAndDataModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_data")

    def test_all_models_use_uuid_v4_primary_keys(self):
        models_to_check = [
            City,
            School,
            User,
            Student,
            Category,
            Product,
            ProductVariant,
            StockBalance,
            Order,
            OrderItem,
            OrderStatusEvent,
            StockMovement,
            DailySalesSummary,
        ]
        for model in models_to_check:
            obj = model.objects.first()
            self.assertIsNotNone(obj, f"{model.__name__} should have seeded instance")
            self.assertIsInstance(obj.pk, uuid.UUID)
            self.assertEqual(obj.pk.version, 4)

    def test_all_models_registered_in_django_admin(self):
        models_to_check = [
            City,
            School,
            User,
            Student,
            Category,
            Product,
            ProductVariant,
            StockBalance,
            Order,
            OrderItem,
            OrderStatusEvent,
            StockMovement,
            DailySalesSummary,
        ]
        for model in models_to_check:
            self.assertIn(
                model,
                admin.site._registry,
                f"{model.__name__} must be registered in Django Admin",
            )

    def test_seed_command_creates_expected_baseline(self):
        self.assertEqual(City.objects.count(), 2)
        self.assertEqual(School.objects.count(), 3)
        self.assertEqual(Category.objects.count(), 4)
        self.assertTrue(Product.objects.count() >= 6)
        self.assertTrue(ProductVariant.objects.count() >= 15)

        roles_present = set(User.objects.values_list("role", flat=True))
        expected_roles = {
            User.Role.BOSS,
            User.Role.ADMIN,
            User.Role.SCHOOL_ADMIN,
            User.Role.TEACHER,
            User.Role.PARENT,
        }
        self.assertTrue(expected_roles.issubset(roles_present))

    def test_composite_indexes_present_in_database(self):
        expected_indexes = {
            "idx_order_school_created",
            "idx_order_city_created",
            "idx_order_student_created",
            "idx_order_parent_created",
            "idx_order_status_created",
            "uniq_student_school_gr",
            "idx_student_school_cls_sec",
            "idx_student_parent",
            "idx_variant_product",
            "idx_prod_school_cat_active",
            "idx_prod_city_cat_active",
            "idx_prod_cat_active",
            "idx_product_active_id",
            "idx_invmov_variant_created",
            "idx_invmov_city_created",
            "idx_invmov_school_created",
            "uniq_stockbalance_city_variant",
            "idx_stockbalance_city_qty",
            "idx_stockbalance_city_updated",
            # Partial index backing the low-stock list (index lookup, no scan)
            "idx_stockbalance_low",
            "idx_order_placer_created",
            "idx_order_payer_created",
            "uniq_dailysales_date_sch_cat",
            "idx_dailysales_date_city",
        }
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indexname FROM pg_indexes WHERE schemaname = 'public';"
            )
            actual_indexes = {row[0] for row in cursor.fetchall()}

        missing = expected_indexes - actual_indexes
        self.assertEqual(missing, set(), f"Missing composite indexes: {missing}")

    def test_jwt_authentication_access_and_refresh_flow(self):
        client = APIClient()
        token_url = reverse("token_obtain_pair")
        refresh_url = reverse("token_refresh")
        me_url = reverse("auth_me")

        res = client.post(
            token_url,
            {"username": "boss", "password": "Password@123"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)
        self.assertEqual(res.data["user"]["role"], "BOSS")

        client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        me_res = client.get(me_url)
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.data["username"], "boss")

        ref_res = client.post(
            refresh_url,
            {"refresh": res.data["refresh"]},
            format="json",
        )
        self.assertEqual(ref_res.status_code, 200)
        self.assertIn("access", ref_res.data)

    def test_redis_cache_invalidation_on_school_and_catalog_updates(self):
        v_cat_before = get_cache_version(CATALOG_CACHE_VERSION_KEY)
        prod = Product.objects.first()
        prod.save()
        v_cat_after = get_cache_version(CATALOG_CACHE_VERSION_KEY)
        self.assertGreater(v_cat_after, v_cat_before)

        v_sch_before = get_cache_version(SCHOOL_LIST_CACHE_VERSION_KEY)
        sch = School.objects.first()
        sch.save()
        v_sch_after = get_cache_version(SCHOOL_LIST_CACHE_VERSION_KEY)
        self.assertGreater(v_sch_after, v_sch_before)

    def test_perf_orders_generator_command(self):
        call_command("seed_perf_orders", count=100, reset=True)
        self.assertGreaterEqual(
            Order.objects.filter(order_number__startswith="ORD-PERF-").count(),
            100,
        )
