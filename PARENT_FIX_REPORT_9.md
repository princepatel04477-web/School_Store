# Task 9 Completion Report: Make Stock Operations and Notifications Dependable

**Date:** 2026-11-22  
**Branch:** `feat/parent-shopping`  
**Repository:** `C:\Users\rebel\OneDrive\Documents\GitHub\School_Store-parent`  

---

## Executive Summary

Task 9 has been completed in full. We implemented robust, auditable stock operations with reconciliation reporting, and built a resilient, durable notification outbox system decoupled from order transactions:

1. **Atomic Stock Ledger & Discrepancy Reconciliation**:
   - Preserved atomic stock updates and immutable movement ledger (`StockMovement`).
   - Extended `StockMovement` with required `notes` and new reason codes (`EXCHANGE_RESERVATION`, `CORRECTION`, `SCRAP`, `AUDIT_DISCREPANCY`).
   - Built a non-destructive stock reconciliation report backend endpoint (`GET /api/inventory/reconciliation/`) comparing physical/ledger balances against the movement history without silent corrections. Discrepancies are highlighted with severity tags.
   - Improved staff inventory views with variant/size/city filters, low-stock severity badges (`Critical Low` <= 5, `Low Stock` <= 15, `Healthy`), and affected pending orders counters.

2. **Durable Notification Outbox & Decoupled Lifecycle Events**:
   - Designed and built a transactional outbox table (`NotificationRecord`) and user preference model (`NotificationPreference`).
   - Decoupled notification dispatch from order database transactions. Notification records are durably committed in `PENDING` state within the primary transaction. Asynchronous Celery worker tasks execute delivery.
   - Handled broker/worker failures: A periodic Celery beat task (`sweep_pending_notifications`) sweeps and recovers any pending or stuck notifications without rolling back or losing orders.
   - Extended event triggers across the full lifecycle: `ORDER_CONFIRMED`, `DISPATCHED`, `PICKUP_READY`, `DELIVERED`, `EXCHANGE_UPDATE`, and `REFUND_PROCESSED`.
   - Linked after-sales size exchange requests with replacement inventory reservations using `StockMovement.Reason.EXCHANGE_RESERVATION`.

3. **Deduplication, Bounded Retries, and Truth in Delivery**:
   - Enforced idempotency via payload/event hashing and row locking (`select_for_update`). Duplicate deliveries are prevented even under aggressive retries or concurrent task execution.
   - Implemented bounded exponential backoff with jitter and a maximum retry cap (`max_retries = 3`).
   - **Delivery Status Integrity**: Provider acceptance (e.g., MSG91/SMS gateway HTTP 200/202) marks status as `SENT`, never `DELIVERED`. Only confirmed carrier receipts transition records to `DELIVERED`.

4. **Privacy, Security & Diagnostics**:
   - Contact numbers and emails are masked in notification logs (`******3210`, `p***@example.com`).
   - Sensitive child information (names, custom measurements) is omitted from external notification payloads.
   - Operational error messages are sanitized before database persistence or staff display, automatically redacting API keys, bearer tokens, passwords, and authorization secrets.
   - Built scoped staff diagnostics endpoint (`/api/notifications/`) and manual retry trigger (`POST /api/notifications/{id}/retry/`) with strict role-based access control (BOSS has nationwide visibility; City Admin is restricted to their assigned city).

---

## Changed Files Summary

### Backend
- `backend/config/settings.py`:
  - Added periodic Celery beat schedule `sweep-pending-notifications` (runs every 5 minutes to recover broker outages).
- `backend/inventory/models.py`:
  - Added `notes` field to `StockMovement`.
  - Added `EXCHANGE_RESERVATION`, `CORRECTION`, `SCRAP`, and `AUDIT_DISCREPANCY` to `StockMovement.Reason`.
- `backend/inventory/migrations/0002_stockmovement_notes_alter_stockmovement_reason.py`:
  - Database migration applying `StockMovement` schema updates.
- `backend/inventory/services.py`:
  - Extended stock adjustment services to persist mandatory staff notes on movements.
