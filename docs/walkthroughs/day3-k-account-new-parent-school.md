# Task K Walkthrough: New Parent on My Account ("Namaste") Page - Choose School First

## 1. Environment & Branch
- **Branch**: `new-parent-school-card` (verified with `git branch --show-current`)
- **Cut from**: `origin/feat/parent-signin-choice` (`c568d2a15fe97b98abeba15c71d4a94d441539bd`)
- **Scope**: Frontend only. No backend modifications, no new API endpoints, no fulfillment code. No merge/push.

---

## 2. Git Diff Stat
```text
 frontend/src/i18n/messages.ts           |  21 +++-
 frontend/src/pages/AccountPage.test.tsx | 173 +++++++++++++++++++++++++++++++-
 frontend/src/pages/AccountPage.tsx      |  86 +++++++++++++++-
 frontend/src/pages/Login.tsx            |   8 ++
 frontend/src/pages/accountPage.css      |  24 +++++
 5 files changed, 307 insertions(+), 5 deletions(-)
```

---

## 3. Redirect Target & Behavior
- **One-time Redirect Target**: `/flow?step=1`
- **Method**: `navigate('/flow?step=1', { replace: true })`
- **Guards**:
  - `fresh_login` flag set in `sessionStorage` strictly upon completing authentication from `/login` (`Login.tsx`).
  - Access to `sessionStorage` guarded with `try / catch` so blocked storage in private/sandbox mode never throws or crashes.
  - Consumed and removed immediately on `/account` mount, guaranteeing it never triggers on page refresh, navigation back, or subsequent visits.
  - Strictly requires `isSignedIn && user?.role === 'PARENT'`, `/students/` loaded with zero active children (`activeChildren.length === 0`), and no stored selection (`!selection?.schoolId`).
  - Never redirects parents with children, parents with an active selection, or users coming from checkout or in-page `ParentSignInSheet`.

---

## 4. Test Results (Baseline vs Final)

### Vitest Test Suite (`cd frontend && npx vitest run`)
- **Baseline (untouched branch)**:
  - Test Files: 4 failed | 19 passed (23)
  - Tests: 9 failed | 149 passed (158)
  - Pre-existing failures: `src/services/placeOrder.test.ts` (4 failed), `src/store/persist.test.ts` (3 failed), `src/pages/ParentOrders.test.tsx` (2 failed)
- **Final**:
  - Test Files: 4 failed | 19 passed (23)
  - Tests: 9 failed | 158 passed (167)
  - **Change**: Exactly **+9 passed tests** (all 9 new test cases for Task K passing in `src/pages/AccountPage.test.tsx`). Pre-existing failures remained unchanged.

### Typecheck & Production Build
- `npx tsc -p tsconfig.build.json && vite build` (`npm run build`):
  - **Passed cleanly with 0 errors** (all assets and chunks generated in `frontend/dist/`).
- `npx tsc --noEmit`:
  - 1 pre-existing type mismatch in `src/pages/CheckoutPage.test.tsx:335` (unmodified from `origin/feat/parent-signin-choice`, kept untouched per instruction).

---

## 5. Captured Screenshots
Captured via Playwright using seeded/mocked API states across both mobile (`390x844`) and desktop (`1280x800`) viewports:

1. **New Parent Card**:
   - Mobile: `docs/walkthroughs/screenshots/01-new-parent-card-mobile.png`
   - Desktop: `docs/walkthroughs/screenshots/01-new-parent-card-desktop.png`
   - Description: Prominent `<section aria-labelledby="acct-school-heading">` card rendered at the top of account content with title *"Choose your child's school"*, subtitle *"Find uniforms, shoes, and books made for their school."*, and saffron button *"Choose school"* linking to `/flow?step=1`.

2. **Loading Skeleton**:
   - Mobile: `docs/walkthroughs/screenshots/02-loading-skeleton-mobile.png`
   - Desktop: `docs/walkthroughs/screenshots/02-loading-skeleton-desktop.png`
   - Description: Dedicated `.acct-school-skeleton` with `aria-busy="true"` rendered while `/students/` query is pending; no card or empty state rendered.

3. **Error with Retry**:
   - Mobile: `docs/walkthroughs/screenshots/03-error-retry-mobile.png`
   - Desktop: `docs/walkthroughs/screenshots/03-error-retry-desktop.png`
   - Description: Error box with `AlertCircle`, *"Check your internet and try again."*, and *"Try again"* retry button calling `refetch()` when the request fails; no card rendered.

4. **Parent with a Child (No Card)**:
   - Mobile: `docs/walkthroughs/screenshots/04-parent-with-child-mobile.png`
   - Desktop: `docs/walkthroughs/screenshots/04-parent-with-child-desktop.png`
   - Description: Parent with an active child displays the child's info under *"My children"* and does not display the *"Choose your child's school"* card.

---

## 6. Design System & Accessibility Compliance
- **No Lucide**: Used existing custom SVG icons (`ArrowRight`, `AlertCircle`) from `components/ui/icons`.
- **No Box Shadow**: Styled with 1px `var(--line)` and clean borders.
- **Corner Radii**: Restricted strictly to `--radius-sm` (3px), `--radius-md` (4px), and `--radius-lg` (6px).
- **Motion**: Reused existing `Reveal` component; full support for `prefers-reduced-motion`. Hover only alters background color (`#ffc582`); pressed state active color (`#f0a34b`). No hover lift, translate, or scaling.
- **Accessibility**: Semantic `<section aria-labelledby="acct-school-heading">`, accessible button/link with min-height >= 46px (exceeding 44px touch target) and visible focus ring on `:focus-visible`.
- **i18n**: Fully localized in English, Hindi, and Gujarati via appended keys in `frontend/src/i18n/messages.ts`. Shortened `account.noChildren` to eliminate duplicate copy.
- **No Inline Styles**: Zero `style={{` in added code.

---

## 7. Not Done / Not Verified
- No push to remote, merge, or deployment performed (push URL disabled, local commit only per instructions).
- Pre-existing test failures (`placeOrder.test.ts`, `persist.test.ts`, `ParentOrders.test.tsx`) and typecheck issue in `CheckoutPage.test.tsx` were kept untouched.
- No Day 3 backend or fulfillment endpoints were added.
