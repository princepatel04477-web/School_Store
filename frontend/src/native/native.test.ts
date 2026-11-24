import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isNativeApp, getRemoteMediaPipePath } from './nativePlatform';
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
