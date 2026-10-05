# School Store

Direct-to-parent e-commerce platform for school supplies — **store and school side only** (no manufacturing).

Schools publish their required items (uniforms, shoes, stationery, ID cards), parents buy per child,
and every order, stock movement and report stays scoped to the city / school / family that owns it.

| Layer | Technology |
|---|---|
| API | Django 5.2 + Django REST Framework, JWT (SimpleJWT), Celery over Redis |
| Database | PostgreSQL 16 (UUID v4 PKs, composite indexes, bounded connection pool / PgBouncer) |
| Cache & queue | Redis (read-heavy catalogue/school caching, Celery broker + results) |
| Frontend | React (Vite) — added in a later prompt |

## Repository layout

```
backend/
  config/       Django project (settings, urls, celery)
  common/       UUIDModel, ImportJob, pagination, scoping layer, permissions, throttles, cache utils
  schools/      City, School, Student + student import engine, tasks, API
  accounts/     custom User, JWT auth (zero-query claims), account-creation hierarchy
  catalog/      Category, Product, ProductVariant + cached storefront (catalogue.py, storefront.py, images.py)
  inventory/    per-city StockBalance + StockMovement ledger, atomic stock services (services.py)
  orders/       Order, OrderItem, OrderStatusEvent (payer + fulfillment snapshots)
  analytics/    DailySalesSummary + DailySchoolTotal + DailyProductSummary rollups,
                incremental + nightly Celery rollup tasks, full-rebuild command
  panel/        School Admin panel: dashboard, orders table, per-student view,
                background Excel exports, student + teacher management
  boss/         Boss panel: whole-business KPI + chart endpoints over the rollups
                (Redis-cached), admin management, benchmark command
infra/pgbouncer.ini   transaction-pooling config + connection budget
```

## Quickstart

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt

# PostgreSQL (school_store) and Redis must be running
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_data                 # 2 cities, 3 schools, catalogue, 1 user per role
.venv/bin/python manage.py seed_perf_orders --count 200000   # perf dataset (optional)
.venv/bin/python manage.py seed_panel_demo --orders 30000    # roster + orders for the School Admin panel
.venv/bin/python manage.py backfill_sales_summaries --all    # rebuild all dashboard rollups from scratch
.venv/bin/python manage.py benchmark_boss_dashboard          # prove < 200 ms + index-only plans (optional)