- `backend/inventory/serializers.py`:
  - Added `notes` and `reason_display` fields to `StockMovementSerializer`.
  - Added low-stock severity calculations and affected orders aggregation.
- `backend/inventory/views.py`:
  - Added reconciliation report endpoint `GET /api/inventory/reconciliation/`.
  - Added severity filters (`critical`, `warning`, `healthy`), size filters, and affected order counters to stock list endpoints.
- `backend/inventory/tests.py`:
  - Added automated test cases for inventory reconciliation, low-stock severity categorization, and adjustment notes validation.
- `backend/orders/models.py`:
  - Added `NotificationPreference` model (channel preferences for SMS, WhatsApp, Email, push, and marketing opt-out).
  - Added `NotificationRecord` model (durable outbox with masked recipient, idempotent hash, retry counter, sanitized error log, and status lifecycle).
- `backend/orders/migrations/0017_notificationpreference_notificationrecord.py`:
  - Database migration for notification preferences and durable outbox records.
- `backend/orders/notifications.py`:
  - Outbox enqueue service `enqueue_notification`.
  - Channel adapters: `MockNotificationAdapter`, `ConsoleNotificationAdapter`, and `Msg91FlowAdapter`.
  - PII masking utilities: `mask_phone_number` and `mask_email_address`.
  - Secret sanitizer: `sanitize_operational_error` redacting API keys, passwords, and bearer tokens.
  - Template builders for `ORDER_CONFIRMED`, `DISPATCHED`, `PICKUP_READY`, `DELIVERED`, `EXCHANGE_UPDATE`, and `REFUND_PROCESSED`.
- `backend/orders/tasks.py`:
  - Asynchronous worker task `deliver_notification_task` with row locking, exponential backoff, and retry caps.
  - Recovery sweeper task `sweep_pending_notifications` for broker outage resilience.
  - Routed order confirmation notifications through the durable outbox.
- `backend/orders/status.py`:
  - Hooked order status transitions (`DISPATCHED`, `PICKUP_READY`, `DELIVERED`) into the notification outbox.
- `backend/orders/after_sales.py`:
  - Hooked after-sales exchange requests, staff reviews, and refund processing into the notification outbox.
  - Added exchange stock reservation using `StockMovement.Reason.EXCHANGE_RESERVATION`.
- `backend/orders/serializers.py`:
  - Integrated `ORDER_CONFIRMED` outbox enqueue into order checkout creation.
  - Added `NotificationRecordSerializer` for staff diagnostic inspection.
- `backend/orders/views.py`:
  - Added `NotificationRecordViewSet` with role/city/school scoping and manual retry action `POST /api/notifications/{id}/retry/`.
- `backend/orders/urls.py`:
  - Registered `/api/notifications/` in the orders router.
- `backend/orders/test_notifications.py`:
  - Comprehensive unit and integration test suite covering deduplication, decoupling from order transactions, broker failure recovery, backoff retries, privacy masking, secret sanitization, channel preferences, and staff retry controls.

### Frontend
- `frontend/src/api.ts`:
  - Added API client methods for `inventory.reconciliation(...)`, `notifications.list(...)`, and `notifications.retry(...)`.
  - Added `notes` support to stock adjustment payload.
- `frontend/src/pages/CityAdmin.tsx`:
  - Added severity badges (`Critical Low`, `Low Stock`, `Healthy`).
  - Added filter dropdowns for stock severity, size, and search text.
  - Added affected orders count column with modal order drill-down.
  - Added notes field and clear adjustment reason choices to adjustment modal.
  - Added Reconciliation Report modal/table displaying ledger discrepancies without destructive auto-correction.
- `frontend/src/components/admin/CityAvailabilityView.tsx`:
  - Integrated severity badges, size filters, and reconciliation drawer into city availability dashboard.
- `frontend/src/pages/CityInventory.test.tsx`:
  - Vitest integration tests for stock severity badges, size/severity filters, adjustment with mandatory notes, and reconciliation report table rendering.

---

## Checks Run & Results

