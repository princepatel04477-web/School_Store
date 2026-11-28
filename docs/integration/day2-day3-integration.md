# Day 2 + Day 3 Integration Runbook

This guide specifies how to execute the end-to-end integration test suite on a branch combining Day 2 (payment verification, stock reservation, and authoritative packing rules) and Day 3 (fulfilment queues, India Post handover, parent tracking, and privacy scoping).

---

## 1. Migration Ordering Rule

> [!IMPORTANT]
> **Migration Lineage Rules:**
> - Day 2's `orders` migration must be merged first (e.g. `orders/migrations/0016_payment_rules_*.py` depending on `0015_orderitem_fit_feedback_and_more.py`).
> - Day 3's shipment and packing migration (`0016_shipment.py`) must then be **renumbered** (e.g. to `0017_shipment.py`) and its `dependencies` array updated to point to Day 2's migration.
> - **NEVER** run `makemigrations --merge`. Django requires a linear migration history for `orders`.
> - Always run `python manage.py makemigrations --check` to verify no unmigrated schema changes exist.

---

## 2. Disposable Database Integration Procedure

Execute the following commands from the repository root to verify migrations from an empty database and execute the integration suite:

### Step 1: Create Disposable PostgreSQL Database
```bash
PGPASSWORD=postgres createdb -h 127.0.0.1 -p 54329 -U postgres school_store_disp
```

### Step 2: Apply Migrations from Empty
```bash
USE_POSTGRES_FOR_TESTS=1 \
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT=54329 \
POSTGRES_USER=postgres \
POSTGRES_DB=school_store_disp \
.venv/bin/python manage.py migrate
```

### Step 3: Verify Schema Cleanliness
```bash
.venv/bin/python manage.py makemigrations --check
```
*Expected output: `No changes detected`.*

### Step 4: Run Day 2 + Day 3 Integration Test Suite
```bash
USE_POSTGRES_FOR_TESTS=1 \
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT=54329 \
POSTGRES_USER=postgres \
POSTGRES_DB=school_store_disp \
.venv/bin/python manage.py test orders.test_integration_day2_day3
```

### Step 5: Tear Down Disposable Database
```bash
PGPASSWORD=postgres dropdb -h 127.0.0.1 -p 54329 -U postgres school_store_disp
```

---

## 3. Integration Test Cases Summary

Module: `backend/orders/test_integration_day2_day3.py`

| Case | Scenario | Description |
|---|---|---|
| 1 | Verified Payment & Fulfilment | Payment verification survives browser closure; city admin claims, verifies packing list lines/quantities, packs; postal handover recorded; parent sees article number; stock deducted exactly once (ORDER_PLACED). |
| 2 | Blocked Unverified & Late Payment | Online order with pending payment is blocked at pack (409 `PACKING_BLOCKED`); late payment on cancelled order blocked. |
| 3 | Eligible Cash on Delivery | COD order reaches packing; parent API confirms unpaid state (`PENDING`) with total amount due. |
| 4 | School Pickup Fulfilment | School pickup completes claim, pack, ready for pickup, delivered with no article number, no carrier, and no postal references. |
| 5 | Repeat Idempotency | Repeated pack and repeated postal dispatch return 200 with `changed=False`, creating exactly one status event and one shipment. |
| 6 | Parent Isolation & Privacy | Another family's order returns HTTP 404 on detail, is omitted from list, and never leaks tracking details. |

---

## 4. Current State (Before Day 2 Merge)

Until Day 2's `orders.payment_rules` module is merged into the branch:
- Cases 1 and 2 are skipped with `@unittest.skipUnless(HAS_DAY2, "Day 2 not merged")`.
- Cases 3 through 6 are exercised via SIMULATED test variants (`test_case_3_eligible_cod_simulated`, `test_case_4_school_pickup_simulated`, etc.) using the Task C packing rule test double.
- Once Day 2 is merged, `HAS_DAY2` evaluates to `True`, and all 6 real cases run end-to-end.
