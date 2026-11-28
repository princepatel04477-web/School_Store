Task K: new parent on the My account ("Namaste") page: choose the school first

Read first: CLAUDE.md, frontend/src/pages/AccountPage.tsx (+ AccountPage.test.tsx, accountPage.css), frontend/src/pages/Login.tsx and the login redirect (`homeFor` in frontend/src/App.tsx),
frontend/src/pages/SelectionFlowPage.tsx and frontend/src/components/SelectionFlow.tsx (step 1 = "Which state is your child's school in?", then city, school, class, products), frontend/src/store/storeState.ts,
frontend/src/components/parent/ParentSignInSheet.tsx, frontend/src/motion/*.

ENVIRONMENT (wins over anything else)
- Folder ss_latest_work, branch `new-parent-school-card` (run `git branch --show-current`; stop if it is `main` or anything else). It is cut from origin/feat/parent-signin-choice (c568d2a).
  This branch has NO Day 3 backend and no fulfilment code: do not add any. Frontend only. One local commit at the end. Never push (push URL is disabled), merge or deploy. Do not read other git branches.
  No new backend endpoints, no invented APIs: use the existing `/students/` query and the existing selection flow.
- `frontend/node_modules` is installed (npm ci). Run each command in the foreground and report its real final line. Never claim a result you did not run. No made up screenshots.
- Failures that exist before your change (do not fix, just report unchanged): run `cd frontend && npx vitest run` FIRST on the untouched branch and record the baseline pass/fail counts in the walkthrough.
- CLAUDE.md design bans apply: no Lucide (components/ui/icons.tsx), no box-shadow, radius only --radius-sm/md/lg (3/4/6px), no blur/glass, no gradients, no emojis, no em dashes in UI text, nothing moves,
  scales or lifts on HOVER (colour only), no animated arrows, Anek Latin, skeleton loaders while loading, 44px touch targets, no purple. Parents are on phones (390px).

PROBLEM
After a new parent signs in they land on the My account page ("Namaste") with an empty orders card and "no children". Nothing tells them what to do next. The best first step is: choose the child's school.

REQUIRED BEHAVIOUR
1. New parent = signed in PARENT, `/students/` loaded with zero active children, AND no valid stored selection (`storeState` selection null). Read the existing code for how selection and children are exposed.
2. For a new parent show a prominent card at the TOP of the account content (above orders): title "Choose your child's school" (new i18n key), one short line, and one primary button that goes to the existing flow
   at its first step (`/flow?step=1`, confirm the right target in SelectionFlowPage). Skeleton while the students request loads (never show this card or the empty states during loading). On request failure show the
   existing error pattern with Retry, not this card. Parents with children or with a stored selection do not see the card.
3. One time redirect: right after a FRESH sign in from the login page, a new parent is sent straight to the flow step 1 with `replace`, so Back does not bounce. Guard it so it happens once per sign in
   (for example a sessionStorage flag, wrapped in try/catch because storage can be blocked), and never for parents with children or a stored selection, never on a page refresh of /account, and never when the user
   came from checkout or any ParentSignInSheet. The user must never be trapped: the flow keeps its own Back, and My account stays reachable from the header.
4. Do not touch the OTP or user id and password sign in logic. Do not show the Welcome modal here.
5. Remove nothing existing: the "My children" card, Add child button and the saved-sizes card stay. If the empty "My children" text and the new card say the same thing, shorten the empty text so there is no duplicate.
6. i18n: every new string in en, hi and gu in frontend/src/i18n/messages.ts (append only).
7. Motion: reuse the existing `Reveal` for the card (no new animation system). Respect prefers-reduced-motion. Pressed state on :active, colour change only on hover.
8. Accessibility: the card is a real `<section aria-labelledby>`, the button is a real link or button, visible focus ring.
9. No inline `style={{` in code you add.

TESTS (write first, show failing, then passing), in AccountPage.test.tsx or a new test file:
new parent sees the card with the right link; loading shows skeleton and no card; failure shows Retry and no card; parent with a child does not see it; parent with a stored selection does not;
one time redirect happens after a fresh login and not on refresh and not twice; blocked sessionStorage does not crash; en, hi and gu render; no "Aarav" or other demo names.
Then `cd frontend && npx vitest run && npx tsc --noEmit && npm run build`; report counts against the baseline you recorded.

SCREENSHOTS only if really captured (Playwright, 390x844 and desktop, mocked or seeded API stated clearly): new parent card, loading skeleton, error with Retry, parent with a child (no card).
EVIDENCE: docs/walkthroughs/day3-k-account-new-parent-school.md with branch, git diff --stat, the redirect target, baseline vs final test counts, screenshots list, and "Not done / not verified".
