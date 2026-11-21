# Uniform Portal & Operations Rebuild

## Overview
Rebuilt the uniform management portal cleanly from the live codebase (`origin/release/kv-pt-uniform`). The previous implementation that introduced hardcoded credentials, local storage state persistence, and worker-level overrides was cleanly rolled back. All data, photo uploads, school management, catalogue items, and city-level stock balances now route strictly through Django REST framework APIs with database persistence and JWT role scoping.

---

## 1. New Backend Endpoints & Enhancements

- **Photo Upload**:
  - `POST /api/products/{id}/photo/` (`MultiPartParser`, `FormParser`)
  - **Permissions**: Restricted to authenticated `BOSS` and city-scoped `ADMIN` users (`RoleScopedPermission` write roles).
  - **Validation**: Accepts JPG, PNG, and WebP up to 8 MB. Uses Pillow's `Image.verify()` to validate binary stream headers rather than client content-type headers. Rejects corrupt files, non-images, and files > 8 MB with HTTP 400.
  - **Image Processing**: Automatically crops and centers to a square 900×900 WebP at quality 84 using `PIL.ImageOps.fit` with `LANCZOS` resampling.
  - **Storage**: Saves output to disk under `MEDIA_ROOT/products/<product_id>/<uuid>.webp`.
  - **Catalogue Integration**: Prepends the CDN absolute URL `https://school-store.aqualite.workers.dev/media/products/<product_id>/<uuid>.webp` to the product's `images` array and flushes catalog cache. Returns the updated product representation.

- **Catalogue Serializer, Scoping & Deletion**:
  - `backend/catalog/serializers.py`: Added `product_type` (`SOCKS`, `BELT`, `TIE`) to `ProductSerializer`. Auto-fills `grades` M2M using `class_from` and `class_to` range mapping (`Class 1`..`Class 12`) when explicit `grades` is not supplied.
  - City admin permission scoping: `ADMIN` can only manage schools, products, and variants matching their designated city.
  - Soft-delete: Added `perform_destroy` on `ProductViewSet` and `ProductVariantViewSet`. Soft-deletes products and variants by setting `active = False` (cascading deactivation from product to variants) and clearing catalogue cache without breaking protected foreign keys in order history. Restricts city-admin to their assigned city.

- **City Pricing & Overrides Endpoint**:
  - `POST /api/city-prices/`, `GET /api/city-prices/`, `DELETE /api/city-prices/{id}/`
  - Model `ProductCityPrice(product, city, selling_price, cost_price, active)` with `unique_together = ('product', 'city')` and migration `0016_productcityprice.py`.
  - Scoping: City admins can only view and set prices for their assigned city; Boss/National Uniform Admins can set city price overrides across any city in India.
  - Universal Listing Default: Products sell across India at the universal base `Product.selling_price` unless explicitly overridden for a specific city.
  - Storefront Integration: Public catalogue endpoint `/api/public/products/?city=<uuid>` checks `ProductCityPrice` and reflects city-specific pricing with fallback to universal price. Order checkout snapshots `ProductCityPrice.selling_price` into `OrderItem.unit_price_snapshot`.

- **Stock Balances & Movements**:
  - `backend/inventory/views.py`: Filter `StockBalanceViewSet` by `city`, `variant`, `school`, and `product`.
  - `POST /api/stock-movements/`: Supports `RESTOCK`, `ADJUSTMENT`, and `INITIAL_STOCK` movements. Allows creating initial stock balance records for variants that have no row yet (e.g. Kendriya Vidyalaya uniform items). Zeroes out stock atomically when negative adjustment matching balance is posted.

---

## 2. Portal Screens (`/portal/*`)

All portal screens follow the design rules defined in `CLAUDE.md` (no drop shadows, 1px `var(--line)` borders, 3/4/6px corner radii, solid backgrounds, no hover movement, no emojis or checkmark bullets, and skeleton loaders during queries).

