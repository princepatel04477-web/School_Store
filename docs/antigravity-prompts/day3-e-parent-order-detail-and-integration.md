Day 3, Task E: parent order detail on the mobile My Orders experience, and Day 2 + Day 3 integration evidence

Read first: CLAUDE.md, docs/antigravity-prompts/00-ground-rules.md, day3-00-trace-and-contract.md, day3-b-parent-tracking.md,
docs/walkthroughs/day3-b-parent-tracking.md, docs/walkthroughs/day3-c-claim-pack-handover.md, docs/day3-review-report.md.

ENVIRONMENT (wins over anything else)
- Folder ss_day3_work, branch `day3-fulfilment` (run `git branch --show-current`, stop if it is `main`). Task D is already committed on it. Do not read other git
  branches. One local commit at the end. Never push, merge or deploy. Leave main and deployment to the owners.
- The Day 2 branch is NOT available here (this folder has no Day 2 code and `orders.payment_rules` does not exist). Part 2 below must therefore report the Day 2
  dependent cases as PENDING. Never claim a case passed that you did not run.
- Tests as in earlier tasks: SQLite full suite, orders suite on the local Postgres
  (`USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store .venv/bin/python manage.py test orders`), Vitest, tsc, build.
- Design rules from CLAUDE.md apply (no Lucide, shadows, blur, hover movement, emojis, em dashes, purple; skeleton loaders; tokens; Anek Latin; 44px targets).
- No made up screenshots or results.

PART 1: PARENT ORDER DETAIL (website My orders and the Android app My Orders)

Goal: after a page refresh a signed in parent can open one order and answer: what did I buy, has it been handed over, how do I track it. Only parent-facing data.

1. Route and screen. Add a deep-linkable order detail screen that survives a refresh (for example /parent/orders/:id on the web and the matching /orders/:id route in the app;
   inspect frontend/src/App.tsx for what exists and reuse it). It loads GET /api/orders/{id}/ (the ParentOrderDetailSerializer from Task B). Each order card in both
   lists links to it. Reuse Timeline, Chip, Skeleton, icons, PullToRefresh, openExternalUrl, i18n. Do not redesign the storefront.
2. Content, top to bottom:
   - Order number, placed date, the items bought: product name, size, quantity ("x3" text when more than 1), personalisation summary if any. No prices of other people, no child measurements.
   - Payment and delivery are two separate blocks. Payment block: Paid, Pending, Failed, Refunded, or for cash on delivery "Pay on delivery" with the amount still due while it is not paid
     (use payment_method, payment_status, total from the API). Delivery block: the latest recorded store event with its timestamp (from tracking.steps: Confirmed, Packed, and so on), then the Timeline.
   - Home delivery after handover (a shipment exists, status Dispatched): show "Dispatched", the label "India Post article number", the number in a monospace span that wraps
     (`overflow-wrap:anywhere`, no horizontal scroll), a Copy button with visible feedback ("Copied" announced in an aria-live region, and the button text changes for about 2 seconds,
     Clipboard API with a textarea fallback), and a link "Track on India Post" to `siteConfig.indiaPostTrackingUrl`. The owner-supplied official page is
     https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx . There is no verified direct deep link for an article number, so open that official page (app: openExternalUrl, web:
     target _blank rel="noopener noreferrer") and show the hint "Copy the number, then paste it on the India Post page." Set indiaPostTrackingUrl to that URL. Never build a URL with the number in it.
   - Delivery scans and a carrier delivery date: show NOTHING of the kind. We have no carrier data. When the store has marked the order Delivered, show "Marked delivered by the store" with the
     timestamp of that store event, and do not call it a carrier scan.
   - Dispatched home order with no recorded number (older order): "Handed over to India Post. The tracking number was not recorded for this order." No Copy button, no link.
   - School pickup: show pickup information instead: "Pickup at <school name>", the status text "Ready at school" once dispatched (store event and time), and never an article number, India Post
     text or tracking link. Before it is ready, show the latest store event.
   - Cancelled/Returned: keep the Task B wording and separate it from payment.
3. Never show: staff names or ids, packing claims, issue notes, article correction history, Razorpay ids, audit data. Backend: confirm and test that ParentOrderDetailSerializer and the list
   serializer expose none of them, that `tracking.consignment_number` is only set when a shipment exists, and that the items include product name, size, quantity and personalisation
   without measurements (add fields only if missing, with tests). Another family's order id returns 404 and never leaks the article number.
