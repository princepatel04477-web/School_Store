# Walkthrough: Day 3 Task E — Parent Order Detail & Day 2 + Day 3 Integration Evidence

## 1. Branch & Git Diff Stat

### Current Branch
```bash
$ git branch --show-current
day3-fulfilment
```

### Git Diff Stat
```text
 backend/orders/serializers.py           |  31 ++++++++-
 backend/orders/test_parent_tracking.py  | 107 +++++++++++++++++++++++++++++++-
 backend/orders/views.py                 |   7 +--
 frontend/src/App.tsx                    |   4 ++
 frontend/src/api.ts                     |  13 ++++
 frontend/src/components/Store.tsx       |   4 +-
 frontend/src/i18n/messages.ts           |  54 ++++++++++++++++
 frontend/src/pages/Parent.tsx           |  22 ++++++-
 frontend/src/pages/native/OrdersTab.tsx |  18 +++++-
 frontend/src/siteConfig.ts              |   2 +-
 frontend/src/styles.css                 |   2 +-
 11 files changed, 250 insertions(+), 14 deletions(-)
```

### New Files Created in Task E
- `backend/orders/test_integration_day2_day3.py`: 10 integration test cases (6 Day 2 contract tests skipped with "Day 2 not merged" + 4 SIMULATED variants exercising the Day 3 half).
- `frontend/src/pages/OrderDetail.tsx`: Dedicated, deep-linkable parent order detail component.
- `frontend/src/pages/orderDetail.css`: Accessible styles adhering to design tokens, 44px tap targets, and monospace wrap rules.
- `frontend/src/pages/OrderDetail.test.tsx`: 9 Vitest tests covering loading, error/retry, home delivery, school pickup, COD payment, copy button feedback, and multilingual support.
- `docs/integration/day2-day3-integration.md`: Step-by-step owner runbook for running integration tests against a disposable database and handling migration renumbering.
- `docs/integration/evidence-table.md`: Redacted case evidence matrix.
- `scripts/capture_day3_e_screenshots.py`: Playwright capture script generating all required mobile (390x844) and desktop screenshots.

---

## 2. Test Suites Execution Results

### A. Full SQLite Test Suite
Command:
```bash
USE_SQLITE=1 .venv/bin/python manage.py test
```
Result:
```text
Found 383 test(s).
Creating test database for alias 'default'...
...
Ran 383 tests in 140.268s

OK (skipped=28)
Destroying test database for alias 'default'...
```

### B. PostgreSQL Orders Test Suite (Port 54329)
Command:
```bash
USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store .venv/bin/python manage.py test orders
```
Result:
```text
Found 116 test(s).
Creating test database for alias 'default'...
...
Ran 116 tests in 67.234s

OK (skipped=6)
Destroying test database for alias 'default'...
```

### C. Frontend Vitest Suite
Command:
```bash
cd frontend && npx vitest run
```
Result:
```text
 ✓ src/pages/OrderDetail.test.tsx (9 tests) 79ms
 ✓ src/pages/OrdersScreens.test.tsx (11 tests) 95ms
 ✓ src/components/StoreTimeline.test.tsx (15 tests) 44ms
 ✓ src/components/admin/FulfilmentQueue.test.tsx (7 tests) 17ms
 ...
 Test Files  19 passed (19)
      Tests  175 passed (175)
   Start at  16:54:13
   Duration  1.98s (transform 3.29s, setup 1.25s, collect 3.63s, tests 1.13s, environment 4.79s, prepare 865ms)
```

### D. TypeScript Check & Production Vite Build
Command:
```bash
cd frontend && npm run build
```
Result:
```text
> school-store-web@1.0.0 build
> tsc -b && vite build

vite v6.4.1 building for production...
transforming...
✓ 1801 modules transformed.
rendering chunks...
computing gzip size...
...
dist/assets/OrderDetail-B0YYuRZD.js                    9.83 kB │ gzip:   2.91 kB
dist/assets/index-eDs3lXT1.js                        484.43 kB │ gzip: 161.07 kB
✓ built in 2.46s
```

---

## 3. Disposable Database Verification Run

To verify that migrations apply cleanly from empty and that the test harness executes in an isolated PostgreSQL environment, a disposable database was provisioned on the local PostgreSQL instance (port 54329).

### 1. Database Creation
```bash
PGPASSWORD=postgres createdb -h 127.0.0.1 -p 54329 -U postgres school_store_disp
```

