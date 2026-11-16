# School Store Android app (APK): walkthrough

## What it is
A Capacitor 6 Android app that opens the live store, `https://school-store.aqualite.workers.dev`, inside a native
WebView. The UI, data, cart and checkout are exactly the website, and every website deploy updates the app too
(no new APK needed for UI changes).

- Package: `com.colorbenz.schoolstore`, label "School Store", version 1.0 (code 1)
- Android 7.0+ (minSdk 24), targetSdk 34
- Permissions: INTERNET, CAMERA (photo measurement: `getUserMedia` and `<input capture>`)
- Icon: the site's "S" mark (from `frontend/public/favicon.svg`) as an adaptive vector icon on #2F5D50,
  with a themed (monochrome) variant for Android 13+
- Splash and status bar: #2F5D50
- Offline: if the site can't load, a local "You're offline" page (`frontend/android-shell/offline.html`) with a retry button
- Back button: goes back in the web history; exits only on the first page (default `@capacitor/app` behaviour)

## Files
- `frontend/capacitor.config.json`: app id, live URL, offline page, splash and status bar
- `frontend/android-shell/`: tiny bundled web folder (redirect page + offline page); the full React build is NOT bundled
- `frontend/android/`: generated Android project, customised by `frontend/android-setup.ps1`
- `frontend/android/app/src/main/res/drawable/ic_launcher_s.xml`: the "S" icon as a vector
- `frontend/package.json`: adds `@capacitor/core|android|app|splash-screen|status-bar@6` and `@capacitor/cli@6`

## Rebuild the APK (Windows, PowerShell)
```powershell
cd frontend
npm ci
npx cap sync android
powershell -ExecutionPolicy Bypass -File .\android-setup.ps1   # only after `npx cap add android` regenerates the project
cd android
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
.\gradlew.bat assembleDebug
# result: frontend\android\app\build\outputs\apk\debug\app-debug.apk
```
Needs JDK 17 and Android SDK platform 34 + build-tools 34 (`sdkmanager "platforms;android-34" "build-tools;34.0.0"`).

## Install on a phone
Copy `dist-apk\school-store-debug.apk` to the phone and open it (allow "install unknown apps"), or with USB debugging:
`adb install -r dist-apk\school-store-debug.apk`.

## Not done yet (needed before the Play Store)
1. **Release signing**: create an upload keystore (keep it out of git) and build `assembleRelease` / `bundleRelease` (AAB).
2. **Legacy launcher icon on Android 7.0 to 7.1** still shows the Capacitor default PNG; Android 8+ shows the "S" icon.
3. **Store listing**: privacy policy URL (the app uses the camera), screenshots, content rating.
4. **Real-device test** of camera measurement and Razorpay checkout inside the app.

## Verification done
- `gradlew assembleDebug`: BUILD SUCCESSFUL
- `aapt dump badging`: package com.colorbenz.schoolstore, sdkVersion 24, targetSdk 34, permissions INTERNET + CAMERA, label "School Store"
- APK size 3.5 MB