4. States: skeleton while loading; on a failed request show a short message and a Retry button (never the empty state and never "no tracking"); an order with no tracking data renders
   normally (older orders); network failure then Retry succeeds.
5. Languages: every new string in en, hi and gu in frontend/src/i18n/messages.ts (new keys appended, existing ones untouched). Test that each language renders (no missing key text).
6. Phone layout: verify at 390x844 with a 40 character article number, in en, hi and gu: no horizontal scroll, Copy and Track buttons at least 44px high and fully visible and tappable,
   nothing under the bottom gesture area. Take screenshots with Playwright (the Task B and C capture scripts show how). Screenshots: placed, packed with its timestamp, dispatched with a long number,
   pickup ready, older dispatched order with no number, payment pending next to a packed order, COD due, error with Retry, skeleton.
7. Tests: Django (parent privacy for list and detail, other family 404, no staff fields, fixed query count, old order without shipment) and Vitest (each state, copy button feedback and fallback,
   link present and opened through the right function, hidden hint rules, long number layout class, three languages, pickup vs home).

PART 2: DAY 2 + DAY 3 INTEGRATION EVIDENCE

Day 2's code is absent, so build the harness now and run what can honestly be run.

A. Create docs/integration/day2-day3-integration.md describing how the owners run the integration on a branch that contains both Day 2 and Day 3: create a disposable database, run `migrate` from empty
   (list the exact commands, including `makemigrations --check` and the rule that Day 2's orders migration comes first and Day 3's `0016` must be renumbered to depend on it, never `--merge`),
   then run the new test module below.
B. Create backend/orders/test_integration_day2_day3.py. It must run the real Day 2 callable when `orders.payment_rules.packing_decision` can be imported and otherwise `skipUnless` skips with a clear
   message "Day 2 not merged". Cases, each as a named test:
   1. A verified test payment survives browser closure: drive the existing payment verification route, then use a brand new API client and a new token for the same parent: the order is still paid, still
      readable. Staff (one city admin) claim, confirm every line, pack: the garments and quantities in the packing list equal what was ordered. Postal handover is recorded with a sample number. The same
      parent, fresh client, sees the same article number. Stock was deducted exactly once (StockBalance and StockMovement counts: ORDER_PLACED once, nothing added by packing or dispatch).
   2. Pending payment (online) is blocked when claim and pack reach the backend. Late capture awaiting refund (payment arrived after cancellation) is blocked too. Nothing is written.
   3. Eligible cash on delivery reaches packing and the parent API still shows it as unpaid with the amount due.
   4. School pickup completes claim, pack, ready for pickup and delivered with no article number and no postal text.
   5. Repeated pack and repeated dispatch give exactly one PACKED and one DISPATCHED event.
   6. Another family cannot read the order or its article number (404 on detail, absent from the list).
   Until Day 2 exists, also provide a variant of cases 3 to 6 that uses the Task C test double of the packing rule and is labelled SIMULATED, so the Day 3 half is exercised now.
C. Disposable database run that can be done now: create a new empty Postgres database on the local server (127.0.0.1:54329, user postgres), run `migrate` from empty with the Day 3 code, run
   `makemigrations --check`, run the new test module against it, then drop the database. Report the output. Combined Day 2 + Day 3 migrations: PENDING.
D. Write docs/integration/evidence-table.md, a redacted table with one row per case: store order reference (redact to the first 4 characters then ****), payment state, packing result, dispatch
   result, parent-visible result, PASS / FAIL / PENDING, and an evidence label:
   - PROVIDER-VERIFIED: only with a real Razorpay or India Post response. There is none in this environment, so no row may use it.
   - SIMULATED: ran here with test doubles, test payment fixtures or a sample article number. State which.
   - UNVERIFIED: not run, or run on assumptions.
   Day 2 dependent rows are PENDING. Add the sentence: "A sample article number proves the app displays tracking details. Actual postal tracking requires evidence from a real booking." Redact personal data.

EVIDENCE: docs/walkthroughs/day3-e-parent-detail-and-integration.md with git branch, `git diff --stat` for this task, full SQLite suite, Postgres orders suite, Vitest, tsc, build, the screenshot list, the
migration check on the disposable database, the evidence table, and a "Not done / awaiting Day 2 or the owners" list (real Day 2 branch, real booking, real payment provider, India Post deep link support).
