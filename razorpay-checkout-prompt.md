
## Task

Finish online payment for the public SchoolStore checkout using Razorpay in **test mode**. Parents must be able to pay by UPI, card or netbanking through Razorpay, or choose cash on delivery as they can today. This task covers the parent web checkout, the Django code it calls, and one routing rule in the public Worker.

## Work on your own until it is finished

The owner is asleep and no one will answer questions until morning. Do the whole task yourself, from reading the code to the final report.

- **Do not ask questions or wait for approval.** Where this prompt leaves a choice open, pick the option that is safest for money and stock. Write it down under "Decisions I made" in the report, and carry on.
- **Do not stop at a plan or a partial change.** Keep going until every section is done and every test passes, or until you have recorded exactly why something cannot be done.
- **You are already in the right place:** the worktree `C:\Users\rebel\OneDrive\Documents\GitHub\School_Store-razorpay`, on branch `feat/razorpay-checkout`. Work only in this folder.
- **Commit as you go** to `feat/razorpay-checkout`, in small commits with clear messages. Do not push.
- **Razorpay test keys are not available.** There is no `backend/.env` with them. Follow the "no credentials" rules in "What to return": run everything you can as `SIMULATED`, and label the end-to-end trace and other provider checks `UNVERIFIED`. Do not sign up for anything or create keys.
- **Postgres for the race tests:** use the PostgreSQL 17 install under `C:\Program Files\PostgreSQL\17` or the portable one in `C:\SchoolStore\runtime\postgres`, with a throwaway test database. Never connect to the store server's database or to `C:\SchoolStoreData`. If you cannot get a local Postgres running, label the race tests `UNVERIFIED` and say why.
- **Cloudflare:** the throwaway Worker in section 8 is approved. Deploy it with `CLOUDFLARE_ACCOUNT_ID=0e1accef8ef38c95615ccc2127999037` from its own config file, and never with `wrangler.jsonc`, `wrangler.showcase.jsonc` or `wrangler.preview.jsonc`.
- **When you finish,** write the full report from "What to return" to `RAZORPAY_REPORT.md` at the worktree root, commit it, and end your reply with the line `DONE`.

## Where to work, and what you must not do

