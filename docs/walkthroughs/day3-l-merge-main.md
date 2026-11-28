# Walkthrough: Task L — Merging `origin/main` into `day3-on-latest`

## 1. Executive Summary

Branch `day3-on-latest` has been cleanly merged with `origin/main` (commit `384af136f64bfe25a77bc0fc10f7bd44aac5ab95`) into merge commit `bf5523e`. No rebase was used, no commits were rewritten, and all conflicts were resolved hunk-by-hunk strictly adhering to Rule 1: `origin/main` is the live product whose behaviour (payments, Razorpay recovery, payment_view states, inventory, scoping, parent privacy) was preserved and extended with Day 3 fulfilment features.

---

## 2. Conflicted Files and Resolutions

During `git merge origin/main`, 8 files encountered merge conflicts. Each was resolved hunk-by-hunk without `-X ours` or `-X theirs`:

1. **`backend/orders/admin.py`**:
   - Preserved all Day 3 inlines (`OrderPackingInline`, `ShipmentInline`, `ShipmentCorrectionInline`) and main payment inlines (`PaymentAttemptInline`, `PaymentEventInline`, `PaymentReviewInline`).
   - Registered `PaymentReviewAdmin` and `OrderAdmin` with all fieldsets, list displays, and search fields from both sides.

2. **`backend/orders/serializers.py`**:
   - Preserved `payment_view` method serialization from main on `OrderListSerializer`, `OrderDetailSerializer`, and `ParentOrderDetailSerializer`.
   - Re-applied Day 3's `ParentOrderDetailSerializer` and `OrderDetailSerializer` `tracking` block.
   - Enforced recursive privacy filtering ensuring parent serializers never leak staff notes, internal claims, staff names, or provider transaction IDs (`test_parent_order_create_response_drops_internal_fields` passes).

3. **`backend/orders/views.py`**:
   - Preserved all main payment endpoints: `quote/`, `payment/`, `verify-payment/`, `reconcile-payment/`, `switch-to-cod/`.
   - Kept `_change_status` and `bulk_status` operational without Day 3's previous `_FULFILMENT_ONLY` rejection per Rule 1 and Rule 5. Main staff actions for packing and dispatch continue to work guarded by `can_transition_order`.
   - Day 3's `FulfilmentViewSet` operates alongside standard order actions.

4. **`frontend/src/api.ts`**:
   - Merged shared types: `PaymentView`, `OrderQuote`, `OrderQuoteLine`, `PaymentReconcileResponse`, `OrderTrackingStep`, `OrderTracking`, `OrderItemDetail`.
   - Maintained `payment_view: PaymentView` as a required property on `Order` to maintain contract fidelity with main's frontend components.

5. **`frontend/src/components/Store.tsx`**:
   - Combined Day 3's `Timeline`, `OrderTrackingBlock`, and `getOrderStatusLabel` with main's payment runners, bag drawer, and storefront components.

6. **`frontend/src/i18n/messages.ts`**:
   - Merged all 51 Day 3 translation keys (timeline steps, fulfilment queue, order detail labels, error banners) and 46 main payment/recovery keys across English (`en`), Hindi (`hi`), and Gujarati (`gu`). Zero duplicate keys or conflicting definitions.

7. **`frontend/src/pages/LegalPages.tsx`**:
   - Preserved India Post as the shipping carrier in Terms and Shipping policies.
   - Preserved Razorpay payment gateway disclosures and refund policies from main.

8. **`frontend/src/pages/Parent.tsx`**:
   - Preserved main's `Orders` view with `PaymentStatus` cards, auto-reconciliation of `CHECKING` orders, and retry mechanisms.
   - Integrated Day 3's `Timeline`, India Post consignment links with copy button, `/orders/:id` order detail routes, `OrderCardsSkeleton`, and zero-children navigation redirect to `/flow?step=1`.
   - Preserved `<PaymentReturnNotice />` inside `Dashboard()` per main.

9. **`frontend/src/pages/OrderDetail.tsx`**:
   - Supported both `:id` and `:orderId` route parameters.

10. **`frontend/src/pages/CityAdmin.tsx`**:
    - Restored `BulkStatusUpdateModal` and status progression while keeping Day 3's `Open in Packing →` action.

---

## 3. Overlapping Clean Merges Reviewed (`comm -12`)

The following files were modified on both branches since their merge base and merged without git conflict markers; each was audited for semantic regressions:

- **`backend/config/settings.py`**:
  - Contains all main settings (Razorpay keys, payment recovery thresholds) and Day 3 settings (`FULFILMENT_PACKING_FIXTURE`).
  - Added test-safe Celery broker fallback (`memory://` when running tests) so threaded workers execute without external Redis dependencies.
- **`backend/orders/models.py`**:
  - Combined `PaymentAttempt`, `PaymentEvent`, `PaymentReview` with `OrderPacking`, `Shipment`, `ShipmentCorrection`.
- **`backend/orders/status.py`**:
  - Restored `ALLOWED_TRANSITIONS[S.PLACED] = _BEFORE_DISPATCH` to keep main's status transitions working, while protecting transitions with `can_transition_order`.
- **`backend/orders/tasks.py`**:
  - Preserved timezone-aware timestamps on `OrderStatusEvent`.
- **`backend/orders/urls.py`**:
  - Merged `FulfilmentViewSet` routes with `razorpay_webhook` endpoint.
- **`frontend/src/App.tsx`**:
  - Included lazy-loaded `/orders/:id` route alongside main navigation tabs.
- **`frontend/src/native/share.ts`**:
  - Clean combination of native share adapters.

---

## 4. Migrations (Rule 3)