1. **Route & Shell (`frontend/src/pages/AdminPortal.tsx`)**:
   - Protected route `/portal/*` wrapped in `<Guard roles={['BOSS', 'ADMIN']}>`.
   - Accessible via "Uniform Portal" navigation link in both `BossPanel` (`/boss`) and `CityAdmin` (`/city`) panels.
   - Dedicated National Uniform Admin support: An `ADMIN` user without a city (e.g. national uniform operations staff) is automatically routed to `/portal` upon sign-in (`homeFor('ADMIN', null) -> '/portal'`).
   - Boss Isolation: Accounts with role `ADMIN` are strictly blocked from `/boss` (BossPanel executive KPIs, revenue, profits, margins, and staff management).
   - Clean top bar displaying current authenticated user and role, link to customer storefront, contextual back buttons (only displayed for Boss and City-scoped Admins, omitted for National Uniform Admins), and sign-out button.
   - Layout isolation: Header and secondary navigation bar (`.portal-nav-bar`) separated into distinct blocks with explicit styling overrides against global 76px header rules, avoiding squashed badges or clipped tab bars.

2. **Schools Screen (`frontend/src/components/admin/SchoolManagerView.tsx`)**:
   - List, search, add, and edit schools using `/api/schools/` and `/api/cities/`.
   - Fields: Name, Code, City, Logo URL, Home Delivery, School Pickup, Address, Commission Rate, Active status.
   - Soft-delete: Setting a school to inactive sets `active: false` (never a hard delete in database).

3. **Uniform Catalogue Screen (`frontend/src/components/admin/UniformCatalogView.tsx`)**:
   - Filter by school, category, gender (boy, girl, unisex), and class range (1-12).
   - Add/edit garments: Name, Description, Category, Product Type, Gender, Class From–To, Cost Price (Boss only), Selling Price, Active status.
   - Delete/Reactivate items: Row-level "Delete" (with confirm dialog) and "Reactivate" actions; "Delete Item" in edit modal footer.
   - Size variant manager: Add, rename, toggle active/inactive, or delete size variants with unique SKU generation in `<SCHOOLCODE>-<ITEMSLUG>-<SIZE>` format.
   - Direct computer photo upload with client-side preview, file size check, progress feedback, and server error handling.

4. **Stock Screen (`frontend/src/components/admin/CityAvailabilityView.tsx`)**:
   - Product-Level Grouping: Replaced 150+ raw size rows with clean, grouped product rows displaying photo thumbnail, school name, category, gender, class grades, total city stock on hand, and overall availability status.
   - Collapsible Size Drawers: Each product row features a "Manage Sizes" drawer and expand/collapse toggle displaying size chips, individual SKUs, stock units, and instant action buttons (`Initialize Stock`, `Restock / Adjust`, `Zero Out`).
   - Global and Batch Controls: Features "Expand All" / "Collapse All" toggle buttons, a quick city metrics summary bar, and a "Mark 0" button to zero out all sizes for a product in that city with a single confirmation.
   - City inventory monitor displaying current stock balances and low-stock alerts, enabling initial stock entry for Kendriya Vidyalaya uniform items.

5. **City Pricing & Overrides Screen (`frontend/src/components/admin/CityPricingView.tsx`)**:
   - City selector allowing staff to inspect and set city-level retail rates.
   - Universal Listing First: Products default to universal catalogue pricing; staff can add custom local rates (e.g. +₹50 in Jaipur).
   - Quick adjustment presets: One-click buttons for +₹10, +₹20, +₹50, +₹100, -₹20, -₹50, or custom rate inputs with live delta calculation (+₹50 / +7.8%).
   - Reset to Universal: Single-click button to remove custom city override and immediately revert back to universal catalogue price.

---

## 3. Manual Verification & Test Summary

