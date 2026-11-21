# Task 4 Fix Report: Real Order Tracking States & Fulfilment Transparency

## 1. Overview & Context

This task addresses order tracking, fulfilment transparency, and parent order lifecycle management on branch `feat/parent-shopping`. Previously, the order tracking UI in `Timeline` assumed a static 4-step sequence (`['PLACED', 'CONFIRMED', 'PACKED', 'DISPATCHED']`), lacked representation for `PROCESSING` or pickup lifecycle states (`READY_FOR_PICKUP`, `COLLECTED`), treated all delivery as home courier delivery, collapsed completed history on cancelled orders, and suffered from request/query explosion where the order list endpoint did not return tracking history or payment status indicators.

We have:
1. **Expanded Backend Status Choices & Transitions**: Added `READY_FOR_PICKUP` and `COLLECTED` to `Order.Status` and `OrderStatusEvent.Status`, defined valid state transitions in `backend/orders/status.py`, enforced strict packing rules (preventing unpaid online orders from transitioning to packing or pickup), and provided backwards-compatible mapping for legacy statuses (`PENDING`, `SHIPPED`, `REFUNDED`).
2. **Eliminated Query Explosion**: Added `select_related` and `prefetch_related("status_events", "payment_attempts")` to `OrderViewSet.queryset`. Both list and detail serializers now return scoped event history, computed payment flags (`can_pay_now`, `has_in_progress_attempt`, `last_attempt_failed`), and `parent_actions` in a constant 3 database queries without N+1 query loops.
3. **Overhauled Store Timeline**: Redesigned `Timeline` to evaluate historical event milestones dynamically. It distinguishes between Home Delivery (`Placed` -> `Confirmed` -> `Packed/Processing` -> `Dispatched` -> `Delivered`) and School Pickup (`Placed` -> `Confirmed` -> `Packed/Processing` -> `Ready at school` -> `Collected`). It displays recorded timestamps, highlights current progress, shows an exceptional state banner for `CANCELLED`, `RETURNED`, or `REFUNDED` orders without erasing earlier milestone timestamps, and explicitly avoids making false courier tracking claims for school pickup.
4. **Enhanced Parent Orders View**: Added separate payment and fulfilment status badges using localized text, a manual "Refresh orders" button with accessible spinning feedback, 30-second polling for active/in-progress orders, actionable pay-now and switch-to-COD buttons, and clear guidance directing parents to the school office for cancellations or modifications.
5. **Updated Legal and Consumer Policies**: Synchronized Terms of Service and Cancellation/Refund policies in `LegalPages.tsx` with actual store operations (manual staff updates, school uniform desk pickup hours, inventory restoration upon cancellation).
6. **Delivered Comprehensive Test Suites**: Authored 5 new backend unit and regression tests in `backend/orders/test_order_tracking.py` (verifying pickup transitions, packing validation, serializer fields, and constant-bounded query performance) and 5 new frontend Vitest tests in `frontend/src/components/StoreTimeline.test.tsx` (verifying delivery vs pickup branching, processing steps, milestone history retention, and absence of courier claims).

---

## 2. Changed Files

### Backend
- `backend/orders/models.py`: Added `READY_FOR_PICKUP` and `COLLECTED` choices to `Order.Status` and `OrderStatusEvent.Status`.
- `backend/orders/status.py`: Added `READY_FOR_PICKUP` and `COLLECTED` to `ALLOWED_TRANSITIONS` and `PACKING_STATUSES`. Ensured staff packing rules block unpaid online orders from progressing to pickup.
- `backend/orders/migrations/0014_alter_order_status_alter_orderstatusevent_status.py`: Migration generated and applied to update database status choices.
- `backend/orders/serializers.py`:
  - Enriched `OrderStatusEventSerializer` with `status_display` and `changed_at` (aliased to `timestamp`).
  - Added `OrderTrackingMixin` providing in-memory evaluation of prefetched payment attempts (`last_attempt_failed`, `has_in_progress_attempt`, `can_pay_now`), explicit `parent_actions` permissions and human-readable reasons, and sanitized `delivery_details` (providing pickup location, timings, instructions, and empty courier tracking fields).
  - Updated `OrderListSerializer` and `OrderDetailSerializer` to include `status_events`, `delivery_details`, `can_pay_now`, `has_in_progress_attempt`, `last_attempt_failed`, `parent_actions`, and `updated_at`.
