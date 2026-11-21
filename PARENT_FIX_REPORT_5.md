# Task 5 Fix Report: Cancellation, Exchange, and Refund Workflows

## 1. Overview & Context

This task establishes real after-sales and refund workflows for parents on branch `feat/parent-shopping`. Previously:
- Parent order edits and cancellations were completely blocked, forcing all requests to offline school office handling.
- `OrderItemExchange` recorded only staff-entered size adjustments without parent requests or replacement fulfillment tracking.
- Stock restocks and replacement reservations lacked automated atomic protections against double-operations.
- Online refunds lacked an idempotent lifecycle decoupling physical inspection from financial repayment.

We implemented and verified an end-to-end after-sales and refund system:
1. **Server-Owned Eligibility Engine**: Centralized in `backend/orders/after_sales.py` (`get_order_after_sales_eligibility`). Evaluates order and item-level eligibility for full/partial cancellation before dispatch, size exchange within 7 days of delivery/collection, and reporting damaged/defective/incorrect items within 7 days. Enforces customisation production cutoff rules (inspecting print status flags and assets) so personalised items in production cannot be cancelled for change of mind.
2. **Durable Data Models**:
   - `OrderAfterSaleRequest`: Tracks request type (`CANCEL`, `EXCHANGE`, `RETURN`, `REPLACE`), status (`REQUESTED`, `APPROVED`, `INSPECTED`, `COMPLETED`, `REJECTED`, `CANCELLED`), reasons, target sizes/variants, quantity, charges, photo keys, restock conditions (`RESTOCKABLE`, `DAMAGED_DISCARD`, `UNINSPECTED`), staff notes, and audit references.
   - `OrderRefund`: Decouples physical return lifecycles from financial refunds. Enforces idempotency via unique idempotency keys, records repayment channel (`ORIGINAL_PAYMENT`, `CASH`, `NOT_APPLICABLE`), tracks Razorpay refund IDs, payment IDs, and failure reasons.
3. **Atomic Inventory & Stock Safety**:
   - Replacement variant stock is reserved immediately and atomically via `apply_stock_movement` when a parent requests a size exchange. If the request is rejected, reserved stock is released back.
   - Returned physical items are restocked ONLY when inspected condition is confirmed as `RESTOCKABLE`. Damaged items are written off as `DAMAGE` stock movements without inflating sellable stock.
   - Double-restocking, double-reserving, and double-refunding are prevented through transactional row locks (`select_for_update`).
4. **Idempotent Refund Boundary**:
   - Online payments: `RazorpayGateway.create_refund` initiates refunds with 5s timeout and idempotency receipts. In test/mock environments without real provider credentials, safely simulates processed refunds.
   - COD orders: Uncollected cancelled orders require zero cash repayment (`NOT_APPLICABLE`). Delivered COD items returned at the school desk schedule a cash repayment (`CASH`) for staff processing.
   - Financial bounds enforced: Total refunds across an order cannot exceed captured payments. A status change alone never marks funds refunded.
5. **Parent User Interface & Multilingual Support**:
   - `AfterSalesModal`: Responsive dialog for self-service cancellation, size exchange selection with live stock availability, and issue reporting.
   - `Parent.tsx`: Exposes contextual action buttons (`Cancel order`, `Request size exchange`, `Report damage`) on eligible orders. Displays active request progress badges and status banners.
   - Localization: Complete Gujarati (`gu`), Hindi (`hi`), and English (`en`) translations in `frontend/src/i18n/messages.ts`.
   - Accessible, design-system compliant UI: Skeleton loaders during data fetch, small border radii (`var(--radius-sm)`, `var(--radius-md)`), 1px solid `var(--line)` borders, solid `var(--paper)` surfaces, zero emojis, zero em dashes.
6. **Staff Management & Auditability**:
   - DRF actions: `/api/orders/<id>/after-sales-eligibility/`, `/api/orders/<id>/request-after-sale/`, `/api/orders/<id>/after-sales-requests/`, `/api/orders/review-after-sale/`, `/api/orders/process-refund/`.
   - Django Admin: `OrderAfterSaleRequestAdmin` and `OrderRefundAdmin` with inlines on `OrderAdmin` and bulk actions (`approve_requests`, `mark_inspected_and_restock`, `complete_requests`, `reject_requests`, `process_selected_refunds`).
   - Audit logging: All requests, reviews, and refunds log structured entries to `common.models.AuditLog`.

