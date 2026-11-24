# Task: build an Android APK of School Store (unattended run)

The owner is asleep. Do the whole task without waiting for approval. Still write the plan artifact first
(docs/apk-plan.md), then execute it, then write docs/apk-walkthrough.md.

## Hard rules (from docs/School-Store-Mobile.md, Prompt 0)
- Work only in this folder, on branch `draft-01`. Commit locally to `draft-01`. Do NOT push anything, and never touch `main`.
- Do not touch anything in Documents\antigravity workspaces or the other School_Store folders.
- The app must look and behave exactly like the current website. No redesign. Brand colour stays #2E8B57.
- Keep every business rule. Do not change the Django backend for this task.
- Do not put secrets, keystores with real passwords, local.properties or .env files into git.

## What to build
1. Read docs/School-Store-Mobile.md (Prompt 5) and frontend/ (React + Vite + TypeScript, Cloudflare Worker in frontend/worker).
2. Make the site a proper PWA as Prompt 5 describes: web app manifest (name "School Store", theme #2E8B57, standalone,
   192/512/maskable icons made from the existing logo), service worker via vite-plugin-pwa (network-first for /api,
   never cache cart/checkout/payment/login), iOS meta tags + apple-touch-icon, offline screen in the site's existing style.
3. Wrap it as an Android app with Capacitor (@capacitor/core, @capacitor/cli, @capacitor/android) inside frontend/:
   - appId: com.colorbenz.schoolstore, appName: School Store
   - The app must load the LIVE store so the UI and data are identical to the website:
     server.url = "https://school-store.aqualite.workers.dev", server.androidScheme = "https", cleartext false.
     Keep webDir = dist so an offline fallback page ships in the APK.
   - Status bar / splash colour #2E8B57, app icon from the existing logo (use @capacitor/assets if helpful).
   - Android back button navigates back in the web history; exits only on the home screen.
   - The store has camera/photo measurement features: add the CAMERA permission and make sure
     <input type=file capture> and getUserMedia work inside the WebView.
4. Build a debug APK:
   - Java 17 is installed. Android SDK is at %LOCALAPPDATA%\Android\Sdk (set ANDROID_HOME / sdk.dir in local.properties; do not commit local.properties).
   - cd frontend; npm ci; npm run build; npx cap sync android; cd android; .\gradlew.bat assembleDebug
   - Copy the result to <repo>\dist-apk\school-store-debug.apk (add dist-apk/ to .gitignore).
5. Verify: `npm run build` and the existing frontend tests (npx vitest run) still pass; the APK exists; run
   `aapt dump badging` (from the SDK build-tools) on it and record package name, version and permissions.
6. Commit to draft-01 with a clear message. Do not push.

## Report (docs/apk-walkthrough.md)
Files changed, exact commands to rebuild the APK, test results, APK path and size, and anything you could not do and why.
If something blocks the build (SDK licence, missing build-tools/platform, network), fix it if you safely can
(sdkmanager --licenses, install the needed platform/build-tools with sdkmanager); otherwise stop and write the exact blocker.