- `backend/orders/views.py`: Updated `OrderViewSet.queryset` with `.prefetch_related("status_events", "payment_attempts")` to guarantee constant query count for parent order listings.
- `backend/orders/test_order_tracking.py`: New regression test suite covering pickup transitions, packing rule enforcement on unpaid orders, serializer output, constant-bounded queries (3 queries for 3 or 5 orders), and legacy status compatibility.

### Frontend
- `frontend/src/api.ts`: Updated `OrderStatusEvent` and `Order` TypeScript definitions with `parent_actions`, `status_events`, `delivery_details`, `updated_at`, `can_pay_now`, `has_in_progress_attempt`, and `last_attempt_failed`.
- `frontend/src/i18n/messages.ts`: Added translations across English (`en`), Gujarati (`gu`), and Hindi (`hi`) for order statuses, payment statuses, timeline step labels, pickup/courier operational notices, exceptional card notices, parent action explanations, and refresh controls.
- `frontend/src/components/Store.tsx`: Overhauled `Timeline` component to support rank-based progress, separate Home Delivery and School Pickup paths, display historical timestamps, handle `PROCESSING` status gracefully, render non-destructive exceptional cards for `CANCELLED`/`RETURNED`/`REFUNDED`, display school pickup location/timings, and omit courier tracking promises for pickup orders.
- `frontend/src/styles.css`: Added clean CSS styles for `.timeline .current span`, `.timeline .pending span`, and `.timeline .discontinued` with 12px status dots and small borders adhering to design constraints.
- `frontend/src/pages/Parent.tsx`:
  - Added `getFulfilmentStatusLabel()` and `getPaymentStatusLabel()` using localized strings.
  - Implemented manual order refresh with spinning `RefreshCw` icon and screen-reader accessibility.
  - Added 30-second automated refresh interval when active orders (e.g. `PLACED`, `CONFIRMED`, `PROCESSING`, `PACKED`) are present.
  - Added inline action buttons for `Pay now` and `Switch to cash on delivery` with loading and error states.
  - Displayed school contact assistance notes for cancellation and modification requests.
- `frontend/src/pages/LegalPages.tsx`: Updated Terms and Refund policy text to reflect staff-updated tracking timelines, school uniform desk pickup procedures, and order cancellation restrictions once items are packed.
- `frontend/src/pages/Parent.test.tsx`: Updated empty state regex to match simplified delivery timeline text.
- `frontend/src/components/StoreTimeline.test.tsx`: New Vitest test suite verifying home delivery vs pickup steps, timestamp rendering, `PROCESSING` state handling, milestone retention during cancellation, and legacy status mapping.

---

## 3. Checks Run & Recorded Results

| Check / Test Suite | Scope | Verification Type | Result | Notes |
|---|---|---|---|---|
| Django `orders` test suite | Backend | SIMULATED (automated test with SQLite) | PASS (44 tests passed, 5 skipped in 10.2s) | Includes all new tests in `test_order_tracking.py` |
| Django `orders.test_order_tracking` | Backend | SIMULATED (automated test with SQLite) | PASS (5/5 tests passed in 5.0s) | Verifies pickup lifecycle, packing validation, serializer fields, and query efficiency |
| Full Django test suite (`orders panel inventory accounts catalog`) | Backend | SIMULATED (automated test with SQLite) | PASS (307 tests passed, 17 skipped in 193.2s) | Complete backend regression testing across all modules |
| Vitest test suite (`npx vitest run`) | Frontend | SIMULATED (automated test with JSDOM) | PASS (16 test files, 140 tests passed in 6.5s) | All 140 unit and integration tests passing cleanly |
| Frontend production build (`npm run build`) | Frontend | SIMULATED (automated build) | PASS (`tsc -b && vite build` built in 10.0s) | Strict TypeScript check passed, zero type errors, bundles generated |
| Live Courier Webhook / Tracking Integration (e.g. Shiprocket/Delhivery API) | External Service | UNVERIFIED | UNVERIFIED | Courier integration is absent and identified as a separate external dependency |

