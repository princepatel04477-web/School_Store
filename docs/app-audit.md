# School Store Android App & Fit System Audit

**Date:** November 17, 2026  
**Workspace:** `School_Store-draft01` (`draft-01`)  
**Scope:** Pre-implementation technical audit covering the Android app shell, frontend architecture, and sizing/fit engine. No application source code was modified during this audit.

---

## Part A: The Android App Today

### 1. Shell Architecture, Configuration, and Installed Plugins

#### Current Configuration & Mechanism
The current Android build operates as a thin web wrapper loading the live website over the network:
- **`frontend/capacitor.config.json`**:
  - `appId`: `com.colorbenz.schoolstore`
  - `appName`: "School Store"
  - `webDir`: `"android-shell"`
  - `server.url`: `"https://school-store.aqualite.workers.dev"` (the app opens the remote web URL)
  - `server.androidScheme`: `"https"`
  - `server.cleartext`: `false`
  - `server.errorPath`: `"offline.html"`
  - `android.allowMixedContent`: `false`
  - `android.webContentsDebuggingEnabled`: `false`
  - `plugins.SplashScreen`: background `#2F5D50`, launch duration 600ms, auto-hide true.
  - `plugins.StatusBar`: background `#2F5D50`, style `DARK`, `overlaysWebView: false`.
- **`frontend/android-shell/`**:
  - `index.html`: Shell placeholder that immediately redirects via `<meta http-equiv="refresh" content="0; url=https://school-store.aqualite.workers.dev/" />` with a `#2F5D50` background.
  - `offline.html`: Static fallback screen displayed when the webview fails to load `server.url`. Features a centered card, logo, "You're offline" title, and a "Try again" button redirecting back to the live site.
- **`frontend/android/`**:
  - Capacitor 6 native Android project using Gradle with JDK 17 compatibility.
  - `variables.gradle`: `minSdkVersion = 24`, `compileSdkVersion = 34`, `targetSdkVersion = 34`, `androidxCoreVersion = '1.12.0'`, `androidxWebkitVersion = '1.9.0'`.
  - `AndroidManifest.xml`: Single `MainActivity` with `@style/AppTheme.NoActionBarLaunch`. Declares `android.permission.INTERNET`, `android.permission.CAMERA` (`android.hardware.camera` required=false).
- **Installed Capacitor Plugins and Versions** (from `frontend/package.json`):
  - `@capacitor/core`: `^6.2.3`
  - `@capacitor/android`: `^6.2.3`
  - `@capacitor/app`: `^6.0.3`
  - `@capacitor/splash-screen`: `^6.0.4`
  - `@capacitor/status-bar`: `^6.0.3`
  - Dev dependencies: `@capacitor/cli`: `^6.2.3`, `@capacitor/assets`: `^3.0.5`

---

### 2. Routes and Screens Grouped by Role

#### A. Public Storefront
- `/`: `HomePage` (Hero school search, featured categories, uniforms, shoes, stationery).
- `/shop` & `/flow`: `SelectionFlowPage` (Selection wizard: select school, standard/grade, gender, category, items, sizing, add-to-bag).
- `/checkout`: `CheckoutPage` (Address entry, delivery option, payment method selection, order placement).
- `/about`, `/for-schools`, `/contact`, `/help`, `/size-guide`: `ComingSoonPage` (Informational placeholders).
- `/privacy`, `/terms`, `/refunds`: `PrivacyPage`, `TermsPage`, `RefundPage` (Legal policy pages).
- `/login`: `Login` (Authentication for parent phone OTP sign-in and staff username/password).

#### B. Parent Portal (`/parent/*`, Role: `PARENT`)
- `/parent`: Parent Dashboard (`Dashboard` in `Parent.tsx`: child selector switch, student profile preview, DPDP-compliant photo deletion request, category chips, `SelectionFlow`, `Cart`).
- `/parent/orders`: Parent Orders (`Orders` in `Parent.tsx`: purchase history, tracking status badges, delivery timeline, order item details).

#### C. Teacher Portal (`/teacher/*`, Roles: `TEACHER`, `SCHOOL_ADMIN`)
- `/teacher`: `TeacherHome` (Overview and quick actions).
- `/teacher/students`: Student roster, class list, and measurement tracking.
- `/teacher/order/:id`: Order creation and sizing assistance for students.

