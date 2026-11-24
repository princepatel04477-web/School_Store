Read the project and write docs/app-audit.md. Do not change any code in this task.

Part A: the Android app today
1. How frontend/capacitor.config.json, frontend/android-shell/ and frontend/android/ work now (the app loads the
   live site through server.url). List every Capacitor plugin installed and its version.
2. Every route and screen in frontend/src, grouped by role (parent, teacher, school, admin, boss). Mark the 4 to 5
   screens a parent uses most: these become the bottom tabs later.
3. How the frontend calls the API: base URL (VITE_API_URL), auth (SimpleJWT access/refresh, where tokens are
   stored), and which calls go to Django versus the Cloudflare Showcase fallback in frontend/worker/index.js.
4. What would break if the app loaded its own bundled files instead of the live URL: absolute API URL needed,
   CORS (backend CORS_ALLOWED_ORIGINS must allow https://localhost), cookies/CSRF, Razorpay checkout, camera
   measurement (frontend/src/measure), MediaPipe wasm files in frontend/public/mediapipe, links that open new tabs.
5. Anything that breaks or feels wrong at 390 x 844: tap targets under 44 px, horizontal scroll, inputs that zoom
   on focus, fixed elements hidden by the notch or the Android gesture bar.

Part B: sizing and fit today
6. Read and summarise: frontend/src/data/fit.ts, frontend/src/data/sizes.ts, frontend/src/components/fit/*,
   frontend/src/components/product/SizeSelector.tsx, SizeGuide.tsx, frontend/src/measure/*,
   backend/catalog (SizeChartRow, SizingSample, size_chart_import.py, size_chart_views.py),
   backend/orders (fit fields on OrderItem, fit_source, fit_retention.py), backend/schools (StudentMeasurement),
   docs/fit-sizing-and-face-photo-plan.md, docs/shoulder-calibration.md, scripts/fit_shoulder_curve.py,
   and the FIT_* / SHOULDER_* settings in backend/config/settings.py.
7. Answer exactly: how is a size recommended today from height + weight (+ shoulder if measured)? Which endpoint
   does it, what does it return, and what happens when there is no shoulder measurement?
8. Count the rows available for training a shoulder estimate: SizeChartRow rows with both height and shoulder
   ranges; SizingSample and StudentMeasurement rows with height, weight and shoulder (split by source:
   tape / camera / manual). Write the counts per gender if gender is stored. If no database is reachable, say
   which database you looked at (dev_db.sqlite3) and that production counts are unknown.
9. Is there any return/exchange or fit-feedback data (too tight / too loose) anywhere in orders? Name the model
   and fields, or write "none".

End the file with a short "Gaps" list: what Prompts 2 to 9 must add, in one line each.
Commit docs/app-audit.md.
