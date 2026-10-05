-- Planner tuning for the dashboard rollups (apply once per database).
--
-- The Boss / School Admin dashboards read pre-aggregated rollup tables
-- through covering indexes (INCLUDE the measures). On SSD-backed storage
-- the default rotational-disk cost model (random_page_cost = 4) makes the
-- planner prefer Seq Scan for small rollups; with realistic SSD costs it
-- picks the intended Index Only Scans, which is what the benchmark in
-- `manage.py benchmark_boss_dashboard` asserts.
ALTER DATABASE school_store SET random_page_cost = 1.1;
