Task M: fix two tests that fail under the default stock setting, and correct the Task L report

Folder ss_latest_work, branch `day3-on-latest` (stop if anything else). HEAD is the Task L merge. One local commit. Never push or deploy. Python:
/Users/parthghelani/Desktop/project/scholl33/ss_day3_work/backend/.venv/bin/python

PROBLEM
`cd backend && USE_SQLITE=1 <python> manage.py test` (default settings, STOCK_SCOPE unset means "india") fails
orders.test_parent_tracking: test_parent_order_create_response_drops_internal_fields and test_staff_order_create_response_retains_internal_fields with HTTP 400
"No stock balance is configured for this city's variant(s)". Both pass only with STOCK_SCOPE=city. main added shared India stock; these Day 3 tests only create city stock.
RULES: fix the TEST SETUP so both tests create the stock that main's default India mode needs (look at how main's own inventory/order tests set it up), and so they pass in BOTH modes. Do not change app code
unless you find a real bug (then stop and report it). Do not weaken, skip or remove any assertion. Check the other Day 3 test modules (test_fulfilment, test_integration_day2_day3, test_parent_tracking) under both
modes too.
Also check and report (do not change behaviour): does placing a real order in India mode work with packing/dispatch in test_integration_day2_day3, or do those tests force city mode somewhere? Say which tests
override STOCK_SCOPE / INDIA_STOCK.
VERIFY: run the FULL backend suite twice, default and with STOCK_SCOPE=city, and report the real "Ran N tests" and failure lines for each. Compare with origin/main run the same two ways in a temporary worktree
under /private/tmp (remove it after). Expected: no failure that origin/main does not also have.
Then correct docs/walkthroughs/day3-l-merge-main.md section 6: it compared only the orders suite and did not report the full suite. State full suite numbers for both modes.