.venv/bin/python manage.py runserver 0.0.0.0:8000    # API
# In a second terminal, from the repository root:
cd backend && DB_POOL_MAX_SIZE=2 ../.venv/bin/celery -A config worker -l info --concurrency=4
```

#### Frontend

```bash
cd frontend && npm install && npm run dev     # http://localhost:5173
```

Vite proxies `/api` and `/media` to the Django server, so the browser only ever
talks to one origin. Sign in as `school_admin_dps` to land on the School Admin
panel at `/school` (Boss and City Admins get a school switcher), or as `boss`
to land on the whole-business Boss panel at `/boss` (KPI cards, six charts,
admin management, and read-only "view as" for any city or school).

Seeded logins (password `Password@123`): `boss`, `admin_surat`, `school_admin_dps`, `teacher_dps`, `parent_rahul`.

## Roles and scoping

Every list/detail query is filtered by the logged-in user's scope, and each scope filter is a
**single `WHERE` clause on an indexed column stored on the row itself** (no joins, no subqueries):

| Role | Scope filter | Sees |
|---|---|---|
| Boss | — | everything, every panel |
| Admin | `city_id = user.city_id` | schools, students, orders, stock of one city |
| School Admin | `school_id = user.school_id` | one school (approves parent-added students, overrides parent links) |
| Teacher | `school_id = user.school_id` | one school; may order for any child in that school |
| Parent | `parent_id = user.id` | own children and their orders only |

`role`, `city_id` and `school_id` are carried in the JWT claims, so authentication and permission
checks cost **0 database queries per request**.

## API reference

### Auth (`/api/auth/`)
| Method | Path | Notes |
|---|---|---|
| POST | `token/` | username + password → access/refresh; response includes the user |
| POST | `token/refresh/` | rotate access token |
| GET | `me/` | current user |
| POST | `otp/send/` | send 5-minute OTP (Redis) for parent self-registration |
| POST | `register/` | parent self-registration with phone + OTP **or** password |
| GET/POST | `users/` | scoped user list / create (Boss→Admins, Admin→School Admins, School Admin→Teachers) |

### Students (`/api/students/`)
| Method | Path | Notes |
|---|---|---|
| GET | `/` | **50 rows/page**, `?search=` (name + GR prefix, indexed), `?class_name=`, `?section=`, `?school=`, `?pending=1` |
| POST | `/` | add by form (`name`, `gr_number`, `class`, `section`, `gender`, optional `date_of_birth`) — School Admin & Teacher |
| GET/PATCH/DELETE | `/{id}/` | scoped CRUD |
| POST | `/claim/` | **parent** claims a child: `school` + `gr_number` + (`date_of_birth` **or** `class_name` + `section`) — one lookup on `uniq_student_school_gr`, rate-limited |
| POST | `/manual-add/` | **parent** adds a child when the school has no roster entry → stays `PENDING` for School Admin approval |
| POST | `/{id}/approve/` | School Admin approves a pending student (may correct details / set parent) |
| POST | `/{id}/assign-parent/` | School Admin **override** of the one-parent-per-child rule (`parent: null` unlinks) |

### Bulk student import (`/api/student-imports/`)
Nothing heavy runs inside the HTTP request; each step is a Celery job.

| Method | Path | Notes |
|---|---|---|
| GET | `template/?format=xlsx\|csv` | downloadable template with the exact columns |
| POST | `/` (or `/api/students/import/`) | upload `.xlsx`/`.csv` (≤ 5 MB) → **202 + job id** |
| GET | `/{id}/` | poll: status, counts, capped preview (valid / duplicates / errors) |
| POST | `/{id}/confirm/` | run the insert job |
| GET | `/{id}/report/` | CSV of rejected rows |
| GET | `/` | scoped list of import jobs |

Flow: `PENDING → VALIDATING → PREVIEW_READY → IMPORTING → COMPLETED` (or `FAILED`).

* Validation detects duplicates with **one indexed query for the whole file**
  (`WHERE school_id = ? AND gr_number IN (...)`) and caps files at **5 MB / 5,000 rows**.
* Confirmation inserts with `bulk_create(batch_size=500, ignore_conflicts=True)`, i.e.
  `INSERT ... ON CONFLICT (school_id, gr_number) DO NOTHING` — **never row by row**.

### Catalogue, orders & stock
| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/categories/`, `/api/products/`, `/api/variants/` | product & variant CRUD (write: Boss + Admin); scoped catalogue (school-specific and generic items) |
| GET | `/api/catalog/students/{student_id}/products/[?category=slug]` | **ordering catalogue** for one student: school + class-range + gender targeted items plus shared items, card fields only, fresh stock flags |
| GET | `/api/catalog/students/{student_id}/products/{product_id}/` | product detail: full description, all CDN image URLs, per-size stock flags |
| GET | `/api/stock-balances/` | paginated city inventory; Boss sees all cities, Admin sees only their city |
| GET | `/api/stock-balances/low/` | low-stock list via the stored `is_low_stock` generated column + partial index (`idx_stockbalance_low`) — an index lookup, never a scan |
| GET/POST | `/api/stock-movements/` | append-only city stock ledger (stock-in / sale / return / manual adjustment); balance changes are atomic |
| GET/POST | `/api/orders/` | scoped orders; checkout debits the matching city + variant balance in one transaction |
| GET | `/api/health/` | database + Redis health |

Stock no longer lives on `ProductVariant`: `inventory.StockBalance` is unique on `(city, variant)`. A checkout uses the city of the student's school branch. Schools may enable home delivery, school pickup, or both; the selected type is stored on the order. `Order.payer` is separate from the student and placer so teacher-paid orders can still appear read-only to a linked parent.

#### Catalogue & targeting

* **Uniforms** can be tied to a specific school via `Product.school`, plus an optional class range
  (`class_from`/`class_to`) and `gender` (`UNISEX`/`MALE`/`FEMALE`). **Shoes, stationery and ID cards**
  leave `school` null and are shared across every school. DB constraints enforce that a class range is
  only used on school-specific items and that `class_from <= class_to`.
* `cost_price` is **required** on every product; both `cost_price` and `selling_price` are snapshotted
  onto `OrderItem` (`unit_cost_snapshot` / `unit_price_snapshot`) at the moment of sale, so profit and
  margin can always be computed later.

#### Catalogue read path (hottest endpoint)

* Catalogue lists are cached in Redis **keyed by `(school, category)`**
  (`catalog:list:v{version}:school:{id}:category:{slug}`) with a short TTL (`CATALOG_CACHE_TTL`, 60 s)
  **and explicit invalidation**: every Product/Variant/Category save or delete — including price
  changes — bumps the version key, abandoning all old keys at once.
