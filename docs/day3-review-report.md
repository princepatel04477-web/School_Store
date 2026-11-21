# Day 3 review report (for Codex)

Latest: Task D `bbf13b1` (fixes C1 to C5, C7, C8) and Task E `a36d977` (parent order detail plus integration harness). See the last two sections. Branch `day3-fulfilment`, 4 local commits on top of the baseline.
Note: in the Tasks A and B section below, the three high bugs were later fixed inside Task C and Task D, not in a separate pass.

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

---

# Task C review (`e6f70de`, claim, pack, postal handover)

Built by Antigravity on Gemini 3.8 Flash from `docs/antigravity-prompts/day3-c-claim-pack-handover.md`.

## Verified by me (clean worktree)

| Check | Result |
|---|---|
| Backend full suite, SQLite | 364 tests OK (22 skipped) |
| Backend `orders` suite, local PostgreSQL | 97 tests OK, 0 skipped, so the 4 thread concurrency tests ran |
| `makemigrations --check` | no changes |
| Vitest / tsc / build | 165 pass / clean / built |
| Spec scenarios (prepaid, COD, blocked, simultaneous claim, repeats, duplicate number, out of scope, pickup) | each has a named passing test; concurrency ones are real threads on Postgres |
| Postal format check | removed, none left in backend or frontend |
| Stock | pack writes nothing to stock; no Day 2 function edited |

Not verified: screenshots (not opened), the Postgres run covered `orders` only, `0016_shipment.py` was edited in place (fine while Day 3 is unmerged).

## Defects found (all reproduced with a throwaway test)

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| C1 | High | `fulfilment_views.py` `dispatch_shipment`, `fulfilment.py` `dispatch_order` | An article number longer than 40 characters returns HTTP 500 (`full_clean` raises a Django `ValidationError` that is not mapped). | Validate request bodies with serializers (max_length 40, non blank) and map Django `ValidationError` to 400. |
| C2 | High | same | A bad `booked_at` string returns 500. | Remove `booked_at` from the request entirely. |
| C3 | High | same | The client can set `booked_at`, so handover time can be backdated (reproduced: 2020 date accepted). The spec says the system records handover time. | Ignore any client value; use `timezone.now()` on the server. |
| C4 | Medium | `dispatch_shipment` | `bool(request.data.get("receipt_confirmed"))`: the string `"false"` counts as confirmed (reproduced: handover succeeded). | Use a `BooleanField` serializer and require `true`. |
| C5 | Medium | `fulfilment.py` `correct_article_number` | A correction that only changes case or spacing (`rb 123` to `RB 123`) is treated as "same value" and silently ignored, so the stored number cannot be fixed to match the receipt exactly. | Compare the trimmed text, not the key, for the no-op test; use the key only for the duplicate test. |
| C6 | Low | `fulfilment_views.py` | Every action wraps its body in `except Exception` and re-raises unknown errors, and reads request fields by hand. Use serializers like the other endpoints. |
| C7 | Low | `fulfilment.py` | `claim_order` on an already PACKED order by the person who packed it returns 409 `ORDER_NOT_CLAIMABLE` instead of a harmless repeat. |
| C8 | Low | `test_parent_tracking.py:224` | Comment still says "valid S10 consignment". |

## Still awaiting Day 2

Real rule callable (assumed `orders.payment_rules.packing_decision`), final blocked reason codes, whether COD needs a confirmation step, refund or cancel of a claimed order, and renumbering migration `0016` after Day 2 merges.


---

# Task D review (`bbf13b1`): C1 to C5, C7, C8

All verified by my own throwaway probe on the final code (SQLite):

| Defect | Result now |
|---|---|
| C1 article number of 41 characters | 400, no shipment (same for correction) |
| C2/C3 `booked_at` | ignored: junk value gives 200 and no crash; a 2020 date is not stored (year is current) |
| C4 `receipt_confirmed` | `"false"`, `"true"`, `1`, `null`, missing all give 400 and write nothing |
| C5 case or spacing correction | `rb 123` to `RB 123` and then `RB123`: both applied, 2 correction rows kept |
| C7, C8 | done |

