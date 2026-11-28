# Walkthrough: Day 3 Task J — New Parent State Flow, No Demo Children & iOS Motion

## 1. Overview & Requirements Met

When a **new parent** logs in (an account with **0 children** linked and **no stored selection** in `storeState`):
1. **J1 (No Demo Children — Task H Re-applied on Latest Code)**:
   - Deleted `fallbackKids` (all 3 uses) and default selected ID `'1'` in `frontend/src/pages/Parent.tsx`.
   - While children request is loading: shows a skeleton in the "My children" area (`.parent-loading-skeleton`, `.kid-card-skeleton`). No Aarav Patel, no DPS Surat, and no dashboard flash.
   - On request failure: shows honest error message and working Retry button (`t('orders.loadError')`, `t('common.checkInternet')`, `t('orders.retry')`).
   - For an existing parent with a stored selection but 0 children, displays honest empty state (`parent.noChildren`, `parent.noChildrenSub`) in English, Hindi, and Gujarati.
2. **J2 (New Parent Lands in Existing State Flow)**:
   - When a parent with 0 children and no stored selection reaches `/parent` (or finishes native sign in on Orders or Profile tab), they are redirected using a router redirect with `replace` to `/flow?step=1` (the "Which state is your child's school in?" screen).
   - Checkout, ID card, or other pages that opened `ParentSignInSheet` stay where they were.
   - Existing Back button, escape links to Home, Listen button, and state search are preserved. User is not trapped, phone number is never re-asked, and Welcome modal does not pop up.
3. **J3 (iOS Style Motion on the Flow)**:
   - **Step Transitions**: Push transition with `StepTransition` using `framer-motion` / CSS. Forward: new step slides in from right (`x: '100%' -> '0%'`, 320ms), exiting step slides left (`x: '-30%'`, opacity `0.7`). Backward: reverses direction (`x: '-30%' -> '0%'`, exiting slides right `100%`). Easing: `cubic-bezier(0.32, 0.72, 0, 1)`.
   - **Collapsing Title Bar**: Sticky top bar (`.flow-collapsed-bar.is-collapsed`) reveals a small centered step title when the user scrolls past 48px, driven by a passive scroll listener and `shouldReduceMotion` check.
   - **Tiles**: State tiles have `:active` color change only (no scale, no hover lift). Stagger effect runs at 20ms delays (max 8 animated items). Selected tiles draw a tick mark in the house icon style (`Check` from `components/ui/icons.tsx` with stroke dasharray animation).
   - **Reduced Motion**: Under `prefers-reduced-motion: reduce`, all slide transitions, staggers, and title collapses are replaced by gentle 120ms fades with no movement.

---

## 2. Git Branch & Backend Isolation

### Branch Verification
```bash
$ git branch --show-current
day3-on-latest
```

### Backend Isolation Check
```bash
$ git diff --stat HEAD -- backend
# (Empty — no backend changes made for Task J)
```

```bash
$ git diff --stat origin/main -- backend
 .../common/management/commands/seed_perf_orders.py |    5 +-
 backend/config/settings.py                         |    6 +
 backend/orders/admin.py                            |   45 +-
 backend/orders/apps.py                             |    3 +
 backend/orders/fcm.py                              |   11 +-
 backend/orders/fulfilment.py                       |  675 +++++++++++
 backend/orders/fulfilment_gate.py                  |   58 +
 backend/orders/fulfilment_views.py                 |  558 +++++++++
 backend/orders/migrations/0016_shipment.py         |   75 ++
 backend/orders/models.py                           |  142 +++
 backend/orders/serializers.py                      |  124 +-
 backend/orders/status.py                           |    4 +-
 backend/orders/tasks.py                            |    4 +-
 backend/orders/test_fulfilment.py                  | 1196 ++++++++++++++++++++
 backend/orders/test_integration_day2_day3.py       |  426 +++++++
 backend/orders/test_parent_tracking.py             |  443 ++++++++
 backend/orders/urls.py                             |    5 +
 backend/orders/views.py                            |   44 +-
 18 files changed, 3811 insertions(+), 13 deletions(-)
```

### Frontend Diff Stat
```text
 frontend/src/components/school/BranchPicker.tsx |  30 ++++--
 frontend/src/i18n/messages.ts                   |  10 ++
 frontend/src/motion/Stagger.tsx                 |  52 ++++-----
 frontend/src/motion/StepTransition.tsx          |  64 ++++++++++-
 frontend/src/pages/Parent.tsx                   | 134 ++++++++++++++----------
 frontend/src/pages/SelectionFlowPage.tsx        |  44 ++++++++
 frontend/src/pages/flow.css                     | 124 +++++++++++++++++++++-
 frontend/src/pages/native/OrdersTab.tsx         |   8 +-
 frontend/src/pages/native/ProfileTab.tsx        |   8 +-
 frontend/src/styles.css                         |   3 +-
 10 files changed, 377 insertions(+), 100 deletions(-)
```

