# Task 2 Fix Report: Indian Delivery Address Validation & Serviceability

## 1. Overview & Context

This task addresses delivery address correctness and validation for Indian school uniform shoppers on branch `feat/parent-shopping`. Previously, the checkout form unconditionally defaulted `state` to `'Gujarat'`, validated PIN format only superficially on the client, and treated `delivery_details` as an untyped JSON dictionary on the server API boundary without strict validation.

We have:
1. Removed the unconditional Gujarat default across the checkout flow and catalogue state models.
2. Structured server-side validation in DRF (`backend/orders/delivery.py` and `backend/orders/serializers.py`), enforcing required recipient, 10-digit Indian mobile number, street address, city, valid State/UT, and 6-digit PIN code for home deliveries, while allowing school pickup orders without a home address.
3. Decoupled PIN code format validation, geographic lookup, and courier serviceability via `PinServiceAdapter` and the public `orders/pincode-lookup/` endpoint.
4. Prevented false delivery promises: unavailable or failed courier lookups return `UNKNOWN` serviceability, never `SERVICEABLE`.
5. Preserved parents' manual input corrections from being unexpectedly overwritten by automated lookups.
6. Maintained complete backwards compatibility for existing order history snapshots and legacy format records.
7. Provided multilingual translations (English, Gujarati, Hindi) and updated provider documentation.

---

## 2. Changed Files

### Backend
- `backend/orders/delivery.py`: Created delivery validation module containing `INDIAN_STATES_AND_UTS`, alias maps, regex validators for Indian mobile numbers (`^[6-9]\d{9}$`) and PIN codes (`^[1-9]\d{5}$`), `clean_delivery_details()` sanitizer, and `PinServiceAdapter`.
- `backend/orders/serializers.py`: Integrated `clean_delivery_details()` in `OrderCreateSerializer.validate()` conditioned on `fulfillment_type`. Added explicit validation in `OrderQuoteSerializer` preserving pricing calculations without requiring home delivery details at quote stage.
- `backend/orders/views.py`: Added `PincodeLookupView` returning format validity, geographical data, and courier serviceability separately.
- `backend/orders/urls.py`: Registered `orders/pincode-lookup/` route under `/api/`.
- `backend/config/settings.py`: Added `DELIVERY_PROVIDER_URL`, `DELIVERY_PROVIDER_API_KEY`, and `DELIVERY_PROVIDER_NAME` environment configuration settings.
- `backend/catalog/public.py`: Exposed `state_name` on public school listings to enable reliable school state prefill.
- `backend/catalog/tests.py`: Updated order placement tests to specify explicit fulfillment types or delivery details, resolving regression failures under strict validation.
- `backend/orders/test_delivery_address.py`: Added 19 comprehensive unit and integration tests covering home delivery validation, phone and PIN normalization, state validation, school pickup exemption, legacy order readability, and provider serviceability separation.
- `backend/orders/test_customisation.py`: Maintained school pickup fulfillment type in customisation order tests.
- `backend/orders/test_payment_method.py`: Maintained valid delivery payloads across payment method test cases.
- `backend/orders/test_razorpay_checkout.py`: Maintained valid delivery payloads across Razorpay quote-and-create test cases.

### Frontend
- `frontend/src/pages/CheckoutPage.tsx`: Removed unconditional `'Gujarat'` default; prefilled `state` and `city` from selection/school where reliable or asked the parent; added Indian States & UTs dropdown selector; integrated debounced 6-digit PIN lookup with format check; preserved manual corrections; displayed serviceability status hints; updated `validateStep2()` and order summary.
- `frontend/src/pages/CheckoutPage.test.tsx`: Added unit and integration tests verifying non-Gujarat prefill, manual state selection, PIN lookup geography auto-fill, preservation of manual corrections, pickup without address, and honest unconfirmed status on lookup failure.
- `frontend/src/api.ts`: Added `PincodeLookupResponse` type and `orderApi.pincodeLookup` method.
- `frontend/src/data/catalog.ts`: Added `state` property to `StoreSchool` and `PublicSchool`, populating it in `toSchool()`.
- `frontend/src/pages/SelectionFlowPage.tsx`: Ensured `schoolAnswer()` captures `stateName` from `activeBranch` or `activeSchool`.
- `frontend/src/i18n/messages.ts`: Added translations in English, Gujarati, and Hindi for state selection, PIN lookup in-flight hint, serviceability status messages, and validation errors.
- `frontend/src/components/cart/bagCheckout.css`: Added `.field-hint` class with typography and responsive spacing adhering to design system rules.

### Documentation
- `DELIVERY_PROVIDER_CONFIG.md`: Separate documentation covering courier serviceability provider configuration, environment variables, adapter contract, timeout limits, and failure handling policies.

