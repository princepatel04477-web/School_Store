Day 3, Task F: fix E1 and E2 from the Task E review

Read first: CLAUDE.md, docs/day3-review-report.md (section "Task E review").
ENVIRONMENT: folder ss_day3_work, branch `day3-fulfilment` (run `git branch --show-current`, stop if it is `main`). Work on top of commit a36d977.
One local commit at the end. Never push, merge or deploy. Do not read other git branches. Do not touch Day 2 code, staff screens or fulfilment services.
Tests: `cd backend && USE_SQLITE=1 .venv/bin/python manage.py test` and the orders suite on local Postgres
(`USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store .venv/bin/python manage.py test orders`);
`cd frontend && npx vitest run && npx tsc --noEmit && npm run build`. Report real output; list anything not done and why.

E1 (backend, privacy). In backend/orders/views.py, the create response (POST /api/orders/) returns the staff OrderDetailSerializer to everyone since Task E removed the PARENT branch.
Restore: when request.user.role is PARENT, return ParentOrderDetailSerializer (no changed_by, no notes, no Razorpay ids); staff and other roles keep OrderDetailSerializer.
First find out WHY Task E removed it (read the Task E diff `git diff bbf13b1 a36d977 -- backend/orders/views.py backend/orders/test_parent_tracking.py` and the frontend checkout code that
reads the create response in frontend/src/pages/CheckoutPage.tsx and api.ts). If the checkout needs a field that ParentOrderDetailSerializer lacks, add ONLY that field to the parent
serializer (and say which in the walkthrough). Write the test first: a parent creates an order, the response JSON has none of changed_by, note, razorpay_order_id, razorpay_payment_id in the order
or in status_events; a staff create or detail response is unchanged; the checkout still works end to end in the existing tests.

E2 (frontend). In frontend/src/pages/OrderDetail.tsx, handleCopy sets "Copied" even when the copy failed. Fix: await navigator.clipboard.writeText; on failure try the textarea and
document.execCommand('copy') fallback and use its boolean result; only show "Copied" (button text and the aria-live message) when one of them really succeeded. When both fail, show a short
message "Could not copy. Press and hold the number to copy it." in en, hi and gu (new keys appended in frontend/src/i18n/messages.ts), announced in the aria-live region, and keep the number
selectable (user-select: text). Remove the leftover timers on unmount (clear the timeout). Tests (Vitest): clipboard success shows Copied; clipboard rejects and execCommand returns false shows the
failure message and not Copied; clipboard missing and execCommand true shows Copied; message exists in all three languages.

E3 (small, do it): move the inline style props in OrderDetailSkeleton to classes in frontend/src/pages/orderDetail.css (no inline styles, tokens only).
E4 (small, do it): in docs/integration/evidence-table.md, for every PENDING row replace the expected outcomes in the packing, dispatch and parent-visible columns with "not run".

Evidence: docs/walkthroughs/day3-f-fix-e1-e2.md with the tests written first and failing (names), then passing, the full SQLite suite, the Postgres orders suite (counts, skips with reasons),
Vitest, tsc, build, `git diff --stat a36d977..HEAD`.