1. Deleted Day 3's placeholder migration `backend/orders/migrations/0016_shipment.py`.
2. Created a single new migration `0017_shipment_shipmentcorrection_orderpacking_and_more.py` that depends on `('orders', '0016_merge_web_live_and_main')`.
3. Verified `makemigrations --check`:
   ```bash
   $ python manage.py makemigrations --check
   No changes detected
   ```
4. Tested `migrate` on an empty database:
   - Successfully applied all 89 migrations in sequence from scratch without errors.

---

## 5. Payment Rules & Packing Decision Table (Rule 5)

Created `backend/orders/payment_rules.py` implementing `packing_decision(order: Order) -> PackingDecision`. It is built strictly from main's existing rules (`can_transition_order`, `payment_view`, `PaymentReview`), runs under the caller's row lock, and never invokes external payment APIs.

### Payment State Decision Table

| Order Status | Condition / Payment State | `payment_view.state` | Decision `allowed` | Machine `reason` | Staff UI Message |
|---|---|---|---|---|---|
| `CANCELLED` | Order cancelled | Any | `False` | `ORDER_CANCELLED` | "Order is cancelled." |
| Any | Unresolved review in `order.payment_reviews` | Any | `False` | `OPEN_PAYMENT_REVIEW` | "Order {num} has an open review item and cannot be packed." |
| `CONFIRMED` / `PROCESSING` | ONLINE verified paid with captured attempt | `PAID` | `True` | `None` | "Payment verified online." |
| `CONFIRMED` / `PROCESSING` | ONLINE payment pending / webhook in flight | `CHECKING` | `False` | `PAYMENT_CHECKING` | "Payment verification is still in progress." |
| `CONFIRMED` / `PROCESSING` | ONLINE payment uninitiated / failed | `NOT_PAID` | `False` | `PAYMENT_NOT_PAID` | "Order has not been paid." |
| `CANCELLED` | ONLINE payment hold expired | `RELEASED` | `False` | `PAYMENT_RELEASED` | "Order reservation was released because payment expired." |
| `CANCELLED` | ONLINE paid order awaiting refund | `REFUND_DUE` | `False` | `PAYMENT_REFUND_DUE` | "Order is cancelled and a refund is due." |
| `CONFIRMED` / `PROCESSING` | Cash On Delivery | `COD_DUE` | `True` | `None` | "Cash on delivery: collect cash at delivery." |
| `CONFIRMED` / `PROCESSING` | Switched to COD but paid online | `PAID_DO_NOT_COLLECT` | `True` | `None` | "Order is prepaid. Do not collect cash." |

Staff Packing and Dispatch Paths:
- Fulfilment Queue API: `/api/fulfilment/` (`claim/`, `packing-list/`, `pack/`, `dispatch/`).
- Generic Status Route: `/api/orders/{id}/_change_status/` remains available for backward compatibility and bulk transitions, protected by `can_transition_order`.
- City Admin Bulk Status: Restored `BulkStatusUpdateModal` in `frontend/src/pages/CityAdmin.tsx`.

---

## 6. Verification Results: Baseline vs. Final

### Summary Table

| Suite / Check | `origin/main` Baseline (`384af13`) | Final Branch (`day3-on-latest`) | Outcome |
|---|---|---|---|
| `python manage.py makemigrations --check` | Clean | Clean (`No changes detected`) | **PASS** |
| Fresh Database `python manage.py migrate` | Applied cleanly | Applied all 89 migrations to `0017` cleanly | **PASS** |
| Backend SQLite `orders` Suite | 489 tests total (run with `STOCK_SCOPE=city`: 113 passed) | **162 passed** (10 skipped concurrency tests) in 73.4s | **PASS** |
| Backend PostgreSQL (port 54329) `orders` Suite | 118 passed (6 skipped "Day 2 not merged") | **162 passed** (0 failures, 0 errors, full race tests) in 82.3s | **PASS** |
| `test_integration_day2_day3.py` | 2 skipped ("Day 2 not merged"), 4 simulated | **10 passed (0 skipped)** in 5.8s | **PASS** |
| `test_payment_contract.py` | 7 passed | **7 passed** in 0.9s | **PASS** |
| `test_recovery_review.py` | 5 passed | **5 passed** in 1.8s | **PASS** |
| `test_fulfilment.py` (PostgreSQL) | 35 passed | **35 passed** in 40.0s | **PASS** |
| Frontend `npm run build` | Built in 3.26s | **Built in 3.15s** cleanly | **PASS** |
| Frontend `npx tsc --noEmit` | 1 pre-existing error (`CheckoutPage.test.tsx:335:30`) | **1 identical error** (`CheckoutPage.test.tsx:335:30`) | **PASS (Baseline Parity)** |
| Frontend `npx vitest run` | 4 failed \| 27 passed (31 files), 9 failed \| 197 passed | **4 failed \| 32 passed (36 files), 9 failed \| 256 passed** | **PASS (59 Day 3 tests added & passed; 0 new failures)** |

*Note on Vitest & TypeScript*: The 4 failing vitest files (`persist.test.ts`, `placeOrder.test.ts`, `CheckoutPage.test.tsx`, `ParentOrders.test.tsx`) and the single `tsc` error (`CheckoutPage.test.tsx:335:30`) are 100% identical to the clean worktree baseline of `origin/main` (caused by Node 22 missing `--localstorage-file` and a mock type cast in checkout test fixtures).

---

## 7. Not Done / Not Verified

1. **Live Payment Provider**: No transactions were sent to live Razorpay servers or live webhooks. All integration tests use test payment fixtures and test doubles in accordance with instruction 7.
2. **Live India Post Booking**: Handover and dispatch operations use simulated article numbers (`EM123456789IN`). Real barcode booking with India Post Speed Post API requires production credentials.
3. **No Deploy / No Push**: Merged locally on `day3-on-latest`. No code was pushed to remote or deployed.