Remaining small item: a numeric article number (JSON `12345`) is accepted and stored as text "12345". Harmless, mention only.

# Task E review (`a36d977`): parent order detail and integration harness

Verified in a clean worktree: SQLite 383 tests OK (28 skipped); Postgres `orders` 116 OK (6 skipped, all the Day 2 integration cases, reason "Day 2 not merged"); `makemigrations --check` clean; Vitest 175; tsc and build clean; 28 screenshots committed (not opened by me).

Evidence table is honest: the 6 real-Day-2 rows are PENDING, the 4 simulated rows are labelled SIMULATED, no row says PROVIDER-VERIFIED.
Official India Post page is set in `siteConfig.indiaPostTrackingUrl` (https://www.indiapost.gov.in/VAS/Pages/TrackConsignment.aspx, found by web search; owner must confirm). No number is put in the URL.

## Defects

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| E1 | Medium | `backend/orders/views.py` create (about line 119) | Task E removed the PARENT branch, so the response to placing an order is again the staff `OrderDetailSerializer` (status events with `changed_by` and notes, Razorpay id fields). The frontend never reads `razorpay_order_id` from that response (payment uses `/payment/`), so nothing needs it. It reverses Task B's rule that parents get parent-only data. Values are empty or the parent's own at creation, so the leak is small today, but it is a regression of the rule. | Restore `ParentOrderDetailSerializer` for PARENT in the create response; if the checkout needs an extra field, add only that field. Add a test on the create response. |
| E2 | Medium | `frontend/src/pages/OrderDetail.tsx` `handleCopy` | When copying fails (clipboard blocked, `execCommand` fails) the `catch` still sets "Copied", so the parent is told it worked when it did not. | Show a failure message ("Press and hold the number to copy") when copy fails; test it. |
| E3 | Low | `OrderDetail.tsx` `OrderDetailSkeleton` | Many inline `style={{...}}` props, against the rule to avoid inline styles. Move to `orderDetail.css`. |
| E4 | Low | `docs/integration/evidence-table.md` | PENDING rows fill the packing and parent-visible columns with the expected outcome ("Packing permitted", "Parent sees article number"). Reads like a result. Use "not run" in those cells. |
| E5 | Low | evidence | Cases 1 and 2 (payment survives browser closure, pending and late capture blocked) have no simulated variant, so nothing of them was exercised. Day 2 integration must run them. |

## Awaiting Day 2 and the owners

Real Day 2 branch and the combined migration run, a real payment provider response, a real India Post booking and a verified deep link, owner sign off on the India Post URL, renumbering Day 3's `0016` after Day 2.

---

# Task F review (E1, E2): INCOMPLETE, not committed

Antigravity was interrupted ("error: interrupted") before it committed or wrote the walkthrough. Its changes sit uncommitted in the working tree. I applied them to a clean worktree of `a36d977` and tested.

- E2 (copy feedback): done and good. "Copied" only on real success, failure message in en/hi/gu, timer cleared. Vitest 179 pass, tsc and build clean.
- E1 (parent create response): the parent serializer is restored in `views.py` and tests were added, but the change exposes a regression from Task E:
  **F1 (High).** `orders.test_fit_logging.FitLoggingTests.test_line_fit_is_copied_even_without_a_chart` now fails (SQLite 1 error in 385, Postgres 1 error in 118). Cause: Task E's `ParentOrderItemSerializer` dropped `measurement`, `chosen_size`, `recommended_size`, `fit_feedback`, `fit_feedback_answered_at` and `category` from the parent's order items. Task E hid this by sending parents the staff serializer on create, and the parent detail endpoint (GET /api/orders/{id}/) has been missing those fields since Task E. `OrderItemSerializer` contains no staff data (no cost, no staff names), so the new serializer was unnecessary.
  **Fix:** make `ParentOrderDetailSerializer.items` use `OrderItemSerializer` again (keep the extra `size` alias if the new screen needs it), re-run the full suites, and add a test that the parent detail and create responses include `measurement` and the other fit fields but never `changed_by`, `note` or Razorpay ids.
- E3: 3 inline `style={{` props remain in `OrderDetail.tsx` (check if they are dynamic values).