#### D. School Admin Portal (`/school/*`, Roles: `SCHOOL_ADMIN`, `ADMIN`, `BOSS`)
- `/school`: Overview dashboard with key metrics.
- `/school/orders`: School-level order management and status progression.
- `/school/students`: Student enrollment and roster records.
- `/school/students/:id`: Detailed student profile with measurements and consent state.
- `/school/teachers`: School faculty directory.
- `/school/exports`: Tailor sheet export, roster downloads, and reports.
- `/school/size-charts`: School uniform size chart review and adjustments.

#### E. City Admin Portal (`/city/*`, Roles: `ADMIN`, `BOSS`)
- `/city`: City-wide daily sales, order counts, and commission metrics.
- `/city/inventory`: Multi-school stock balances and inventory alerts.
- `/city/orders`: Aggregated city orders list.
- `/city/schools`: Schools directory across the city.
- `/city/size-charts`: City-level size chart management.

#### F. Boss Panel (`/boss/*`, Role: `BOSS`)
- `/boss`: Executive performance overview.
- `/boss/analytics`: Revenue, margin, and conversion analytics.
- `/boss/management`: Administrative staff and permissions.
- `/boss/schools`: Partner schools commission and contract agreements.
- `/boss/view-as`: User role impersonation switch.
- `/boss/size-charts`: Global generic size charts.
- `/boss/school-requests`: Incoming school partnership requests.
- `/boss/retailers`: Retail partner directory and assignments.

#### G. Retailer Portal (`/retailer/*`, Role: `RETAILER`)
- `/retailer`: Assigned schools overview.
- `/retailer/uniforms`: Uniform catalog and mockups.
- `/retailer/uniforms/:id`: Uniform detail, sports polo / track pant mockup generator.

#### Top 4 Screens a Parent Uses Most (Future Bottom Tabs)
1. **Shop**: `/shop` (School selection, category browsing, uniform items, selection flow).
2. **Orders**: `/parent/orders` (Order tracking, delivery timeline, purchase history).
3. **Measure**: In-flow camera measurement & shoulder guide (`MeasurementPanel` / `MeasureFlow`).
4. **Profile**: `/parent` (Child selector, student details, saved measurements, photo management, settings).

---

### 3. API Communication, Auth & Cloudflare Worker Routing

#### Frontend API Client & Auth Architecture (`frontend/src/api.ts`)
- **Base URL**: `const API = import.meta.env.VITE_API_URL || '/api'`.
  - URL generation helper `toUrl(path)` prefixes `/api` if not already present.
- **Authentication**: SimpleJWT Bearer tokens.
  - Stored in browser `localStorage`: keys `'access'` and `'refresh'`.
  - Request injection: `Authorization: Bearer <access>` header attached to all requests via `api()`, `upload()`, and `download()`.
  - Automatic Token Refresh: On receiving HTTP 401, queues concurrent requests and executes `POST ${API}/auth/token/refresh/` with `{ refresh: token }`. On success, updates `access` in `localStorage` and retries the original request.
  - Session Expiry: If refresh fails, `logout()` clears `localStorage` tokens and navigates to `/login`.

#### Cloudflare Worker Gateway & Showcase Fallback (`frontend/worker/index.js`)
- Cloudflare Worker (`https://school-store.aqualite.workers.dev`) sits in front of the entire application.
- **Static Asset Routing**: Any path not matching `SERVER_PATH = /^\/(api|admin|static|media)(\/|$)/` is served directly from Worker KV/Asset storage (`env.ASSETS` compiled from `frontend/dist`).
- **Server Request Forwarding**:
  - Worker retrieves active tunnel address from KV (`env.CONFIG.get('origin')`) and proxies `/api`, `/admin`, `/static`, `/media` to the Django server.
- **Showcase Fallback (D1 + KV)**:
  - Specially designated for retailer endpoints (`/api/retail/*`), auth endpoints (`/api/auth/token/`, `/api/auth/token/refresh/`, `/api/auth/me/`), and public retail mockups (`/api/public/schools/*`, `/api/public/mockups/*`).
  - If the tunnel origin is down (`502, 503, 504, 521, 522, 523, 524, 530`) or if Django returns 401 on auth (retailer credentials stored in D1) or 404 on retail assets, Worker routes the request to `env.SHOWCASE`.
  - Core student, catalog, and order endpoints route exclusively to Django and return the standard 503 offline response if the backend is down.