* **Stock is never cached.** Availability is returned as `IN_STOCK` / `LOW_STOCK` / `OUT_OF_STOCK`,
  computed fresh per request from `StockBalance` in one indexed query, so the cached catalogue can
  never show wrong availability.
* The list response carries only what the card shows: id, name, price, **one thumbnail URL**, and the
  available sizes. Full description and all images come from the detail endpoint.
* Product images live in **object storage behind a CDN** — the API stores and returns URLs only and
  Django never serves image bytes. Thumbnails are built with the CDN's resize parameters
  (`CATALOG_THUMBNAIL_TEMPLATE`).
* The list is built with a **fixed number of queries** (products + `prefetch_related` variants),
  regardless of product count.

#### Stock integrity

* Every stock change goes through a `StockMovement` row (stock-in, sale, return, manual adjustment)
  via `inventory.services.apply_stock_movement` — `stock_quantity` is never edited directly (the
  Django admin is read-only for it too).
* Changes are applied with an atomic conditional `UPDATE ... SET stock_quantity = stock_quantity + x`
  (`F()` expression) — never read-modify-write in Python. A decrement matches zero rows when stock is
  insufficient, so concurrent sales can never oversell.
* `StockBalance.is_low_stock` is a Postgres **stored generated column** backed by a **partial index**,
  making the low-stock dashboard an index lookup.

## School Admin panel

One panel for one school. Every endpoint takes `?school=<id>` (Boss / City Admin)
or is pinned to the signed-in School Admin's school, and every query is a single
indexed `WHERE school_id = ?` — no joins or subqueries to work out the scope.

| Method | Path | Requirement |
|---|---|---|
| GET | `/api/panel/dashboard/?date_from=&date_to=` | 1, 7 — total orders, units, gross sales, category breakdown, daily trend, commission, pending approvals |
| GET | `/api/panel/commission/?date_from=&date_to=` | 7 — gross sales plus the commission derived from `School.commission_rate` |
| GET | `/api/panel/orders/` | 2 — every order for the school, 50 rows per page |
| GET | `/api/panel/students/` | 5 — roster (search, class filter, pending filter) |
| POST/PATCH | `/api/panel/students/` , `/{id}/` | 5 — add / edit a student |
| GET | `/api/panel/students/pending/` | 5 — parent-added children waiting for approval |
| POST | `/api/panel/students/{id}/approve/` | 5 — approve (and correct) a pending child |
| POST | `/api/panel/students/{id}/assign-parent/` | 5 — override the parent link |
| GET | `/api/panel/students/{id}/orders/?year=` | 3 — one child's year: orders, units, spend |
| GET/POST | `/api/panel/student-imports/` | 5 — bulk import (upload → preview → confirm) |
| GET | `/api/panel/student-imports/{id}/report/` | 5 — CSV of rejected rows |
| GET | `/api/panel/student-imports/template/?format=xlsx\|csv` | 5 — downloadable template |
| GET/POST | `/api/panel/teachers/` | 6 — list / create teacher logins |
| PATCH | `/api/panel/teachers/{id}/` | 6 — edit a teacher |
| POST | `/api/panel/teachers/{id}/deactivate/`, `/activate/` | 6 — deactivate / reactivate |
| POST | `/api/panel/exports/` | 4 — request an Excel export → **202 + job id** |
| GET | `/api/panel/exports/{id}/` | 4 — poll status, progress and the download link |
| GET | `/api/panel/exports/{id}/download/` | 4 — stream the finished workbook |
| GET | `/api/panel/schools/`, `/api/panel/filters/` | schools in scope, values for the filter dropdowns |

### 1. Dashboard reads the rollup, never the orders table

`DailySalesSummary` is one row per `(date, school, category)`, so its `orders`
column is `COUNT(DISTINCT order)` **within that category** — adding it up would
count an order that spans two categories twice. The rollup therefore writes a
second grain in the same SQL pass (`GROUPING SETS`, one scan of the order-item
join):

| Table | Grain | Used for |
|---|---|---|
| `DailySalesSummary` | `(date, school, category)` | the category breakdown |
| `DailySchoolTotal` | `(date, school)` | headline orders / units / gross sales |
| `DailyProductSummary` | `(date, product)` + city/school/category | Boss panel "top products by units" |

All three grains are produced by one SQL pass (`GROUPING SETS`, one scan of
the order-item join) and served by **covering indexes** (`INCLUDE` the
measures), so every dashboard aggregate is an index-only scan over a handful
of rollup rows regardless of how many orders exist. Neither panel ever scans
`orders_order` to answer — a test proves this by changing only the rollup and
watching the dashboard follow.