### 2. Migration Execution from Empty
```bash
USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store_disp .venv/bin/python manage.py migrate
```
Output:
```text
Operations to perform:
  Apply all migrations: admin, auth, common, contenttypes, inventory, orders, sessions
Running migrations:
  Applying contenttypes.0001_initial... OK
  Applying auth.0001_initial... OK
  Applying common.0001_initial... OK
  Applying common.0002_school_class_school_is_class_based... OK
  Applying inventory.0001_initial... OK
  Applying inventory.0002_uniformitem... OK
  Applying inventory.0003_school_classes... OK
  Applying inventory.0004_remove_uniformitem_unique_uniform_item_and_more... OK
  Applying inventory.0005_studentmeasurement_studentphoto... OK
  Applying inventory.0006_uniformitem_alter_unique_together_and_more... OK
  Applying inventory.0007_photo_consent... OK
  Applying inventory.0008_stockbalance_stockmovement_and_more... OK
  Applying orders.0001_initial... OK
  Applying orders.0002_order_parent_order_idx_order_parent_created... OK
  Applying orders.0003_order_checkout... OK
  Applying orders.0004_order_fulfillment_type_order_payer_and_more... OK
  Applying orders.0005_order_student_class_and_more... OK
  Applying orders.0006_order_branch_order_idx_order_branch_created... OK
  Applying orders.0007_order_payment_method... OK
  Applying orders.0008_photoconsent... OK
  Applying orders.0009_orderitem_chosen_size_orderitem_fit_height_cm_and_more... OK
  Applying orders.0010_orderpacking_shipment_shipmentcorrection... OK
  Applying orders.0011_remove_shipment_article_correction_history_and_more... OK
  Applying orders.0012_remove_shipment_orders_ship_carrier_4e9b92_idx_and_more... OK
  Applying orders.0013_remove_shipment_corrections_and_more... OK
  Applying orders.0014_remove_shipment_order_and_more... OK
  Applying orders.0015_orderitem_fit_feedback_and_more... OK
  Applying orders.0016_shipment... OK
  Applying sessions.0001_initial... OK
```

### 3. Schema Check
```bash
.venv/bin/python manage.py makemigrations --check
```
Output:
```text
No changes detected
```

### 4. Integration Test Execution Against Disposable Database
```bash
USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store_disp .venv/bin/python manage.py test orders.test_integration_day2_day3
```
Output:
```text
Found 10 test(s).
Creating test database for alias 'default'...
System check identified no issues (0 silenced).
ssssss....
----------------------------------------------------------------------
Ran 10 tests in 5.342s

OK (skipped=6)
Destroying test database for alias 'default'...
```

### 5. Database Cleanup
```bash
PGPASSWORD=postgres dropdb -h 127.0.0.1 -p 54329 -U postgres school_store_disp
```

---

## 4. Evidence Table

> [!NOTE]
> A sample article number proves the app displays tracking details. Actual postal tracking requires evidence from a real booking.

| Case | Store Order Reference | Payment State | Packing Result | Dispatch Result | Parent-Visible Result | Result | Evidence Label |
|---|---|---|---|---|---|---|---|
| Case 1 (Real Day 2) | `ORD-****` | Verified online payment | Packing permitted (2 garments verified) | Dispatched via India Post | Parent sees article number; payment Paid; 1 stock deduction | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 2 (Real Day 2) | `ORD-****` | Pending payment / Late capture | Blocked with 409 `PACKING_BLOCKED` | Not reached | Order unchanged; no leakage | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 3 (Real Day 2) | `ORD-****` | Unpaid Cash on Delivery | Packing permitted for confirmed COD | Dispatched | Unpaid with amount due (₹500.00) displayed | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 4 (Real Day 2) | `ORD-****` | Verified prepaid | Packing permitted | Ready at School / Delivered | "Ready at school", "Delivered", no postal data | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 5 (Real Day 2) | `ORD-****` | Verified prepaid | First pack 200, repeat returns 200 (`changed=false`) | First dispatch 200, repeat returns 200 (`changed=false`) | Exactly 1 PACKED and 1 DISPATCHED timeline event | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 6 (Real Day 2) | `ORD-****` | Verified prepaid | Packed | Dispatched with consignment number | Other family receives HTTP 404; article number omitted | **PENDING** | PENDING (Awaiting Day 2 `payment_rules`) |
| Case 3 [SIMULATED] | `ORD-****` | Unpaid Cash on Delivery | Packed via packing rule test double | Dispatched | Unpaid with amount due (₹500.00) displayed | **PASS** | SIMULATED (Task C packing rule test double) |
| Case 4 [SIMULATED] | `ORD-****` | Prepaid (Simulated) | Packed via packing rule test double | Marked ready for pickup, then delivered | "Delivered", no postal data, no India Post text | **PASS** | SIMULATED (Task C packing rule test double) |
| Case 5 [SIMULATED] | `ORD-****` | Prepaid (Simulated) | Packed once, repeat changed=False | Dispatched with sample article number, repeat changed=False | Exactly 1 PACKED and 1 DISPATCHED timeline event | **PASS** | SIMULATED (Sample article number `EM555555555IN`) |
| Case 6 [SIMULATED] | `ORD-****` | Prepaid (Simulated) | Packed | Dispatched with sample article number | Other family receives HTTP 404; article number absent | **PASS** | SIMULATED (Sample article number `EM888888888IN`) |