---

### 4. Bundled App Constraints & Potential Breakages

Running the React build from local files inside the APK (`https://localhost`) introduces specific issues:
1. **Relative API Base URL**:
   - `VITE_API_URL` defaults to `'/api'`, which inside the APK evaluates to `https://localhost/api` and fails. The app build must provide an absolute URL: `VITE_API_URL=https://school-store.aqualite.workers.dev/api`.
2. **CORS and Origin Restrictions**:
   - Origin changes from `https://school-store.aqualite.workers.dev` to `https://localhost`.
   - In `backend/config/settings.py`, `CORS_ALLOWED_ORIGINS` must include `https://localhost`.
   - `CSRF_TRUSTED_ORIGINS` currently lists `http://localhost:5173` and `http://127.0.0.1:8000`, but omits `https://localhost`. It must explicitly include `https://localhost`.
   - The Cloudflare Worker must correctly proxy CORS headers and handle `OPTIONS` preflight for `https://localhost`.
3. **Token Storage**:
   - `localStorage` can be wiped by the Android WebView under memory pressure or app cache clearing. SimpleJWT tokens should transition to `@capacitor/preferences` (or secure storage) for persistent native sessions.
4. **MediaPipe WASM & Model Assets**:
   - `frontend/public/mediapipe` contains 27.5 MB of binary assets (`pose_landmarker_full.task` at ~15 MB, plus SIMD and non-SIMD wasm engines).
   - Bundling these inside `dist-app` would inflate the APK beyond 40 MB (violating the < 15 MB APK constraint).
   - `MeasureCapture.tsx` currently resolves `/mediapipe/wasm` and `/mediapipe/pose_landmarker_full.task` relative to root. In the app, these must be fetched lazily from the remote CDN/worker URL (`https://school-store.aqualite.workers.dev/mediapipe/...`) only when measurement opens.
5. **Razorpay & External Links**:
   - External links (PDF downloads, map directions, Razorpay checkout pages) must not be trapped inside the internal WebView. They require `@capacitor/browser` or Android Intent dispatch to open in the system browser and return cleanly upon completion.

---

### 5. Mobile Ergonomics & Viewport Audit (390 x 844)

An audit of the storefront UI at 390 x 844 reveals several touch target and layout concerns:
1. **Viewport Meta Tag**:
   - `frontend/index.html` has `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` without `viewport-fit=cover`.
   - Without `viewport-fit=cover`, CSS safe-area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) evaluate to 0px, causing fixed headers and footers to collide with hardware notches and the Android navigation/gesture bar.
2. **Input Font-Size Zoom**:
   - Across `styles.css` and admin pages, text inputs, selects, and date pickers use `font-size: 13px` or `15px` (e.g. `.admin-main input`, `.school-switch`, `product select`).
   - Mobile browsers (WebKit / Android WebView) automatically trigger an unwanted zoom on focus whenever input font-size is strictly below 16px.
3. **Sub-44px Touch Targets**:
   - Radio buttons (`.radio`) measure `20px x 20px`.
   - Student avatar icons (`.kid-avatar`) measure `34px x 34px`.
   - `.text-button` and `.link-button` have `font-size: 13px` with minimal padding, falling below the recommended 44px x 44px ergonomic target.
4. **Missing Safe-Area Padding**:
   - Header is fixed at `height: 76px` without top notch inset padding.
   - Sticky Add-to-Bag bars and modals lack `env(safe-area-inset-bottom)` padding, colliding with the Android gesture bar.
5. **Horizontal Scrolling & Text Selection**:
   - Long product tables and admin views produce horizontal scrollbars.
   - Interactive UI elements (buttons, cards, chips) lack `user-select: none`, allowing unwanted text selection and copy callouts on mobile touch and hold.

---

## Part B: Sizing and Fit Today

### 6. Summary of Existing Fit & Sizing Subsystems