---

## 3. Checks Run & Recorded Results

| Check / Test Suite | Scope | Verification Type | Result | Notes |
|---|---|---|---|---|
| Django `orders` suite | Backend | SIMULATED (automated test with mocks) | PASS (100 tests passed, 6 skipped in 100.5s) | Includes all 19 delivery address tests in `test_delivery_address.py` |
| Django `catalog` suite | Backend | SIMULATED (automated test with mocks) | PASS (134 tests passed in 114.8s) | Public school state exposure, catalogue filters, and order placement |
| Django `panel`, `inventory`, `accounts` suites | Backend | SIMULATED (automated test with mocks) | PASS (68 tests passed, 11 skipped in 165.3s) | Role-scoping, stock balances, student claims |
| Delivery address validation test suite | Backend (`test_delivery_address.py`) | SIMULATED (automated test with mocks) | PASS (19/19 tests) | Tests 01–19 covering all address rules, phone/pin bounds, pickup, legacy orders, and provider mocks |
| Vitest test suite (`npx vitest run`) | Frontend | SIMULATED (automated test with mocks) | PASS (15 test files, 135 tests passed in 13.3s) | Includes 10 tests in `CheckoutPage.test.tsx` (Razorpay flow + delivery address flow) |
| Frontend production build (`npm run build`) | Frontend | SIMULATED (automated build) | PASS (`tsc -b && vite build` built in 14.0s) | TypeScript checks and production bundle generated cleanly |
| Live Courier Provider Integration (e.g. Shiprocket live credentials) | Infrastructure | UNVERIFIED | UNVERIFIED | No external live courier credentials provided; unconfigured fallback returns honest `UNKNOWN` as designed |

---

## 4. Acceptance Criteria Verification

### 1. Non-Gujarat orders do not inherit Gujarat
- **Status**: MET
- **Backend Evidence**: Verified by `test_09_non_gujarat_order_preserves_punjab_state` and `test_10_non_gujarat_order_preserves_delhi_state` in `test_delivery_address.py`.
- **Frontend Evidence**: Verified by `non-Gujarat selection and school do not inherit Gujarat` test in `CheckoutPage.test.tsx`. State initializes from `selection.stateName` or `school.state` (e.g. Punjab) or remains empty, prompting the parent to choose.

### 2. Malformed direct API submissions are rejected
- **Status**: MET
- **Backend Evidence**: Verified by tests `test_01` through `test_08` in `test_delivery_address.py`. Direct API submissions missing recipient, phone, address, city, state, or PIN are rejected with HTTP 400 and field-specific error messages. Invalid phone numbers (non-Indian, incorrect length) and invalid PINs (non-6 digit, starting with 0) are rejected. Inputs are trimmed and length-bounded.

### 3. Pickup works without a home address
- **Status**: MET
- **Backend Evidence**: Verified by `test_11_pickup_works_without_home_address` and `test_12_pickup_with_recipient_and_phone_cleaned` in `test_delivery_address.py`. School pickup orders with empty or partial `delivery_details` succeed with HTTP 201.
- **Frontend Evidence**: Verified by `pickup works without a home address` test in `CheckoutPage.test.tsx`. Selecting "Collect at school" does not prompt for or require home address fields.

### 4. Unavailable lookup does not produce a false delivery promise
- **Status**: MET
- **Backend Evidence**: Verified by `test_16_unavailable_lookup_shows_unknown_not_serviceable` and `test_19_mock_courier_provider_failure_returns_unknown` in `test_delivery_address.py`. When provider credentials are unconfigured or when provider requests fail/timeout, serviceability status returns `UNKNOWN`, never `SERVICEABLE`.
- **Frontend Evidence**: Verified by `serviceability check failure shows unconfirmed unknown status, not serviceable` in `CheckoutPage.test.tsx`. The UI renders "Courier delivery unconfirmed. We will verify availability after booking." and never promises delivery.

### 5. Document provider configuration separately
- **Status**: MET
- **Evidence**: `DELIVERY_PROVIDER_CONFIG.md` created at repository root documenting environment variables, adapter contract, timeout policies, and failure behaviors.

---

## 5. Remaining Decisions & Operational Notes

1. **Live Courier Provider Credentials**:
   - `DELIVERY_PROVIDER_URL` and `DELIVERY_PROVIDER_API_KEY` are currently unset in default environments. When production courier accounts (e.g. Shiprocket or Delhivery) are provisioned, setting these variables will automatically activate live serviceability queries without code modifications.
2. **Postgres Cluster in Testing**:
   - Tests execute against SQLite by default; no server or shared databases were touched.
3. **No Uncommitted Work / Clean Working Tree**:
   - All code, tests, documentation, and reports are committed to `feat/parent-shopping`.