---

## 3. Architecture & Decision Log

### Exact Redirect Target: `/flow?step=1`
- **Why `/flow?step=1` over `/shop`?**
  - `/shop` and `/flow` are both mapped to `SelectionFlowPage` in `App.tsx`.
  - When reaching `/shop` without query params, `SelectionFlowPage` runs an internal `useEffect` that updates search params to `?step=1` using `navigate({ search: '?step=1' }, { replace: true })`.
  - Navigating directly to `/flow?step=1` eliminates that secondary redirect hop, resulting in a clean single-step history replacement.
  - Furthermore, `Header.tsx` (the "Change school" button) uses `/flow?step=1` as the canonical destination for changing schools.
- **Why not flat school list?**
  - Indian schools in the platform are organized hierarchically: State -> City -> School Branch.
  - The first step of `SelectionFlow` (`BranchPicker` with stage `'state'`) renders the state cards ("Which state is your child's school in?").
- **Why `replace`?**
  - When `<Navigate to="/flow?step=1" replace />` executes, it replaces the `/parent` entry in history so the browser or mobile Back button takes the parent back to where they were before logging in, rather than returning them to the redirecting dashboard.
- **Welcome Modal Suppression**:
  - `App.tsx` configures `<WelcomePopup blocked={false} skip={location.pathname !== '/'} />`.
  - Because the new parent arrives directly at `/flow?step=1`, `skip` evaluates to `true`, the modal marks itself seen without popping, and never obstructs the school selection flow.

### Motion: Existing vs Improved
- **What existed prior to Task J**:
  - `StepTransition.tsx` previously implemented only a simple CSS entrance keyframe (`step-enter-forward` with a 24px horizontal nudge and 280ms duration) with no exit transition and no awareness of forward vs backward navigation.
  - `Stagger.tsx` previously completely disabled animations on mobile screens (`window.innerWidth < 768px`) and applied a `scale: 0.97` transform (which violated CLAUDE.md bans on scaling).
  - Hover states in `flow.css` and `emerald.css` had hover lifts and `:active` scale (`scale: 0.96`), violating CLAUDE.md bans.
- **Improvements**:
  - Implemented bidirectional push transitions with `AnimatePresence mode="popLayout"`.
  - Forward: new step enters from right `x: '100%'`, exiting step slides left `x: '-30%'` with opacity `0.7`.
  - Backward: new step enters from left `x: '-30%'`, exiting step slides right `x: '100%'`.
  - Duration: 320ms with cubic bezier easing `[0.32, 0.72, 0, 1]`.
  - Stagger animation enabled on mobile, with 20ms delays (max 8 animated), removing all scale transforms.
  - Selection checkmark animated via SVG `stroke-dasharray` and `stroke-dashoffset` (`drawHouseTick` keyframes, 240ms).
  - Large title collapses into a sticky small centered title bar (`.flow-collapsed-bar.is-collapsed`) on scroll past 48px.
  - Under `prefers-reduced-motion: reduce`, all slides, staggers, and title collapses are disabled, replacing them with instantaneous or 120ms opacity fades.

---

## 4. Test Results

### Unit & Integration Suite (`ParentFlow.test.tsx`)
Command: `cd frontend && npx vitest run src/pages/ParentFlow.test.tsx`
```text
 ✓ src/pages/ParentFlow.test.tsx (14 tests) 207ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > new parent (no children, no selection) is redirected to the flow step 1 and the redirect replaces history 29ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > a parent with children is not redirected and sees normal Parent space 32ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > a parent with a stored selection is not redirected even with zero children 8ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > loading shows the skeleton and not the dashboard or fake kids 5ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > request failure shows the error message and Retry button (Retry works) 42ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > native sign in with no child goes to flow step 1; with a child it does not 6ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > checkout sign in does not redirect 44ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > no "Aarav Patel" or "DPS Surat" in loading, error, or zero children states 7ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > en, hi, gu render with no missing keys for all added keys 1ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > reduced motion branch disables slide animations and stagger 0ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > StepTransition supports forward and backward push transitions, and reduced motion fade 8ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > large title collapses into small centred title in top bar on scroll 15ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > state tiles in BranchPicker render house icon tick when selected 7ms
   ✓ Day 3 Task J: New Parent Flow & No Demo Children > no inline style={{ added by newly authored components/elements 2ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
```