Update cadence:

* **Incremental** — a Celery job fires after every order, return and
  cancellation and recomputes that order's local day.
* **Nightly** — `analytics.recompute_recent_days` (Celery beat, 02:00 IST)
  rebuilds the last 7 days from the raw tables to correct any drift.
* **Manual** — rebuild everything from scratch:

```bash
.venv/bin/python manage.py backfill_sales_summaries           # day by day (large histories)
.venv/bin/python manage.py backfill_sales_summaries --all     # one SQL pass
.venv/bin/python manage.py backfill_sales_summaries --date 2026-04-01
```

### 2. Orders table

`GET /api/panel/orders/` filters by `?class_name=` (or `?class=`), `?category=`,
`?date_from=` / `?date_to=`, `?placed_by_role=`, `?status=` and `?student=`, and
returns 50 rows per page in cursor style (`?cursor=`) ordered by
`(-created_at, -id)`.

* `class_name` is a **denormalised `Order.student_class`** column, so the filter
  is one indexed `WHERE` instead of a join to `Student`; it is kept in sync on
  save (and backfilled by a one-statement data migration).
* `category` is a semi-join (`EXISTS` on `idx_orderitem_order`) — no `DISTINCT`,
  no full join.
* Cursor pagination walks `idx_order_school_created_id (school, created_at, id)`,
  so each page is an index range scan with **no sort node and no `COUNT(*)`**
  (~0.4 ms for 50 rows against 30k orders). Each row caps its item lines at four
  and shows the order's total units and amount.

### 3. Per-student view

`GET /api/panel/students/{id}/orders/` returns one child's orders across the
academic year (1 Apr → 31 Mar, or `?year=` / `?date_from=` + `?date_to=`), with
`totals.orders`, `totals.units` and `totals.gross_sales`. The list and the
totals both ride `idx_order_student_created_id (student, created_at, id)`, so
the aggregate only ever touches that one child's rows.

### 4. Excel export is a background job

```
POST /api/panel/exports/  →  202 {id, status: QUEUED}     (nothing is built)
GET  /api/panel/exports/{id}/  →  {status, progress, download_url}
GET  /api/panel/exports/{id}/download/  →  the workbook
```

`panel.tasks.build_export` runs in a Celery worker and streams the file:

* `openpyxl` **write-only** worksheet — rows are appended straight into the zip
  stream, so memory stays flat;
* `queryset.iterator(chunk_size=500)` — the queryset is streamed in chunks
  instead of materialised;
* the finished file is saved to storage and the job flips to `READY`, after
  which the panel shows a download link (kept for `EXPORT_FILE_TTL_DAYS`,
  default 7; `panel.purge_expired_exports` deletes the bytes).

A 10,000-row order export is ~690 KB and takes a few seconds in the worker; the
HTTP request that queues it returns in milliseconds. `EXPORT_MAX_ROWS`
(default 200,000) stops a runaway export and marks the file truncated.

### 5–6. Students and teachers

Student management reuses the import engine (upload → validate job → capped
preview → confirm job → batched `ON CONFLICT` insert), always locked to the
admin's school. Teacher logins are created with a generated password that is
returned **once** (and flagged `must_change_password`); leavers are
deactivated, never deleted, so their order history stays intact.

### 7. Commission

The rate always comes from `School.commission_rate` — nothing is hard-coded.
When the field is empty the API reports `rate_set: false`, `rate: null`,
`rate_display: "Not set"` and a note explaining why; gross sales are still
shown. Two tests pin this down (one rate → one amount, empty rate → "not set").

### 8. No counts over large filtered sets

Orders and students use **cursor pagination with "load more"** and never return
a `count` field. Headline numbers come from the rollup tables. The only
`COUNT()` in the panel is the pending-approval counter, which is a handful of
rows served by `idx_student_school_approval`.

## Boss panel

One screen for the owner covering the whole business — `/boss` in the
frontend, `/api/boss/` in the API. Every number reads the rollups above;
**no dashboard query touches `orders_order` or `orders_orderitem`**.

| Endpoint | Returns |
|---|---|
| `GET /api/boss/kpis/` | all KPI cards in one small response: revenue, cost, gross profit, gross margin %, orders, units sold, current stock value |
| `GET /api/boss/charts/revenue-trend/` | revenue + profit per day |
| `GET /api/boss/charts/category-sales/` | sales by category |
| `GET /api/boss/charts/city-sales/` | sales by city |
| `GET /api/boss/charts/top-schools/` | top schools by revenue |
| `GET /api/boss/charts/top-products/` | top products by units (reads `DailyProductSummary`) |
| `GET /api/boss/charts/stock-by-category/` | current stock level by category |
| `GET /api/boss/filters/` | cities / schools / categories for the filter dropdowns |
| `GET/POST/PATCH /api/boss/admins/` | create Admins, assign them to cities, deactivate |

