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
  catalog/      Category, Product, ProductVariant
  inventory/    per-city StockBalance + StockMovement ledger
  orders/       Order, OrderItem, OrderStatusEvent (payer + fulfillment snapshots)
  analytics/    DailySalesSummary + Celery rollup task
infra/pgbouncer.ini   transaction-pooling config + connection budget
```

## Quickstart

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt

# PostgreSQL (school_store) and Redis must be running
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_data                 # 2 cities, 3 schools, catalogue, 1 user per role
.venv/bin/python manage.py seed_perf_orders --count 200000   # perf dataset (optional)

.venv/bin/python manage.py runserver 0.0.0.0:8000    # API
# In a second terminal, from the repository root:
cd backend && DB_POOL_MAX_SIZE=2 ../.venv/bin/celery -A config worker -l info --concurrency=4
```

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
| GET | `/api/categories/`, `/api/products/`, `/api/variants/` | scoped catalogue (school-specific and generic items) |
| GET | `/api/stock-balances/` | paginated city inventory; Boss sees all cities, Admin sees only their city |
| GET/POST | `/api/stock-movements/` | append-only city stock ledger; adjustments and balance changes are atomic |
| GET/POST | `/api/orders/` | scoped orders; checkout locks only the matching city + variant balance in one transaction |
| GET | `/api/health/` | database + Redis health |

Stock no longer lives on `ProductVariant`: `inventory.StockBalance` is unique on `(city, variant)`. A checkout uses the city of the student's school branch. Schools may enable home delivery, school pickup, or both; the selected type is stored on the order. `Order.payer` is separate from the student and placer so teacher-paid orders can still appear read-only to a linked parent.

## Performance rules in force

| Rule | Implementation |
|---|---|
| P1 target load | ~500 concurrent users, 200 RPS headroom on one modest server |
| P2 network first | `200 RPS × 30 KB × 8 = 48 Mbps`; every list is paginated (max 50 rows), order/stock lists omit detail arrays, and catalogue variants are compact size/stock summaries |
| P3 indexed lookups | composite indexes per spec + expression indexes for `?search=`; no full scans, no `ORDER BY random()`, no unindexed `COUNT(*)` |
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
rule plus admin override, pending approvals and claim rate limiting. Inventory tests cover
city-specific balances and scopes, teacher payer attribution, fulfillment settings, and
transactional stock debits.
