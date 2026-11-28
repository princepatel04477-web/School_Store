# Day 3 merge handoff (for the owners)

Day 3 is ready on branch `day3-on-latest` (upstream `main` 920c739 plus Day 3 Tasks A to G, the report and Task J). Nothing is pushed.

## Why it is not on feat/parent-signin-choice
- `feat/parent-signin-choice` (c568d2a) is 40 commits ahead of `main` but 19 behind it (merge base 1c48784e).
- Its orders migrations are 0013_paymentattempt..., 0014_payment_recovery. `main` has 0013_devicetoken, 0014_orderitem_fit_model_version, 0015_orderitem_fit_feedback_and_more. Same numbers, different migrations.
- Day 3 Task A already conflicts there in settings.py, admin.py, fcm.py (missing on that branch), models.py, tasks.py, urls.py.
- `origin/codex/day3-fulfilment` (f176fe1) is an earlier Day 3 implementation touching the same files. Keep one implementation.

## Merge order we recommend
1. Owners merge `main` and `feat/parent-signin-choice` into one branch. Resolve the orders migration numbering (never `makemigrations --merge`).
2. Decide which Day 3 implementation stays: this one (`day3-on-latest`) or `codex/day3-fulfilment`.
3. Put Day 3 on top. Delete Day 3's `0016_shipment.py`, re-run `makemigrations orders` so it depends on the last migration, keep one migration.
4. New-parent step on the My account page ("Namaste" page): a parent with no children and no saved school gets a card that opens the existing state, city, school flow at `/flow?step=1`. Task J did this for `/parent` only, which is not where login lands on the signin-choice line.
5. Run the full backend suite on PostgreSQL and the frontend suite.

## Known failures that are not Day 3
- `frontend/src/store/persist.test.ts` (3 tests) fails on untouched `main`.
- `backend catalog.test_kv_photos` (photo size).