* **Filters** — every card and chart takes `?city=&school=&category=&date_from=&date_to=`
  and respects all of them (cities and schools combine, stock follows the
  city).
* **Definitions** — profit = Σ(`unit_price_snapshot` − `unit_cost_snapshot`) ×
  quantity = `revenue − cost` from the rollups; gross margin = profit ÷
  revenue.
* **Caching** — every response is cached in Redis for 60 seconds
  (`BOSS_DASHBOARD_CACHE_TTL`), keyed by the exact filter combination; the
  stock-value aggregate (`SUM(stock × cost)` over the city/variant balances)
  is cached separately for `BOSS_STOCK_VALUE_CACHE_TTL` seconds (180).
* **Management** — cities and schools (including each school's
  `commission_rate`) reuse the existing Boss-level CRUD at `/api/cities/` and
  `/api/schools/`.
* **View as** — the Boss opens the City Admin view for any city
  (`/school?view_city=<id>`) or the School view for any school
  (`/school?view_school=<id>`); both are **read-only by default** with an
  explicit "enable editing" switch.
* **Performance** — `manage.py benchmark_boss_dashboard` times every endpoint
  (database layer and full HTTP) against the seeded volume and fails unless
  each answers under 200 ms with EXPLAIN plans showing index scans only and
  no access to the order tables. With 200,000 seeded orders every endpoint
  answers in ~1–11 ms.

## Performance rules in force

| Rule | Implementation |
|---|---|
| P1 target load | ~500 concurrent users, 200 RPS headroom on one modest server |
| P2 network first | `200 RPS × 30 KB × 8 = 48 Mbps`; every list is paginated (max 50 rows), order/stock lists omit detail arrays, and catalogue variants are compact size/stock summaries |
| P3 indexed lookups | composite indexes per spec + expression indexes for `?search=`; no full scans, no `ORDER BY random()`, no unindexed `COUNT(*)`. Panel additions: `idx_order_school_created_id`, `idx_order_sch_cls_created_id`, `idx_order_student_created_id`, `idx_student_school_roster`, and covering indexes (`INCLUDE` the measures) on all three rollup tables — `idx_ds_cover_*`, `idx_dst_cover_*`, `idx_dp_cover_*` — so dashboards are index-only scans. Apply `infra/postgres_tuning.sql` (`random_page_cost = 1.1` for SSD) so the planner picks them. |
| P4 keys | every model uses application-generated `uuid.uuid4` primary keys |
| P5 background jobs | student imports, rollups, exports, and notifications run in a dedicated Celery worker over Redis |
| P6 transactions | orders, payments and stock changes are written synchronously in one transaction |
| P7 bounded pool | PostgreSQL `max_connections=100`; `4 web workers × DB_POOL_MAX_SIZE 10 + 4 Celery processes × DB_POOL_MAX_SIZE 2 + 10 admin/maintenance headroom = 58`; keep the sum well below the server limit. Web and job services set `DB_POOL_MAX_SIZE` separately. Persistent connections default to 60 seconds (`DB_CONN_MAX_AGE`); psycopg pool bounds actual server connections. |
| P8 caching | only read-heavy, rarely-changing data (catalogue, school lists) in Redis with explicit invalidation |

## Tests

```bash
cd backend && ../.venv/bin/python manage.py test
```

Covers the data model and indexes, the JWT/zero-query permission path, school-vs-school and
city-vs-city isolation, parent isolation, constant query counts as rows grow (no N+1),
student CRUD/search/filters, the full import pipeline (single-query duplicate detection,
batched `ON CONFLICT` inserts, caps, template), parent claim verification, the one-parent
rule plus admin override, pending approvals and claim rate limiting.

`panel/tests.py` covers the School Admin panel: dashboard totals coming from the
rollup (proved by mutating the summary rows only), the school-day vs per-category
order count, every orders filter, 50-row cursor pagination with no `count`,
per-student totals, the export lifecycle (202 with nothing built → worker builds →
download serves the workbook), scoped student add/edit/approve, the bulk import
two-job flow, teacher create/deactivate, cross-school isolation, and the
"not set" commission path. Inventory tests cover
city-specific balances and scopes, teacher payer attribution, fulfillment settings, and
transactional stock debits.