- **`frontend/src/data/fit.ts` & `frontend/src/data/sizes.ts`**:
  - Implements client-side fit structures: `Fit` (`heightCm`, `weightKg`, `shoulderCm`, `shoulderConfidence`, `source`: `'CAMERA' | 'MANUAL'`, `shoulderEdited`).
  - Defines `FIT_LIMITS` sourced from `shared/fit_limits.json` (`height_cm`: 80–200, `weight_kg`: 10–120, `shoulder_cm`: 20–60).
  - Provides hooks: `useLatestMeasurement(studentId)` (fetches from `/students/${studentId}/measurements/latest/`), `useLastSizes`, `useSizeFit(products, fit, className)` (calls `POST /api/public/size-fit/`).
  - Contains helper functions: `suggestedSizeIds`, `preselectSizeId`, and `suggestSizeId` (matches sizes using class label ranges like "Class 4-6").
- **`frontend/src/components/fit/*`**:
  - `MeasurementPanel.tsx`: Card displayed on product detail views. If no measurement exists, shows "Accurate size" camera/tape trigger; if measured, renders height, weight, shoulder values, and a "Measure again" button.
  - `MeasureFlow.tsx`: Multi-step guided modal wizard allowing parents to enter height/weight, choose between camera or tape measurement, view live camera landmarks, and save results.
  - `MeasureDrawings.tsx`: SVG illustrations for tape measurement instructions across chest, waist, and shoulders.
  - `SizeChartTable.tsx`: Tabular display of product size chart rows showing height, weight, shoulder, and chest spans.
- **`frontend/src/components/product/SizeSelector.tsx` & `SizeGuide.tsx`**:
  - `SizeSelector`: Renders size pills, highlights suggested sizes (`is-suggested`), and reflects selection via animated pills.
  - `SizeGuide`: Dialog modal displaying growth allowance advice and size breakdown tables.
- **`frontend/src/measure/*`**:
  - On-device MediaPipe pose detection pipeline.
  - `config.ts`: Defines `SHOULDER_EDGE_BLEND = 0.5`, `DEFAULT_SHOULDER_FACTOR = 1.0`, `MASS_CURVE = { bmiBase: 22, gain: 1, alpha: 0, beta: 0, min: 0.85, max: 1.35 }`, `CORNER_TO_JOINTS = { min: 0.95, max: 1.5 }`, tilt threshold (5 deg), and depth tolerance (0.2).
  - Captures 10 frames during a still window, computing median landmarks and segmenting the body outline to locate shoulder corner inflection points.
- **`backend/catalog` (`SizeChartRow`, `SizingSample`, `size_chart_views.py`)**:
  - `SizeChartRow`: OneToOne with `ProductVariant`. Stores `height_cm_min/max`, `weight_kg_min/max`, `shoulder_cm_min/max`, `chest_cm_min/max`, `length_cm`.
  - `SizingSample`: Anonymized training sample generated during fit data retention cleanup. Stores `product`, `month`, `student_class`, `height_cm`, `weight_kg`, `shoulder_cm`, `shoulder_confidence`, `recommended_size`, `chosen_size`, `final_size`, and `exchange_reason`.
  - `size_chart_views.py` & `size_chart_import.py`: Administrative APIs for CSV upload, validation, and CRUD operations on size charts.
- **`backend/orders` (OrderItem fit fields, `OrderItemExchange`, `fit_retention.py`)**:
  - `OrderItem`: Stores snapshot fit fields: `fit_height_cm`, `fit_weight_kg`, `fit_shoulder_cm`, `fit_shoulder_confidence`, `fit_source`, `fit_shoulder_edited`, `recommended_size`, `recommended_alt_size`, `recommendation_status`, `chosen_size`.
  - `OrderItemExchange`: Staff exchange records tracking `from_size`, `to_size`, `reason` (`TOO_SMALL`, `TOO_BIG`, `NOT_SIZE`).
  - `fit_retention.py`: `clear_fit_data()` executes retention policies (`FIT_DATA_RETENTION_DAYS` after completion or `FIT_DATA_BACKSTOP_DAYS`). Copies measurements to `SizingSample` without personal identifiers, then blanks `fit_height_cm`, `fit_weight_kg`, `fit_shoulder_cm` on `OrderItem`.
- **`backend/schools` (`StudentMeasurement`)**:
  - Stores child measurements: `height_cm`, `weight_kg`, `shoulder_cm`, `shoulder_confidence`, `source` (`CAMERA` / `MANUAL`), `shoulder_edited`. Scoped by school and parent, purged after `MEASUREMENT_RETENTION_DAYS`.
