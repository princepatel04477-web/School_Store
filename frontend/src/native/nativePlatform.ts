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
