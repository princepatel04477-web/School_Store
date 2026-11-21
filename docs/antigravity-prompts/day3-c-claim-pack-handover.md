Day 3, Task C: staff claim, pack and postal handover (replaces the bulk pack and S10 parts of Task A)

Read first: CLAUDE.md, docs/antigravity-prompts/00-ground-rules.md, docs/antigravity-prompts/day3-00-trace-and-contract.md,
docs/day3-review-report.md. Do not read or use any other git branch.

ENVIRONMENT (wins over anything else)
- Folder: this one (ss_day3_work). Branch `day3-fulfilment`; run `git branch --show-current` first and stop if it is `main`.
  Task A is commit 5fd68d4, Task B is 9d4b15f. Work on top of them. Commit locally in one commit at the end. Never push, merge or deploy.
- Day 2's shared payment rule is NOT merged. Keep using the adapter `backend/orders/fulfilment_gate.py` (`get_packing_decision`).
  Do not write payment logic yourself. In tests use a clearly named test double of Day 2's rule (online order packable only
  when payment_status is PAID, cash on delivery packable once CONFIRMED) patched into the adapter, and say so in the docstring.
- Backend tests: SQLite is fine for most, but the concurrency tests need PostgreSQL. A local Postgres is already running:
  `USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store backend/.venv/bin/python manage.py test`
  (run from backend/). Run the whole suite on SQLite AND on this Postgres, and report both results. Frontend: `npm ci` is done, use `npx vitest run`, `npx tsc --noEmit`, `npm run build`.
- Do not edit Day 2 code: record_payment, release_expired_reservation, payment, verify_payment, the webhook, checkout in
  OrderCreateSerializer.create, _restock. Packing must NOT write stock or StockMovement rows.
- Do not skip any numbered item. Anything you cannot finish goes under "Not done" in the walkthrough with the reason. No made-up screenshots or test output.

THE TASK (from the owner; the pilot uses direct India Post booking and manual entry of the article number printed on the booking receipt)

1. Give authorised staff a queue of orders within their existing scope. Show the store order number, delivery method, packing
   eligibility, and any blocked reason. Enforce permissions and eligibility on the server for every route that can advance an
   order. Use the shared Day 2 rule.
2. Let a staff member claim an order and see a packing list with each product, size, quantity, and relevant personalisation.
   Make quantities greater than one obvious. Require staff to confirm all lines before marking the order packed. If stock or an
   item is missing, keep the order open and surface the issue.
3. Record who claimed and packed the order and when. Handle two staff members claiming the same order at once. A repeated tap or
   request must produce one transition and one history event. Packing must leave inventory accounting to the existing order and
   stock workflow.
4. Treat packing and postal handover as distinct actions. For home delivery, staff enter or scan the carrier-issued India Post
   article number, review it against the receipt, and confirm handover. Save the carrier, article number, handover time, and
   staff identity. Preserve the number accurately, reject blanks and accidental reuse across parcels, and avoid inventing a
   postal tracking format. If staff correct a typo, retain who changed it, when, and the previous value.
5. Keep school pickup on its existing pickup path. It should never require a postal article number or show a postal dispatch message.
6. Use existing status events where possible. Preserve older orders that have no tracking data. Keep payment decisions and
   stock-release logic in the Day 2 implementation. For this pilot, manual postal handover is sufficient.

Demonstrate (each as a named test, and in the walkthrough): an eligible prepaid order, an eligible COD order, a blocked online
order, a simultaneous claim, a repeated pack and a repeated dispatch request, a duplicate article number, an out-of-scope staff
account, and school pickup. Report changed files, migration dependencies, test results, and anything awaiting Day 2 integration.

HOW TO BUILD IT (design guidance, follow it unless the code proves it wrong)

Data (one new migration only, replace Task A's 0016_shipment so there is a single Day 3 migration after 0015; Day 2 merges first and
this is renumbered then):
- Remove the S10 pattern and check digit code and its tests entirely. No postal format may be enforced anywhere (backend, frontend, tests).
- New model `OrderPacking` (one to one with Order, related_name "packing"): claimed_by, claimed_at, packed_by, packed_at, issue_note,
  issue_reported_by, issue_reported_at (all users SET_NULL).
- `Shipment`: keep `consignment_number` (the exact text staff typed, surrounding spaces trimmed, max 40) so Task B keeps working; add
  `article_key` (unique, not editable) = the number upper-cased with spaces and hyphens removed, used only to catch reuse; `booked_at` is
  the handover time set by the server; `created_by` is the staff member. Carrier stays INDIA_POST only.
- New model `ShipmentCorrection` (shipment FK, previous_number, new_number, reason, changed_by, changed_at).

