# Razorpay return recovery

**Razorpay verification: none.** The recovery worktree had none of the three required test settings configured. No test account mode was observable, no dashboard or tunnel was used, and no webhook was registered. Provider interactions below were simulated. The COD scenario used the local app with zero gateway calls.

Branch: `fix/razorpay-return-recovery` from `ad16038`. No push, merge, deployment, Cloudflare write or store database connection was made.

## Review pass, 21 November 2026 (evening)

**Real Razorpay: UNVERIFIED.** This worktree has no `backend/.env`, so there were no sandbox keys. Real Checkout and real webhook delivery were not tried. Everything below used a fake gateway (scripted payment answers) and a stub in place of `checkout.js`. Nothing was pushed or deployed, and nothing connected to the store server.

### Regressions found and fixed (each with a test that fails without the fix)

| Commit | Problem | Test |
| --- | --- | --- |
| `3ab85e6`, `9c618ac` | The saved order key was cleared as soon as an online order was created. A parent who left the payment screen with the bag still full, or added the same items again, got a new key, and checking out again made a **second order** (and a possible second payment). The saved copy now stays, tied to the order id, until that order is paid, released or moved to cash. The payment choice no longer makes it a different order. A cancelled earlier order starts a new one. (A full page load empties the bag, so this happens without a reload.) | `frontend/src/services/placeOrder.test.ts`, 2 cases in `CheckoutPage.test.tsx` |
| `5671f9d` | When the same items found the earlier unpaid online order but the parent picked cash, Checkout reopened Razorpay. It now calls switch-to-COD. The server checks Razorpay first and refuses while a payment may still go through. | 2 cases in `CheckoutPage.test.tsx` |
| `396a2aa` | A **delivered** COD order still said "Pay ₹X when the order arrives". Nothing is due after delivery now, and the My Orders card shows the order total again. | `backend/orders/test_recovery_review.py` |
| `46c5471` | After My Orders' check found a capture, the card showed the receipt but kept the old `PLACED` badge and timeline. A check that settles the payment now fetches the orders again. Found on the phone run. | `frontend/src/pages/ParentOrders.test.tsx` |

Also added, and already passing (no bug): the staff "payments to check" queue and manual check stay inside each role's scope. Parents and teachers get 403. COD never calls Razorpay from PLACED to DELIVERED. Staff-cancelled orders are not shown as released.

### Test results after the fixes

- Full `vitest`: 17 files, 129 tests passed. App type-check (`tsc -p tsconfig.build.json`) passed.
- Django on SQLite, `orders panel inventory`, run **before** these fixes: 145 ran, OK, 17 skipped. After the fixes I ran only `orders.test_recovery_review` and `orders.test_payment_contract`: 12 tests, OK. The full Django suite and the Postgres run were **not** repeated after the `payment_view.py` change.

### Phone-size Playwright run (Pixel 7 profile, local stack, SIMULATED)

Local Django on a throwaway SQLite database, with the fake gateway. Vite was pointed at it with `VITE_API_PROXY_TARGET` (its default target is the live Worker). Requests to any non-local host were blocked and logged: none were attempted. The OTP limit was raised to 100/min for this run, because the real limit (5/min, send and verify counted together) stops repeated sign-ins.

