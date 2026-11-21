import { describe, it, expect, vi, beforeEach } from 'vitest';

// An outage is not a sign-out (review 2026-11-21, ported from the website line).
// The app keeps tokens in Capacitor Preferences; this in-memory stand-in plays that part.
const prefs = vi.hoisted(() => new Map<string, string>());

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefs.set(key, value); },
    remove: async ({ key }: { key: string }) => { prefs.delete(key); },
  },
}));
vi.mock('./native/nativePlatform', () => ({ isNativeApp: () => true }));
vi.mock('./native/push', () => ({ unregisterDeviceToken: vi.fn(async () => {}) }));

type ApiModule = typeof import('./api');

/** A fresh copy of api.ts each time, so the token cache and the sign-out latch start clean. */
async function freshApi(): Promise<ApiModule> {
  vi.resetModules();
  return import('./api');
}

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('signing out only when the server refuses the sign-in', () => {
  beforeEach(() => {
    prefs.clear();
    prefs.set('access', 'synthetic-access');
    prefs.set('refresh', 'synthetic-refresh');
    vi.stubGlobal('window', { location: { href: '', pathname: '/parent' } });
  });

  it('keeps the tokens when the refresh request cannot reach the server', async () => {
    const api = await freshApi();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(401))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.api('/auth/me/')).rejects.toBeInstanceOf(TypeError);
    expect(prefs.get('access')).toBe('synthetic-access');
    expect(prefs.get('refresh')).toBe('synthetic-refresh');
    expect(window.location.href).toBe('');
  });

  it('keeps the tokens when the server is down (5xx on refresh)', async () => {
    const api = await freshApi();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(502)));

    const err: unknown = await api.api('/auth/me/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(api.ApiError);
    expect((err as InstanceType<ApiModule['ApiError']>).status).toBe(502);
    expect(api.isRefusedSession(err)).toBe(false);
    expect(prefs.get('refresh')).toBe('synthetic-refresh');
    expect(window.location.href).toBe('');
  });

  it('signs out when the refresh token is refused, and sends a parent to the store', async () => {
    const api = await freshApi();
    api.rememberSignedInRole('PARENT');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(401)));

    await expect(api.api('/auth/me/')).rejects.toBeInstanceOf(api.ApiError);
    expect(prefs.has('access')).toBe(false);
    expect(prefs.has('refresh')).toBe(false);
    expect(window.location.href).toBe('/');
  });

  it('runs sign-out once even when called twice', async () => {
    const api = await freshApi();
    const push = await import('./native/push');
    vi.mocked(push.unregisterDeviceToken).mockClear();
    api.rememberSignedInRole('PARENT');

    await Promise.all([api.logout(), api.logout()]);
    expect(push.unregisterDeviceToken).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/');
  });
});

describe('isRefusedSession', () => {
  it('treats only 401 and a refused refresh token as the end of the sign-in', async () => {
    const api = await freshApi();
    expect(api.isRefusedSession(new api.SessionExpired())).toBe(true);
    expect(api.isRefusedSession(new api.ApiError('Expired', 401))).toBe(true);
    expect(api.isRefusedSession(new api.ApiError('Bad gateway', 502))).toBe(false);
    expect(api.isRefusedSession(new api.ApiError('Forbidden', 403))).toBe(false);
    expect(api.isRefusedSession(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('pageAfterSignOut', () => {
  it('sends parents to the store and staff to the staff sign-in page', async () => {
    const api = await freshApi();
    expect(api.pageAfterSignOut('PARENT', '/school')).toBe('/');
    expect(api.pageAfterSignOut('TEACHER', '/parent')).toBe('/login');
    // Role not known yet (expired before the app learnt who it was): go by the page
    expect(api.pageAfterSignOut(null, '/parent/orders')).toBe('/');
    expect(api.pageAfterSignOut(null, '/school/students')).toBe('/login');
    expect(api.pageAfterSignOut(null, '/schools')).toBe('/');
  });
});