*Personal data redacted: child names, telephone numbers, and addresses have been omitted or replaced with generic identifiers.*

---

## 5. Playwright Screenshot Catalogue (390x844 Mobile + Desktop)

All mobile screenshots were captured at 390x844 viewport and verified to have zero horizontal scroll overflow (`scrollWidth <= clientWidth`), fully compliant 44px tap targets, and no content obscured by bottom navigation or system gestures.

| Scenario | English (`en`) | Hindi (`hi`) | Gujarati (`gu`) | Description |
|---|---|---|---|---|
| Placed | `order-detail-placed-390-en.png` | `order-detail-placed-390-hi.png` | `order-detail-placed-390-gu.png` | Initial order placed step, items listed with quantities, payment status Paid |
| Packed with timestamp | `order-detail-packed-390-en.png` | `order-detail-packed-390-hi.png` | `order-detail-packed-390-gu.png` | Packed status with event date/time, items list, payment Paid |
| Dispatched with 40-char number | `order-detail-dispatched-long-390-en.png` | `order-detail-dispatched-long-390-hi.png` | `order-detail-dispatched-long-390-gu.png` | Monospace wrapped 40-char India Post article number, Copy button, Track link, hint text |
| Pickup Ready | `order-detail-pickup-ready-390-en.png` | `order-detail-pickup-ready-390-hi.png` | `order-detail-pickup-ready-390-gu.png` | School pickup order: "Pickup at Delhi Public School", "Ready at school", zero postal text |
| Older Dispatched without number | `order-detail-older-dispatched-no-number-390-en.png` | `order-detail-older-dispatched-no-number-390-hi.png` | `order-detail-older-dispatched-no-number-390-gu.png` | Legacy order notice: "Handed over to India Post. The tracking number was not recorded..." |
| Payment Pending next to Packed | `order-detail-payment-pending-packed-390-en.png` | `order-detail-payment-pending-packed-390-hi.png` | `order-detail-payment-pending-packed-390-gu.png` | Payment status Pending next to packed order step |
| Cash on Delivery Due | `order-detail-cod-due-390-en.png` | `order-detail-cod-due-390-hi.png` | `order-detail-cod-due-390-gu.png` | Payment status "Pay on delivery" with remaining amount due (₹500.00) |
| Loading Skeleton | `order-detail-skeleton-390-en.png` | `order-detail-skeleton-390-hi.png` | `order-detail-skeleton-390-gu.png` | Skeleton loader state matching exact card geometry |
| Error with Retry | `order-detail-error-retry-390-en.png` | `order-detail-error-retry-390-hi.png` | `order-detail-error-retry-390-gu.png` | Network failure banner with visible 44px "Retry" button |
| Storefront Desktop | `order-detail-storefront-desktop.png` | — | — | Desktop storefront showing parent order detail view |

All screenshots reside in `docs/walkthroughs/screenshots/`.

---

## 6. Not Done / Awaiting Day 2 or the Owners

1. **Real Day 2 Branch Merge (`orders.payment_rules`):**
   - The Day 2 codebase containing authoritative payment rules and `packing_decision` does not exist on this branch.
   - The integration test suite (`backend/orders/test_integration_day2_day3.py`) imports `orders.payment_rules` conditionally. When merged by the repository owners, cases 1 through 6 will automatically execute without changes.
2. **Real Postal Booking Evidence (India Post):**
   - India Post API integration is not available in local or CI environments. Consignment numbers used in local tests and mock scenarios are simulated identifiers.
   - Live end-to-end postal tracking requires booking receipts and manifests from a production India Post facility.
3. **Real Payment Provider Integration (Razorpay Live Capture & Webhooks):**
   - Automated tests rely on simulated payment states and mock responses. Live verification requires real Razorpay test credentials or production webhooks.
4. **India Post Direct Article Deep Linking:**
   - India Post's official consignment tracking portal (`https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx`) does not support direct URL query parameters for article numbers.
   - As specified, the application opens the official portal in a new tab / external browser and guides the parent with a copy-paste hint. Direct deep linking will only be supported if India Post introduces a verified query-parameter endpoint in the future.
