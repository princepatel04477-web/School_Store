Day 3, Task D: fix the five dispatch defects found in the Task C review

Read first: CLAUDE.md, docs/antigravity-prompts/00-ground-rules.md, docs/day3-review-report.md (section "Task C review").
ENVIRONMENT: folder ss_day3_work, branch `day3-fulfilment` (run `git branch --show-current`, stop if it is `main`). Work on top of commit e6f70de.
One local commit at the end. Never push, merge or deploy. Do not read other git branches. Do not change Day 2 code or the Task C behaviour that already works.
Backend tests: `cd backend && USE_SQLITE=1 .venv/bin/python manage.py test`, and the orders suite on the local Postgres:
`USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store .venv/bin/python manage.py test orders`.
Frontend: `npx vitest run`, `npx tsc --noEmit`, `npm run build`. Report real output. If something cannot be done, say so under "Not done".

Fix exactly these, each with a failing-first regression test (write the test, see it fail on the current code, then fix):

C1. POST /api/fulfilment/{id}/dispatch/ with an article number longer than 40 characters returns 500. Validate the request body with a DRF
    serializer (article_number: required, trimmed, not blank, max_length 40; receipt_confirmed: BooleanField). Return 400 with {code, detail}.
    Also map django.core.exceptions.ValidationError raised by services to 400 in the shared error helper, so no validation failure can be a 500.
C2/C3. Remove `booked_at` from the dispatch request completely (view and service signature). The handover time is always `timezone.now()` on the
    server. A client sending booked_at (valid, invalid, or a 2020 date) must have no effect and must never cause a 500. Test all three.
C4. `receipt_confirmed` must be the JSON boolean true. The strings "false", "true", "1", 0, null and a missing field must not count as confirmed
    (400 RECEIPT_NOT_CONFIRMED), only true does. Use a strict check (for example a serializer field that rejects non booleans). Test each value.
C5. correct-article-number must let staff fix a change in case or spacing only (for example "rb 123" to "RB 123", or "RB123" to "RB 123"). Compare the
    trimmed text for the no-op test, and use article_key only for the duplicate check against OTHER parcels. A correction that changes only case or
    spacing writes a ShipmentCorrection (previous value, who, when) and updates consignment_number and article_key. The exact same trimmed text is still a no-op.
Also apply the same serializer approach to correct-article-number (max 40, not blank), and make sure the same validation applies to
the frontend: the article number input has maxLength 40 and the correction form shows the server message for a 400.

Low items, do them if small: C7 (a repeat claim by the person who already packed the order returns changed=false with 200 instead of 409),
C8 (fix the stale "valid S10 consignment" comment in backend/orders/test_parent_tracking.py).

Evidence: append a section "Task D" to docs/walkthroughs/day3-c-claim-pack-handover.md with: the five tests that failed first and then passed
(names), full SQLite suite result, orders suite result on Postgres (how many tests, any skipped), Vitest, tsc, build, `git diff --stat e6f70de..HEAD`.