- **A. Paid, browser closed before success, fresh sign-in:** passed. Checkout opened with the store order's Razorpay order id, ₹800, a timeout from the hold, and retry off. A new context signed in by OTP, with an empty bag, found **one** order, `CONFIRMED` with its receipt and no payment button. [Screenshot](recovery-evidence/review/A-paid-after-browser-closed.png)
- **B. Payment window closed, back to the full bag, cash picked:** passed in one run. Orders went 1 → 2 → 2 (no second order). The order became COD and Razorpay was not reopened. [Dismissed](recovery-evidence/review/B1-dismissed.png) · [Same items, cash](recovery-evidence/review/B2-same-items-cash.png)
- **C. Payment still `created` on return:** passed in that run. "Checking payment" and "Refresh status" were shown with no Pay or cash button, and the server answered 409 `payment_in_progress`. After the fake payment failed, Refresh status offered Pay and Pay cash on the same order. [In progress](recovery-evidence/review/C-in-progress.png) · [Then failed](recovery-evidence/review/C-then-failed.png)
- **D (outage), E (COD delivered in the browser), F (staff queue in the browser): not completed.** The script was still being moved from hand-rolled history changes to real link navigation when the session ended. D and E are covered by the backend tests above. F is covered by the existing and new backend tests.
- **Open question:** on a second checkout in the same tab, the "Choose your child" picker sometimes opened and closed about 80 ms later with no click. It appeared while the script changed pages with `pushState` outside React Router. I did not finish checking it with real navigation, so it is not yet known whether a parent can hit it.

## Follow-up verification, 21 November 2026

The checkout and order recovery work now has a generated server contract and passing regression suites. The initial failure counts and statements about pending fixture work below document the earlier run and are superseded by this section.

- The local browser exposed a password redirect from My Orders. That route now uses the existing parent OTP sheet and preserves the My Orders URL. Browser inspection confirmed the number field and Send OTP button. Verification used the desktop web workflow after the ARTEMIS autonomous run stalled.
- The command `python manage.py export_payment_contract frontend/src/test/fixtures/payment-contract.json` builds real API responses for all seven states, the start payload and the 409 and 503 refusals. It mocks the gateway and rolls back the sample data.
- The Checkout, payment status and staff queue tests use the generated fixture. Backend regressions cover payload parity, query count, parent scope, hold safety, rate limiting, staff access and reconciliation reasons.
- Updated legacy expectations `test_05_payment_called_twice_creates_razorpay_order_once_with_paise_amount` and `test_retrying_payment_reuses_the_razorpay_order` to check the public field names and the mandatory provider lookup. `test_unpaid_online_order_still_expires` now advances the persisted hold deadline. The Checkout tests use the shared payment view, updated screen labels and the provider options actually passed by the storefront.
- Test results, with zero failures in every run

  | Command | Passed | Skipped |
  | --- | ---: | ---: |
  | `python manage.py test orders panel inventory` (SQLite) | 121 | 17 |
  | `USE_POSTGRES_FOR_TESTS=1 python manage.py test orders panel inventory` (PostgreSQL) | 138 | 0 |
  | `python manage.py test orders.test_payment_contract` (SQLite) | 7 | 0 |
  | `USE_POSTGRES_FOR_TESTS=1 python manage.py test orders.test_payment_contract` (PostgreSQL) | 7 | 0 |
  | `npm test` | 121 | 0 |

  The two full backend runs began before the seven new focused tests were added and the focused tests were run separately on both engines. `npm run build` passed with the existing bundle size advisory.
- No Razorpay test credentials were supplied for this worktree. Real Checkout and real webhook delivery remain unverified. The original browser captures and local simulations are preserved.

Additional files changed in the follow-up

- `backend/orders/management/commands/export_payment_contract.py`
- `backend/orders/test_payment_contract.py`
- `backend/orders/test_payment_method.py`
- `backend/orders/test_razorpay_checkout.py`
- `backend/orders/test_status_and_payment.py`
- `frontend/src/App.tsx`
- `frontend/src/components/PaymentStatus.test.tsx`
- `frontend/src/components/PaymentsToCheck.test.tsx`
- `frontend/src/pages/CheckoutPage.test.tsx`
- `frontend/src/test/fixtures/payment-contract.json`

## Part A

The original code at `ad16038` confirmed all ten findings. The existing tests remain unchanged. New test authoring and the test-first sequence could not proceed because the required ARTEMIS exploration was blocked by a missing multimodal model credential and no active Android device. Part D's generated contract fixture, management command and dedicated regression suites remain outstanding. The demonstrations below used the real local API and browser with simulated provider results.

