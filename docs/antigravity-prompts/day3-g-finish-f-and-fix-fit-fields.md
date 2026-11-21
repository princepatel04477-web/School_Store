Day 3, Task G: finish Task F and fix the parent order item regression

Read first: CLAUDE.md, docs/day3-review-report.md (sections "Task E review" and "Task F review").
ENVIRONMENT: folder ss_day3_work, branch `day3-fulfilment` (run `git branch --show-current`, stop if it is `main`). HEAD is a36d977 and the working tree holds Task F's UNCOMMITTED changes
(views.py parent create response, test_parent_tracking.py, OrderDetail.tsx copy handler, OrderDetail.test.tsx, orderDetail.css, messages.ts, docs/integration/evidence-table.md). Keep them: they were reviewed and
the copy fix (E2) is good. Do not discard or redo them. One local commit at the end covering Task F and Task G together. Never push, merge or deploy. Do not read other git branches.
Do not touch Day 2 code, staff screens or fulfilment services.
Tests: `cd backend && USE_SQLITE=1 .venv/bin/python manage.py test` and the orders suite on local Postgres
(`USE_POSTGRES_FOR_TESTS=1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=54329 POSTGRES_USER=postgres POSTGRES_DB=school_store .venv/bin/python manage.py test orders`), then
`cd frontend && npx vitest run && npx tsc --noEmit && npm run build`. IMPORTANT: wait for each command to finish and report its real final line. Do not start a background run and then poll it
in a loop: run each suite in the foreground with a long timeout (they take 2 to 3 minutes).

G1 (the regression). `orders.test_fit_logging.FitLoggingTests.test_line_fit_is_copied_even_without_a_chart` fails on the current tree (KeyError 'measurement'). Root cause: Task E added
`ParentOrderItemSerializer` in backend/orders/serializers.py, which dropped `measurement`, `category`, `chosen_size`, `recommended_size`, `fit_feedback`, `fit_feedback_answered_at` from a parent's order items.
`OrderItemSerializer` contains no staff data (no unit cost, no staff names). Fix: make `ParentOrderDetailSerializer.items` use `OrderItemSerializer` again (delete `ParentOrderItemSerializer`; if the new
OrderDetail screen reads a `size` field that only the new serializer had, add that one read-only field to OrderItemSerializer or map it in the frontend, and say which). Staff data stays out of parent responses:
status_events use ParentOrderStatusEventSerializer (no changed_by, no note), no razorpay ids.
Write the tests first and show them failing, then passing:
 - parent create response (POST /api/orders/) and parent detail (GET /api/orders/{id}/): items include `measurement` (when the line had one), `chosen_size`, `recommended_size`, `category`, `fit_feedback`;
   no `changed_by`, `note`, `razorpay_order_id`, `razorpay_payment_id` anywhere in the JSON (walk the whole structure recursively, not just top level keys).
 - staff detail and create responses are unchanged.
 - another parent's order is still 404.
 - the existing fit logging, fit feedback and parent tracking tests all pass again.
Also search the frontend for any other place that reads fields from a parent order item and confirm they are all present (`git grep -n "items\\b" frontend/src/pages frontend/src/components | grep -i order`), and say what you checked.

F-finish (small, from the review):
 - frontend/src/pages/OrderDetail.tsx still has 3 inline `style={{` props. Move them to classes in orderDetail.css unless the value is truly dynamic (then keep it and say why in the walkthrough).
 - docs/integration/evidence-table.md: confirm every PENDING row says "not run" in the packing, dispatch and parent-visible columns.
 - Write docs/walkthroughs/day3-f-g-fixes.md: the tests that failed first (names) and then passed, full SQLite suite, Postgres orders suite (counts and skip reasons), Vitest, tsc, build,
   `git diff --stat a36d977..HEAD`, and a "Not done" list.