---

## 2. Changed Files

### Backend
- `backend/orders/models.py`: Added `OrderAfterSaleRequest` and `OrderRefund` models with status enums, indexes, and relations to `Order`, `OrderItem`, `ProductVariant`, and `OrderItemExchange`.
- `backend/orders/migrations/0015_orderaftersalerequest_orderrefund_and_more.py`: Migration creating tables and performance indexes.
- `backend/orders/after_sales.py`: Core domain logic for after-sales eligibility calculation, request creation, staff review workflow, stock movements, and idempotent refund processing.
- `backend/orders/payment.py`: Added `create_refund` to `RazorpayGateway` with idempotency receipt handling, timeout configuration, and test-mode simulation.
- `backend/orders/serializers.py`: Added `OrderAfterSaleRequestSerializer` and `OrderRefundSerializer`. Enriched `OrderTrackingMixin` with after-sales permissions and summary badges.
- `backend/orders/views.py`: Registered endpoints for eligibility, parent request submission, after-sales listing, staff review, and refund execution. Updated querysets to prefetch `after_sales_requests` to maintain constant query bounds.
- `backend/orders/admin.py`: Added `OrderAfterSaleRequestAdmin`, `OrderRefundAdmin`, and tabular inlines for `OrderAdmin`.
- `backend/orders/test_after_sales.py`: Regression test suite covering cancellation, size exchange atomic reservation, 7-day expiration, restock conditions (restockable vs damaged discard), cross-parent permission rejection, and query bounds.
- `backend/orders/test_order_tracking.py`: Updated serializer assertions to recognize permitted cancellation on eligible orders and verified constant 4-query efficiency.

### Frontend
- `frontend/src/api.ts`: Added types for `AfterSaleRequest`, `OrderRefund`, `OrderAfterSalesEligibility`, `ItemAfterSalesEligibility`, `ReplacementSizeOption`, and API methods `getAfterSalesEligibility`, `requestAfterSale`, `getAfterSalesRequests`.
- `frontend/src/i18n/messages.ts`: Added translations across English (`en`), Gujarati (`gu`), and Hindi (`hi`) for after-sales action buttons, modal dialogs, status badges, reasons, and confirmation text.
- `frontend/src/pages/LegalPages.tsx`: Synchronized Refund Policy with implemented self-service online portal actions, replacement inventory reservations, 7-day windows, and cash-on-delivery repayment procedures.
- `frontend/src/pages/Parent.tsx`: Integrated `AfterSalesModal`, action buttons for cancellation, size exchange, and defect reporting, and active request status indicators.
- `frontend/src/components/parent/AfterSalesModal.tsx`: New component providing accessible forms for cancellation, exchange size picker with stock indicators, and defect reporting with resolution options.
- `frontend/src/pages/ParentAfterSales.test.tsx`: Vitest suite testing cancellation buttons, exchange modal flows, out-of-stock disabling, active request status badges, and request submission.

---

## 3. Checks Run & Recorded Results

| Check / Test Suite | Scope | Verification Type | Result | Notes |
|---|---|---|---|---|
| Django `orders` test suite (`python backend\manage.py test orders`) | Backend | SIMULATED (automated test with SQLite) | PASS (114 tests passed, 6 skipped in 121.0s) | Includes all unit and regression tests in `test_after_sales.py` and `test_order_tracking.py` |
| Django `schools.tests.ParentWriteRestrictionTests` | Backend | SIMULATED (automated test with SQLite) | PASS (6 tests passed in 9.2s) | Verifies parent write restrictions and order deletion blocking |
| Django backend full suite (`orders panel inventory accounts catalog schools common`) | Backend | SIMULATED (automated test with SQLite) | PASS (402 tests passed, 23 skipped) | Complete backend regression testing across all existing apps |
| Vitest test suite (`npx vitest run`) | Frontend | SIMULATED (automated test with JSDOM) | PASS (17 test files, 144 tests passed in 15.7s) | All frontend unit and component tests passing cleanly |
| Frontend production build (`npm run build`) | Frontend | SIMULATED (automated build) | PASS (`tsc -b && vite build` built in 19.5s) | Strict TypeScript check passed, zero type errors, bundles generated |
| Live Razorpay Refund Gateway (`api.razorpay.com/v1/payments/.../refund`) | External Service | UNVERIFIED | UNVERIFIED | No live Razorpay API keys configured on this branch; simulated via `RazorpayGateway.create_refund` test fallback |

