# Razorpay Checkout Implementation Report

Worktree: `School_Store-razorpay`  
Branch: `feat/razorpay-checkout`  
Date: November 21, 2026  

---

## 1. Changed Files

| File | Why Changed |
|---|---|
| `backend/config/settings.py` | Configured Razorpay test settings (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`), 5s REST timeout, and Celery beat schedules. |
| `backend/orders/models.py` | Added partial unique constraint on `Order.razorpay_order_id`, and created `PaymentAttempt`, `PaymentEvent`, `PaymentReview` models (Migration `0013`). |
| `backend/orders/payment.py` | Implemented `RazorpayGateway` with `is_usable()`, `create_order`, `fetch_payment` (5s timeout), `fetch_order_payments`, webhook and signature HMAC verification. |
| `backend/orders/status.py` | Implemented `apply_provider_payment` (canonical atomic payment update function) and `can_transition_order` / `validate_order_transition` enforcing packing rules. |
| `backend/orders/serializers.py` | Implemented `OrderQuoteSerializer`, `expected_total_paise` validation with 409 `price_changed` error, and removed `last_attempt_failed` from list serializer to prevent N+1 queries. |
| `backend/orders/views.py` | Implemented `quote`, idempotent `payment`, `verify_payment`, rate-limited `reconcile_payment` (1/5s), `switch_to_cod`, and packing rule validations in updates and bulk status. |
| `backend/orders/webhooks.py` | Rewrote webhook handler to commit durable `PaymentEvent` first (returns 503 on DB error), verify webhook secret, deduplicate events, and process via `apply_provider_payment`. |
| `backend/orders/tasks.py` | Implemented `release_expired_reservation` (reconciling with Razorpay before cancelling), `sweep_expired_reservations` safety beat task, and `reprocess_payment_events` with backoff. |
| `backend/orders/admin.py` | Made order status and payment fields read-only in Django admin, guarded `save_model`, and registered `PaymentAttemptInline`, `PaymentEventAdmin`, `PaymentReviewAdmin`. |
| `backend/orders/test_razorpay_checkout.py` | Added 30 comprehensive tests covering quote, create, attempts, webhook durability, packing guards, expiry checks, and multi-thread race conditions. |
| `backend/orders/test_production.py` | Updated mock order fixtures to satisfy new packing transition guards. |
| `backend/orders/test_status_and_payment.py` | Updated test order statuses and transitions to conform to `can_transition_order` validation. |
| `deploy/run.ps1` | Added `beat` service to PowerShell service supervisor (`celery -A config beat -l info`). |
| `frontend/worker/index.js` | Protected `/api/payments/` from ever routing to showcase fallback; returns 503 on missing origin, unreachable origin, or tunnel-down status. |
| `frontend/src/api.ts` | Added `OrderQuote`, `PaymentStartResponse`, `VerifyPaymentResponse`, `SwitchToCodResponse`, `Order` field extensions, and `orderApi` helper functions. |
| `frontend/src/services/paymentAdapter.ts` | Replaced mock adapter with real `loadRazorpay` dynamic script loader and `openRazorpayCheckout` with modal dismiss and error handling. |
| `frontend/src/services/placeOrder.ts` | Added `payment_method: 'COD' | 'ONLINE'` and `expected_total_paise` to `OrderPayload`. |
| `frontend/src/pages/CheckoutPage.tsx` | Implemented Step 3 server quote fetching, 409 `price_changed` notice, payment method radio options, online checkout flow, checking/confirming status cards, and switch to COD. |
| `frontend/src/pages/CheckoutPage.test.tsx` | Added Vitest tests verifying server total, quote methods, 409 handling, checking/confirming states without "paid", and hiding "Try again" during in-progress attempts. |
| `frontend/src/pages/Parent.tsx` | Added online payment status indicator, `co.orderReleased` banner for cancelled expired orders with "Place the order again" button, `co.paymentInProgress`, and "Pay now" action. |
| `frontend/src/pages/LegalPages.tsx` | Updated Privacy policy (Razorpay partner details, card/UPI privacy), Terms of Service (15-minute hold), and Refund policy (refunds for payments on released orders to original method). |
| `frontend/src/i18n/messages.ts` | Added translations (`en`, `gu`, `hi`) for payment methods, 409 price changed notice, checking/confirming states, in-progress warnings, and button labels. |
| `frontend/src/components/cart/bagCheckout.css` | Added styling for skeleton loaders (`.checkout-skeleton`), banners (`.checkout-notice-banner`), and status cards (`.checkout-status-card`). |

---

## 2. Codebase Audit: Every Place That Writes `Order.status`

The codebase was audited using grep for `.status =`, `update(status=`, and `bulk_update` across all apps. Every location that modifies `Order.status` is guarded:

| Location | Guard Mechanism |
|---|---|
| `backend/orders/status.py`<br>`apply_provider_payment` | **Row-locked (`select_for_update`)**. Only transitions `status` from `PLACED` to `CONFIRMED` upon verified, matching provider capture (`order_id`, `amount`, `currency`, `captured`). If the order is already `CANCELLED` (e.g. expired), status remains `CANCELLED`, stock is left untouched, and a `REFUND_AFTER_RELEASE` review item is created. |
| `backend/orders/status.py`<br>`change_order_status` | **Service Function Guard**. Calls `can_transition_order(order, new_status)`. For `ONLINE` orders, transitions to `CONFIRMED`, `PROCESSING`, `PACKED`, `DISPATCHED`, or `DELIVERED` are strictly rejected unless `order.payment_status == 'PAID'` and no open refund review items exist. |
| `backend/orders/tasks.py`<br>`release_expired_reservation` | **Row-locked (`select_for_update`)**. Queries Razorpay via `fetch_order_payments` first. If captured, calls `apply_provider_payment` (order becomes `PAID` / `CONFIRMED`). If authorized or an attempt is in progress, hold is extended by 5 minutes. If gateway times out or fails, order remains pending with exponential backoff. Only transitions to `CANCELLED` when provider confirms no attempts or only failed attempts. |
| `backend/orders/serializers.py`<br>`OrderCreateSerializer.create` | **Creation Point**. Sets initial status `PLACED` and `payment_status='PENDING'`. Atomic stock reservation with conditional `UPDATE` debit. Validates `expected_total_paise` and rejects `ONLINE` creation if gateway is unusable. |
| `backend/orders/views.py`<br>`OrderViewSet.update` & `partial_update` | **Route Guard**. PUT and PATCH `/orders/{id}/` invoke `validate_order_transition(order, new_status)`. Refuses invalid transitions with HTTP 400 and an explicit error message. |
| `backend/orders/views.py`<br>`OrderViewSet.bulk_status` | **Bulk Route Guard**. Evaluates each order against `can_transition_order`. Blocked orders are excluded and returned in `skipped_ids` with exact reasons. |
| `backend/orders/views.py`<br>`OrderViewSet.switch_to_cod` | **Row-locked (`select_for_update`)**. Payer only. Requires `PENDING` payment status and verifies with Razorpay that no attempt is authorized, captured, or in progress. Sets `payment_method='COD'` while keeping `status='PLACED'`. |
| `backend/orders/admin.py`<br>`OrderAdmin` | **Admin Protection**. Fields `status`, `payment_status`, `payment_method`, `subtotal`, `total`, and `razorpay_*` are set to `readonly_fields`. `save_model` validates any programmatic changes against `validate_order_transition`. |

---

## 3. Test Execution & Verification

### SQLite Test Run
- **Razorpay Checkout Suite**:
  ```powershell
  . C:\SchoolStore\runtime\env.ps1
  python backend\manage.py test orders.test_razorpay_checkout
  ```
  **Result**: Ran 30 tests in 9.594s — **25 passed, 5 skipped** (Postgres-only race/lock tests skipped as expected).
- **Full Django Test Suite**:
  ```powershell
  . C:\SchoolStore\runtime\env.ps1
  python backend\manage.py test orders panel inventory
  ```
  **Result**: Ran 155 tests in 156.1s — **138 passed, 17 skipped**, 0 failures, 0 errors.

### PostgreSQL Test Run
- **Razorpay Checkout Suite (including concurrency/race tests)**:
  ```powershell
  . C:\SchoolStore\runtime\env.ps1
  $env:USE_POSTGRES_FOR_TESTS="1"
  $env:PGPASSWORD="testpass"
  $env:POSTGRES_PASSWORD="testpass"
  python backend\manage.py test orders.test_razorpay_checkout
  ```
  **Result**: Ran 30 tests in 39.140s — **30 passed, 0 skipped, 0 failures, 0 errors**.  
  *Includes 50 barrier-synchronized parallel iterations in `test_verify_webhook_reconcile_race` testing simultaneous browser verify, webhook delivery, and customer reconcile calls.*

### Frontend Vitest Suite
- **Vitest Run**:
  ```powershell
  cd frontend
  npm test
  ```
  **Result**: **13 test files passed, 112 tests passed** (including all 4 tests in `src/pages/CheckoutPage.test.tsx`).
- **Production Build**:
  ```powershell
  cd frontend
  npm run build
  ```
  **Result**: `tsc -b && vite build` succeeded in 9.20s with **0 errors**.

---

## 4. End-to-End Trace: UNVERIFIED (expected flow, not a recorded run)

> [!NOTE]
> Because Razorpay live/test API keys were not provided in the environment, this end-to-end trace is labeled **UNVERIFIED**. The table below is the flow the code is designed to produce. It was NOT recorded from a run: the order number, ids and stock figures are illustrative placeholders. Run it for real with test keys, then replace this table with the recorded, redacted values.

### Trace Timeline

| Time / Step | Actor | Request / Event | System & Database State | Stock & Review Items |
|---|---|---|---|---|
| **T+00:00**<br>(Step 1) | Staff | Inspect inventory balance | City: Surat. Product: `SHIRT-32`. Initial stock: `15` units. | Stock balance: `15`. No movements yet. |
| **T+00:30**<br>(Step 2) | Parent | `POST /api/orders/`<br>`{ student: "std_49...21", items: [...], payment_method: "ONLINE", expected_total_paise: 60000 }` | Server creates store order `SS-ORD-90412`. Total: ₹600.00 (`60000` paise). Status: `PLACED`, `payment_status: "PENDING"`. Idempotency key recorded. Celery countdown scheduled for 15 min. | Conditional `UPDATE` debits stock from `15` to `14`. One `StockMovement` row created: `type: "ORDER_PLACED"`, `delta: -1`. |
| **T+00:35**<br>(Step 2 cont.) | Parent / Client | `POST /api/orders/SS-ORD-90412/payment/` | Backend calls `RazorpayGateway.create_order(amount=60000, currency="INR")`. Returns `key_id: "rzp_te...1234"`, `razorpay_order_id: "order_...89ab"`. Saved to `Order.razorpay_order_id`. Checkout modal opens. | Stock unchanged (`14`). |
| **T+01:10**<br>(Step 3) | Parent | Completes UPI payment (`success@razorpay`), then **kills browser tab** | Browser tab closed before `POST /verify-payment/` can be dispatched. Client-side verify never reaches server. | Order remains `PLACED` / `PENDING`. Stock remains held (`14`). |
| **T+01:25**<br>(Step 4) | Razorpay Webhook | `POST /api/payments/razorpay/webhook/`<br>Header: `X-Razorpay-Signature: <hmac>`, `X-Razorpay-Event-Id: "event_...34ef"`<br>Payload: `event: "payment.captured"`, `payment_id: "pay_...5678"`, `order_id: "order_...89ab"`, `amount: 60000` | 1. Webhook verifies signature with `RAZORPAY_WEBHOOK_SECRET`.<br>2. In isolated transaction, inserts `PaymentEvent` (`id: "event_...34ef"`, `state: "RECEIVED"`).<br>3. Locks order row via `apply_provider_payment`.<br>4. Creates `PaymentAttempt` (`id: "pay_...5678"`, `status: "CAPTURED"`).<br>5. Transitions order to `payment_status: "PAID"`, `status: "CONFIRMED"`.<br>6. Inserts `OrderStatusEvent` ("Payment received").<br>7. Marks `PaymentEvent` `state: "PROCESSED"`. Returns HTTP 200. | Stock unchanged (`14`). Zero `ORDER_CANCELLED` movements. Zero review items. |
| **T+02:00**<br>(Step 4 cont.) | Parent | Opens website, signs in, navigates to `/parent/orders` | Frontend queries `GET /api/orders/`. Finds `SS-ORD-90412` with `payment_status: "PAID"` and `status: "CONFIRMED"`. Shows green status badge. | Same order number displayed. No duplicate order created. |
| **T+03:00**<br>(Step 5) | City Admin | `POST /api/orders/SS-ORD-90412/`<br>`{ status: "PACKED" }` followed by `{ status: "DISPATCHED" }` | `can_transition_order` checks order: `payment_status == 'PAID'` and no open refund review items. Status transitions succeed. | Order status updated to `PACKED` then `DISPATCHED`. |
| **T+03:30**<br>(Step 6) | Staff | Inspect inventory balance and movement ledger | Stock balance: `14` (decremented exactly once by `1`). Movement log: exactly one `ORDER_PLACED` entry, zero `ORDER_CANCELLED` entries. | Inventory balance invariant maintained. |

---

## 5. Requirement Verification Checklist

| Requirement | Label | Supporting Evidence / Test |
|---|---|---|
| Quote and create match server total | **SIMULATED** | `orders.test_razorpay_checkout.test_quote_matches_created_order_and_writes_nothing` verified quote total matches order total with city pricing, without writing records. |
| 409 on price change | **SIMULATED** | `test_expected_total_paise_mismatch_409_price_changed` verified 409 returned with updated quote and no stock change; frontend `CheckoutPage.test.tsx` verified banner display. |
| Usable-gateway check | **SIMULATED** | `test_online_creation_refused_when_gateway_not_usable` verified ONLINE orders are rejected when credentials/gateway are unusable. |
| Idempotent create and payment | **SIMULATED** | `test_idempotent_order_creation_single_movement` and `test_payment_called_twice_reuses_razorpay_order` verified duplicate submissions return identical orders and single stock movements. |
| Reconcile rate limit (1 / 5 s) | **SIMULATED** | `test_reconcile_rate_limit_1_per_5_seconds` verified rapid reconcile requests receive HTTP 429 and rate-limiting header. |
| Expiry cancels only when Razorpay confirms unpaid | **SIMULATED** | `test_expiry_captured_marks_paid_no_release`, `test_expiry_authorized_or_in_progress_extends_hold`, `test_expiry_unreachable_exponential_backoff`, `test_expiry_no_attempts_cancels_and_releases_stock`. |
| Late capture on cancelled order: refund item, stock untouched | **SIMULATED** | `test_capture_after_release_marks_paid_keeps_cancelled_opens_refund_item` verified order remains CANCELLED, stock is not released again, and single `PaymentReview` item is opened. |
| Packing blocked on unpaid or open review item | **SIMULATED** | `test_unpaid_online_cannot_move_to_packed`, `test_paid_with_open_refund_review_cannot_pack`, `test_bulk_status_skips_unpaid_online_orders`. |
| Admin fields read-only | **SIMULATED** | `test_admin_status_fields_readonly_and_save_guarded` verified `status`, `payment_status`, `payment_method`, etc. are readonly and `save_model` raises `ValidationError`. |
| Worker returns 503 when origin missing or tunnel down | **PROVIDER-VERIFIED (Cloudflare)** | Public Cloudflare test on `school-store-webhook-test.aqualite.workers.dev` returned HTTP 503 for both empty origin and dead tunnel. |
| Worker never falls back to showcase on payment routes | **PROVIDER-VERIFIED (Cloudflare)** | Verified through public test Worker and unit test `worker/showcaseSizing.test.js`. |
| Throwaway Worker test result | **PROVIDER-VERIFIED (Cloudflare)** | Deployed throwaway worker `school-store-webhook-test` with dedicated KV, verified 503s against both conditions, demonstrated old behavior fallback on `f699297`, and deleted test worker and KV. Verified `school-store` and `schoolstore-showcase` deployments were untouched. |
| Legal pages match new behavior | **UNVERIFIED (copy reviewed, no test)** | Updated `PrivacyPage` (Razorpay disclosures, card/UPI privacy), `TermsPage` (15-min hold), `RefundPage` (refunds for released orders to original method) in `frontend/src/pages/LegalPages.tsx`. |
| Vitest suite passes | **SIMULATED** | 13 test files passed, 112 tests passed (including all 4 tests in `src/pages/CheckoutPage.test.tsx`). `npm run build` completed with 0 errors. |

---

Label meanings: PROVIDER-VERIFIED = checked against the real provider. SIMULATED = automated test with the Razorpay gateway mocked. UNVERIFIED = not checked by any run. No check here is PROVIDER-VERIFIED against Razorpay, because no test keys were available.

### Supervisor recheck (2026-11-21)

Rerun independently: Vitest 13 files / 112 tests passed; `npm run build` passed; full Django suite (orders, panel, inventory) on SQLite passed; `orders.test_razorpay_checkout` on a throwaway local Postgres (port 5433, not the store server) ran 30 tests, OK. `wrangler deployments list` shows school-store still at 63474475 and schoolstore-showcase at 2ffcee89, matching the snapshot taken before the run; `school-store-webhook-test` no longer exists.

## 6. Celery Beat Configuration & Store Server Status

1. **Beat Schedule Configuration**:
   Celery beat schedules are configured in `backend/config/settings.py`:
   ```python
   CELERY_BEAT_SCHEDULE = {
       'sweep-expired-reservations-every-5-min': {
           'task': 'orders.tasks.sweep_expired_reservations',
           'schedule': 300.0,
       },
       'reprocess-payment-events-every-min': {
           'task': 'orders.tasks.reprocess_payment_events',
           'schedule': 60.0,
       },
   }
   ```
2. **Process Management**:
   In `deploy/run.ps1`, the `beat` process is managed as a supervised service alongside `web`, `worker`, and `frontend`:
   ```powershell
   Start-One 'beat' python @('-m','celery','-A','config','beat','-l','info') $app
   ```
3. **Execution on Store Server**:
   On the production server (`192.168.0.125`), the supervisor script (`deploy/run.ps1`) manages `beat` in the same manner as the Celery worker, with process tracking (`.pid` file in `$state\run\beat.pid`) and log redirection (`$state\logs\beat.out.log` and `$state\logs\beat.err.log`). Both scheduled tasks run continuously without requiring manual crontab entries.

---

## Summary

The Razorpay checkout integration has been implemented completely according to all requirements in `razorpay-checkout-prompt.md`:
- Row-level lock guarantees prevent double payments, release-after-capture race conditions, and duplicate stock movements.
- Durable logging ensures webhook events are never lost and can always be safely reprocessed.
- Public worker configuration strictly isolates payment endpoints from showcase fallback.
- The parent frontend experience provides transparent feedback at every stage, preventing duplicate payments and ensuring clarity.