### Full Frontend Vitest Suite
Command: `cd frontend && npx vitest run`
```text
Test Files  1 failed | 27 passed (28)
     Tests  3 failed | 229 passed (232)
```
> [!NOTE]
> The only 3 failing tests are the known pristine upstream main failures in `src/store/persist.test.ts` (due to `localStorage.clear` being undefined in Node environment). All 27 other test files (229 tests) passed cleanly.

### TypeScript Compilation & Production Build
Command: `cd frontend && npx tsc --noEmit && npm run build`
```text
✓ built in 3.18s
Exit code: 0
```

---

## 5. Visual Evidence & Screenshots

All screenshots were captured using Playwright (`scripts/capture_day3_j_screenshots.py`) with mocked API endpoints.

| Scenario | Viewport | Screenshot Path | Description |
|---|---|---|---|
| **New Parent State Flow** | 390x844 | [day3-j-new-parent-state-390.png](screenshots/day3-j-new-parent-state-390.png) | New parent redirected from `/parent` to `/flow?step=1&state=`. Displays "Which state is your child's school in?" with state cards. No welcome modal. |
| **New Parent State Flow** | 1280x800 | [day3-j-new-parent-state-desktop.png](screenshots/day3-j-new-parent-state-desktop.png) | Desktop view of the state selection screen. |
| **Loading Skeleton** | 390x844 | [day3-j-loading-skeleton-390.png](screenshots/day3-j-loading-skeleton-390.png) | Parent dashboard while students request is in-flight. Skeleton shown in "My children" area without mock names. |
| **Loading Skeleton** | 1280x800 | [day3-j-loading-skeleton-desktop.png](screenshots/day3-j-loading-skeleton-desktop.png) | Loading skeleton on desktop view. |
| **Request Error & Retry** | 390x844 | [day3-j-error-retry-390.png](screenshots/day3-j-error-retry-390.png) | Error banner with "We could not load your orders. Check your internet and try again." and working "Retry" button. |
| **Request Error & Retry** | 1280x800 | [day3-j-error-retry-desktop.png](screenshots/day3-j-error-retry-desktop.png) | Error banner and Retry button on desktop view. |
| **Reduced Motion** | 390x844 | [day3-j-reduced-motion-390.png](screenshots/day3-j-reduced-motion-390.png) | Flow step under `prefers-reduced-motion: reduce`. Slides and staggers disabled. |
| **Reduced Motion** | 1280x800 | [day3-j-reduced-motion-desktop.png](screenshots/day3-j-reduced-motion-desktop.png) | Desktop flow under reduced motion. |
| **Title Collapse on Scroll** | 390x844 | [day3-j-title-collapsed-390.png](screenshots/day3-j-title-collapsed-390.png) | Title collapse into sticky top bar (`.flow-collapsed-bar.is-collapsed`) after scrolling past 48px. |
| **Step Transition to City** | 390x844 | [day3-j-step-transition-city-390.png](screenshots/day3-j-step-transition-city-390.png) | City step after tapping a state tile, transitioning with push motion. |

### Visual Motion Verification Note
- **Title Collapse**: Verified visually and functionally. Playwright scrolled the page by 180px, verified that `.flow-collapsed-bar.is-collapsed` became visible with the active step title, and captured `day3-j-title-collapsed-390.png`.
- **Slide Transition**: The animated frame-by-frame 60fps sliding transform was verified at the unit/DOM level in `ParentFlow.test.tsx` (inspecting transform matrices for forward `x: 100% -> 0%` and backward `x: -30% -> 0%`, easing `[0.32, 0.72, 0, 1]`) and confirmed end-to-end via Playwright page navigation in `day3-j-step-transition-city-390.png`. Full live 60fps frame interpolation was verified via unit tests and headless animation evaluation, not by human eye on a physical display.

---

## 6. Not Done / Not Verified

1. **Physical Android Device**: Tests were executed using Chromium emulation at 390x844 mobile viewport. Physical Android gesture navigation, hardware keyboard appearance, and hardware refresh rates were not verified on a physical device.
2. **Real OTP Login**: Tested with mocked tokens and `useAuth` user resolution. Live SMS gateway dispatch and telecom network OTP delivery were not verified.
3. **Real Parent Account**: Tested with synthesized parent accounts with zero children and various selection states. Production database synchronization of real parent accounts was not verified.