- **Documentation & Calibration**:
  - `docs/fit-sizing-and-face-photo-plan.md`: Master architecture plan separating Track A (on-device photo sizing) from Track B (face photos for ID cards).
  - `docs/shoulder-calibration.md`: Tape check comparisons highlighting how tape measurements vary on heavy builds.
  - `scripts/fit_shoulder_curve.py`: Pure Python standard library implementation of Ordinary Least Squares (solving normal equations via Gaussian elimination) for mass-correction curves.
- **Backend Settings (`backend/config/settings.py`)**:
  - `FIT_DATA_RETENTION_DAYS = 90`
  - `FIT_DATA_BACKSTOP_DAYS = 180`
  - `MEASUREMENT_RETENTION_DAYS = 365`
  - `FIT_USE_SHOULDER = False` (defaults to False; shoulder width only changes recommendations when explicitly enabled)
  - `FIT_SHOULDER_MIN_CONFIDENCE = 0.6`
  - `SHOULDER_CALIBRATION_FACTOR = 1.0`
  - `PHOTO_RETENTION_DAYS = 30`

---

### 7. How Sizing is Recommended Today

#### The Recommendation Process
- **Endpoint**: `POST /api/public/size-fit/`
- **Request Payload**:
  ```json
  {
    "products": ["<product-uuid>", "..."],
    "height_cm": 135.0,
    "weight_kg": 30.0,
    "class": "Class 4",
    "shoulder_cm": 31.5,
    "shoulder_confidence": 0.85
  }
  ```
- **Validation**:
  - `validate_fit` in `backend/catalog/sizing.py` checks hard limits (`HEIGHT_MIN/MAX`: 80–200 cm, `WEIGHT_MIN/MAX`: 10–120 kg, `SHOULDER_MIN/MAX`: 20–60 cm).
  - Generates advisory warnings for unusual height/weight compared to typical class age or BMI outside 10–40.
- **Recommendation Algorithm (`recommend_size` in `backend/catalog/sizing.py`)**:
  1. **Height First**: Identifies candidate chart rows where `height_cm_min <= height_cm <= height_cm_max`. If outside the entire chart, returns `BELOW_CHART` or `ABOVE_CHART`. In gaps between sizes, identifies the bounding sizes as `BETWEEN`.
  2. **Weight Refinement**: Discards candidates where the child's weight exceeds `weight_kg_max` (`_heavier_than`). If all candidates are discarded because the child is heavier, offers the next size up.
  3. **Multi-Size Fit**: When multiple rows fit, selects the two rows whose height range midpoint is closest to the child, returning status `BETWEEN` with the larger size listed first (room to grow).
  4. **Single-Size Fit**: If exactly one candidate remains, returns status `FIT` with that size.
- **Shoulder Measurement Handling**:
  - If `FIT_USE_SHOULDER` is `True` AND `shoulder_cm` is provided AND `shoulder_confidence >= FIT_SHOULDER_MIN_CONFIDENCE` (0.6):
    - `refine_with_shoulder` is invoked. If the recommendation is `BETWEEN`, it checks if the shoulder fits exactly one of the two sizes and narrows the suggestion to `FIT`. If the recommendation is `FIT` and the shoulder exceeds `shoulder_cm_max`, it expands to `BETWEEN` offering the next size up.
- **When There is No Shoulder Measurement**:
  - `refine_with_shoulder` is completely bypassed.
  - Sizing is determined purely from height and weight against the size chart.
  - **There is currently no shoulder estimation from height + weight.** If the parent does not take a camera or tape measurement, shoulder width remains `None`, and no shoulder range or confidence is generated.

---

### 8. Training Data Availability Counts

A database audit of the development database (`backend/dev_db.sqlite3`) yielded the following row counts:

