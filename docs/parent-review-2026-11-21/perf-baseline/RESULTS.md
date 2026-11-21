# Read baseline: Postgres + Redis, separate load generator

Run: 2026-11-21 by Claude. This replaces Antigravity's `perf/RESULTS-2026-11-20.md` (SQLite, generator inside the server process), which should not be used.

## Environment

| | |
|---|---|
| Machine | The developer's Windows 11 PC: 16 logical CPUs, 16 GB RAM. The generator runs on the same machine (local, no network in between). |
| Code | `fix/parent-review` (review worktree `School_Store-review`), production settings: `DJANGO_DEBUG=0`, `SMS_PROVIDER=console`, no payment keys, `CELERY_TASK_ALWAYS_EAGER=1`. |
| App server | Waitress, 1 process, `--threads=8`, the same command as `deploy/run.ps1`. |
| Database | Throwaway PostgreSQL 17.11 cluster (scratchpad, port 5544), `pg_stat_statements` on. The app's connection pool uses its defaults (min 2, max 10). |
| Cache | Throwaway Redis (port 6390), via `django_redis`. |
| Load generator | `driver.py` + `load.py` (httpx, asyncio), split across up to **6 separate processes** per step. The busiest generator process used ≤ 0.5 CPU core in every step, so the generator was never the limit. |
| Override | `PUBLIC_CATALOG_RATE=1000000/min` on the app process only (otherwise one client IP gets 429s at 120/min). Nothing committed. |
| Excluded | SMS (development provider only, and no OTP calls in the runs), payments, carriers, Cloudflare Worker and tunnel. |

## Dataset

The perf DB was 182 MB, built with `seed_data`, `seed_perf_orders --count 100000` and `seed_perf_parents --count 500`:

| Table | Rows |
|---|---|
| Orders | 101,749 |
| Order items | 101,750 |
| Parents | 502 |
| Students | 758 |
| Schools | 3 |
| Branches | 4 |
| Products / variants | 28 / 100 |

The catalogue is small (the seed catalogue). Product-list cost will grow with the real catalogue.

## Method

Concurrency steps were 1, 5, 10, 25, 50 and 100 virtual users. Each step had 15 s of warm-up (0 s for the cold-cache run, which also flushed Redis before each step) and then **60 s measured**. The run stops early if errors exceed 1% or p95 exceeds 2 s.

- **Catalogue mix:** schools 25%, states 15%, cities 15%, branches 15%, grades 10%, products for a school/class/gender 20%.
- **Parent mix:** 500 parent tokens, each request picking a random parent. `GET /orders/` 50%, `GET /orders/<own id>/` 30%, `GET /students/` 20%.

## Results

**Catalogue, warm cache**

| Users | req/s | p50 ms | p95 ms | p99 ms | max ms | errors | Postgres conns | server CPU (cores) |
|---|---|---|---|---|---|---|---|---|
| 1 | 79.8 | 11.9 | 17.0 | 19.3 | 24 | 0% | 8 | 0.42 |
| 5 | 196.4 | 23.9 | 36.6 | 41.7 | 126 | 0% | 8 | 1.15 |
| 10 | 198.3 | 46.5 | 78.3 | 93.9 | 171 | 0% | 8 | 1.19 |
| 25 | 200.3 | 121.1 | 160.3 | 210.8 | 281 | 0% | 8 | 1.18 |
| 50 | 199.3 | 246.4 | 298.3 | 352.1 | 430 | 0% | 8 | 1.19 |
| 100 | 210.8 | 483.1 | 572.8 | 669.9 | 30,081 | 0.02% (2 timeouts) | 8 | 1.02 |

**Catalogue, cold cache:** within 5% of the warm numbers at every step (peak 211.6 req/s, p95 560 ms at 100 users, 4 timeouts, 0.03%). Caching makes little difference at this catalogue size.

**Parent order reads**

| Users | req/s | p50 ms | p95 ms | p99 ms | max ms | errors | Postgres conns | server CPU (cores) |
|---|---|---|---|---|---|---|---|---|
| 1 | 45.1 | 21.2 | 29.4 | 32.4 | 121 | 0% | 8 | 0.53 |
| 5 | 82.9 | 53.6 | 96.9 | 167.9 | 234 | 0% | 8 | 1.07 |
| 10 | 79.4 | 113.8 | 225.3 | 301.4 | 383 | 0% | 8 | 1.07 |
| 25 | 80.7 | 295.5 | 441.1 | 490.9 | 589 | 0% | 8 | 1.07 |
| 50 | 81.7 | 598.4 | 755.0 | 802.3 | 858 | 0% | 8 | 1.07 |
| 100 | 95.4 | 1178.1 | 1374.0 | 1450.4 | 30,042 | 0.03% (2 timeouts) | 8 | 1.08 |

The stop condition never triggered: p95 stayed under 2 s up to 100 users. The few 30 s timeouts at 100 users are requests that queued behind Waitress's 8 threads until the client's 30 s timeout.

## Database behaviour

- **Parent run:** the order-list query ran 17,402 times, averaging 0.26 ms (max 1.15 ms). Order detail ran 10,395 times at 0.12 ms, and the students list 6,925 times at 0.16 ms. Total DB execution time was about 8 s over about 4 minutes of load.
- **Catalogue run:** the busiest queries average 0.03 to 0.05 ms. The product list averages 0.47 ms.
- **Connections:** constant at 8 under every load level (the pool).
- **Plans** (`EXPLAIN (ANALYZE, BUFFERS)`, a perf parent with 6 orders): the list query is an index scan on `orders_order_parent_id_2d691aa5` plus an in-memory sort, executing in 0.145 ms with 3 shared buffer hits. Detail is an index scan on the same index with an id filter, 0.115 ms. With a handful of orders per parent, the planner prefers the plain `parent_id` index over `idx_order_parent_created`. Either is fine.
- The students list also runs `link_children_by_phone` (an UPDATE) on every call. It did not show up as a cost here.

## What limits throughput

The single Waitress process tops out at about **1.1 CPU cores**: Python's GIL caps one process at about one core of work. Throughput stops rising after 5 users (about 200 req/s catalogue, about 80 req/s parent reads), and latency then grows in proportion to the queue. Postgres is nowhere near busy. More capacity would come from more app processes (several Waitress processes behind a balancer, or gunicorn workers on Linux), not from database work.

## Not measured

- The production server (192.168.0.125) and its hardware.
- The Cloudflare Worker and tunnel hop.
- Real phone networks.
- Write paths (checkout, payment), OTP and SMS.
- A full-size real catalogue.
- More than one app process.
- Run-to-run variance: each step was run once.
