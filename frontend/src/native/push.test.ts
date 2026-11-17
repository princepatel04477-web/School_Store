import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    checkPermissions: vi.fn(async () => ({ receive: 'prompt' })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    register: vi.fn(async () => {}),
  },
}));

vi.mock('../api', () => ({
  api: vi.fn(async () => ({ ok: true })),
}));

import {
  initPushNotifications,
  requestPushPermissionAfterOrder,
  registerDeviceToken,
  unregisterDeviceToken,
} from './push';

describe('Push Notifications Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('safely no-ops in web browser environment', async () => {
    const callback = vi.fn();
    await initPushNotifications(callback);
    const requested = await requestPushPermissionAfterOrder();
    expect(requested).toBe(false);
  });

  it('does not send register request when on web', async () => {
    const { api } = await import('../api');
    await registerDeviceToken('mock-fcm-token-123');
    expect(api).not.toHaveBeenCalled();
  });

  it('does not fail when unregistering token on web', async () => {
    await expect(unregisterDeviceToken()).resolves.toBeUndefined();
  });
});
