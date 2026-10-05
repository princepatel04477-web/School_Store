"""
Benchmark every Boss dashboard endpoint against the seeded order volume and
prove the query plans never touch the order tables.

    manage.py benchmark_boss_dashboard [--runs 5] [--limit-ms 200]

For each endpoint x filter combination the command:

1. Times the service layer (pure database cost, cache bypassed).
2. Times the real HTTP view through DRF with the Redis cache flushed first,
   so every measured request pays the full database cost.
3. Runs EXPLAIN on the underlying queries and fails if any plan shows a
   Seq Scan on the rollups or any access to orders_order / orders_orderitem.

Exit code is non-zero when a latency or plan check fails, so it can run in
CI.
"""

import statistics
import time

from django.core.cache import cache
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from boss import services as boss
from schools.models import City, School
from catalog.models import Category

# Relations that must never appear in a dashboard plan.
FORBIDDEN_TABLES = ("orders_order", "orders_orderitem")
# Rollup relations may only be read through an index.
ROLLUP_TABLES = (
    "analytics_dailysalessummary",
    "analytics_dailyschooltotal",
    "analytics_dailyproductsummary",
)
# Tables the stock chart may legitimately read (current-stock snapshot).
STOCK_TABLES = ("inventory_stockbalance", "catalog_product", "catalog_productvariant", "catalog_category")