| Finding | Change | Existing coverage and observed result |
| --- | --- | --- |
| A1 | `518c2b0` returns the provider order ID, paise, order number, deadline and prefill under the agreed response keys. | `test_05_payment_called_twice_creates_razorpay_order_once_with_paise_amount` still indexes the removed `order_id` key. Simulated start returned HTTP 200. |
| A2 | `518c2b0`, `d259041` use `payment_view.in_progress` and refuse a new attempt after reconciliation. | Case 3 confirmed 409 and the in-progress copy. The existing Vitest in-progress test still supplies the old payload. |
| A3 | `518c2b0`, `dc87554` persist provider failure, report whether a fresh check ran and block retry on a deferred check. | Case 3 confirmed 503 and the outage copy. Case 4a observed a failed attempt, then recovered the same order. |
| A4 | `518c2b0`, `d259041`, `d967e2b` add and consume the shared payment state. My Orders can fetch a linked order beyond the first page. | Fresh Pixel 7 contexts rendered server orders after OTP sign-in. Query sampling returned 2 queries for both 1 and 20 orders with zero gateway calls. |
| A5 | `518c2b0`, `d259041` persist and use the hold deadline. Both callers derive the provider timeout from that deadline minus 60 seconds. | Case 4c exercised expiry. The existing expiry test changes `created_at` while the new stored deadline remains in the future. |
| A6 | `d259041`, `d967e2b` use the server receipt for online success and poll the order when confirmation is pending. | The existing Vitest confirming test supplies legacy mocks that omit the required deadline and payment view. |
| A7 | `518c2b0`, `d259041` use a typed expiry cancellation reason to show the release message. | Case 4c observed RELEASED. A dedicated staff-cancelled COD regression was not authored. |
| A8 | `d259041`, `dc87554`, `d967e2b` share one browser checkout lock, handle callback errors and disable SDK retries so retries route through the store. | The 409 and 503 API refusals were observed. Opening an actual Razorpay checkout was unverified. |
| A9 | `518c2b0`, `d259041`, `dc87554` expose reconciliation metadata and add scoped queues, counts and a manual check action. | The BOSS queue showed the simulated outage and its reason. A cross-role regression suite remains outstanding. |
| A10 | Confirmed. Production TypeScript build compiles application sources. | Existing hand-written test responses remain. The contract fixture and parity tests are outstanding. |

## Changed files