- **Backend Tests (Django)**:
  - `backend/catalog/test_portal_api.py` (11 tests):
    - Photo upload rejected for anonymous (401), parent/teacher (403).
    - Rejects non-image and file > 8MB (400).
    - Saves 900×900 WebP, stores file under `MEDIA_ROOT`, and puts URL first in `Product.images`.
    - City admin scoping: Admin cannot upload photo or edit products for schools in another city.
    - Product create/update with `class_from`..`class_to` automatically populates `grades` M2M.
    - Variant create/update permitted for BOSS/ADMIN and refused for PARENT.
    - Product and variant soft-delete cascades `active = False` and enforces city-admin scoping.
  - `backend/inventory/test_portal_stock.py` (4 tests):
    - Stock movements create initial balance rows and update balances atomically.
    - Mark out of stock brings balance to 0.
    - City-scoped Admin cannot modify stock in another city (403).
    - Stock balances and movements inaccessible to Parent (403).
  - All 134 tests in `catalog` and `inventory` pass. Full Django test suite passes.
  - `python manage.py makemigrations --check` detects no missing migrations.

- **Frontend Tests (Vitest & TypeScript)**:
  - `frontend/src/pages/AdminPortal.test.tsx` (6 tests):
    - `/portal` redirects to sign-in when signed out.
    - `/portal` refuses PARENT role and redirects to `/parent`.
    - Renders navigation tabs and header for BOSS / ADMIN.
    - Catalogue form sends accurate payload and renders API validation errors.
    - Renders Delete button for uniform items and invokes `deleteProduct` API.
    - Zero `localStorage` calls verified across all admin components and portal pages.
  - `npx tsc --noEmit`: 0 TypeScript errors.
  - `npm test -- --run`: All 11 test files and 105 tests pass.
  - `npm run build` with `VITE_API_URL=/api`: Succeeded cleanly in 14.84s.

- **Live Proxy Preview (`npm run preview` on port 4173)**:
  - Verified `GET /api/public/cities/?state=Haryana` returns Gurugram city (`id: b8d65aed-837c-49f9-be26-1970d5272995`).
  - Verified `GET /api/public/cities/b8d65aed-837c-49f9-be26-1970d5272995/branches/` returns exactly 73 schools.
  - Verified Kendriya Vidyalaya (`CHAIN-KV`) Class 1 items load with valid WebP images.
  - Verified protected frontend files (`frontend/worker/`, `frontend/wrangler*.jsonc`, `frontend/public/products/`) have zero diff against `origin/release/kv-pt-uniform`.
  - Verified no backdoor strings, hardcoded demo credentials, or fake roles exist in the repository.

---

## 4. Deploy Steps (For a Person to Run After Review)

- [ ] Merge the PR into `release/kv-pt-uniform`.
- [ ] Back up first: `pg_dump` the store-server database.
- [ ] Update the store server: Pull the merged code onto `192.168.0.125` and restart the `SchoolStorePublic` task, which runs migrate.
- [ ] Load the school directory: new campuses in `backend/schools/data/north_india_schools.json` only appear after an import. Run `deploy/import-school-directory.ps1` on the server as SYSTEM (the `schtasks` lines are at the top of the script). It writes a `pg_dump` backup first, then runs `manage.py import_school_directory --deactivate-missing`, which updates branches by their Google Maps place id and switches off branches no longer in the file. Check `E:\runtime\data\school_store\logs\import-school-directory.log` for the backup path and the counts.
- [ ] Check the media folder: Confirm `MEDIA_ROOT/products` exists on the server and that `/media/` URLs load through the Worker.
- [ ] Look for surprise deploys: Run `npx wrangler deployments list --name school-store` and make sure no unexpected deploy has happened since the last known good one.
- [ ] Build and deploy the Workers:
  - Build frontend with `VITE_API_URL=/api`
  - `npx wrangler deploy`
  - `npx wrangler deploy -c wrangler.showcase.jsonc`
- [ ] Check the live site:
  - KV photos load as `image/webp`
  - Gurugram shows its schools on desktop
  - `/portal` asks for sign-in
  - Signing in as a real `BOSS` opens the portal
