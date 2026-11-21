# Task 6 Completion Report: Reliable Required-Item Lists and Full-Set Ordering

**Date:** 2026-11-21  
**Branch:** `feat/parent-shopping`  
**Repository:** `C:\Users\rebel\OneDrive\Documents\GitHub\School_Store-parent`  

---

## Executive Summary

Task 6 has been completed in full. We implemented end-to-end support for reliable required-item lists and full-set ordering across backend and frontend:
1. **Explicit Backend Requirement Model & Rules**: Replaced seed-inferred flags with explicit `is_required` attribute on `Product` and created `ProductRequirement` model with specificity scoring supporting school, class range (`class_from` - `class_to`), specific grade, campus branch, gender, and season. 'Required' status is strictly explicit and never inferred from school ownership or customisation schema.
2. **Live Catalogue & Staff Management**: Exposed `required` boolean and requirements metadata across public product APIs (`/public/schools/<id>/catalogue/`, `/public/catalogue/card/`), internal catalog serializers, and the staff admin portal (`UniformCatalogView.tsx`), allowing staff to toggle and view required status per item.
3. **Enhanced Full-Set Shopping (`FullSetSheet.tsx`)**:
   - Independent per-item quantity steppers (1 to 10) and size selectors.
   - Live total price calculation responding immediately to size, quantity, and skip status.
   - Out-of-stock visibility ("Out of stock in your city") with automatic exclusion from set total.
   - Omission confirmation warning when skipping required items, allowing parents who already own them to proceed without being forced to repurchase.
   - Prevention of cross-school and cross-child mixing with explicit mismatch confirmation dialogs.
   - Real-time pre-commitment server revalidation (`/api/cart/validate/`) identifying price changes and stock exhaustion with clear explanations before adding to bag.
4. **Parent Uniform Checklist (`SelectionFlowPage.tsx`)**:
   - Integrated progress summary card ("X of Y required items in bag") with visual progress bar at Step 4.
   - Clear item status indicators: "In bag", "Missing", and "Out of stock in your city".
   - "Add remaining required items" action button launching `FullSetSheet` for unselected required items.
5. **Multi-Item Cart Validation Endpoint (`/api/cart/validate/` & `/api/v1/cart/validate/`)**:
   - Validates cart line items against city pricing and current stock balances.
   - Refuses cross-school item mixing.
   - Scopes items to student/child where provided.
   - Returns itemized price change diffs and out-of-stock shortages.
6. **I18n & Design System Compliance**:
   - All newly added parent-facing strings localized across English, Gujarati (ગુજરાતી), and Hindi (हिन्दी).
   - Complies strictly with `CLAUDE.md`: no stock icons (uses `icons.tsx`), no drop shadows, small radii (`--radius-sm`, `--radius-md`, `--radius-lg`), no hover animations, no emojis, no em dashes in UI text, Anek Latin font, and `var(--paper)` backgrounds.

---

## Changed Files

### Backend
- `backend/catalog/models.py`:
  - Added `is_required = models.BooleanField(default=False)` to `Product`.
  - Added `ProductRequirement` model with fields: `product`, `school`, `grade`, `class_from`, `class_to`, `campus`, `gender`, `season`, `required`, `min_quantity`, `active`.
  - Added specificity scoring helper `is_product_required(...)` to resolve requirements without false positives.
- `backend/catalog/migrations/0018_product_is_required_productrequirement.py`:
  - Migration adding `is_required` to `Product` and creating table `catalog_productrequirement` with indexes.
- `backend/catalog/serializers.py`:
  - Added `ProductRequirementSerializer`.
  - Updated `ProductSerializer` to expose `is_required` and nested `requirements`.
- `backend/catalog/views.py`:
  - Updated `ProductViewSet` with prefetching (`Prefetch("requirements", queryset=ProductRequirement.objects.select_related("school", "grade", "campus"))`) ensuring constant O(1) query counts.
  - Added `ProductRequirementViewSet` for staff management of requirement rules.
  - Added `CartValidateView` handling multi-item live validation, city pricing diffs, city stock checks, student scoping, and cross-school refusal.