1. **Backend Notification Outbox & Lifecycle Test Suite**:
   - `python backend\manage.py test orders.test_notifications`
   - Result: **9 passed** in 3.88s (`OK`).
   - Verification Label: `SIMULATED` (Automated Django test runner with SQLite).

2. **Backend Inventory & Reconciliation Test Suite**:
   - `python backend\manage.py test inventory`
   - Result: **18 passed** in 23.5s (`OK`).
   - Verification Label: `SIMULATED` (Automated Django test runner with SQLite).

3. **Frontend Inventory Vitest Suite**:
   - `npx vitest run src/pages/CityInventory.test.tsx`
   - Result: **4 passed** in 1.23s (`OK`).
   - Verification Label: `SIMULATED` (Vitest with jsdom environment).

4. **Frontend Full Vitest Suite**:
   - `npx vitest run`
   - Result: **175 passed** across 23 test files in 18.20s (`OK`).
   - Verification Label: `SIMULATED` (Vitest automated runner).

5. **Frontend Production Build**:
   - `npm run build` (`tsc -b && vite build`)
   - Result: **Success** in 17.44s (Zero TypeScript errors, production bundle compiled cleanly).
   - Verification Label: `SIMULATED` (Vite production compiler).

6. **Full Django Test Suite Across All Apps**:
   - `python backend\manage.py test orders panel inventory accounts catalog`
   - Result: **344 passed** (`Ran 344 tests in 456.183s, OK (skipped=17)`).
   - Verification Label: `SIMULATED` (Automated Django test runner with SQLite).

7. **Live Provider Delivery (MSG91 SMS / WhatsApp Business API)**:
   - Evaluated live external carrier gateway message transmission:
   - Result: External provider credentials not configured for development/test environment; mocked and console adapters safely intercepted all calls during verification.
   - Verification Label: `UNVERIFIED` (Live external carrier delivery intentionally disabled and kept behind provider adapters to avoid sending real messages or incurring gateway costs).

---

## Acceptance Criteria Evaluation

- [x] **Retries cannot duplicate customer messages**: Verified. Outbox records use an SHA-256 idempotency hash combining order, event, recipient, and channel. Worker tasks acquire row-level locks (`select_for_update`) and verify status before invoking adapters. Duplicate attempts are safely discarded.
- [x] **Notification/provider outages cannot lose or roll back orders**: Verified. Outbox records are saved and committed in the database along with the order transaction. If Celery broker is offline or fails immediately after commit, the order transaction remains valid and committed. The `sweep_pending_notifications` periodic beat task picks up stuck `PENDING` records and completes delivery.
- [x] **Stock discrepancies are visible and auditable**: Verified. Discrepancies between current stock balance and sum of ledger movements are presented in the Reconciliation Report without silent auto-correction. Staff adjustments require an explicit reason code and audit notes.
- [x] **Staff can diagnose failed delivery without exposing secrets**: Verified. Recipients are masked (`******3210`), child names and measurements are excluded, and error messages pass through a secret sanitizer that strips API keys and authorization tokens before storage and staff display. Staff can view diagnostic errors and trigger manual retries via `/api/notifications/{id}/retry/`.
- [x] **Provider acceptance is not marked as delivered**: Verified. Successful provider HTTP responses transition status to `SENT`. Status `DELIVERED` is strictly reserved for explicit delivery receipt webhooks.

---

## Remaining Decisions & Operational Configuration

1. **MSG91 Flow ID Configuration**:
   - In production environments, set `MSG91_AUTH_KEY`, `MSG91_FLOW_ID_ORDER_CONFIRMED`, `MSG91_FLOW_ID_DISPATCHED`, `MSG91_FLOW_ID_PICKUP_READY`, `MSG91_FLOW_ID_DELIVERED`, `MSG91_FLOW_ID_EXCHANGE`, and `MSG91_FLOW_ID_REFUND` in environment settings.
2. **Provider Webhook for Terminal Delivery**:
   - When carrier delivery receipts (DLR) are required to mark `DELIVERED` status, configure an inbound webhook endpoint verifying carrier signatures to update `NotificationRecord.status` to `DELIVERED`.