---

## 4. Acceptance Criteria Verification

### 1. Server-Owned Eligibility & Policy Wording
- **Status**: MET
- **Backend Evidence**: `get_order_after_sales_eligibility()` in `backend/orders/after_sales.py` computes permitted actions on the server. Validates order status, delivery timestamp (within 7-day window), sibling variants in the order city, and active requests.
- **Frontend Evidence**: `LegalPages.tsx` explains that parents can exchange unworn items or cancel orders directly through their account before dispatch.

### 2. Customisation Production Cutoff
- **Status**: MET
- **Backend Evidence**: `check_customisation_production_started()` checks whether an item has custom print keys generated (`cover_photo_print`, `student_photo_print`) or `_status` flags marked `PROCESSED`/`IN_PRODUCTION`. If so, self-service cancellation is blocked. Verified by `test_cancellation_eligibility_and_customisation_cutoff` in `test_after_sales.py`.

### 3. Atomic Replacement Stock Reservation & Conditional Restocking
- **Status**: MET
- **Backend Evidence**: In `create_after_sale_request()`, requesting a size exchange atomically calls `apply_stock_movement(quantity_change=-qty)` on the target variant. If rejected, stock is returned. In `review_after_sale_request()`, returned items are restocked only when `restock_condition == RESTOCKABLE`. Items marked `DAMAGED_DISCARD` are recorded as `DAMAGE` movements without adding to sellable inventory. Verified by `test_size_exchange_eligibility_and_atomic_reservation` and `test_staff_inspection_restocks_only_when_restockable`.

### 4. Decoupled Return & Refund Lifecycles
- **Status**: MET
- **Backend Evidence**: `OrderRefund` records financial disbursements separately from physical item inspection. `process_order_refund()` verifies that total refunds cannot exceed the paid order amount. Succeeded refunds record provider refund IDs. Verified by `test_damaged_item_return_and_idempotent_refund` and `test_cod_cancellation_requires_no_online_refund`.

### 5. Role Scoping & Double-Operation Guards
- **Status**: MET
- **Backend Evidence**: Parent requests verify `order.parent_id == user.id or order.placed_by_id == user.id`. Cross-parent submissions fail with `PermissionDenied`. Transactional locks (`select_for_update`) block concurrent double-submissions. Verified by `test_parent_cannot_act_on_another_parents_order`.

### 6. Design System & Multilingual Standards
- **Status**: MET
- **Frontend Evidence**: Followed all `CLAUDE.md` design rules: no stock icons, small radii (`var(--radius-sm)`, `var(--radius-md)`), 1px solid `var(--line)` borders, solid `var(--paper)` surfaces, skeleton loaders during fetch, zero emojis, and zero em dashes. Complete translations provided in English, Gujarati, and Hindi.

---

## 5. Remaining Decisions & Operational Notes

1. **Second/Subsequent Size Exchange Fee**: Current policy states the first size exchange is free. The code records `first_exchange_free: true/false` and `charge_paise: 0`. If the school administration decides to levy a shipping/handling fee for subsequent exchanges, the fee amount should be configured in school billing settings rather than hardcoded.
2. **Damaged Item Photo Uploads**: The request model and API support `photo_key` strings. When photo uploads are enabled via Cloudflare R2 / S3 presigned URLs, parents can attach photos during defect submission.
3. **Live Razorpay Credentials**: Verification used the built-in simulated test-mode provider refund engine. Production execution requires valid live Razorpay credentials (`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`).