- `backend/orders/migrations/0014_payment_recovery.py`
- `backend/orders/models.py`
- `backend/orders/payment.py`
- `backend/orders/payment_view.py`
- `backend/orders/serializers.py`
- `backend/orders/status.py`
- `backend/orders/tasks.py`
- `backend/orders/views.py`
- `backend/panel/payments.py`
- `backend/panel/serializers.py`
- `backend/panel/services.py`
- `backend/panel/urls.py`
- `backend/panel/views.py`
- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/api.ts`
- `frontend/src/components/PaymentReturnNotice.tsx`
- `frontend/src/components/PaymentStatus.tsx`
- `frontend/src/components/PaymentsToCheck.tsx`
- `frontend/src/components/cart/BagDrawer.tsx`
- `frontend/src/components/cart/bagCheckout.css`
- `frontend/src/i18n/messages.ts`
- `frontend/src/pages/BossPanel.tsx`
- `frontend/src/pages/CheckoutPage.tsx`
- `frontend/src/pages/CityAdmin.tsx`
- `frontend/src/pages/Parent.tsx`
- `frontend/src/pages/SchoolAdmin.tsx`
- `frontend/src/services/orderPayment.ts`
- `frontend/src/services/paymentAdapter.ts`
- `frontend/src/services/placeOrder.ts`
- `frontend/tsconfig.build.json`
- `RECOVERY_REPORT.md`
- `recovery-evidence/1a-parent.png`
- `recovery-evidence/1b-parent.png`
- `recovery-evidence/2-parent.png`
- `recovery-evidence/3-parent.png`
- `recovery-evidence/4a-parent.png`
- `recovery-evidence/4b-parent.png`
- `recovery-evidence/4c-parent.png`
- `recovery-evidence/5-parent.png`
- `recovery-evidence/staff-orders.png`
- `recovery-evidence/staff-reconciliation.png`

## Decisions I made

- Razorpay describes a typical payment timeout around 10 minutes followed by a possible late authorisation. The documentation does not establish a universal maximum time in `created`. The 15-minute limit is a store rule. A stale created attempt opens one reconciliation review and stops blocking a fresh attempt on the same Razorpay order after a successful provider check. Expiry keeps stock reserved while Razorpay still reports an unsettled attempt. This protects fulfilment while the payment can clear. Test-mode timing is unverified. [Razorpay payment timeout and late authorisation](https://razorpay.com/learn/payment-timeout/)
- Reconciliation returns a conservative CHECKING view when a same-order call is rate-limited and the current state would otherwise offer retry. The check timestamp stays unchanged. Each actual provider query updates the timestamp, and a separate field tracks the start of a consecutive outage for staff escalation.
- For existing online orders without a stored hold, the original creation time plus 15 minutes supplies the deadline. Orders cancelled before this change lack a typed expiry reason, so the release message requires a reason written by the expiry task.
- A legacy paid flag without a matching captured attempt cannot produce a receipt. An online order cancelled by staff without a capture has no retry, COD switch or release message.
- The Razorpay modal has retry disabled so retrying from the store checks the original order again first. The browser lock is scoped to one running app instance. The server row lock serializes start requests and reuses a single provider order. A provider checkout window that has opened without creating a provider attempt is not separately recorded. [Razorpay checkout retry option](https://hdfcbank-collectnow-docs.razorpay.com/payments/payment-gateway/android-integration/standard/integration-steps/)
- The production build uses `frontend/tsconfig.build.json` for application type-checking. The legacy Vitest fixtures still run in `npm test` and their failures remain visible there.

## Local demonstration setup

Django, Celery worker, Celery beat and Vite were run on this PC, with an isolated PostgreSQL instance on port 55472 and Redis on 56379. The demo used one school, one parent, one child and two SKUs. Stock totals listed below apply separately to each SKU. Playwright used the Pixel 7 profile for parent captures, closed an initial context and signed in again through the local OTP endpoints in a new context. The screenshots show the returned orders, after backend scenarios were driven through local API calls. The staff capture uses the local BOSS account without password entry. No external Checkout interaction was attempted without test credentials.

## Case 1a. Capture via webhook, no browser callback

- **SIMULATED.** A locally signed `payment.captured` event produced HTTP 200 with no browser verification callback. The event ID was `demo_e…001a`, state PROCESSED, tries 0. The store recorded one CAPTURED attempt at 80,000 paise from WEBHOOK and no review.
- **SIMULATED.** `ORD-88142EF569A24583` was CONFIRMED / ONLINE / PAID, view PAID, total ₹800. Each SKU went 49 → 48 with one ORDER_PLACED −1 movement.
- **SIMULATED.** My Orders showed “Payment received.” and a receipt for ₹800, order `ORD-88142EF569A24583`, UPI and reference ending 001a. There was no payment button. [Parent](recovery-evidence/1a-parent.png) · [Staff orders](recovery-evidence/staff-orders.png)
- **UNVERIFIED.** Real Checkout success, Playwright abort of its verify callback and real webhook delivery required test credentials.

## Case 1b. Capture recovered without webhook

- **SIMULATED.** Started `ORD-69FD9DE056D84E6D`, which returned CHECKING. Local reconcile with the mocked captured payment returned 200 and `checked: true`. The result was CONFIRMED / ONLINE / PAID, view PAID, total ₹800. One CAPTURED attempt at 80,000 paise from RECONCILE. No events or reviews. Each SKU went 48 → 47 with one ORDER_PLACED −1 movement.
- **SIMULATED.** A fresh browser showed “Payment received.” and the ₹800 receipt for that same order with reference ending 1001. No payment button. The initial CHECKING result was observed through the API before browser sign-in. [Parent](recovery-evidence/1b-parent.png) · [Staff orders](recovery-evidence/staff-orders.png)
- **UNVERIFIED.** Recovery through the real provider from automatic browser reconciliation required test credentials.

## Case 2. Webhook first, browser verification, then replay

- **SIMULATED.** Webhook, verification with mocked provider fetch, and exact-body webhook replay each returned 200. The only provider event was `demo_e…0002`, type payment.captured, PROCESSED, tries 0. There were two status events total, placement and one capture. One CAPTURED attempt at 80,000 paise from WEBHOOK. No reviews.
- **SIMULATED.** `ORD-EC47D2B54AB54E57` was CONFIRMED / ONLINE / PAID, view PAID, total ₹800. Each SKU went 47 → 46 with one ORDER_PLACED −1. The parent saw “Payment received.” and a receipt for ₹800 with reference ending 0002. No payment button. [Parent](recovery-evidence/2-parent.png) · [Staff orders](recovery-evidence/staff-orders.png)
- **UNVERIFIED.** First delivery from Razorpay's test dashboard and interception of an actual browser callback required test credentials.

## Case 3. Pending on return and provider outage

- **SIMULATED.** Mocked CREATED yielded HTTP 409 `payment_in_progress` on direct payment start. A forced timeout yielded HTTP 503 `payment_check_failed`. The order `ORD-76B465EADA224ED2` stayed PLACED / ONLINE / PENDING, view CHECKING, total ₹800. One CREATED attempt at 80,000 paise from RECONCILE, no events or reviews. Stock went 46 → 45 on each SKU with one ORDER_PLACED −1.
- **SIMULATED.** The parent saw “Checking payment”, “We are checking whether your payment of ₹800 for order ORD-76B465EADA224ED2 went through. Please do not pay again.”, “A payment is still in progress. Check your UPI app.”, the provider outage message, last checked time and “Refresh status”. No Pay button. An outage age moved to eleven minutes showed `PROVIDER_UNREACHABLE` in the staff queue. [Parent](recovery-evidence/3-parent.png) · [Staff queue](recovery-evidence/staff-reconciliation.png)
- **UNVERIFIED.** Leaving a real test payment pending and then completing or failing that payment required test credentials.

## Case 4a. Failed attempt followed by success

- **SIMULATED.** `ORD-50886C0726774E05` first returned NOT_PAID with one FAILED attempt. Payment start returned 200 on the existing gateway order. Reconcile then returned PAID. Final status CONFIRMED / ONLINE / PAID, total ₹800. Final attempts were FAILED and CAPTURED, each 80,000 paise from RECONCILE. No events or reviews. Each SKU went 45 → 44 with one ORDER_PLACED −1.
- **SIMULATED.** The screenshot shows the final “Payment received.” and receipt for ₹800 with payment reference ending 4002. The earlier failed state was exercised through the API. [Parent](recovery-evidence/4a-parent.png) · [Staff orders](recovery-evidence/staff-orders.png)
- **UNVERIFIED.** Test bank failure, parent retry in real Checkout and a browser capture of the intermediate failed state.

## Case 4b. Checkout abandoned and switched to COD

- **SIMULATED.** An empty provider payment list yielded NOT_PAID. The switch-to-COD endpoint reconciled again and returned HTTP 200. `ORD-2177F7449BFA4277` ended PLACED / COD / PENDING, view COD_DUE, total ₹800. No attempts, events or reviews. Each SKU went 44 → 43 with one ORDER_PLACED −1.
- **SIMULATED.** My Orders showed “Cash on delivery. Pay ₹800 when the order arrives.” and its timeline. [Parent](recovery-evidence/4b-parent.png) · [Staff orders](recovery-evidence/staff-orders.png)
- **UNVERIFIED.** Dismissal from a real Checkout modal and a screenshot of the pre-switch view.

## Case 4c. Hold expired

- **SIMULATED (time moved).** Moved the hold deadline into the past in local PostgreSQL and ran expiry twice. Calls returned true, then false. `ORD-54F54A4426DB46DC` became CANCELLED / ONLINE / PENDING, view RELEASED, total ₹800. No attempts, events or reviews. Each SKU went 43 → 42 → 43 with one ORDER_PLACED −1 and one ORDER_CANCELLED +1.
- **SIMULATED.** My Orders showed “This order was released because payment did not arrive in time. If money left your account it will be refunded within 7 working days.” and “Place the order again”. [Parent](recovery-evidence/4c-parent.png) · [Staff orders](recovery-evidence/staff-orders.png)

## Case 5. COD fulfilment

- **LOCAL ONLY.** The COD order `ORD-3AE8907DD77C4431` used the existing PLACED → CONFIRMED → PROCESSING → PACKED → DISPATCHED → DELIVERED transitions. Every change returned 200. Its original `payment_status` stays PENDING at every step, and payment view was COD_DUE with ₹800 due at each step. The expiry task left it alone. Zero gateway calls, attempts, events and reviews. Each SKU went 50 → 49 once with one ORDER_PLACED −1 movement.
- **LOCAL ONLY.** The final phone screenshot shows “Cash on delivery. Pay ₹800 when the order arrives.” and the existing timeline. [Parent](recovery-evidence/5-parent.png) · [Staff orders](recovery-evidence/staff-orders.png)

## Demonstration summary

| Case | RAZORPAY TEST MODE | SIMULATED | LOCAL ONLY | UNVERIFIED |
| --- | --- | --- | --- | --- |
| 1a |  | Local signed event and receipt |  | Real Checkout and delivery |
| 1b |  | Mocked reconcile and receipt |  | Real provider check from browser |
| 2 |  | Signed event, verification, replay |  | Real delivery and callback interception |
| 3 |  | Pending gate, outage gate and queue |  | Real pending payment lifecycle |
| 4a |  | Failure, retry and capture |  | Test bank and intermediate screenshot |
| 4b |  | Empty check and COD switch |  | Real Checkout dismissal |
| 4c |  | Time moved and stock released once |  |  |
| 5 |  |  | COD through delivery |  |

## Test output

Django used the existing Python environment with the repository-pinned Razorpay and setuptools installed in an isolated dependency directory. HTTP and HTTPS proxies were pointed at unused loopback for the Django suites to block accidental provider calls from legacy tests missing a gateway mock. PostgreSQL used a throwaway cluster on 127.0.0.1:55472. The full Django suites ran before the final tightening of the read-only attention query and rate-limited response. Both affected endpoints were exercised against local PostgreSQL afterwards.

| Command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `python manage.py test orders panel inventory` (SQLite) | 118 | 3, including 1 error | 17 |
| `USE_POSTGRES_FOR_TESTS=1 python manage.py test orders panel inventory` (PostgreSQL) | 135 | 3, including 1 error | 0 |
| `npm test` | 110 | 2 | 0 |
| `npm run build` | Production build passed, bundle size advisory | 0 | 0 |
| `python manage.py makemigrations --check --dry-run` | No changes detected | 0 | 0 |

Both Django runs reported the same three failures. `test_05_payment_called_twice_creates_razorpay_order_once_with_paise_amount` expects the removed `order_id` response key. `test_retrying_payment_reuses_the_razorpay_order` does not mock the now-required provider reconciliation and gets 503 instead of 200. `test_unpaid_online_order_still_expires` moves the creation timestamp and does not move the stored deadline. Vitest's “confirming and checking states never say paid” and “Try again is hidden while server reports attempt in progress” mocks lack the hold deadline and canonical payment view. No existing assertions were changed.

Manual query sampling with `CaptureQueriesContext` on PostgreSQL observed 2 SQL statements for 1 order and 2 for 20 orders, with zero gateway calls. The attention request returned only the CHECKING demo order. The staff queue contained that order with the provider outage reason. This sampling is runtime evidence. The requested automated query-count and permission cases remain outstanding.