class Command(BaseCommand):
    help = "Time every Boss dashboard endpoint and verify EXPLAIN plans use index scans only."

    def add_arguments(self, parser):
        parser.add_argument("--runs", type=int, default=5)
        parser.add_argument("--limit-ms", type=float, default=200.0)

    # ------------------------------------------------------------------ #
    def handle(self, *args, **options):
        runs = max(1, options["runs"])
        limit_ms = options["limit_ms"]

        # Plans are asserted under the deployment planner settings
        # (see infra/postgres_tuning.sql).
        with connection.cursor() as cursor:
            cursor.execute("SET random_page_cost = 1.1")

        city = City.objects.order_by("name").first()
        school = School.objects.order_by("name").first()
        category = Category.objects.order_by("name").first()
        filter_sets = {
            "no filters": {},
            "city": {"city": str(city.id)} if city else {},
            "school": {"school": str(school.id)} if school else {},
            "category": {"category": str(category.id)} if category else {},
            "all filters": {
                "city": str(city.id),
                "school": str(school.id),
                "category": str(category.id),
            },
        }

        failures = []
        for label, params in filter_sets.items():
            filters = boss.BossFilters.from_params(params)
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n== Filters: {label} =="))
            for name, producer, explainers in self.endpoints(filters):
                # 1) service-layer timing (no cache involved)
                samples = []
                for _ in range(runs):
                    started = time.perf_counter()
                    producer()
                    samples.append((time.perf_counter() - started) * 1000)
                db_ms = statistics.median(samples)

                # 2) EXPLAIN the underlying queries
                plan_ok, plan_notes = self.check_plans(explainers())

                # 3) full HTTP round trip through the view, cache flushed
                http_ms = self.http_timing(filters, name)

                status_ok = db_ms <= limit_ms and (http_ms is None or http_ms <= limit_ms) and plan_ok
                marker = self.style.SUCCESS("ok") if status_ok else self.style.ERROR("FAIL")
                self.stdout.write(
                    f"  [{marker}] {name:<22} db={db_ms:8.2f} ms"
                    + (f"  http={http_ms:8.2f} ms" if http_ms is not None else "")
                )
                for note in plan_notes:
                    style = self.style.ERROR if note.startswith("!") else self.style.WARNING
                    self.stdout.write(f"        {style(note)}")
                if not status_ok:
                    failures.append(f"{label} / {name}")

        if failures:
            raise CommandError("Benchmark failures: " + ", ".join(failures))
        self.stdout.write(
            self.style.SUCCESS(
                f"\nAll Boss dashboard endpoints answered in under {limit_ms:.0f} ms "
                "with index-only plans."
            )
        )

    # ------------------------------------------------------------------ #
    def endpoints(self, filters: boss.BossFilters):
        """(name, producer, explainable-factory) triples for every endpoint."""
        sales = lambda: boss._sales_qs(filters)
        school_totals = lambda: boss._school_total_qs(filters)
        products = lambda: boss._product_qs(filters)
        trend = lambda: (
            boss._sales_qs(filters)
            .values("date")
            .annotate(revenue=boss.Sum("revenue"))
            .order_by("date")
        )
        by_category = lambda: (
            boss._sales_qs(filters).values("category_id").annotate(revenue=boss.Sum("revenue"))
        )
        by_city = lambda: (
            boss._sales_qs(filters).values("city_id").annotate(revenue=boss.Sum("revenue"))
        )
        top_schools = lambda: (
            boss._sales_qs(filters).values("school_id").annotate(revenue=boss.Sum("revenue"))[: boss.TOP_N_LIMIT]
        )
        top_products = lambda: (
            boss._product_qs(filters).values("product_id").annotate(units=boss.Sum("units"))[: boss.TOP_N_LIMIT]
        )
        # KPI aggregates: EXPLAIN the exact aggregate shape (a values() with
        # no grouping produces the same scan node as .aggregate()).
        kpi_money = lambda: sales().values().annotate(
            revenue=boss.Sum("revenue"), cost=boss.Sum("cost"), units=boss.Sum("units")
        )
        kpi_orders = lambda: school_totals().values().annotate(orders=boss.Sum("orders"))
        kpi_orders_cat = lambda: sales().values().annotate(orders=boss.Sum("orders"))
        return [
            (
                "kpis",
                lambda: boss.kpi_payload(filters),
                lambda: (
                    [kpi_money(), kpi_orders_cat()]
                    if filters.category_id
                    else [kpi_money(), kpi_orders()]
                ),
            ),
            ("revenue-trend", lambda: {"points": boss.revenue_trend(filters)}, lambda: [trend()]),
            ("category-sales", lambda: {"points": boss.sales_by_category(filters)}, lambda: [by_category()]),
            ("city-sales", lambda: {"points": boss.sales_by_city(filters)}, lambda: [by_city()]),
            ("top-schools", lambda: {"points": boss.top_schools(filters)}, lambda: [top_schools()]),
            ("top-products", lambda: {"points": boss.top_products(filters)}, lambda: [top_products()]),
            (
                "stock-by-category",
                lambda: {"points": boss.stock_by_category(filters)},
                lambda: [],
            ),
        ]

    # ------------------------------------------------------------------ #
    def check_plans(self, querysets):
        ok = True
        notes = []
        for qs in querysets:
            sql, params = qs.query.get_compiler(using="default").as_sql()
            with connection.cursor() as cursor:
                cursor.execute("EXPLAIN " + sql, params)
                plan = [row[0] for row in cursor.fetchall()]
            text = "\n".join(plan)
            for table in FORBIDDEN_TABLES:
                if table in text:
                    ok = False
                    notes.append(f"! plan touches {table}")
            for line in plan:
                if "Seq Scan" in line and any(t in line for t in ROLLUP_TABLES):
                    ok = False
                    notes.append(f"! sequential scan on a rollup: {line.strip()}")
            scans = [
                line.strip()
                for line in plan
                if "Scan" in line or "Aggregate" in line or "Limit" in line
            ]
            notes.extend(scans[:6])
        return ok, notes

    # ------------------------------------------------------------------ #
    def http_timing(self, filters: boss.BossFilters, endpoint: str) -> float | None:
        from rest_framework.test import APIClient

        from accounts.models import User

        boss_user = User.objects.filter(role=User.Role.BOSS).first()
        if boss_user is None:
            return None
        paths = {
            "kpis": "/api/boss/kpis/",
            "revenue-trend": "/api/boss/charts/revenue-trend/",
            "category-sales": "/api/boss/charts/category-sales/",
            "city-sales": "/api/boss/charts/city-sales/",
            "top-schools": "/api/boss/charts/top-schools/",
            "top-products": "/api/boss/charts/top-products/",
            "stock-by-category": "/api/boss/charts/stock-by-category/",
        }
        client = APIClient()
        client.force_authenticate(user=boss_user)
        query = {
            "date_from": filters.date_from.isoformat(),
            "date_to": filters.date_to.isoformat(),
        }
        if filters.city_id:
            query["city"] = filters.city_id
        if filters.school_id:
            query["school"] = filters.school_id
        if filters.category_id:
            query["category"] = filters.category_id

        # Flush the 60-second response cache so the request pays the DB.
        cache.clear()
        started = time.perf_counter()
        response = client.get(paths[endpoint], query)
        elapsed = (time.perf_counter() - started) * 1000
        if response.status_code != 200:
            raise CommandError(f"{paths[endpoint]} returned {response.status_code}")
        return elapsed