---

## 4. Acceptance Criteria Verification

### 1. Delivery vs. Pickup Lifecycle Distinction
- **Status**: MET
- **Backend Evidence**: `Order.Status.READY_FOR_PICKUP` and `Order.Status.COLLECTED` choices are available and validated in `backend/orders/status.py`. `test_pickup_lifecycle_transitions` in `test_order_tracking.py` proves valid progression through `CONFIRMED` -> `PROCESSING` -> `PACKED` -> `READY_FOR_PICKUP` -> `COLLECTED`.
- **Frontend Evidence**: In `Store.tsx`, `Timeline` renders separate step sequences: Home Delivery shows `Dispatched` and `Delivered`, while School Pickup shows `Ready at school` and `Collected`. Courier tracking notices are only rendered for Home Delivery; School Pickup displays pickup desk instructions, location, and school office hours. Verified by `renders school pickup steps and does not claim courier tracking` in `StoreTimeline.test.tsx`.

### 2. Processing & Legacy Status Handled Gracefully
- **Status**: MET
- **Evidence**: `PROCESSING` is mapped to step 3 in `Timeline`, marking previous milestones (`Placed` and `Confirmed`) completed while displaying `Processing` as the current active step. Legacy statuses (`PENDING`, `SHIPPED`, `REFUNDED`) serialize cleanly without errors and map to their modern visual counterparts. Verified by `test_legacy_statuses_serialization` and `renders PROCESSING status with preceding steps completed`.

### 3. Non-Destructive Milestone History for Cancelled Orders
- **Status**: MET
- **Evidence**: When an order transitions to `CANCELLED`, `RETURNED`, or `REFUNDED`, `Timeline` evaluates historical `status_events` to determine the highest completed rank. Completed milestones remain checked with their recorded timestamps intact, unreached steps are styled with `.discontinued`, and an exceptional notice banner clearly states the cancellation date and confirms that items were returned to school stock. Verified by `renders CANCELLED status showing exceptional card without wiping past milestone history`.

### 4. Bounded Database Queries (No N+1 Request Explosion)
- **Status**: MET
- **Evidence**: `OrderViewSet` prefetches `status_events` and `payment_attempts`. The serializer calculates `can_pay_now`, `has_in_progress_attempt`, `last_attempt_failed`, and `parent_actions` directly over in-memory prefetched lists. `test_no_n_plus_one_queries_on_order_list` in `test_order_tracking.py` confirms that fetching 3 orders or 5 orders takes exactly 3 SQL queries in total (1 main order query with inner/left joins for student/school/city/users, 1 query for status events, and 1 query for payment attempts).

### 5. Parent Order Actions & Transparency
- **Status**: MET
- **Evidence**: `Parent.tsx` displays separate payment and fulfilment badges, exposes `Pay now` and `Switch to cash on delivery` buttons for eligible unpaid online orders, and explains why self-service online cancellation is unavailable while directing parents to the school office. Manual refresh is available via a dedicated button, and automatic polling refreshes order status every 30 seconds for active orders.

### 6. Design System & Multilingual Standards
- **Status**: MET
- **Evidence**: All typography uses Anek Latin, neutral borders adhere to small border radii (`var(--radius-sm)` / `4px`), no box-shadows or stock icon libraries were added, and zero emojis or em dashes are present in user-facing text. Complete translations are provided in English, Gujarati, and Hindi in `messages.ts`.

---

## 5. External Dependency Note: Courier Integration

The application currently does not connect to external courier tracking APIs (such as Shiprocket, Delhivery, or Blue Dart). Courier tracking integration is identified as an absent external dependency. 

To maintain transparency with parents:
- Home delivery orders in `DISPATCHED` state display an honest operational notice: *"Dispatched via courier. Tracking will update once scanned by the delivery partner."*
- School pickup orders never display courier tracking fields or promises.
- `delivery_details` defaults `courier_name`, `tracking_number`, and `tracking_url` to `null` until live logistics webhooks or admin entries are configured.
