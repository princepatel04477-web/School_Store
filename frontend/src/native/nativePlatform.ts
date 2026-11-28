import { Capacitor } from '@capacitor/core';

/**
 * Returns true only when running inside the native Android/iOS Capacitor app shell.
 * False on the website and mobile web browsers.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Live site origin for remote assets (e.g. MediaPipe wasm/model files)
 * that are omitted from the native APK bundle to keep APK size under 15 MB.
 */
export const REMOTE_ASSET_BASE = 'https://school-store.aqualite.workers.dev';

export function getRemoteMediaPipePath(relativePath: string): string {
  return `${REMOTE_ASSET_BASE}${relativePath}`;
}

/**
 * Returns the public website origin for shared links.
 * In the native app (Capacitor), window.location.origin is https://localhost,
 * so we must return REMOTE_ASSET_BASE instead of localhost.
 */
export function getShareOrigin(): string {
  if (isNativeApp() || typeof window === 'undefined' || !window.location?.origin) {
    return REMOTE_ASSET_BASE;
  }
  return window.location.origin;
}
