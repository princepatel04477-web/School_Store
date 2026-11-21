import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { isNativeApp, getRemoteMediaPipePath, getShareOrigin, REMOTE_ASSET_BASE } from './nativePlatform';
import { toUrl, getStoredToken, setStoredTokens, clearStoredTokens } from '../api';
import { openExternalUrl } from './externalLinks';

class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new MockStorage();
// @ts-expect-error test mock
globalThis.localStorage = mockStorage;

describe('native utilities', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('isNativeApp reports false in browser/test environment', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('getRemoteMediaPipePath prefixes relative path with remote CDN origin', () => {
    const p = getRemoteMediaPipePath('/mediapipe/wasm');
    expect(p).toBe('https://school-store.aqualite.workers.dev/mediapipe/wasm');
  });

  it('getShareOrigin returns window.location.origin on web and REMOTE_ASSET_BASE on native app', () => {
    // Web environment:
    const origin = getShareOrigin();
    expect(origin).toBe(typeof window !== 'undefined' && window.location?.origin ? window.location.origin : REMOTE_ASSET_BASE);

    // Mock Capacitor.isNativePlatform to true
    const spy = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    expect(getShareOrigin()).toBe(REMOTE_ASSET_BASE);
    spy.mockRestore();
  });

  it('toUrl correctly formats API URLs', () => {
    expect(toUrl('/schools/')).toContain('/schools/');
    expect(toUrl('/api/schools/')).toContain('/schools/');
  });

  it('manages auth tokens in storage on web platform', async () => {
    await setStoredTokens({ access: 'test_access_token', refresh: 'test_refresh_token' });
    expect(await getStoredToken('access')).toBe('test_access_token');
    expect(await getStoredToken('refresh')).toBe('test_refresh_token');

    await clearStoredTokens();
    expect(await getStoredToken('access')).toBeNull();
    expect(await getStoredToken('refresh')).toBeNull();
  });

  it('openExternalUrl opens window on web platform', async () => {
    const openMock = vi.fn();
    // @ts-expect-error test mock
    globalThis.window = { open: openMock };
    await openExternalUrl('https://wa.me/919999999999');
    expect(openMock).toHaveBeenCalledWith('https://wa.me/919999999999', '_blank', 'noopener,noreferrer');
  });
});
