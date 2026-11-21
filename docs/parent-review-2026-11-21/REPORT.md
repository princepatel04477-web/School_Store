# Parent account review: Antigravity prompts 1 to 5

Date: 2026-11-21. Reviewer: Claude.

## Update: fixes made (uncommitted, branch `fix/parent-review` in worktree `School_Store-review`, on top of `feat/parent-orders`)

| Must-fix | Change | Checked |
|---|---|---|
| Outage at load signs parent out | `auth.tsx` signs out only on a refused session (401). Network errors and 5xx keep the tokens and set `offline`. `Guard` shows "You are still signed in" with Try again. `api.ts`: refresh failures from network errors no longer sign out, and `logout()` runs once (fixes the `/login` race) | `auth.test.tsx` (4 tests). Phone: server down, reload → panel with tokens kept; server back, Try again → account restored |
| Active order never shown | `OrderListSerializer` returns `student` (the order's own column, no join, no migration, no permission change). The card shows readable labels and links to that order | Backend test asserts it. Phone: both families show their active order on the right child |
| No sign-out | "My orders" and "Sign out" buttons on the account page | Phone: sign out → home page, storage empty |
| OTP rate limit | Verify has its own allowance (`otp_verify`, `OTP_VERIFY_THROTTLE_RATE`, default 20/min). Send stays at 5/min. A code is still burned after 5 wrong tries | 2 new backend tests. Phone: 1 send + 4 wrong codes + right code signs in |
| Timeline | `.step-badge` renamed to `.parent-step-badge` (it collided with checkout's); the current step stays white on green with a ring; delivered orders have no "in progress" label; hex colours replaced by tokens | Phone screenshot |
| Card padding / undefined variables | `--space-5` → `--space-4`, `--ink-muted` → `--ink-soft` | Computed padding 16 px |
| Wrong error copy | New `parent.loadError` on the account page, My Orders and order detail | Phone |
| Campus city label | `StudentSerializer` returns `city_name`; the shop selection uses it | Phone: "Udgam Surat Campus · Surat" |
| Also | Checkout sign-in sheet no longer loads children twice; `-` for empty values; delivery labels translated; Antigravity's order-dependent student test fixed | Tests |
| Baseline | Rerun on Postgres 17 and Redis with a separate multi-process load generator: see `perf-baseline/RESULTS.md` | Raw JSON in `perf-baseline/raw` |

**Tests on the final code:** frontend 148/148, `tsc -b` clean, backend 298 (accounts, orders, schools, common, catalog; 7 skipped) with accounts rerun after the last test fix.

**Still open:**
- MSG91 on the live server. My read-only check of the server's env file was blocked by the permission system.
- The client-IP key behind the Worker and tunnel (`NUM_PROXIES`).
- Real-handset SMS.
- Remaining hard-coded English on the account page (photo section, "Read-only", Boy/Girl).
- The photo delete button's missing confirmation step.
- Re-assignment moves old orders and delivery details to the new parent.

---

The original review follows.

## What was tested

| | |
|---|---|
| Code | `feat/parent-orders` @ d7bab48 (contains prompts 1 to 4 stacked on `release/guest-nosave-portal` @ f699297). Prompt 5 is the separate branch `perf/read-baseline` @ dae3587. The main folder has `perf/read-baseline` checked out, which does **not** contain the parent work. |
| Where | Separate worktree `School_Store-review`. Its own SQLite DB was seeded with `seed_data` plus synthetic families. The Vite dev server was proxied to a local Django `runserver`. Nothing touched live, the store server, Render or Neon. |
| SMS | `SMS_PROVIDER=console` (the development provider; codes are shown on screen as "Test mode"). Failure cases were run by restarting with `SMS_PROVIDER=msg91` and no keys (not configured), and with fake keys plus `HTTPS_PROXY=127.0.0.1:9` (send fails; no traffic left the machine). |
| Device | The Claude desktop app's built-in Chromium browser, emulating 360x740 at DPR 2 with a touch phone profile. **No real handset was used.** Chrome would not shrink below desktop width, so all visual checks are from the built-in browser. |
| Families | **New parent** 9811100001 (no child, created through OTP). **Two children** 9811100002: Arjun, DPS Surat, Class 3, boy; Bela, Udgam Surat Campus, Class 8, girl. **Active order** 9811100003: Chirag, Fountainhead, Class 5, with a PACKED/COD order of ₹1,350 and a DELIVERED/PAID order of ₹450. |
| Automated | Backend: 296 tests OK, 7 skipped (accounts, orders, schools, common, catalog), including the new two-family `test_parent_order_access`. Frontend: 144/144 vitest pass. `tsc -b` is clean. |
| Recording | `phone-journey.gif`: 19 captioned phone screenshots in sequence. It is a slideshow, not a screen video. |

## Results

| # | Check | Environment | Expected | Observed | Result |
|---|---|---|---|---|---|
| 1.1 | Account entry on `/` without scrolling | 360x740 guest | Visible in the top bar | User icon at 254,10, 44x44. Icon only below 640 px: the text label is hidden and the accessible name is "Sign in" | Pass |
| 1.2 | Home entry opens parent OTP | 360x740 | OTP sheet | "Sign in with your mobile number" sheet, staff link below | Pass |
| 1.3 | Shopping header entry opens OTP | `/shop` 360x740 | Same sheet | Same sheet | Pass |
| 1.4 | Account, bag and language visible, tappable, no overlap | `/` and `/shop` | 44 px targets, no overlap | All 44 px with no overlap (gaps are 4 px). The shop header brand truncates to "School…" | Pass |
| 1.5 | Double scrollbar | `/`, `/shop`, `/flow`, `/parent`, `/parent/orders` | One page scroller | No nested scroll containers and no horizontal overflow | Pass |
| 2.1 | New parent | dev SMS | Account created, lands on account | Created, lands on `/parent` | Pass |
| 2.2 | Returning parent | dev SMS | Same account | Same user id, 1 row for the number | Pass |
| 2.3 | Wrong code | dev SMS | Clear message, can retry | "That OTP is wrong or old. Try again.", field cleared and refocused | Pass |
| 2.4 | Expired code | dev SMS | Clear message, resend | "That code has expired or was used up. Send a new code." plus "Send OTP again". Reached by locking the code after 5 wrong tries; the 5-minute timeout itself was covered only by unit tests | Pass |
| 2.5 | Resend | dev SMS | New code works | 30 s timer; the new code signs in | Pass |
| 2.6 | Provider not configured | msg91, no keys | Understandable | "Sign-in by mobile number is not available yet." The parent has no other route to sign in | Pass (message) |
| 2.7 | Provider send fails | msg91, blocked | Understandable, can retry | "We could not send the SMS. Please try again in a minute." Retry worked after the provider was restored | Pass |
| 2.8 | Rate limit vs mistakes | local | A few typos tolerated | 1 send + 4 wrong codes gives "Too many tries". Send and verify share 5/min per IP | **Fail** (risk) |
| 2.9 | Refresh after sign-in | 360x740 | Still signed in | Still signed in | Pass |
| 2.10 | Real handset SMS | none | Code arrives by SMS | Development provider only | Unverified |
| 2.11 | Sign out | 360x740 | Parent can sign out | No sign-out control anywhere (page, header, menu) | **Fail** |
| 3.1 | No linked child | new parent | Find school / add child | "No children linked yet", "Find your school", "Add your child" | Pass |
| 3.2 | Two children, switch A to B, shop | two-child family | Campus, class and catalogue change | A: DPS · Class 3 · Boy, DPS items. B: Udgam Surat Campus · Class 8 · Girl, Udgam items | Pass |
| 3.2b | Campus city label | child B | Surat | Shop chips read "Udgam Surat Campus · **Ahmedabad**" | **Fail** |
| 3.3 | Active order leads | active-order family; two-child family after a real order | Order card first | No order card for either family | **Fail** |
| 3.4 | Landing layout | 360x740 | Padded cards | Cards have 0 padding; text and buttons touch the borders | **Fail** |
| 4.1 | Hard refresh after adding to bag | two-child family | Bag empty, fresh selection, signed in | Bag 0, `/flow` step 1, still signed in | Pass |
| 4.2 | Placed order after refresh | two-child family | In My Orders | Listed: Order placed / Pay on delivery / ₹580 | Pass |
| 4.3 | School link, first arrival | guest, `/shop?school=<FHS>` | That school preselected | Step 2 for Fountainhead School Surat | Pass |
| 5.1 | Empty account | new parent | Empty state | "No orders yet" plus Browse catalogue. Sign-in returned to My Orders | Pass |
| 5.2 | Account with orders | active-order family | Items, sizes, amount, payment, fulfilment | Socks Junior x2 ₹900 and Senior x1 ₹450, total ₹1,350, "Packed" and "Pay on delivery" shown separately. No Razorpay ids | Pass |
| 5.2b | Timeline legibility | 360x740 | Readable steps | Current step number invisible (green on green); "Order in progress" covered by a solid circle; a delivered order says "Order in progress" | **Fail** |
| 5.3 | Failure mid-session, Retry, restore | backend stopped then restarted | Retry, original order returns | "Try again" appears and restores both orders correctly. The message wrongly says "Your order is saved on this phone. Tap Place order again" | Pass (mechanics) / **Fail** (copy) |
| 5.4 | Failure when the page loads | backend stopped, reload | Retry | Parent is **signed out** and sent to the staff password page `/login` | **Fail** |
| 5.5 | Other family's order by URL | active-order family to two-child family's order | Not shown | Page: "We could not find this order". API: 404, no names leaked | Pass |
| 5.6 | Backend permissions, two families | Django tests | Each sees only own | Passes: list, `?student=`, detail, PATCH, DELETE, payment, verify-payment, anonymous, plus curl over HTTP | Pass |
| 6.1 | OTP keyboard | emulation | Numeric keypad, SMS autofill | Phone `type=tel inputmode=numeric`; OTP `inputmode=numeric autocomplete=one-time-code`, auto-focused. The real keyboard cannot be seen in emulation | Pass (attributes) / Unverified (device) |
| 6.2 | Back navigation | 360x740 | Detail to list to previous | Browser back: detail, then list, then previous page. "Back to My Orders" link works | Pass |
| 6.3 | Backend baseline evidence | `perf/read-baseline` | Postgres/Redis, external load, real metrics | See below | **Fail** (not usable) |

## Failures: shortest reproduction and file

1. **Outage at page load signs the parent out.** Sign in, stop the API, reload `/parent/orders`, and you land on `/login` with the tokens deleted. `frontend/src/auth.tsx` calls `logout()` on *any* `auth.me()` error, including network errors and 5xx, and `logout()` in `frontend/src/api.ts` can fire twice (the second call loses `user_role` and goes to `/login`). This code existed before, but it now defeats the Retry design and will also hit payment returns.
2. **Active order never shown.** Sign in as 9811100003 (PACKED order): no order card. `ParentLanding.tsx` matches `order.student`, but `OrderListSerializer` (`backend/orders/serializers.py`) has no `student` field. `ParentLanding.test.tsx:125,171` mocks a field the API doesn't send, which is why the tests pass.
3. **No sign-out.** Removing `Shell` from `frontend/src/pages/Parent.tsx` removed the only sign-out button.
4. **OTP rate limit.** 1 send + 4 wrong codes returns 429. `OTPRateThrottle` (`backend/accounts/views.py`) uses one 5/min scope for send and verify. `NUM_PROXIES` is unset behind the Worker and tunnel, so on live this bucket may be shared by every parent (still unverified on live).
5. **Timeline.** Open My Orders with any order. `.parent-timeline-step.current .step-marker` overrides the `.done` white text, and `.step-badge` collides with the existing global `.step-badge` in `components/cart/bagCheckout.css` (28 px green circle). `ParentTimeline.tsx` shows "Order in progress" on DELIVERED. Files: `frontend/src/components/parent/ParentOrders.css`, `ParentTimeline.tsx`.
6. **Card padding.** `ParentLanding.css` uses `--space-5`, which is not defined. `ParentOrders.css` uses the undefined `--ink-muted` (13 times).
7. **Wrong error copy.** On My Orders with the API down, it reuses `err.offline`, which is checkout text. Files: `ParentOrders.tsx` and `ParentLanding.tsx`.
8. **City label.** Shop for child B and the chips read "Ahmedabad". `handleShopForChild` sets `cityName: activeSchool.city` instead of the branch's city. File: `ParentLanding.tsx`.

Also seen in code review, not blocking:
- In checkout mode, `ParentSignInSheet` calls `loadChildren()` twice after verify (the open effect now depends on `user`), which doubles the `/students/` request and its UPDATE.
- Hard-coded English on the landing page and order detail ("Read-only", "Boy/Girl", the photo section, "Recipient/Phone/Address", "PARENT ACCOUNT").
- `—` used for empty values (CLAUDE.md says `-`).
- The photo delete button lost its confirmation step.
- The round badge (`border-radius: 50%`) and hex reds and ambers in `ParentOrders.css`.
- The curl test (`test_parent_order_access.py`) shells out to `curl.exe` and `nul`, so it only runs on Windows.
- My earlier prompt said re-assigning a child leaves old orders with the old parent. That was wrong: `Student.save()` moves them to the new parent, including the old parent's delivery name, phone and address. Decide whether that is acceptable.

## Backend baseline (prompt 5): what its numbers are

- **Environment:** the developer's Windows 11 PC (16 threads, 16 GB). **SQLite `dev_db.sqlite3` and LocMemCache**, not Postgres and Redis. Waitress with 16 threads.
- **Workload:** 50 synthetic parents, 3,175 orders, 48 products / 230 variants, 18.5 MB DB. 1, 5, 10 and 25 virtual users, **15 s per step** (the prompt asked for 2 min after a 30 s warm-up). Throttles were raised by environment variables (nothing committed).
- **Reported:**
  - Catalogue: about 40 req/s peak at 5 VUs (p95 ≈ 150 ms). At 25 VUs, 23 req/s (p95 ≈ 2.3 s).
  - Parent orders: 25.6 req/s at 5 VUs (p95 258 ms). At 25 VUs, 17 req/s (p95 3.2 s).
  - 0 errors throughout.
- **Why it isn't usable:**
  - k6 never ran. `perf/benchmark_runner.py` is a Python asyncio client running **in the same process as the Waitress server**, so generator and server share one interpreter. Throughput *falls* as users increase, which fits that contention.
  - "Gen CPU" equals "App CPU" on every row.
  - The DB connection count is hard-coded (`1 if sqlite … else 2`).
  - The "raw k6 summary" JSON is produced by the runner itself.
  - The report claims a PostgreSQL index scan without running Postgres.
- **Missing measurements:** Postgres latency and connections, `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)`, Redis cache behaviour, an external load generator, and steps above 25 users.

## Must fix before payment work

1. Don't sign parents out on network or 5xx errors; only on a real 401 after refresh fails (item 1).
2. Show the active order: add read-only `student` to `OrderListSerializer` (no migration, no permission change) and fix the mocked tests (item 2).
3. Give parents a sign-out (item 3).
4. Separate the send and verify throttles, and confirm the client-IP key behind the Worker and tunnel on the store server before launch (item 4).
5. Make the order timeline legible and correct for delivered orders, and fix the undefined CSS variables (items 5 and 6).
6. Correct the My Orders and landing error copy (item 7).
7. Confirm that MSG91 with a DLT OTP template is configured on the live server. Without it, every parent sees "not available yet".
8. Redo the baseline on Postgres and Redis with an external load generator before sizing for payment traffic.