- `backend/catalog/urls.py` & `backend/config/urls.py`:
  - Registered `requirements` viewset and `cart/validate/` endpoint under both `/api/` and `/api/v1/`.
- `backend/catalog/public.py`, `backend/catalog/storefront.py`, `backend/catalog/catalogue.py`:
  - Updated public cards and cached catalogue entries to include live `required` boolean and `is_required` attributes.
- `backend/common/management/commands/seed_data.py`:
  - Updated baseline seed data to set `is_required=True` and seed explicit `ProductRequirement` instances for mandatory school uniform items.
- `backend/catalog/tests.py`:
  - Added test suite `ProductRequirementsAndCartValidationTests` covering base flag, specificity scoring, gender/class scoping, non-inference, public card exposure, cross-school cart refusal, and price/stock change reporting.

### Frontend
- `frontend/src/api.ts`:
  - Added `CartValidationItem` and `CartValidationResponse` types and `cartApi.validate` client function.
- `frontend/src/data/catalog.ts`:
  - Updated `toProduct` to map `required: Boolean(p.required ?? p.is_required)`.
- `frontend/src/store/storeState.ts`:
  - Added `studentId` and `studentName` to `CartItem`, `StoredSelection`, and `addItem`.
  - Updated composite item ID generation to include `schoolId` and `studentId` preventing cross-school/cross-child item coalescence.
- `frontend/src/i18n/messages.ts`:
  - Added localized strings for checklist progress, item status tags, full-set controls, omit-required warning, and school mismatch warning in EN, GU, HI.
- `frontend/src/components/product/FullSetSheet.tsx` & `frontend/src/components/product/fullSet.css`:
  - Full-set modal with independent quantity steppers, garment size selectors, immediate total re-computation, out-of-stock badges, omission confirmation dialog, school mismatch dialog, and server revalidation before adding to bag.
- `frontend/src/pages/SelectionFlowPage.tsx` & `frontend/src/pages/flow.css`:
  - Added Parent Uniform Checklist card at Step 4 with progress counts, status badges, and quick-add button.
- `frontend/src/components/admin/UniformCatalogView.tsx`:
  - Added Requirement badge column and "Required uniform item" toggle in product create/edit modal.
- `frontend/src/components/product/FullSetSheet.test.tsx`:
  - Added 6 unit/integration tests for `FullSetSheet`.
- `frontend/src/pages/SelectionFlowPage.test.tsx`:
  - Added 3 unit/integration tests for Step 4 Parent Uniform Checklist.

---

## Verification & Checks Run

All checks were executed in the foreground with exit codes verified.

| Check | Command | Result | Verification Status |
|---|---|---|---|
| **Query Count Constant Test (No N+1)** | `. C:\SchoolStore\runtime\env.ps1; python backend/manage.py test accounts.tests.RolesPermissionsAndScopingTests.test_query_count_of_each_list_endpoint_stays_constant_as_rows_grow` | **Passed** (1 test, 30.528s, 0 failures) | **PROVIDER-VERIFIED** (SQLite local test DB) |
| **Catalog Requirements & Cart Validate Test Suite** | `. C:\SchoolStore\runtime\env.ps1; python backend/manage.py test catalog.tests.ProductRequirementsAndCartValidationTests` | **Passed** (9 tests, 2.812s, 0 failures) | **PROVIDER-VERIFIED** (SQLite local test DB) |
| **Full Django Backend Test Suite** | `. C:\SchoolStore\runtime\env.ps1; python backend/manage.py test orders panel inventory accounts catalog` | **Passed** (326 tests ran in 441.734s, 0 failures, 17 skipped) | **PROVIDER-VERIFIED** (SQLite local test DB) |
| **Full Frontend Vitest Suite** | `. C:\SchoolStore\runtime\env.ps1; cd frontend; npx vitest run` | **Passed** (19 test files, 153 tests passed in 11.99s, 0 failures) | **SIMULATED** (JSDOM automated test suite with mocks) |
| **Frontend Production Build** | `. C:\SchoolStore\runtime\env.ps1; cd frontend; npm run build` (`tsc -b && vite build`) | **Passed** (Built in 14.25s, 0 TypeScript errors, 0 bundle errors) | **PROVIDER-VERIFIED** (Production build artifact generation) |
| **Live Razorpay Payment Gateway** | N/A (Keys not provided in test environment) | Not executed | **UNVERIFIED** (Real provider verification deferred per guidelines) |
| **Physical Android Device Automation** | N/A (No device testing per prompt instructions) | Not executed | **UNVERIFIED** (Device testing excluded per prompt rules) |