| Model / Category | Condition / Filter | Count | Notes |
|---|---|:---:|---|
| **SizeChartRow** | Total rows | **12** | 6 for `UDG-SHIRT`, 6 for `UDG-TRS` |
| **SizeChartRow** | Both height & shoulder ranges | **6** | All 6 rows belong to `UDG-SHIRT` (sizes 26, 28, 30, 32, 34, 36) |
| **SizeChartRow** | By Gender | **6 unisex** | Products have `gender='unisex'`. (Boys: 0, Girls: 0) |
| **SizingSample** | Total rows | **0** | Populated only after order retention cleanup runs |
| **SizingSample** | Height, weight & shoulder | **0** | No historical samples exist in dev DB |
| **StudentMeasurement** | Total rows | **0** | No live measurements recorded in dev DB |
| **StudentMeasurement** | Height, weight & shoulder | **0** | Split by source: `CAMERA`: 0, `MANUAL`: 0 |
| **StudentMeasurement** | By Gender | **0** | No rows stored |

*Implication for Prompt 7:* The initial shoulder estimation model must rely on the pseudo-samples generated from `SizeChartRow` entries with shoulder ranges (weight 0.3) until real student measurements accumulate.

---

### 9. Return / Exchange and Fit-Feedback Data in Orders

- **Existing Exchange Model**: `OrderItemExchange` in `backend/orders/models.py`.
  - Fields:
    - `order_item` (ForeignKey to `OrderItem`, `related_name="exchanges"`)
    - `from_size` (CharField, 50 chars, original size)
    - `to_size` (CharField, 50 chars, replacement size)
    - `reason` (CharField, choices: `TOO_SMALL`, `TOO_BIG`, `NOT_SIZE`)
    - `note` (TextField, optional staff notes)
    - `created_by` (ForeignKey to User, staff member recording exchange)
    - `created_at` (DateTimeField)
- **Derived / Historical Fields**:
  - `OrderItem.current_size`: Returns the latest exchange's `to_size`, or `chosen_size`/`variant.size`.
  - `SizingSample.final_size`: Preserves the retained size after all exchanges.
  - `SizingSample.exchange_reason`: Preserves `TOO_SMALL` / `TOO_BIG` / `NOT_SIZE`.
- **Customer Fit-Feedback (Post-Delivery)**:
  - **None**. There is currently no customer-facing fit survey model or fields (e.g. `fit_feedback`, `answered_at`) on `OrderItem` for parents to report "Too tight / Fits well / Too loose" 5 days post-delivery.

---

## Gaps (What Prompts 2 to 9 Must Add)

- **Prompt 2 (Bundle inside APK)**: Add `build:app` with `dist-app`, configure `capacitor.config.json` with `webDir: "dist-app"`, set absolute `VITE_API_URL`, allow `https://localhost` in CORS/CSRF, lazy-load MediaPipe assets from CDN, and handle external links via Browser plugin.
- **Prompt 3 (Native navigation)**: Add 4-tab parent bottom bar (`Shop`, `Orders`, `Measure`, `Profile`), hardware back button double-tap exit, slide/fade page transitions, safe-area inset padding, and prevent mobile input auto-zoom (`>= 16px`).
- **Prompt 4 (Native touches)**: Integrate `@capacitor/haptics`, build custom pull-to-refresh for React Query, add `@capacitor/share` for lists/orders, add biometric fingerprint/face unlock, cache parent preferences, and implement backend app version update checking.
- **Prompt 5 (Push notifications)**: Add `@capacitor/push-notifications`, create backend `DeviceToken` model and registration endpoints with `firebase-admin`, and dispatch Celery notification tasks on order status changes.
- **Prompt 6 (Offline catalogue & cart)**: Add `@capacitor/network` status banner, persist React Query catalog cache up to 7 days, cache product images, preserve cart locally, and block offline checkout with re-validation upon reconnecting.
- **Prompt 7 (Shoulder estimator backend)**: Create `catalog/shoulder_estimate.py` with pure Python weighted least squares OLS, store versions in `ShoulderEstimateModel`, add `train_shoulder_model` management command, expose `POST /api/public/fit/estimate/` returning 80% confidence ranges, and add `ESTIMATE` to `OrderItem.fit_source`.
- **Prompt 8 (Size recommendation UI)**: Extend product sizing UI to auto-call estimate API on height/weight input, display High/Medium/Low confidence badges, pre-select recommended sizes, and provide camera/tape fallback options.
- **Prompt 9 (Learn from exchanges)**: Add `fit_feedback` and `answered_at` to `OrderItem`, prompt parents 5 days post-delivery via in-app banner/push, incorporate feedback into weekly model retraining and size-chart bias warnings, and build an admin accuracy dashboard.
