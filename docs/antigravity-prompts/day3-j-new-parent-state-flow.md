Day 3, Task J: what a NEW parent sees after login, on the LATEST code: go into the existing "Which state is your child's school in?" flow, no demo children, iOS style motion

Read first: CLAUDE.md, docs/antigravity-prompts/day3-h-parent-no-demo-children.md (the requirement you will re-apply, see J1), frontend/src/pages/Parent.tsx, frontend/src/pages/Login.tsx,
frontend/src/App.tsx (routes, Guard, homeFor), frontend/src/components/parent/ParentSignInSheet.tsx, frontend/src/pages/SelectionFlowPage.tsx and frontend/src/components/SelectionFlow.tsx
(step 1 = state, 2 = city, 3 = school, 4 = class and gender, 5 = products; i18n keys `flow.s1.*`), frontend/src/store/storeState.ts, frontend/src/pages/native/OrdersTab.tsx and ProfileTab.tsx,
frontend/src/motion/*, frontend/src/pages/flow.css.

ENVIRONMENT (wins over anything else)
- Folder ss_latest_work, branch `day3-on-latest` (run `git branch --show-current`, stop if it is `main`). This branch is the LATEST upstream main (920c739) with the Day 3 commits A to G applied on top.
  One local commit at the end. Never push (the push URL is disabled), merge or deploy. Do not read other git branches. Frontend only: do not touch backend, fulfilment, staff screens or Day 2 code.
  No new backend endpoints and no invented APIs: use the existing flow and APIs only.
- `frontend/node_modules` is installed. Run each command in the foreground and report its real final line. Never claim a result you did not run. No made up screenshots.
- Known failures on pristine upstream main (NOT yours, leave them, do not "fix" them, just report them unchanged): `src/store/persist.test.ts` (3 tests, localStorage undefined) and, in the backend,
  `catalog.test_kv_photos` (not part of this task).
- CLAUDE.md design bans apply and WIN over "iOS look": no Lucide (use components/ui/icons.tsx), no box-shadow, radius only --radius-sm/md/lg (3/4/6px), no backdrop-filter or glass, no gradients/orbs,
  no emojis, no em dashes in UI text, nothing moves, scales or lifts on HOVER (colour only), no animated arrows, Anek Latin, var(--paper) background, skeleton loaders while loading, 44px touch targets, no purple.
  Parents are on phones (390px wide).

J1. NO DEMO CHILDREN (re-apply Task H on the latest code; a plain cherry-pick conflicts in Parent.tsx and skeleton.css, so redo it by hand following docs/antigravity-prompts/day3-h-parent-no-demo-children.md)
Delete `fallbackKids` (still present in Parent.tsx, 3 uses) and the default selected id '1'. Loading: skeleton in the "My children" area. Request failure: short message and Retry (existing i18n keys). Zero children:
the new-parent path in J2, not an empty dashboard. With real children nothing changes. New i18n strings in en, hi and gu (append only). Keep latest's own changes in Parent.tsx and styles; read the latest file first.

J2. NEW PARENT LANDS IN THE EXISTING STATE FLOW (no new "pick school" screen, do not recreate the flat school list)
- A PARENT with zero children AND no valid stored selection (`storeState.getSelection()` null) who reaches /parent (website, from /login) is sent to the existing flow at its first step (the "Which state is
  your child's school in?" screen). Use a router redirect with `replace` so Back does not return to an empty page. Decide the exact target (`/shop` or `/flow?step=1`) by reading SelectionFlowPage.
- While the students request is loading show a skeleton (not the dashboard, not the flow) so there is no flash of the wrong screen.
- A parent with children, or with a stored selection, sees the normal Parent Space as today.
- Native app: after sign in from the Orders or Profile tab (ParentSignInSheet `onDone(child)` with child null and no stored selection) go to the same flow step 1. With a child or a selection nothing changes.
- Checkout, ID card or any page that opened ParentSignInSheet: stay where they were (existing behaviour). Do not break the new OTP / demo code login on latest.
- The flow must keep its own Back and its Skip/escape behaviour, and a visible way to leave to the home page. Do not trap the user. Never ask for the phone number again, never show the Welcome modal here.
- Keep latest's behaviour of the flow (Listen button, search, state tiles, city counts) untouched in content.

J3. iOS STYLE MOTION on that flow (CSS first, transform and opacity only, 60fps; reuse the existing `motion` package, components in frontend/src/motion and the flow's own `stepDirection` logic; no new dependency)
- First read what motion the flow already has and say so; improve rather than duplicate.
- Step to step: push transition (new step slides in from the right about 320ms, old one shifts left about 30% and fades slightly), Back reverses it. Easing cubic-bezier(0.32, 0.72, 0, 1), no overshoot.
- Large title that collapses into a small centred title in a top bar on scroll (iOS large title) using opacity and transform driven by a passive scroll listener or IntersectionObserver.
- State and school tiles: pressed state is a colour change on `:active` only (no scale, nothing on hover). Tiles appear with a short stagger (20ms apart, max 8 animated). Selected state draws a tick in the house icon style.
- `prefers-reduced-motion: reduce`: no slide, no stagger, no collapse, only an instant or 120ms fade. Test it.
- Nothing longer than 450ms, no animation of width/height/top/left.

TESTS (write first, show failing, then passing)
Vitest: new parent (no children, no selection) is redirected to the flow step 1 and the redirect replaces history; a parent with children is not; a parent with a stored selection is not; loading shows the skeleton and
not the dashboard; request failure shows the message and Retry (Retry works); native sign in with no child goes to the flow, with a child it does not; checkout sign in does not redirect; no "Aarav Patel" or
"DPS Surat" in loading, error or empty states; reduced motion branch; en, hi, gu render with no missing keys; no inline `style={{` added by you.
Then run: `cd frontend && npx vitest run && npx tsc --noEmit && npm run build`. Report counts. The only allowed failures are the 3 known `persist.test.ts` tests; any other failure is yours to fix.
`git diff --stat origin/main -- backend` must show only the Day 3 backend files already on the branch (compare with `git diff --stat HEAD -- backend` being empty for this task).

SCREENSHOTS only if really captured with Playwright (390x844 and desktop, mocked or seeded API stated clearly, no Welcome modal in any shot): new parent landing in the state screen, loading skeleton,
error with Retry, reduced motion. Say whether the slide and the title collapse were checked visually or only by tests. Never claim a visual check you did not do.

EVIDENCE: docs/walkthroughs/day3-j-new-parent-state-flow.md: git branch, `git diff --stat`, the exact redirect target and why, what motion already existed, test results, screenshot list, and
"Not done / not verified" (real Android device, real OTP login, real parent account).
