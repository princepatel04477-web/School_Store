"""
Boss panel tests.

Covers the prompt-9 requirements:
  1  KPI cards (revenue, cost, profit, margin %, orders, units, stock value)
  2  the six charts
  3  every card/chart respects the city/school/category/date filters
  4  profit = sum of (price - cost) x quantity; margin = profit / revenue
  5  everything reads the rollups (no orders / order items on the read path)
  6  one KPI endpoint + one endpoint per chart, cached in Redis for 60s
  7  stock value = SUM(stock x cost), cached separately
  8  Admin management (create Admins, assign cities)
"""

from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import User
from analytics.models import DailyProductSummary, DailySalesSummary, DailySchoolTotal
from analytics.services import recompute_recent_days, refresh_sales_summary
from analytics.tasks import recompute_recent_days_task
from catalog.models import Category, ProductVariant
from inventory.models import StockBalance
from orders.models import Order, OrderItem
from panel.tests import PanelTestBase, login
from schools.models import City, School

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(CACHES=LOCMEM)
class BossDashboardBase(PanelTestBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        # PanelTestBase predates the product rollup; clear it too so every
        # assertion counts only the orders each test creates.
        DailyProductSummary.objects.all().delete()
        cls.boss = User.objects.get(username="boss")
        cls.city = cls.school.city
        cls.other_city = City.objects.exclude(id=cls.city.id).first()

    def setUp(self):
        cache.clear()


# --------------------------------------------------------------------------- #
# 1 + 4 + 6. KPI cards in one small response
# --------------------------------------------------------------------------- #
class KpiTests(BossDashboardBase):
    def test_kpi_cards_match_the_snapshots(self):
        # 2 orders x qty 2 @ price 50 / cost 30 -> revenue 200, cost 120.
        self.make_order(quantity=2, days_ago=1)
        self.make_order(quantity=2, days_ago=1, role="TEACHER")
        self.rollup()

        payload = login(self.boss).get("/api/boss/kpis/").json()
        self.assertEqual(Decimal(payload["revenue"]), Decimal("200.00"))
        self.assertEqual(Decimal(payload["cost"]), Decimal("120.00"))
        self.assertEqual(Decimal(payload["profit"]), Decimal("80.00"))
        self.assertEqual(Decimal(payload["margin_pct"]), Decimal("40.0"))
        self.assertEqual(payload["orders"], 2)
        self.assertEqual(payload["units"], 4)
        self.assertIn("stock_value", payload)

    def test_margin_is_zero_without_revenue(self):
        payload = login(self.boss).get("/api/boss/kpis/").json()
        self.assertEqual(Decimal(payload["margin_pct"]), Decimal("0.0"))

    def test_date_range_filter_is_respected(self):
        self.make_order(quantity=1, days_ago=20)
        self.make_order(quantity=1, days_ago=2)
        self.rollup()

        today = timezone.localdate()
        recent = login(self.boss).get(
            "/api/boss/kpis/",
            {
                "date_from": (today - timedelta(days=7)).isoformat(),
                "date_to": today.isoformat(),
            },
        ).json()
        self.assertEqual(recent["orders"], 1)
        self.assertEqual(recent["units"], 1)

    def test_invalid_dates_are_rejected(self):
        response = login(self.boss).get("/api/boss/kpis/", {"date_from": "not-a-date"})
        self.assertEqual(response.status_code, 400)

    def test_city_and_school_filters_are_respected(self):
        self.make_order(quantity=1, days_ago=1)
        other_student = self.student.__class__.objects.filter(school=self.other_school).first()
        self.make_order(student=other_student, quantity=3, days_ago=1)
        self.rollup()

        in_city = login(self.boss).get("/api/boss/kpis/", {"city": str(self.city.id)}).json()
        self.assertEqual(in_city["orders"], 2)

        at_school = login(self.boss).get("/api/boss/kpis/", {"school": str(self.school.id)}).json()
        self.assertEqual(at_school["orders"], 1)
        self.assertEqual(at_school["units"], 1)

    def test_category_filter_uses_the_category_rollup_counts(self):
        self.make_order(quantity=1, days_ago=1)
        self.rollup()
        payload = login(self.boss).get(
            "/api/boss/kpis/", {"category": str(self.category.id)}
        ).json()
        self.assertEqual(payload["orders"], 1)
        self.assertEqual(payload["units"], 1)


# --------------------------------------------------------------------------- #
# 7. Stock value
# --------------------------------------------------------------------------- #
class StockValueTests(BossDashboardBase):
    def test_stock_value_is_stock_times_cost(self):
        StockBalance.objects.all().delete()
        variant = self.variant
        cost = variant.product.cost_price
        StockBalance.objects.create(city=self.city, variant=variant, stock_quantity=5)
        cache.clear()

        payload = login(self.boss).get("/api/boss/kpis/").json()
        self.assertEqual(Decimal(payload["stock_value"]), (cost * 5).quantize(Decimal("0.01")))

    def test_stock_value_respects_the_city_filter(self):
        StockBalance.objects.all().delete()
        StockBalance.objects.create(city=self.city, variant=self.variant, stock_quantity=4)
        if self.other_city:
            StockBalance.objects.create(
                city=self.other_city, variant=self.variant, stock_quantity=10
            )
        cache.clear()

        payload = login(self.boss).get(
            "/api/boss/kpis/", {"city": str(self.city.id)}
        ).json()
        expected = (self.variant.product.cost_price * 4).quantize(Decimal("0.01"))
        self.assertEqual(Decimal(payload["stock_value"]), expected)

    def test_stock_by_category_endpoint(self):
        StockBalance.objects.all().delete()
        StockBalance.objects.create(city=self.city, variant=self.variant, stock_quantity=7)
        cache.clear()

        payload = login(self.boss).get("/api/boss/charts/stock-by-category/").json()
        self.assertEqual(len(payload["points"]), 1)
        point = payload["points"][0]
        self.assertEqual(point["units"], 7)
        self.assertEqual(point["category"], self.category.name)


# --------------------------------------------------------------------------- #
# 2 + 3. Charts
# --------------------------------------------------------------------------- #
class ChartTests(BossDashboardBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.make_order(cls, quantity=2, days_ago=1)
        cls.make_order(cls, quantity=3, days_ago=2, role="TEACHER")
        cls.rollup(cls)

    def test_revenue_trend_has_one_point_per_day_with_profit(self):
        payload = login(self.boss).get("/api/boss/charts/revenue-trend/").json()
        points = payload["points"]
        self.assertEqual(len(points), 2)
        for point in points:
            self.assertEqual(
                Decimal(point["profit"]),
                Decimal(point["revenue"]) - Decimal(point["cost"]),
            )

    def test_category_and_city_charts(self):
        by_category = login(self.boss).get("/api/boss/charts/category-sales/").json()
        self.assertEqual(len(by_category["points"]), 1)
        self.assertEqual(by_category["points"][0]["category"], self.category.name)
        self.assertEqual(Decimal(by_category["points"][0]["revenue"]), Decimal("250.00"))

        by_city = login(self.boss).get("/api/boss/charts/city-sales/").json()
        self.assertEqual(len(by_city["points"]), 1)
        self.assertEqual(by_city["points"][0]["city"], self.city.name)

    def test_top_schools_and_top_products(self):
        top_schools = login(self.boss).get("/api/boss/charts/top-schools/").json()
        self.assertEqual(top_schools["points"][0]["school"], self.school.name)

        top_products = login(self.boss).get("/api/boss/charts/top-products/").json()
        self.assertEqual(len(top_products["points"]), 1)
        point = top_products["points"][0]
        self.assertEqual(point["units"], 5)
        self.assertEqual(point["product"], self.variant.product.name)

    def test_charts_respect_the_school_filter(self):
        payload = login(self.boss).get(
            "/api/boss/charts/revenue-trend/", {"school": str(self.other_school.id)}
        ).json()
        self.assertEqual(payload["points"], [])

    def test_top_products_come_from_the_product_rollup(self):
        self.assertTrue(
            DailyProductSummary.objects.filter(
                school=self.school, product=self.variant.product
            ).exists()
        )


# --------------------------------------------------------------------------- #
# 6. Redis caching keyed by the filters
# --------------------------------------------------------------------------- #
class CacheTests(BossDashboardBase):
    def test_response_is_cached_for_the_filter_combination(self):
        self.make_order(quantity=1, days_ago=1)
        self.rollup()
        client = login(self.boss)

        first = client.get("/api/boss/kpis/").json()
        self.assertEqual(first["orders"], 1)

        # New data arrives, but the cached answer is served until TTL expiry.
        self.make_order(quantity=1, days_ago=1, role="TEACHER")
        self.rollup()
        cached = client.get("/api/boss/kpis/").json()
        self.assertEqual(cached["orders"], 1)

        cache.clear()
        fresh = client.get("/api/boss/kpis/").json()
        self.assertEqual(fresh["orders"], 2)

    def test_different_filters_get_different_cache_entries(self):
        self.make_order(quantity=1, days_ago=1)
        self.rollup()
        client = login(self.boss)

        all_scope = client.get("/api/boss/kpis/").json()
        school_scope = client.get(
            "/api/boss/kpis/", {"school": str(self.school.id)}
        ).json()
        self.assertEqual(all_scope["orders"], 1)
        self.assertEqual(school_scope["orders"], 1)
        self.assertEqual(all_scope["filters"]["school"], None)
        self.assertEqual(school_scope["filters"]["school"], str(self.school.id))


# --------------------------------------------------------------------------- #
# Permissions + management
# --------------------------------------------------------------------------- #
class PermissionTests(BossDashboardBase):
    def test_only_the_boss_sees_the_boss_panel(self):
        for endpoint in ("/api/boss/kpis/", "/api/boss/charts/revenue-trend/"):
            self.assertEqual(login(self.boss).get(endpoint).status_code, 200)
            self.assertEqual(login(self.admin).get(endpoint).status_code, 403)
            self.assertEqual(login(self.parent).get(endpoint).status_code, 403)

    def test_filter_options_list_cities_schools_categories(self):
        payload = login(self.boss).get("/api/boss/filters/").json()
        self.assertTrue(payload["cities"])
        self.assertTrue(payload["schools"])
        self.assertTrue(payload["categories"])


class AdminManagementTests(BossDashboardBase):
    def test_boss_creates_an_admin_assigned_to_a_city(self):
        response = login(self.boss).post(
            "/api/boss/admins/",
            {
                "username": "admin_baroda",
                "password": "Password@123",
                "first_name": "Vera",
                "city": str(self.city.id),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        admin = User.objects.get(username="admin_baroda")
        self.assertEqual(admin.role, User.Role.ADMIN)
        self.assertEqual(admin.city_id, self.city.id)
        self.assertTrue(admin.check_password("Password@123"))

    def test_boss_reassigns_an_admins_city(self):
        admin = User.objects.create_user(
            username="admin_move", password="Password@123", role=User.Role.ADMIN,
            city=self.city,
        )
        response = login(self.boss).patch(
            f"/api/boss/admins/{admin.id}/",
            {"city": str(self.other_city.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        admin.refresh_from_db()
        self.assertEqual(admin.city_id, self.other_city.id)

    def test_admins_cannot_manage_admins(self):
        response = login(self.admin).post(
            "/api/boss/admins/",
            {"username": "x", "password": "Password@123", "city": str(self.city.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 403)


# --------------------------------------------------------------------------- #
# 5. Rollups stay in sync (incremental + nightly)
# --------------------------------------------------------------------------- #
class RollupSyncTests(BossDashboardBase):
    def test_product_rollup_matches_the_items(self):
        self.make_order(quantity=3, days_ago=0)
        self.rollup()
        row = DailyProductSummary.objects.get(
            date=timezone.localdate(), product=self.variant.product
        )
        self.assertEqual(row.units, 3)
        self.assertEqual(row.revenue, Decimal("150.00"))
        self.assertEqual(row.cost, Decimal("90.00"))
        self.assertEqual(row.city_id, self.school.city_id)
        self.assertEqual(row.school_id, self.school.id)

    def test_nightly_recompute_repairs_drift(self):
        self.make_order(quantity=2, days_ago=1)
        self.rollup()
        # Somebody "fixes" the rollup by hand...
        DailySalesSummary.objects.update(revenue=Decimal("0.00"))
        DailySchoolTotal.objects.update(revenue=Decimal("0.00"))
        DailyProductSummary.objects.update(revenue=Decimal("0.00"))

        result = recompute_recent_days(days=7)
        self.assertEqual(result["days"], 7)
        self.assertEqual(
            DailySchoolTotal.objects.get(school=self.school).revenue, Decimal("100.00")
        )
        self.assertEqual(
            DailyProductSummary.objects.get(product=self.variant.product).revenue,
            Decimal("100.00"),
        )

    def test_nightly_celery_task_runs(self):
        self.assertEqual(recompute_recent_days_task.apply().result["days"], 7)

    def test_cancellation_refreshes_the_rollups(self):
        order = self.make_order(quantity=2, days_ago=0)
        self.rollup()
        today = timezone.localdate()
        self.assertEqual(
            DailySchoolTotal.objects.get(school=self.school, date=today).revenue,
            Decimal("100.00"),
        )

        client = login(self.boss)
        with self.captureOnCommitCallbacks(execute=True):
            response = client.patch(
                f"/api/orders/{order.id}/", {"status": "CANCELLED"}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(
            DailySchoolTotal.objects.filter(school=self.school, date=today).exists()
        )

    def test_dashboard_reads_never_mention_the_order_tables(self):
        """The read layer only references the rollup + stock models."""
        from boss import services

        filters = services.BossFilters.from_params({})
        for qs in (
            services._sales_qs(filters),
            services._school_total_qs(filters),
            services._product_qs(filters),
        ):
            sql = str(qs.query).lower()
            self.assertNotIn("orders_order", sql)
            self.assertNotIn("orders_orderitem", sql)