Services (backend/orders/fulfilment.py, type hints). Every function does `select_for_update()` on the Order row first, inside
transaction.atomic(), then decides:
- claim_order: only CONFIRMED or PROCESSING; gate must allow (PACKING_RULE_NOT_WIRED means 503, blocked means 409 PACKING_BLOCKED with
  the reason); a second person gets 409 ALREADY_CLAIMED naming who; the same person claiming again returns changed=false.
- release_claim (claimer or BOSS), report_issue (needs a note; the order stays open; packing is refused with OPEN_ISSUE until cleared),
  clear_issue.
- pack_order: must be claimed by the caller; every order line id must be confirmed, no more and no fewer (400 LINES_NOT_CONFIRMED);
  gate checked again at that moment; writes PACKED once with one OrderStatusEvent (changed_by) and one audit entry, sets packed_by and
  packed_at, push and summary refresh on commit. A repeat by the same user on an already packed order returns 200 with changed=false and
  writes nothing. Never touch stock.
- dispatch_order: HOME_DELIVERY only (pickup gets 400 NOT_HOME_DELIVERY), status PACKED, article number non-blank, `receipt_confirmed`
  must be true, number not already used by another parcel (409 ARTICLE_NUMBER_IN_USE, case, spaces and hyphens ignored). Writes the
  Shipment, DISPATCHED and one event with note "India Post <number>". The same number again on the same order is a repeat
  (changed=false, nothing written); a different number on an already handed over order is 409 ALREADY_HANDED_OVER. Catch IntegrityError from
  the unique key and return the same 409.
- correct_article_number: only while DISPATCHED or SHIPPED; same duplicate rule; writes a ShipmentCorrection with the previous value,
  who and when; same value again is a no-op.
- mark_ready_for_pickup (SCHOOL_PICKUP, PACKED to DISPATCHED, note "Ready at the school counter.", no shipment) and mark_delivered
  (DISPATCHED or legacy SHIPPED to DELIVERED): both must be safe to repeat.
- IMPORTANT (a review found this bug): never `select_related` a reverse one to one (shipment, packing) on a queryset that is locked with
  select_for_update. PostgreSQL rejects FOR UPDATE on the nullable side of an outer join. Add the joins only on the read-only queue query.

Endpoints (backend/orders/fulfilment_views.py, under /api/fulfilment/, BOSS and ADMIN only, scope with the existing apply_user_scope city
rule; out of scope is 404, the same as not found; SCHOOL_ADMIN, TEACHER, PARENT, RETAILER get 403 on every route):
- GET queue/?stage=to_pack|to_dispatch|dispatched, paginated, flat query count. Rows include order_number, fulfillment_type, payment_method,
  payment_status, can_pack, blocked_reason, blocked_message, claimed_by_name, claimed_by_me, claimed_at, packed_by_name, packed_at, issue_note,
  consignment_number, dispatched_at. The dispatched stage includes legacy SHIPPED orders. Old orders with no packing or shipment row must work.
- GET {id}/packing-list/: lines with product name, sku, size, quantity, `multiple` (quantity > 1) and personalisation (reuse
  OrderItemSerializer.get_customisation_display). Never include a child's measurements.
- POST {id}/claim/, release/, issue/ {note}, issue/clear/, pack/ {confirmed_item_ids, note?}, dispatch/ {article_number, receipt_confirmed},
  correct-article-number/ {article_number, reason?}.
- POST ready-for-pickup/ and delivered/ with {order_ids}. These validate ids with a serializer (ListField of UUIDField, non empty, max 200)
  and return 400, never 500, for a non UUID, an object, an empty list or more than 200. Unknown or out of scope ids are returned as skipped_ids.
- Remove the old bulk `pack/` endpoint (a bulk pack would bypass the per line confirmation).
- Map errors in one helper: PackingRuleNotWired to 503 {code: PACKING_RULE_NOT_WIRED}, FulfilmentError to its status with {code, detail, reason?}.
- Keep the generic routes closed: PATCH /api/orders/{id}/ and bulk-status must still refuse PROCESSING, PACKED, DISPATCHED, DELIVERED.
  Prove it in tests for BOSS, ADMIN and SCHOOL_ADMIN, including an unpaid PLACED order.
- Keep the fcm DISPATCHED text for home delivery ("Order <n> was sent by India Post. Tracking number <number>.") but do not make up a link.
  School pickup keeps its own "ready for pickup" wording and must never mention India Post or a tracking number.

Frontend (City Admin only; CLAUDE.md design rules: no Lucide, no shadows, no blur, no hover movement, no emojis, no em dashes, no purple,
tokens and panel.css classes, 44px tap targets, works at 390px wide as cards):
- Rework frontend/src/components/admin/FulfilmentQueue.tsx: tabs To pack, To dispatch, Sent. To pack rows show order number, delivery method,
  eligibility, blocked reason (cannot be opened if blocked), who has claimed it, and a Claim button. Remove the bulk "Pack selected".
