import { api } from '../api';
import { isNativeApp } from './nativePlatform';

export interface AppVersionResponse {
  latest_version: string;
  latest_version_code: number;
  min_supported_version: string;
  min_supported_code: number;
  play_store_url: string;
  release_notes?: string;
}

export interface VersionCheckResult {
  isOutdated: boolean;
  forceUpdate: boolean;
  latestVersion: string;
  updateUrl: string;
  installedVersion: string;
}

export const INSTALLED_APP_VERSION = '1.0.0';
export const INSTALLED_VERSION_CODE = 1;

export function compareVersions(installed: string, required: string): number {
  const p1 = installed.split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = required.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const v1 = p1[i] || 0;
    const v2 = p2[i] || 0;
    if (v1 < v2) return -1;
    if (v1 > v2) return 1;
  }
  return 0;
}

export async function checkAppVersion(): Promise<VersionCheckResult> {
  if (!isNativeApp()) {
    return {
      isOutdated: false,
      forceUpdate: false,
      latestVersion: INSTALLED_APP_VERSION,
      updateUrl: '',
      installedVersion: INSTALLED_APP_VERSION,
    };
  }

  try {
    const data = await api<AppVersionResponse>('/public/app-version/');
    const installed = INSTALLED_APP_VERSION;
    const installedCode = INSTALLED_VERSION_CODE;

    const needsForceUpdate =
      installedCode < data.min_supported_code ||
      compareVersions(installed, data.min_supported_version) < 0;

    const isOutdated =
      needsForceUpdate ||
      installedCode < data.latest_version_code ||
      compareVersions(installed, data.latest_version) < 0;

    return {
      isOutdated,
      forceUpdate: needsForceUpdate,
      latestVersion: data.latest_version,
      updateUrl: data.play_store_url,
      installedVersion: installed,
    };
  } catch {
    // If offline or network error, allow app to open without blocking
    return {
      isOutdated: false,
      forceUpdate: false,
      latestVersion: INSTALLED_APP_VERSION,
      updateUrl: '',
      installedVersion: INSTALLED_APP_VERSION,
    };
  }
}
