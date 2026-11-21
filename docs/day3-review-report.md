# Day 3 review report (for Codex)

Repo: `ss_day3_work` (git copy of `ss_main`, no remote). Branch `day3-fulfilment`.
Baseline `17c15f2` (main). Task A `5fd68d4`. Task B `9d4b15f`.
Built by Antigravity (Task A started on Claude Opus 4.6, hit a quota limit, finished on Gemini 3.8 Flash; Task B all Gemini 3.8 Flash).
Reviewed by Claude: code read plus independent re-runs in clean worktrees.

`day3-00-trace-and-contract.md` is a reference doc, not a coding task. Its two code claims were checked and are true:
`send_post_delivery_fit_prompts` filtered a field `created_at` that does not exist, and `ALLOWED_TRANSITIONS` let PLACED and PENDING go to PACKED.

## Verified results (my own runs, SQLite only)

| Check | Task A `5fd68d4` | Task B `9d4b15f` |
|---|---|---|
| `USE_SQLITE=1 manage.py test` | 353 tests OK (18 skipped) | 358 tests OK (18 skipped) |
| `npx vitest run` | 141 pass | 165 pass |
| `tsc` / `npm run build` | tsc clean | build OK |
| `makemigrations --check` | no changes | not re-run |

Not verified: screenshots (not opened), anything on Postgres, Task A `npm run build`.
Antigravity ran only `orders` tests for Task B (91), not the full suite the prompt required. The full suite does pass.

## Critical and high bugs (A1, A2, B1 and A3 FIXED in the working tree after review, not yet committed)

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| A1 | High, confirmed | `backend/orders/fulfilment_views.py` (`pack`, `ready_for_pickup`, `delivered`, `_scoped_ids`) | `order_ids` containing a non-UUID string or an object returns HTTP 500 (reproduced for all three endpoints). | Validate with a serializer (`ListField(child=UUIDField(), max_length=200)`), return 400. Add tests. |
| A2 | High, unconfirmed (needs Postgres) | `backend/orders/fulfilment.py` `dispatch_order` | `select_for_update().select_related("shipment")` joins a reverse one-to-one with a LEFT JOIN. Postgres normally rejects `FOR UPDATE` on the nullable side ("cannot be applied to the nullable side of an outer join"). SQLite ignores row locks, so no test catches it. | Drop `select_related("shipment")` or use `select_for_update(of=("self",))`. Run the dispatch test on Postgres. |
| B1 | High | `frontend/src/pages/native/OrdersTab.tsx` ~line 57 | Share URL now uses `window.location.origin`. In the Capacitor app `androidScheme` is `https`, so the origin is `https://localhost` and shared links break. The old hard-coded host worked. | Use a configured public site URL (for example `siteConfig`/env), not `window.location.origin`, inside the native app. Keep the website unchanged. |

## Medium

| ID | Where | Problem |
|---|---|---|
| A3 | `fulfilment_views.py` `dispatch_shipment` | `except (ValueError, Exception)` is too broad. A race on a duplicate consignment number or order can become a 500 instead of 409. `IntegrityError` is only caught around the call, not reliably around `full_clean` plus `save`. |
| A4 | `fulfilment_views.py` `pack` | Scope is checked once, then `pack_orders` re-queries `Order.objects.filter(id__in=scoped)` with no scope inside the lock. |
| A5 | `fulfilment_views.py` queue | Stage `dispatched` filters `DISPATCHED` only. Legacy `SHIPPED` orders never show in "Sent", though `mark_delivered` accepts them. |
| A6 | `test_fulfilment.py` | The "gate called with order locked" test only asserts `in_atomic_block`. Row-lock behaviour is untested (and cannot be on SQLite). |
| A7 | `fulfilment_gate.py` | Day 2 import path `orders.payment_rules` and function name are guesses. Must match Day 2. Until then packing is closed by design (503 `PACKING_RULE_NOT_WIRED`). |
| B2 | `frontend/src/components/ui/Skeleton.tsx` | Task B edited a shared component that already existed (+39 lines). Check Task A and other screens still look the same. |
| B3 | `frontend/src/pages/OrdersScreens.test.tsx` | Uses `any` (lines ~19 and ~29), against the "no `any`" rule. |
| B4 | styles in `frontend/src/styles.css` | New tracking CSS added to the single minified line. Prompt asked for nativePages.css or the parent stylesheet. Uses a hard-coded `monospace` font and `#fff` fallbacks. |
| B5 | Task B | Spec asked for tests of legacy SHIPPED/PENDING timeline and gu/hi labels; I did not verify all are covered. |

## Low

- `fcm.py` DISPATCHED branch has a bare `except Exception` around `order.shipment`.
- `pack` builds a set inside a list comprehension (O(n^2), n at most 200).
- `vitest.config.ts` now includes `*.test.tsx` (needed, but outside the file lists in the prompts).
- Walkthrough titles use an em dash (docs only).

## Things done correctly (no action)

- Payment bypass closed: PLACED/PENDING can only go to CONFIRMED or CANCELLED; generic PATCH and bulk-status refuse PROCESSING, PACKED, DISPATCHED, DELIVERED.
- Fit-prompt `timestamp` fix is in, with a regression test.
- Parent payloads drop `changed_by`, `note` and Razorpay ids; staff detail unchanged; other parent's order is 404; query count tested for 1 and 30 orders.
- `indiaPostTrackingUrl` left empty, link hidden, Copy kept (owner has not given the URL).
- Process rules kept: no push, no Day 2 files edited, one migration `0016_shipment`.

## Open business items for the owner

1. India Post tracking URL (needed for the "Track on India Post" link).
2. Whether SCHOOL_ADMIN should lose pack/dispatch/deliver (now blocked for everyone through the generic API; only the new fulfilment endpoints do it, BOSS and ADMIN).
3. Day 2 merge order: Day 2 merges first, then rebase this and regenerate `0016`.
4. Shipment rows only come from the new dispatch endpoint, so old DISPATCHED orders show no tracking number.

## How to reproduce

```bash
cd ss_day3_work/backend && USE_SQLITE=1 .venv/bin/python manage.py test
cd ../frontend && npx vitest run && npm run build
```
Bug A1: POST `/api/fulfilment/pack/` as an ADMIN with `{"order_ids": ["not-a-uuid"]}`.