- Start from branch `release/guest-nosave-portal` at `f699297`. That is what the live store runs. Create the branch `feat/razorpay-checkout` from it in a **separate git worktree**, not in the main `School_Store` folder.
- Never push to `main`. Do not merge into any `release/*` branch.
- **Do not deploy the store.** That means no `wrangler deploy` of `school-store`, `schoolstore-showcase` or `school-store-preview`, no writes to the `CONFIG` KV namespace, and nothing copied to the store server (192.168.0.125). The one exception is the throwaway test Worker in section 8. The owner has approved it, on the conditions given there.
- Never put a Razorpay key or secret in a committed file, a test fixture, a log line, a screenshot or your report. Test keys go only in `backend/.env`, which is gitignored, as `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and a new `RAZORPAY_WEBHOOK_SECRET`. The key secret never reaches the browser. Only `key_id` may be sent to the browser.
- Follow `CLAUDE.md` for every UI change. Use icons only from `frontend/src/components/ui/icons.tsx`. No shadows, no blur, no emojis, no em dashes in UI text, radii only from `--radius-*`, and a skeleton loader while data loads. Every new parent-facing string goes in `frontend/src/i18n/messages.ts` with `en`, `gu` and `hi`.
- The Android app (`School_Store-appbuild`) is out of scope.

## What the code does today (checked on f699297)

Read these files before you change anything.

| Area | File | Current state |
|---|---|---|
| Checkout UI | `frontend/src/pages/CheckoutPage.tsx` | Hard-codes `payment_method: 'COD'` (line ~143). The total shown comes from the browser cart (`subtotalPaise`), not from the server. There is no payment method picker. |
| Order submit | `frontend/src/services/placeOrder.ts` | Retries safely with `idempotency_key` and the `Idempotency-Key` header, and keeps a pending copy for signed-in parents. `OrderPayload.payment_method` is typed `'COD'` only. **Reuse this.** |
| Payment adapter | `frontend/src/services/paymentAdapter.ts` | `MockPaymentAdapter` always returns success. Nothing imports it. Delete it or replace it with the real adapter. |
| Order creation | `backend/orders/serializers.py` `OrderCreateSerializer.create` | Prices every line from the server's current price (`ProductCityPrice` for the city, else `product.selling_price`). Debits stock atomically with a conditional `UPDATE` and writes `ORDER_PLACED` movements. Idempotent on `idempotency_key`. Schedules `release_expired_reservation` 15 minutes later for `ONLINE` orders. **Reuse this.** |
| Start payment | `backend/orders/views.py` `OrderViewSet.payment` | Creates one Razorpay order per store order and reuses it on retry. **Reuse this.** |
| Browser verify | `OrderViewSet.verify_payment` | Checks the HMAC against this order's own `razorpay_order_id`. On a valid signature alone it marks the order PAID and CONFIRMED, without asking Razorpay whether the payment was captured, for how much, or in what currency. |
| Webhook | `backend/orders/webhooks.py` | Verifies the signature with `RAZORPAY_KEY_SECRET` instead of a webhook secret. **It ignores `event`**, so a signed `payment.failed` marks the order PAID. Never checks amount or currency. Stores nothing before acting. Returns 404 for an unknown order and throws the event away. |
| Payment state | `backend/orders/status.py` `record_payment` | One payment field set straight on the order, idempotent only on PAID. There is no record of separate attempts. A late payment on a CANCELLED order stays cancelled and gets a "Refund needed" audit entry. Reuse the row locking. |
| Status routes | `OrderViewSet.update` / `partial_update` (PUT and PATCH `/orders/{id}/`), `bulk_status` (`POST /orders/bulk-status/`), and **Django admin `OrderAdmin`** in `backend/orders/admin.py` | The API routes go through `change_order_status`, whose `ALLOWED_TRANSITIONS` let an **unpaid ONLINE** order move from PLACED to PROCESSING or PACKED. In Django admin, `status`, `payment_status` and `payment_method` are editable fields with no guard at all. Only `panel/tailor_sheet.py` filters on PAID or COD. |
| Expiry | `backend/orders/tasks.py` `release_expired_reservation` | Returns stock and cancels the order after 15 minutes without first asking Razorpay whether a payment was captured but its webhook is late. Depends on one Celery countdown, with no periodic job to catch a lost one. |
| Gateway | `backend/orders/payment.py` `RazorpayGateway` | `import razorpay` is used, but `razorpay` is **not in `requirements.txt`**. With no keys it returns a fake `local_<id>` order. |
| Public Worker | `frontend/worker/index.js` | Forwards `/api/*`, including raw POST bodies and headers, to the store server tunnel. When the tunnel answers 502, 503, 504, 52x or 530, it may return the showcase Worker's response instead, and the code accepts any showcase status other than 404. A webhook could therefore get a 2xx that the store never saw. |
| Tests | `backend/orders/test_status_and_payment.py`, `test_payment_method.py`, `test_production.py`, `panel/test_tailor_sheet.py` | Cover signature binding, Razorpay order reuse, late webhook on a cancelled order, the missing-secret refusal, and COD surviving the timer. **Keep them all passing.** Update an assertion only where this task deliberately changes the behaviour, and say which ones in your report. Postgres-only tests use `@requires_postgres` from `common/testing.py` and run with `USE_POSTGRES_FOR_TESTS=1`. |

## Required behaviour

### 1. Final amount and methods before the order is placed

- Add `POST /api/orders/quote/`. It takes the same body as order creation, without `idempotency_key`. Run the **same** validation as `OrderCreateSerializer` (student permission, product match, city pricing, stock), but write nothing. Move the pricing into one shared function that both quote and create call, so the two can never diverge.
- The response has: each line (variant, SKU, name, size, quantity, unit price, line total), `subtotal`, `total`, `total_paise`, `currency: "INR"`, `payment_methods`, and `reservation_minutes: 15`.
- `payment_methods` includes `ONLINE` only when the gateway is usable: key id, key secret and webhook secret are set, and `razorpay` imports. It includes `COD` wherever COD is offered today, which is every school. Do not add a new per-school COD switch.
- Creation accepts `expected_total_paise`. If it differs from the server's total at creation time, return **409** with `{"code": "price_changed", "quote": {...}}`, and create no order and change no stock. The checkout then shows the new total and asks the parent to confirm again.
- Creation refuses `payment_method: ONLINE` with 400 when the gateway is not usable and `DEBUG` is off.
- `CheckoutPage` review step: fetch the quote once the child and delivery choice are known, with a skeleton while it loads. Show the server's lines and total, not the cart's, and a payment method choice built from `payment_methods`: "Pay online (UPI, card, netbanking)" and "Cash on delivery". The place-order button shows the server total.

### 2. One store order, one Razorpay order, many payment attempts

Keep these three things separate in the data model:

- **Store order** (`Order`): one per checkout, created through the existing idempotent path. It holds stock and is what staff pack.
- **Razorpay order** (`Order.razorpay_order_id`): exactly one per store order, created by the existing `payment/` endpoint with `amount = total in paise`, `currency = "INR"`, `receipt = order_number` and `notes = {"store_order_id": <uuid>}`. The amount always comes from the saved order, never from the request. Add a **unique** constraint on `razorpay_order_id`, applied only when it is non-empty.
- **Payment attempt** (new `PaymentAttempt` model): one row per Razorpay payment id, linked to the store order. Fields: `razorpay_payment_id` (unique), `status` (`CREATED`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED`), `method`, `amount_paise`, `currency`, `error_code`, `error_reason`, `first_seen_at`, `updated_at`, and `last_source` (`VERIFY`, `WEBHOOK` or `RECONCILE`). The unique payment id means one payment can never pay two orders. A parent may make several attempts on one order. For example, a failed UPI try followed by a successful card payment gives two attempts and one paid order.

Rules for state:

- **A captured attempt never goes back.** `CAPTURED` can change only to `REFUNDED`, and only by staff. Events that arrive late or out of order and say `failed` or `authorized` for a captured attempt are recorded in `PaymentEvent` (section 4) but do not change it.
- A `FAILED` attempt may later become `AUTHORIZED` or `CAPTURED`, because Razorpay can authorize a payment late after first reporting it failed.
- The order's `payment_status` comes from its attempts: `PAID` if any attempt is captured and matches (section 3), else `AUTHORIZED` if any is authorized, else `PENDING`. **Nothing ever moves an order from `PAID` to a lower state**, whatever events arrive afterwards. Stop using `Order.PaymentStatus.FAILED` for new orders. A failed attempt leaves the order `PENDING` and payable, and the API exposes `last_attempt_failed` with the reason.
- A second captured attempt on an order that is already paid does not change the order. It opens one `DUPLICATE_PAYMENT` review item (section 5).

Frontend:

- Load `https://checkout.razorpay.com/v1/checkout.js` only when the parent picks online payment. Set Checkout's `timeout` to the seconds left in the hold minus 60.
- **Closing Checkout does not mean the parent did not pay.** They may have approved in their UPI app and then closed the window. On `ondismiss`, and before offering any new attempt, call a new `POST /orders/{id}/reconcile-payment/`. It fetches this Razorpay order's payments from Razorpay, applies each one through the function in section 3, and returns the order's payment state, including whether an attempt is still in progress. Allow at most 1 call per 5 seconds per order.
- If the page closes, comes back or goes offline, the saved pending order (`placeOrder.ts`) re-submits and gets the **same** order back. It never creates a new one. On the parent's orders page (`Parent.tsx`, "My Orders"), an ONLINE order shows its payment state from the server. "Pay now" appears only when the order is inside its hold and the server reports no attempt that is authorized, captured or still in progress.
- Add `razorpay` to `requirements.txt`, pinned to an exact version. Prove `import razorpay` works on Python 3.12 (older SDKs import `pkg_resources`). If it does not, call the Razorpay REST API with `requests` inside `RazorpayGateway` instead. All provider calls stay inside that one class, with a 5-second timeout.

### 3. Only the server decides, from Razorpay's own record

Write **one** function, for example `apply_provider_payment(order, payment_entity, source)`. It is the only code that creates or changes a `PaymentAttempt` or an order's `payment_status`. Browser verify, the webhook, `reconcile-payment` and the expiry check all call it. It locks the order row (`select_for_update`), upserts the attempt by payment id under the rules in section 2, and then re-derives the order's state.

A payment counts as paid only when **all** of these hold:

- `payment.order_id == order.razorpay_order_id`
- `payment.amount == order total in paise`
- `payment.currency == "INR"`
- `payment.status == "captured"`

A mismatch in order id, amount or currency never marks the order paid. The attempt is stored with its real values and one `AMOUNT_MISMATCH` review item is opened.

When a matching capture is applied to an order that is still PLACED, the order becomes `PAID` and CONFIRMED, with one status event "Payment received". When the order is already CANCELLED because its stock was released, see section 6.

- **Browser verify** (`verify-payment`): keep the signature check bound to this order's own Razorpay order id. After it passes, **fetch the payment from Razorpay** and pass it to the function above. Return `paid`, `confirming` (authorized, or Razorpay could not be reached) or `failed`. A valid signature alone never marks the order paid.

### 4. Webhook acknowledgement that can always be recovered

The webhook stays at `POST /api/payments/razorpay/webhook/` and works in this order:

1. **Verify** the signature with `RAZORPAY_WEBHOOK_SECRET`. Refuse in production when the secret is empty, as today. A bad signature gets 400.
2. **Record durably first.** In its own transaction, commit a `PaymentEvent` row before doing anything else. Fields: provider event id from `X-Razorpay-Event-Id` (unique), event type, Razorpay order and payment ids, amount, currency, the raw payload, received time, `state` (`RECEIVED`, `PROCESSED`, `RETRY`, `UNMATCHED`, `IGNORED`), `tries`, `next_try_at` and `last_error`. **If this row cannot be saved, return 503** so that Razorpay retries. Never acknowledge an event that was not saved.
3. **Duplicates.** If the event id already exists and its state is `PROCESSED`, `IGNORED`, `RETRY` or `UNMATCHED`, return 200 and do nothing. If it is still `RECEIVED` (an earlier delivery stopped part way), process it now as in step 4.
4. **Process** in a separate transaction:
   - `payment.captured` and `order.paid` are captures, `payment.authorized` is an authorization, and `payment.failed` is a failed attempt. Each goes through the section 3 function. Mark the event `PROCESSED`.
   - Every other event type is marked `IGNORED`.
   - **Unknown Razorpay order:** if no store order matches the Razorpay order id or `notes.store_order_id`, mark the event `UNMATCHED`. It is kept, not thrown away.
   - **Processing error:** mark the event `RETRY` with the error and `next_try_at`. If that write also fails, return 503.
5. Return **200 only after step 2 committed and step 4 left the event `PROCESSED`, `IGNORED`, `RETRY` or `UNMATCHED`.**

Add a Celery beat job that runs every minute. It reprocesses `RETRY` and `UNMATCHED` events whose `next_try_at` has passed, with backoff (1, 2, 5, 10, then every 30 minutes). An event still unmatched after 24 hours opens one `UNMATCHED_EVENT` review item.

### 5. Packing rule, enforced on the server for every route

- Put the rule in one service function that every status change calls. An `ONLINE` order may move to CONFIRMED, PROCESSING, PACKED, DISPATCHED or DELIVERED only when its `payment_status` is `PAID` and it has no open refund-review item. COD orders keep today's `ALLOWED_TRANSITIONS`.
- Routes that must call it:
  - `PUT` and `PATCH /orders/{id}/`: refuse with 400 and a clear message.
  - `POST /orders/bulk-status/`: blocked orders appear in `skipped_ids`, with the reason.
  - **Django admin `OrderAdmin`**: make `status`, `payment_status`, `payment_method`, `subtotal`, `total` and the `razorpay_*` fields read-only, so that status changes happen only in the staff panel. Check for admin list actions as well, and send any that change status through the service function.
  - Search the codebase for any other code that writes `Order.status` (`grep` for `.status =`, `update(status=`, `bulk_update`). List each place you find in the report and either send it through the service function or explain why it is safe (for example the expiry task, which only cancels).
- Staff order lists and order detail show the payment state and any open review item.
- **Review items:** add a `PaymentReview` model with order (nullable, for unmatched events), payment id, reason (`REFUND_AFTER_RELEASE`, `DUPLICATE_PAYMENT`, `AMOUNT_MISMATCH`, `PAID_AFTER_COD_SWITCH`, `RECONCILE_STUCK` or `UNMATCHED_EVENT`), created time, and `resolved_by` / `resolved_at`. Add a unique constraint on (order, reason, payment id) so that one problem can only ever create **one** item. Staff see and resolve these in Django admin, with a badge on the staff order detail. Refunds themselves are done by staff in the Razorpay dashboard. Automatic refunds are out of scope.

### 6. Reserved stock, expiry and the race with capture

- The hold is 15 minutes from order creation (existing). Keep the per-order countdown, and **add** a Celery beat job every 5 minutes that runs the same check for every unpaid ONLINE order past its hold. Then a lost countdown cannot hold stock forever. Confirm in the report that beat runs from the store server's start script (`deploy/publish.ps1`, `server-run.ps1`). Do not edit those scripts unless beat is missing.
- The expiry check locks the order row. While holding the lock, it fetches this Razorpay order's payments from Razorpay (5-second timeout) and applies each through section 3. Then:
  - **Captured and matching:** the order is PAID. Release nothing.
  - **Authorized, or an attempt still in progress:** keep the hold and check again in 5 minutes.
  - **Razorpay unreachable or timed out:** the result is unknown. **Release nothing.** Keep the order pending and check again with backoff (5, 10, 15, then every 30 minutes). After 2 hours unknown, open one `RECONCILE_STUCK` review item. Stock stays held until a check succeeds or staff cancel the order in the panel.
  - **No attempts, or only failed ones:** release stock exactly as today (atomic `F()` increment and `ORDER_CANCELLED` movements), set CANCELLED, and write the status event "Payment reservation expired." Release happens **once**, whichever of the countdown and the sweep runs first.
- **Capture confirmed after release:** if a matching capture arrives later for a CANCELLED order whose stock was released, by any path, then record the attempt as CAPTURED and the order as `PAID`, keep it CANCELLED, leave stock untouched, and open exactly **one** `REFUND_AFTER_RELEASE` review item. Packing stays blocked, because CANCELLED is final and the review item is open.
- Because both the capture path and the expiry check take the same row lock and decide inside it, they must never release stock for an order that ends up PAID and CONFIRMED, and never release it twice.
- On an expired order the parent sees: "This order was released because payment did not arrive in time. If money left your account it will be refunded within 7 working days." Then a button "Place the order again".

### 7. What the parent sees

| Outcome | Server state | Stock | Parent screen |
|---|---|---|---|
| **Captured** (verify, webhook, reconcile or expiry check) | Attempt CAPTURED, order `PAID` and CONFIRMED, one status event | Unchanged since creation | "Payment received. Order {n} is confirmed." Shown only after the **server** says `paid`. |
| **Checkout closed, outcome unknown** | No change until `reconcile-payment` answers | Held | "Checking your payment." If an attempt is in progress: "A payment is still in progress. Check your UPI app. Please do not pay again." with a "Check again" button. Offer "Try again" and "Pay cash on delivery instead" only when the server finds no attempt, or only failed ones. |
| **Attempt failed** | Attempt FAILED, order `PENDING` and still payable | Held | Razorpay's reason in plain words, then "Try again" (same Razorpay order) and "Pay cash on delivery instead". |
| **Delayed** (the success handler ran, but the server says `confirming`, or the verify call failed or went offline) | Unchanged until a webhook, reconcile or expiry check decides | Held | "We are confirming your payment. Please do not pay again." Poll `GET /orders/{id}/` every 3 s for up to 2 minutes, then "We will text you when it is confirmed." Never show "paid" in this state. |

"Pay cash on delivery instead" is `POST /orders/{id}/switch-to-cod/`. It is allowed only for the payer, only while the order is `PENDING` and not cancelled, and only after a fetch from Razorpay inside the row lock shows no attempt that is authorized, captured or in progress. If Razorpay cannot be reached, refuse and ask the parent to try again. On success it sets `payment_method=COD` and writes a status event, and the expiry task already skips COD orders. A capture that still arrives later for a switched order is recorded as `PAID`, keeps the status, and opens one `PAID_AFTER_COD_SWITCH` review item ("paid online, do not collect cash").

Repeated taps: "Place order" and "Pay" are disabled while a request is in flight. The existing `idempotency_key` returns the same order, and `payment/` returns the same Razorpay order. Verify, webhook and reconcile racing for one payment give one attempt row, one status event and no stock movement beyond `ORDER_PLACED`.

### 8. Public Worker must never fake a success

- In `frontend/worker/index.js`, send `/api/payments/` **only** to the store server tunnel. Never send it to the showcase, in any branch: no origin, a tunnel-down status, or an exception. With no origin, an unreachable origin or a tunnel-down status, it returns **503**, so that Razorpay retries. Change nothing else in the Worker.
- Prove it through a public URL with the origin unavailable:
  - Deploy a **throwaway** Worker named `school-store-webhook-test` from this branch's `worker/index.js`, on the same Cloudflare account as the live Worker. The owner has approved this deploy. Give it the same `SHOWCASE` service binding, so that the fallback path is really exercised, and its **own new** KV namespace whose `origin` is first empty and then a dead `https://<random>.trycloudflare.com`.
  - Use a separate wrangler config file (for example `wrangler.webhooktest.jsonc`, not committed) so that `school-store`, `schoolstore-showcase` and the `CONFIG` KV cannot be touched. Before deploying, run `wrangler deployments list` for `school-store` and `schoolstore-showcase`. Run it again afterwards, and report both lists to show they did not change.
  - When the check is done, delete the test Worker and its KV namespace (`wrangler delete`, `wrangler kv namespace delete`), and report that they are gone.
  - POST a validly signed test webhook body to `https://school-store-webhook-test.<subdomain>.workers.dev/api/payments/razorpay/webhook/` in both states and record the status codes. Both must be 503, never 2xx.
  - Also run the same two requests against the **unchanged** `worker/index.js` from `f699297` in the same test Worker, and report what it returned, so the fix is shown against the old behaviour.
  - Also run both cases with `wrangler dev` (store Worker plus a local showcase) as a `SIMULATED` check. If the public deploy cannot be done (for example, wrangler is logged into the wrong account), label the public-URL check `UNVERIFIED` with the reason. Do not deploy anything else to make it work.

### 9. Legal pages

Update `frontend/src/pages/LegalPages.tsx` so it matches what the code now does:

- Privacy: name Razorpay as the payment partner and state what it receives (order number, amount, parent name and phone). State that card and UPI details are entered on Razorpay's page and never reach us.
- Terms: the 15-minute hold for online payment.
- Refund: payments on released orders are refunded to the original method.

## Tests to add

Use Django `TestCase` unless a test says otherwise. Mock `RazorpayGateway` network calls, and compute HMACs with a test secret.

**Quote and create**
1. Quote total equals the created order's total, uses the city price, and writes nothing.
2. `expected_total_paise` mismatch gives 409 `price_changed`, with no order and no stock change.
3. ONLINE creation is refused when the gateway is not usable (`DEBUG=False`).
4. Same `idempotency_key` sent twice gives one order and one set of `ORDER_PLACED` movements.
5. `payment/` called twice creates the Razorpay order once, and its amount equals the total in paise.

**Attempts and payment state**
6. A failed attempt, then a captured attempt with a different payment id on the same order, gives two attempts and an order that is `PAID` and CONFIRMED.
7. Capture, then a late `payment.failed` for the same payment id, leaves the attempt CAPTURED and the order `PAID`. The event is stored.
8. Capture on attempt A, then `payment.failed` for a different attempt B, leaves the order `PAID`.
9. `payment.failed`, then a late authorization and capture for the same payment id, gives `PAID`.
10. Verify with a valid signature and a fetched payment that is captured and matches gives `PAID` with one status event.
11. Verify with a valid signature but a mismatched amount, currency or order id gives not paid and one `AMOUNT_MISMATCH` item.
12. Verify with a valid signature and an authorized payment gives `AUTHORIZED`, with status unchanged.
13. A second captured attempt on a paid order gives one `DUPLICATE_PAYMENT` item, and the order is unchanged.
14. One `razorpay_payment_id` cannot be recorded on two orders.
15. `reconcile-payment` after the window is closed, with Razorpay showing a captured payment, gives `PAID`.

**Webhook acknowledgement**
16. `payment.failed` alone never gives `PAID` (regression test for today's bug).
17. The same event id delivered twice gives one `PaymentEvent`, one status event and 200 both times.
18. `order.paid` plus `payment.captured` for one payment give one outcome.
19. An event for an unknown Razorpay order gives 200, a stored `UNMATCHED` event and no order change. When the order appears, the beat job processes it. After 24 hours unmatched, it opens one `UNMATCHED_EVENT` item.
20. When saving `PaymentEvent` fails (patch the save to raise a `DatabaseError`), the response is 503 and nothing changes.
21. When processing raises, the event is `RETRY`, the response is 200, and the beat job later processes it once.
22. An event left `RECEIVED` (simulating a crash) is processed when Razorpay redelivers it.

**Expiry and the race** (Postgres-only, `TransactionTestCase` with `@requires_postgres`)
23. Run the expiry check and the capture handler for the same order at the same moment, in two threads with separate DB connections and a `threading.Barrier`. Repeat 50 times in each start order. Every run must end in exactly one of two states:
    - `PAID` and CONFIRMED, with no `ORDER_CANCELLED` movement and the stock balance down once; or
    - `PAID` and CANCELLED, with exactly one set of `ORDER_CANCELLED` movements and exactly one `REFUND_AFTER_RELEASE` item.

    These must never happen: stock released twice, released while CONFIRMED, or `PAID` lost.
24. Expiry with no payment at Razorpay gives CANCELLED and stock back once. With the countdown and the sweep both running, stock still comes back once.
25. Expiry when Razorpay shows a capture (webhook lost) gives `PAID` with no release.
26. Expiry with Razorpay unreachable releases nothing, keeps the order PLACED and `PENDING`, and schedules another check. After 2 hours of failures it opens one `RECONCILE_STUCK` item and still releases nothing.
27. A capture after release, delivered twice (webhook then reconcile), gives one `REFUND_AFTER_RELEASE` item and no stock change.

**Packing rule on every route**
28. An unpaid ONLINE order (`PENDING`, `AUTHORIZED`, or paid but with an open review item) cannot move to CONFIRMED, PROCESSING, PACKED or DISPATCHED through `PATCH`, `PUT` or `bulk-status`. Run this as boss, city admin and school admin.
29. Django admin: posting the change form with a new `status` or `payment_status` does not change either field.
30. A captured ONLINE order can move to PACKED and DISPATCHED. A COD order can still move forward as today. In a mixed bulk request, only the eligible orders move.

**Frontend (`vitest`)**: the checkout shows the server total and methods from the quote. A 409 `price_changed` shows the new total and asks the parent to confirm again. The "confirming" and "checking" states never say "paid". "Try again" is hidden while the server reports an attempt in progress.

Run `python manage.py test orders panel inventory` on SQLite, then the same command with `USE_POSTGRES_FOR_TESTS=1` so that the race tests run. Run `npm test` and `npm run build` in `frontend`.

## Final demonstration: one order traced end to end in Razorpay test mode

Run the backend and frontend locally. Never use the live store or the store server. Expose the local server with a temporary `cloudflared tunnel --url http://localhost:8000`. Register `<tunnel>/api/payments/razorpay/webhook/` in the Razorpay **test** dashboard with the webhook secret, and enable auto-capture. Then, with one order:

1. Note the stock balance of each item in the order for that city.
2. As a parent, place an ONLINE order and pay in Razorpay Checkout (UPI `success@razorpay` or a Razorpay test card).
3. **Close the browser** as soon as Razorpay shows success, before the page reaches the server. Kill the tab, or block `verify-payment` in DevTools before paying.
4. Wait for the webhook. Then open the site again and sign in as the same parent. **My Orders shows the same order number as paid.** No second order exists.
5. As city admin, open the order in the staff panel, move it to PACKED and then DISPATCHED.
6. Check inventory. For each item, the stock balance is down by the ordered quantity **exactly once**, there is one `ORDER_PLACED` movement per line, and there is no `ORDER_CANCELLED` movement.

Return this trace as one redacted timeline. Each step gives its time, actor, request or event, and the resulting state. Include:

- the store `order_number`, Razorpay order id and payment id;
- the `PaymentAttempt` rows;
- the `PaymentEvent` rows with the Razorpay webhook delivery ids from the dashboard;
- the order status events;
- stock balance before and after, and the `StockMovement` rows;
- screenshots of My Orders and of the staff order detail.

Redact by showing only the first 6 and last 4 characters of Razorpay ids, and phone numbers only by their last 4 digits. Never show a key, a secret or a signature.

## What to return

1. **Changed files**, one line each on what changed and why.
2. **Every place that writes `Order.status`** that you found, and how each one is now guarded.
3. **Test output**: the exact commands, and pass and fail counts for SQLite, Postgres and vitest. Name any existing test whose assertion you changed, and why.
4. **The end-to-end trace** above.
5. **A check table** with one row per scenario: captured, checkout closed with outcome unknown, failed then captured, late failure after capture, delayed result, duplicate delivery, unknown order, event save failure, expiry with no payment, expiry with Razorpay unreachable, capture racing expiry, capture after release, packing blocked on every route, the public Worker with the origin down, and the end-to-end trace. Give every row exactly one label:
   - `PROVIDER-VERIFIED`: a real Razorpay test-mode interaction (real API calls, real webhook deliveries with their delivery ids).
   - `SIMULATED`: a controlled scenario run in tests or by hand, such as duplicate delivery, outage, races, mocked gateway or locally computed HMAC.
   - `UNVERIFIED`: not run. Say why.

   If test credentials are not available, say so at the top. Run everything you can as `SIMULATED`, label the end-to-end trace `UNVERIFIED`, and **do not** describe anything as verified with Razorpay.
6. Whether Celery beat runs on the store server, whether the throwaway Worker was deployed and deleted, and anything you could not finish.
