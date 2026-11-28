Day 3, Task H: a new parent must never see demo children

Read first: CLAUDE.md, frontend/src/pages/Parent.tsx.
ENVIRONMENT: folder ss_day3_work, branch `day3-fulfilment` (run `git branch --show-current`, stop if it is `main`). One local commit at the end. Never push, merge or deploy.
Do not read other git branches. Do not touch backend, staff screens or Day 2 code. Design rules from CLAUDE.md apply (no Lucide, shadows, blur, hover movement, emojis, em dashes, purple;
skeleton loaders; tokens; 44px targets; Anek Latin). Run each command in the foreground and report its real final line. Never claim a result you did not run.

PROBLEM
`Dashboard` in frontend/src/pages/Parent.tsx (the page at /parent that a parent sees after login) falls back to a hard-coded `fallbackKids` list (Aarav Patel, DPS Surat, and one more)
whenever GET /students/ returns no students, fails, or is still loading. So a brand new parent with no children sees someone else's invented children, and `selected` points at a fake student.

REQUIRED BEHAVIOUR
1. Delete `fallbackKids` and every use of it. Never show invented children.
2. While the students request is loading: show a skeleton (reuse the existing Skeleton components) in the "My children" area, no kids, no fake data.
3. If the request fails: a short message and a Retry button (same style and i18n keys already used for the order list error, for example `orders.loadError`, `common.checkInternet`, `orders.retry`; add new keys only if
   needed). Never show the empty state for a failure.
4. If the request succeeds with zero children: an empty state "No children added yet." with a short line telling the parent how to continue (for example choose a school or ask the school to add the child;
   keep it honest, do not promise a feature that does not exist, check what the app really offers). No fake child, and nothing that needs `selected` (the profile card, photo delete, product picker for a child)
   must render or crash when there is no selected child. Orders stay reachable (the Orders link in the shell must keep working).
5. With real children: behaviour unchanged, first child selected by default, switching still works.
6. `selectedId` must not default to the string '1'. Use null until a real child exists, and handle null everywhere it is used (`rawStudent`, `studentProfile`, cart reset).
7. Every new string in en, hi and gu in frontend/src/i18n/messages.ts (append new keys only, leave existing keys untouched). If Parent.tsx currently uses plain English strings for this section,
   new strings still go through `t()`.
8. No inline `style={{` added by you. If you touch the inline-styled profile card block, leave it as it is unless you must change it.

TESTS (write first, show failing, then passing): a Vitest file frontend/src/pages/Parent.test.tsx covering loading (skeleton, no child names), error (message + Retry, then Retry succeeds and children appear),
empty (empty state, no "Aarav", no crash), and one or two real children (names shown, switching works). Check the text "Aarav Patel" and "DPS Surat" never appears in the empty, loading or error states.
Also confirm with `git grep -n "fallbackKids\|Aarav" frontend/src` what is left (test fixtures are fine, app code is not) and report it.

VERIFY: `cd frontend && npx vitest run && npx tsc --noEmit && npm run build`. Report counts and final lines.
Evidence: docs/walkthroughs/day3-h-parent-no-demo-children.md with the git diff --stat, the test results and what you checked. Screenshots only if you really captured them with Playwright, with the modal
"Welcome to SchoolStore" dismissed first; otherwise say none were taken.
