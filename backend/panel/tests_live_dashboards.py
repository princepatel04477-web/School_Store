"""
Dashboards draw from live rollups on every database, with one point per day.

Before this, the rollup engine skipped every database but Postgres (so local
copies showed zeros), the trend endpoints returned only days that had sales
(two sales drew one straight line), and the teacher home showed fixed numbers.
"""

import datetime as dt
from datetime import timedelta
from decimal import Decimal

from django.test import SimpleTestCase
from django.utils import timezone

from accounts.models import User
from analytics.series import fill_series, pick_bucket

from .tests import PanelTestBase, login


class SeriesTests(SimpleTestCase):
    def test_quiet_days_are_zero_points_not_gaps(self):
        start = dt.date(2026, 11, 1)
        rows = [
            {"date": dt.date(2026, 11, 2), "orders": 3},
            {"date": dt.date(2026, 11, 5), "orders": 1},
        ]
        bucket, points = fill_series(rows, start, dt.date(2026, 11, 7), {"orders": 0})
        self.assertEqual(bucket, "day")
        self.assertEqual([p["orders"] for p in points], [0, 3, 0, 0, 1, 0, 0])

    def test_long_ranges_group_into_weeks_then_months(self):
        start = dt.date(2026, 1, 1)
        self.assertEqual(pick_bucket(start, start + timedelta(days=91)), "day")
        self.assertEqual(pick_bucket(start, start + timedelta(days=200)), "week")
        self.assertEqual(pick_bucket(start, start + timedelta(days=600)), "month")

        rows = [
            {"date": dt.date(2026, 1, 5), "orders": 2},
            {"date": dt.date(2026, 1, 20), "orders": 4},
            {"date": dt.date(2026, 3, 1), "orders": 1},
        ]
        _, months = fill_series(rows, start, dt.date(2026, 3, 31), {"orders": 0}, bucket="month")
        self.assertEqual([(p["date"].month, p["orders"]) for p in months], [(1, 6), (2, 0), (3, 1)])

    def test_first_bucket_never_starts_before_the_range(self):
        # 2026-11-04 is a Wednesday; its week starts on Monday the 2nd.
        _, weeks = fill_series([], dt.date(2026, 11, 4), dt.date(2026, 11, 20), {"orders": 0}, bucket="week")
        self.assertEqual(weeks[0]["date"], dt.date(2026, 11, 4))
        self.assertEqual(weeks[1]["date"], dt.date(2026, 11, 9))


class LiveDashboardTests(PanelTestBase):
    def setUp(self):
        self.today = timezone.localdate()
        self.make_order(quantity=2, days_ago=1)
        self.make_order(quantity=3, days_ago=4, role="TEACHER")
        self.rollup()

    def range(self, days):
        return {
            "date_from": (self.today - timedelta(days=days - 1)).isoformat(),
            "date_to": self.today.isoformat(),
        }

    def test_school_dashboard_reads_real_orders_on_any_database(self):
        payload = login(self.admin).get("/api/panel/dashboard/", self.range(7)).json()
        self.assertEqual(payload["totals"]["orders"], 2)
        self.assertEqual(payload["totals"]["units"], 5)
        self.assertEqual(Decimal(payload["totals"]["gross_sales"]), Decimal("250.00"))

    def test_school_daily_chart_has_a_point_for_every_day(self):
        daily = login(self.admin).get("/api/panel/dashboard/", self.range(7)).json()["daily"]
        self.assertEqual(len(daily), 7)
        self.assertEqual(daily[-1]["date"], self.today.isoformat())
        self.assertEqual({d["bucket"] for d in daily}, {"day"})
        sales = [Decimal(d["gross_sales"]) for d in daily]
        self.assertEqual(sales.count(Decimal("0.00")), 5)
        self.assertEqual(sum(sales), Decimal("250.00"))

    def test_boss_trend_is_continuous_with_profit_per_day(self):
        boss = User.objects.get(username="boss")
        points = login(boss).get("/api/panel/boss/charts/revenue-profit/", self.range(10)).json()
        self.assertEqual(len(points), 10)
        by_date = {p["date"]: p for p in points}
        yesterday = by_date[(self.today - timedelta(days=1)).isoformat()]
        self.assertEqual(Decimal(yesterday["revenue"]), Decimal("100.00"))
        self.assertEqual(Decimal(yesterday["profit"]), Decimal("40.00"))
        self.assertEqual(Decimal(by_date[self.today.isoformat()]["revenue"]), Decimal("0.00"))

    def test_boss_kpis_compare_with_the_period_before(self):
        boss = User.objects.get(username="boss")
        kpis = login(boss).get("/api/panel/boss/kpis/", self.range(3)).json()
        # Only the order from yesterday is inside the last 3 days; the one from
        # 4 days ago is in the 3 days before that.
        self.assertEqual(kpis["orders"], 1)
        self.assertEqual(kpis["previous"]["orders"], 1)
        self.assertEqual(Decimal(kpis["previous"]["revenue"]), Decimal("150.00"))
        self.assertEqual(Decimal(kpis["average_order_value"]), Decimal("100.00"))

    def test_city_daily_sales_carries_a_30_day_trend(self):
        boss = User.objects.get(username="boss")
        payload = login(boss).get(
            "/api/panel/city-daily-sales/", {"city": str(self.school.city_id)}
        ).json()
        self.assertEqual(len(payload["trend"]), 30)
        self.assertEqual(payload["trend"][-1]["date"], self.today.isoformat())
        self.assertEqual(sum(p["orders"] for p in payload["trend"]), 2)

    def test_teacher_home_shows_real_counts(self):
        response = login(self.teacher).get("/api/panel/teacher-summary/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["school"]["code"], "DPS-SUR")
        self.assertEqual(
            payload["students"]["total"], self.school.students.count()
        )
        self.assertEqual(len(payload["trend"]), 30)
        self.assertEqual(sum(p["orders"] for p in payload["trend"]), 2)

    def test_seed_and_load_test_orders_never_reach_a_dashboard(self):
        from orders.models import Order

        for prefix in ("ORD-SEED-", "ORD-PERF-", "DEMO"):
            sample = self.make_order(quantity=9, days_ago=1)
            Order.objects.filter(pk=sample.pk).update(order_number=f"{prefix}{sample.pk.hex[:8]}")
        self.rollup()

        school = login(self.admin).get("/api/panel/dashboard/", self.range(7)).json()
        self.assertEqual(school["totals"]["orders"], 2)
        self.assertEqual(school["totals"]["units"], 5)

        boss = login(User.objects.get(username="boss"))
        self.assertEqual(boss.get("/api/panel/boss/kpis/", self.range(7)).json()["orders"], 2)
        products = boss.get("/api/panel/boss/charts/top-products/", self.range(7)).json()
        self.assertEqual(sum(p["units"] for p in products), 5)

    def test_parents_cannot_read_the_teacher_summary(self):
        self.assertEqual(login(self.parent).get("/api/panel/teacher-summary/").status_code, 403)