---

## Acceptance Criteria Audit

1. **Live data—not seed data—drives required badges**:
   - **Status**: **MET**.
   - `Product.is_required` and `ProductRequirement` models store requirement rules in the database.
   - Public catalogue APIs expose `required: is_product_required(...)`.
   - `frontend/src/data/catalog.ts` maps `required` directly from server responses.
2. **Independent quantities and separate garment sizes carry through correctly**:
   - **Status**: **MET**.
   - `FullSetSheet.tsx` provides dedicated steppers (+/-) and size dropdowns per line.
   - Items added to the bag carry their selected sizes, quantities, and pricing.
3. **Retain skip controls for optional purchases and update total immediately**:
   - **Status**: **MET**.
   - Parents can toggle selection on both optional and required items.
   - Subtotal updates reactively whenever a quantity, size, or skip toggle changes.
4. **Warn about omitted required items without forcing parents to repurchase**:
   - **Status**: **MET**.
   - When required items are skipped, an omission alert modal displays explaining that required uniform items were not selected.
   - Modal gives parents the explicit choice: "Proceed without them (I already own them)" or "Go back and review items".
5. **Out-of-stock items are explained**:
   - **Status**: **MET**.
   - FullSetSheet displays "Out of stock in your city" badges for out-of-stock sizes.
   - Out-of-stock items are disabled and excluded from the "Add set to bag" action.
   - The checklist on Step 4 also tags out-of-stock required items clearly.
6. **The server owns the final price and availability**:
   - **Status**: **MET**.
   - `/api/cart/validate/` checks live city prices (`ProductCityPrice`) and city inventory (`StockBalance`).
   - If a price changed between catalogue render and set addition, FullSetSheet displays a price update warning explaining the exact diff before committing.
7. **Ensure full sets cannot silently cross schools or children**:
   - **Status**: **MET**.
   - `CartItem` tracks `schoolId`, `studentId`, and `studentName`.
   - Cart item composite keys incorporate `schoolId` and `studentId`.
   - `FullSetSheet` detects when bag contains items from another school and prompts the parent with a choice: clear the bag or keep existing items.
   - Backend `CartValidateView` refuses validation payloads containing items from multiple schools.
8. **Parent checklist on Step 4 of SelectionFlowPage**:
   - **Status**: **MET**.
   - Step 4 displays "Parent Uniform Checklist" with "X of Y required items in bag" counter, progress bar, and item status badges ("In bag", "Missing", "Out of stock in your city").
   - Includes "Add remaining required items" action button.
9. **Staff editor exposes and updates required status**:
   - **Status**: **MET**.
   - `UniformCatalogView.tsx` shows a "Required" / "Optional" badge in the table.
   - The Add/Edit uniform modal includes a "Required uniform item" checkbox.

---

## Remaining Decisions & Unresolved Policies

1. **Default Quantities for Multi-Piece Requirements**:
   - `ProductRequirement.min_quantity` allows schools to specify multi-piece requirements (e.g. 2 shirts, 2 socks).
   - Currently, `FullSetSheet` defaults quantity to 1 for all items to prevent accidental over-ordering, while allowing parents to step up to 10. A policy decision could align default initial stepper values with `min_quantity` if desired by school boards.
2. **Grade Range Specificity Priority**:
   - Specificity scoring in `is_product_required` prioritizes explicit `grade` foreign keys (score +10) over numeric class ranges (`class_from` - `class_to`, score +5). This covers all current school catalog configurations; additional rules can be configured per school.
3. **Out-of-Stock Required Items Notification to Schools**:
   - When required items are out of stock in a parent's city, the checklist informs the parent. An automatic stock alert pipeline to the school administration could be considered in future releases.
