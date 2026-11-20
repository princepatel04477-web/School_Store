# School Store Read Throughput Benchmark Suite

This directory contains the load testing scripts, benchmark runner, and baseline results for the School Store catalogue and parent orders read throughput paths as specified in Prompt 5.

---

## 1. Workload Mixes

### A. Public Catalogue Mix (`perf/catalog.js`)
Weighted to reflect a realistic browsing visit through the student storefront:
- **25%** Schools list: `GET /api/public/schools/`
- **15%** States list: `GET /api/public/states/`
- **15%** Cities list: `GET /api/public/cities/?state=...`
- **15%** City branches: `GET /api/public/cities/{city_id}/branches/`
- **10%** Grades list: `GET /api/public/grades/`
- **20%** Products list: `GET /api/public/products/?school_id={school}&class_name={class}&gender={gender}`

Runs are executed in two conditions:
1. **Cold Cache Run**: Cache empty / unprimed to measure baseline database and application latency.
2. **Warm Cache Run**: Cache pre-warmed to measure cache throughput and connection reuse.

### B. Authenticated Parent Orders Mix (`perf/parent_orders.js`)
Simulates parents reviewing their past and active orders:
- **50%** List orders: `GET /api/orders/` (paginated, ordered by `-created_at`)
- **30%** Order detail: `GET /api/orders/{id}/` (with line items and status history)
- **20%** List students: `GET /api/students/` (viewing linked children)

---

## 2. Concurrency Model & Stop Conditions

- **Stepped Concurrency**: 1, 5, 10, 25, 50, and 100 Virtual Users (VUs).
- **Duration**: 2 minutes per step with a 30-second warm-up phase.
- **Automated Abort Limits**:
  - Stop immediately if the HTTP error rate exceeds **1.0%**.
  - Stop immediately if the **p95 latency** exceeds **2.0 seconds** (2,000 ms).

---

## 3. Prerequisites & Test Data Seeding

### Seeding Performance Orders & Synthetic Parents
Run the management commands to populate the test dataset:

```powershell
# 1. Generate baseline performance orders
python backend/manage.py seed_perf_orders --count 3000

# 2. Generate synthetic parents, children, and attach orders (minting tokens outside repo)
python backend/manage.py seed_perf_parents --count 50 --reset
```

The synthetic parents use reserved test phone numbers in the `50000xxxxx` range (`perf_parent_5000000001` through `perf_parent_5000000050`). Minted JWT access tokens are saved to `$TEMP/perf_parent_tokens.json`.

---

## 4. Running the Benchmarks

### Option A: Using k6
If `k6` is installed on your path:

```powershell
# 1. Catalogue benchmark
k6 run perf/catalog.js --summary-export=perf/raw-catalog-summary.json

# 2. Parent Orders benchmark
$env:TOKENS_FILE = "$env:TEMP\perf_parent_tokens.json"
k6 run perf/parent_orders.js --summary-export=perf/raw-parent-orders-summary.json
```

### Option B: Using the Python Benchmark Runner
The repository includes a standalone async benchmark runner (`perf/benchmark_runner.py`) using `httpx` and native Windows process performance monitoring:

```powershell
# Run all scenarios with stepped concurrency
python perf/benchmark_runner.py --scenario all --tokens-file "$env:TEMP\perf_parent_tokens.json"
```

For quick verification:
```powershell
python perf/benchmark_runner.py --scenario all --steps "1,5,10,25" --step-duration 10 --warmup-duration 2
```

---

## 5. Rate Limit & Throttle Overrides

To avoid measuring the Django rate limiter (HTTP 429) rather than system throughput, set the following environment variables when starting the application server:

```powershell
$env:PUBLIC_CATALOG_RATE = "1000000/min"
$env:LOGIN_THROTTLE_RATE = "1000000/min"
$env:OTP_THROTTLE_RATE = "1000000/min"
$env:STUDENT_CLAIM_USER_RATE = "1000000/hour"
```

No settings files are modified or committed.

---

## 6. Query Plan & Database Index Verification

Verify that the `idx_order_parent_created` composite B-tree index (`parent_id`, `created_at`) is utilised:

```powershell
python -c "
import os, django; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); django.setup()
from django.db import connection; from accounts.models import User; from orders.models import Order
u = User.objects.filter(role='PARENT').first()
qs = Order.objects.filter(parent=u).order_by('-created_at')
sql, params = qs.query.sql_with_params()
c = connection.cursor()
c.execute('EXPLAIN QUERY PLAN ' + sql, params)
print(c.fetchall())
"
```

Expected output:
```
[(4, 0, 0, 'SEARCH orders_order USING INDEX idx_order_parent_created (parent_id=?)')]
```