- New packing screen (modal or panel) for a claimed order: lines list with product, size, quantity (quantities above 1 shown large and
  labelled "x3" style text, not only colour), personalisation, a confirm checkbox per line, "Mark packed" enabled only when every line is
  ticked, and "Report a problem" that records the issue and shows it on the row. Show the 503 not-wired notice and disable claiming.
- To dispatch, home delivery rows: an article number input (label, `autoCapitalize="characters"` is NOT allowed because the number must be
  kept as typed; use autoComplete off, spellCheck false), a second step that shows the number back and a checkbox "I checked this against the
  India Post receipt", then "Confirm handover". No client side postal format check, only non blank. Pickup rows: "Ready for pickup", no number field.
  Sent rows: number, handover time, who handed over, "Correct number" (asks for the new number and a reason) and "Mark delivered".
- Typed API in api.ts, no `any`. Skeleton rows while loading, error with Retry, empty state per tab.
- Keep CityAdmin wiring from Task A. Do not change the parent screens, except the one fix below.

Also fix these defects from docs/day3-review-report.md in this same task (the first two are covered above, do not skip the third):
- A1: bad order_ids returned 500 (covered by the serializer above, add the regression test).
- A2: dispatch lock joined `shipment` (covered above, add a test that the locked SELECT has no JOIN, and prove it passes on Postgres).
- B1: `frontend/src/pages/native/OrdersTab.tsx` builds the share link from window.location.origin, which is https://localhost inside the
  Android app. Add `getShareOrigin()` in frontend/src/native/nativePlatform.ts that returns REMOTE_ASSET_BASE when isNativeApp() or there is no
  window, else window.location.origin, use it in OrdersTab, and add a Vitest test with @capacitor/core mocked.
- A5: queue `dispatched` stage must include legacy SHIPPED (covered above).
- B3: remove `any` from frontend/src/pages/OrdersScreens.test.tsx.

TESTS (Django test runner and Vitest; every scenario in the demonstrate list is a named test)
- Name pitfall: do not define a helper called `client` on a TestCase subclass, it shadows the test client. Call it `api`.
- Eligible prepaid, eligible COD, blocked online (claim 409 with reason, nothing written), gate rechecked at pack time, rule not wired returns
  503 and writes nothing, claim then pack then handover end to end with exact stored number, stock unchanged after packing.
- Packing list: sizes, quantity flag, personalisation, no measurements; all lines required; issue blocks packing until cleared.
- Claims: second claimant 409, same claimant repeat harmless, release, claimed_by_me in the queue.
- Repeats: pack three times gives one PACKED event, one audit row, one push; dispatch repeated (also with different case and spacing) gives one
  shipment and one DISPATCHED event; different number on a handed over order is 409.
- Handover: blank and whitespace rejected, missing receipt_confirmed rejected, any text kept exactly (including "EE123456789IN", "12345",
  "a-b c/d 9"), duplicate refused across case, spaces and hyphens, correction keeps previous value, user and time, correction cannot take another
  parcel's number.
- Pickup: dispatch refused, ready-for-pickup writes no shipment and the event note is the pickup text, push text has no India Post, repeat is a no-op.
- Scope and roles: another city's ADMIN gets 404 on every per-order route and an empty queue, skipped_ids on bulk routes; the four other roles get
  403 everywhere; BOSS can act in any city.
- Old orders: legacy SHIPPED shows in Sent and can be delivered; an old PACKED order with no packing row can still be handed over.
- Query count flat for 1 and 50 rows. fit-prompt regression for DELIVERED stays.
- Concurrency (PostgreSQL only, TransactionTestCase with threads and a barrier, skipped on SQLite): two admins claiming at once give exactly one 200
  and one 409; three simultaneous pack requests from one user give one event; two simultaneous identical dispatches give one shipment and one event;
  two parcels racing for one number give one 200 and one 409.
- Vitest: queue skeleton, blocked row cannot be claimed, 503 notice, packing screen requires every line before enabling Mark packed, quantity
  above one is labelled, article number step requires the receipt checkbox, no format check (a number like "12345" is allowed), pickup row has no number
  field, correction form, getShareOrigin.

EVIDENCE (docs/walkthroughs/day3-c-claim-pack-handover.md)
- `git branch --show-current`, `git diff --stat 9d4b15f..HEAD`.
- Migration: its name and parent, `makemigrations --check --dry-run`, `showmigrations orders`.
- Full backend suite result on SQLite and on the local Postgres (say how many concurrency tests ran), Vitest, tsc, build.
- One table: scenario, test name, result.
- Changed files; Day 2 files not touched; "Awaiting Day 2" list (real rule callable and its module path, final blocked reason codes, whether COD needs a
  confirmation step, refund/cancel handling of a claimed order).
- Screenshots at 390x844 and desktop of: To pack with a blocked row, claimed row, packing screen with a quantity above one, handover step with the
  receipt checkbox, Sent with a correction, pickup row. If you cannot capture them, list them under Not done.
