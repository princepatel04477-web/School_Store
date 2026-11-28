Task L: bring branch day3-on-latest up to date with origin/main and resolve every conflict

Read first: CLAUDE.md, docs/day3-merge-handoff.md, docs/day3-review-report.md, backend/orders/fulfilment_gate.py, backend/orders/fulfilment.py, and on origin/main:
backend/orders/status.py, payment_view.py, models.py, views.py, serializers.py, webhooks.py, test_payment_contract.py, test_recovery_review.py (use `git show origin/main:<path>`).

ENVIRONMENT (wins over anything else)
- Folder ss_latest_work, branch `day3-on-latest` (run `git branch --show-current`; stop if it is anything else). `origin/main` is already fetched (384af13). Run `git merge origin/main` (a merge, NOT a rebase,
  never rewrite existing commits). Finish with the merge commit. Never push, never deploy, never touch `main`. Do not read other branches.
- Python: backend/.venv/bin/python . If main added Python dependencies, make a venv outside the repo and say so. Frontend: run `cd frontend && npm ci` after the merge.
- Run each command in the foreground with a long timeout and report its real final line. Never claim a result you did not run. Do not commit .DS_Store.

MERGE RULES
1. origin/main is the live product. Where behaviour conflicts, KEEP main's behaviour (payments, Razorpay recovery, payment_view states, inventory, teacher portal, auth, UI) and fit Day 3 into it.
   Never drop a line of main to make Day 3 simpler. Never use `-X ours` / `-X theirs` or take a whole file from one side. Resolve hunk by hunk. In the walkthrough, list every conflicted file and how you resolved it.
2. Also review files that merged WITHOUT conflicts but were changed on both sides (list them with
   `comm -12` of the two changed-file lists from the merge base) for semantic breakage: duplicate definitions, dead imports, two payment fields, serializers leaking staff data.
3. Migrations: delete Day 3's `orders/migrations/0016_shipment.py`, then `makemigrations orders` so Day 3 gets ONE new migration (0017_...) that depends on main's `0016_merge_web_live_and_main`.
   Never `makemigrations --merge`, never edit a main migration. `makemigrations --check` must be clean, and `migrate` from an empty database must work.
4. Parents: keep main's parent pages. Re-apply Day 3's parent features on top (order tracking timeline, order detail route, India Post number with Copy and link, new-parent redirect to the state flow with
   skeleton and Retry, no demo children). Payment wording must come from main's payment_view states, not a second Day 3 interpretation. If main already does something Day 3 did, keep main's and say so.
   Parent responses never include staff names, notes, claims, issue text or Razorpay ids (keep the recursive no-leak tests passing).
5. PACKING PAYMENT RULE (important, otherwise the merge would stop all packing, because Day 3 refuses PROCESSING/PACKED/DISPATCHED/DELIVERED on the generic order route and the gate is closed by default).
   Create backend/orders/payment_rules.py with `packing_decision(order) -> PackingDecision`, built ONLY from main's existing rules (reuse `can_transition_order` and `payment_view` / PaymentReview; do not write
   new payment logic). Conservative: ONLINE is allowed only when main's rules say it is verified PAID with no refund due and no open payment review; CHECKING, NOT_PAID, RELEASED, REFUND_DUE, cancelled are blocked
   with a machine reason and a plain staff sentence; COD (COD_DUE) is allowed; PAID_DO_NOT_COLLECT is allowed with a message saying not to collect cash, and the packing list/UI must show that.
   It runs under the caller's row lock and never calls the payment provider. List every payment state and your decision in a table in the walkthrough.
   Check what staff flows main had for packing and dispatch (generic status route, bulk-status, any admin UI). Every one must still have a working path: say which, and test it. If you find a main flow that
   Day 3's refusal would break and cannot map to the new endpoints, do not silently break it: keep main's flow working and report it.
6. i18n: keep all keys from both sides, no duplicates, en/hi/gu. CLAUDE.md design bans apply to anything you touch.
7. Integration tests: orders/test_integration_day2_day3.py should now run for real instead of skipping. Make the Day 2 cases use main's real payment flow (test fixtures and the existing fake gateway,
   no real Razorpay). Update docs/integration/evidence-table.md honestly: SIMULATED at best, never PROVIDER-VERIFIED.

VERIFY (all after the merge)
- Before merging, record baselines on a clean worktree of origin/main outside the repo folder: backend SQLite full suite, vitest, tsc. Remove that worktree after.
- After: `USE_SQLITE=1 python manage.py test`; `makemigrations --check`; if a local PostgreSQL answers on 127.0.0.1:54329 (user postgres), the full suite there too
  (`USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store`), otherwise try to start a temporary one in /private/tmp and say what happened;
  `cd frontend && npx vitest run && npx tsc --noEmit && npm run build`.
- Every failure that is not present in the origin/main baseline is yours to fix. Do not delete, skip or weaken tests to get green.
EVIDENCE: docs/walkthroughs/day3-l-merge-main.md: conflicted files and resolutions, overlapping clean merges reviewed, migration, payment state table, baseline vs final results, and "Not done / not verified".
Add it to the merge commit or one follow-up commit.
