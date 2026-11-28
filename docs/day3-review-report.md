# Day 3 review report (for Codex)

Repo: `ss_day3_work` (git copy of `ss_main`, no remote). Branch `day3-fulfilment`, HEAD `aba43a2`. Nothing pushed, merged or deployed.
Built by Antigravity (Task A began on Claude Opus 4.6, then its Claude quota ran out; everything else ran on Gemini 3.8 Flash).
Reviewed by Claude: code read, plus my own re-runs in clean git worktrees, plus throwaway probe tests that reproduced each bug before it was reported.

## 1. What was built (commits on top of baseline `17c15f2`)

| Commit | Task | Content |
|---|---|---|
| `5fd68d4` | A | Staff packing and dispatch services, gate adapter, queue API, City Admin Packing screen. Closed the PLACED to PACKED payment bypass. Fixed the `created_at` bug in `send_post_delivery_fit_prompts`. |
| `9d4b15f` | B | Parent tracking payload, parent-only detail serializer, Timeline rewrite, My Orders states, legal text. |
| `e6f70de` | C | Replaced bulk pack with claim, packing list, per-line confirmation, pack, report issue, postal handover by hand-entered article number, correction history, pickup path. Removed postal format checks. |
| `bbf13b1` | D | Fixed dispatch defects C1 to C5, C7, C8. |
| `a36d977` | E | Parent order detail screen (web and app), official India Post page link, Day 2 + Day 3 integration test module and evidence table. |
| `aba43a2` | F + G | Copy feedback fix, parent create response restored, parent order item regression fixed, walkthrough. |

`day3-00-trace-and-contract.md` is a reference document, not a coding task. Its code claims were checked and true.
Single Day 3 migration: `orders/migrations/0016_shipment.py` (name kept, content edited in place; adds `OrderPacking`, `Shipment` changes, `ShipmentCorrection`).

## 2. Verified results at HEAD `aba43a2` (my own runs)

| Check | Result |
|---|---|
| Backend full suite, SQLite | 385 tests OK (28 skipped) |
| Backend `orders` suite, local PostgreSQL | 118 tests OK (6 skipped, all "Day 2 not merged"). The real thread-based race tests ran. |
| `makemigrations --check` | no changes |
| Vitest | 179 pass |
| `tsc` and `npm run build` | clean |

Spec scenarios, each a named passing test: eligible prepaid order, eligible COD, blocked online order, simultaneous claim (two threads on Postgres, one 200 and one 409), repeated pack and repeated dispatch (one event each), duplicate article number (case, spaces and hyphens ignored), out-of-scope staff (404 per order, empty queue), school pickup (no article number, no postal text).
Postal handover rules verified by probe: blank, over 40 characters, invalid receipt flag values and any `booked_at` are all handled; case or spacing only corrections are applied and recorded.

## 3. Defect history and current status

Fixed and re-verified:

| ID | Was | Status |
|---|---|---|
| A1 | `order_ids` not a UUID returned 500 | fixed (serializer, 400) |
| A2 | `select_for_update` joined the reverse one-to-one `shipment` (fails on PostgreSQL) | fixed, no join on locked queries; Postgres tests pass |
| A5 | queue "Sent" tab missed legacy `SHIPPED` orders | fixed |
| B1 | share link used `window.location.origin` (https://localhost in the Android app) | fixed (`getShareOrigin()` with test) |
| C1 | article number over 40 characters gave 500 | fixed |
| C2, C3 | client `booked_at` accepted, crash on bad value, handover could be backdated | fixed, server sets the time |
| C4 | `receipt_confirmed` string "false" counted as confirmed | fixed, strict boolean |
| C5 | case or spacing only correction silently ignored | fixed |
| C7, C8 | repeat claim 409, stale S10 comment | fixed |
| E1 | parent order-create response used the staff serializer | fixed, parent serializer restored, recursive no-leak test |
| E2 | Copy said "Copied" even when it failed | fixed (en, hi, gu message) |
| F1 | Task E's `ParentOrderItemSerializer` dropped fit fields (`measurement`, `chosen_size`, `recommended_size`, `fit_feedback`, `category`) from parent order items; broke `test_line_fit_is_copied_even_without_a_chart` | fixed, original `OrderItemSerializer` used again |
| E3, E4 | inline styles, "expected" values in PENDING rows | fixed (0 inline `style={{` left in `OrderDetail.tsx`) |

## 4. Still open (for Codex to look at)

| ID | Sev | Item |
|---|---|---|
| O1 | Medium | PostgreSQL: only the `orders` app was run on Postgres, not the full suite. Run the full suite there. |
| O2 | Medium | Day 2 contract: the import path `orders.payment_rules.packing_decision`, the blocked reason codes and the COD rule are assumptions (see section 5). Until Day 2 is merged packing is closed by design (HTTP 503 `PACKING_RULE_NOT_WIRED`). |
| O3 | Low | `fulfilment_views.py`: most actions still use a broad `except Exception` wrapper that re-raises unknown errors and parse fields by hand (dispatch and correction use serializers now). Move the rest to serializers (C6). |
| O4 | Low | A numeric article number (JSON `12345`) is accepted and stored as text. Harmless; decide if it should be rejected. |
| O5 | Low | `size` was added to `OrderItemSerializer`, so staff responses also carry it. Harmless duplicate of `variant_size`. |
| O6 | Low | Task B edited the shared `Skeleton` component (+39 lines), put tracking CSS on the single minified line of `styles.css`, and used a hard-coded `monospace` font. Check other screens still look the same. |
| O7 | Low | `fcm.py` DISPATCHED branch uses a bare `except Exception` around `order.shipment`. |
| O8 | Low | Task B asked for tests of legacy SHIPPED and PENDING timelines and gu/hi labels; coverage not re-checked. `any` removal in `OrdersScreens.test.tsx` was requested, not re-checked. |
| O9 | Low | Migration `0016_shipment.py` is named after an older design. Rename when it is renumbered after Day 2. |

## 5. Awaiting Day 2 and the owners

Day 2's branch is not in this folder (`ss_main` has no git history), so these are PENDING, not passed:
1. Day 2's real callable (assumed `orders.payment_rules.packing_decision`), final blocked reason codes, whether COD needs a confirmation step, how a claimed or packed order is handled on refund or cancel.
2. Combined Day 2 + Day 3 migrations on a disposable database. Rule: Day 2 merges first, then Day 3 deletes its `0016`, re-runs `makemigrations orders` and keeps one migration. Never `makemigrations --merge`. A Day 3 only `migrate` from empty on a fresh Postgres database was run by Antigravity (16 migrations, no changes detected afterwards).
3. Integration cases 1 and 2 (verified payment survives browser closure; pending payment and late capture awaiting refund blocked) have no simulated variant and were never run. Cases 3 to 6 ran as SIMULATED with a test double of the rule.
4. Evidence table (`docs/integration/evidence-table.md`): no row is PROVIDER-VERIFIED because there is no real payment provider response and no real India Post booking. A sample article number only proves the app displays tracking details; actual tracking needs a real booking.
5. India Post link: `siteConfig.indiaPostTrackingUrl` is set to https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx (found by web search). No direct link with the number is built because none was verified. Owner must confirm the URL.
6. School Admin: the generic order API now refuses PROCESSING, PACKED, DISPATCHED and DELIVERED for everyone, so only BOSS and City Admin can use the new fulfilment endpoints. Confirm this is the intended rule.

## 6. Not verified by me

- Screenshots (about 80 across the tasks) were generated by Antigravity; I did not open them.
- The Android app was not run on a device or emulator, only the web build and Vitest.
- Real Razorpay, push notifications and India Post were not exercised.

## 7. How to reproduce

```bash
cd ss_day3_work/backend
USE_SQLITE=1 .venv/bin/python manage.py test
# Postgres (start any local Postgres first; the temporary one used here ran on port 54329)
USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store .venv/bin/python manage.py test orders
cd ../frontend && npx vitest run && npx tsc --noEmit && npm run build
```
Walkthroughs with Antigravity's own evidence: `docs/walkthroughs/day3-a-staff-fulfilment.md`, `day3-b-parent-tracking.md`, `day3-c-claim-pack-handover.md`, `day3-e-parent-detail-and-integration.md`, `day3-f-g-fixes.md`. Prompts used: `docs/antigravity-prompts/day3-*.md`.
Do not merge or deploy: that is left to the owners.
