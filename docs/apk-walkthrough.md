# School Store Android app (APK): walkthrough

## What it is
A Capacitor 6 Android app that packages the full React frontend (`dist-app/`) directly inside the native APK (`android/app/src/main/assets/public`).
The UI loads instantly from local assets without waiting for network. API requests are routed to the remote production backend at `https://school-store.aqualite.workers.dev/api`.

- Package: `com.colorbenz.schoolstore`, label "School Store", version 1.0 (code 1)
- Android 7.0+ (minSdk 24), targetSdk 34
- Permissions: INTERNET, CAMERA (photo measurement: `getUserMedia` and `<input capture>`)
- Icon: Adaptive vector icon on #2F5D50 with themed monochrome variant for Android 13+
- Splash & status bar: #2F5D50 branding
- Offline resilience: Dedicated in-app offline view with auto-retry and connectivity monitoring
- Back button: Managed via `@capacitor/app` with predictable stack navigation and double-tap exit prevention
- Architecture: Bundled local frontend (`dist-app`), remote API (`VITE_API_URL`), remote MediaPipe models loaded on demand to keep APK size < 15 MB (actual ~6.9 MB)
- Token Storage: Native `@capacitor/preferences` on Android / iOS with fallback to `localStorage` on web browsers

## Files and Directories
- `frontend/capacitor.config.json`: Capacitor configuration with `webDir: "dist-app"`, `SplashScreen` configuration, and `androidScheme: "https"`.
- `frontend/src/native/`: Native platform abstraction layer:
  - `nativePlatform.ts`: `isNativeApp()` check and MediaPipe asset resolution.
  - `externalLinks.ts`: `openExternalUrl()` using `@capacitor/browser`.
  - `splash.ts`: Splash screen hide orchestration.
- `frontend/src/components/native/OfflineScreen.tsx`: React offline screen displayed when the device is disconnected.
- `frontend/src/api.ts`: Centralized `toUrl()` API routing and native `@capacitor/preferences` JWT token management.
- `frontend/src/auth.tsx`: Asynchronous token hydration and logout supporting native preferences.
- `dist-apk/`: Compiled Android packages (`school-store-debug.apk`).

## Build the APK (Windows, PowerShell)
```powershell
cd frontend
npm ci

# 1. Build optimized React assets for native app into dist-app/
npm run build:app

# 2. Sync web assets and plugins to native Android project
npx cap sync android

# 3. Compile the debug APK
cd android
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
.\gradlew.bat assembleDebug
```

The resulting debug APK is located at:
`frontend/android/app/build/outputs/apk/debug/app-debug.apk` (and copied to `dist-apk/school-store-debug.apk`).

## Bundled Asset Architecture & Size Optimization
1. **Local Assets**: All compiled HTML, CSS, JavaScript chunks, fonts, and SVGs are bundled into `dist-app/` and copied to `android/app/src/main/assets/public`.
2. **MediaPipe Remote Loading**: Large MediaPipe WASM and pose landmark binaries (~12 MB) are excluded from `dist-app/` during `npm run build:app` via a custom Vite plugin. On native platforms, `getRemoteMediaPipePath()` loads these assets from the remote worker on-demand, keeping the APK under 7 MB.
3. **CORS & Origin Configuration**: Requests from WebView originate from `https://localhost`. Both Django (`settings.py`) and Cloudflare Worker (`worker/index.js`) allow CORS origins `https://localhost` and `capacitor://localhost`.

## Verification
- `npm run build:app`: Successful, `dist-app` is ~4.4 MB (without MediaPipe).
- `gradlew assembleDebug`: BUILD SUCCESSFUL.
- Final APK Size: 6.94 MB (< 15 MB limit).
- Web storefront: Preserved with full backward compatibility via `isNativeApp()` guards.
