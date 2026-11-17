import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from '../api';
import { isNativeApp } from './nativePlatform';

const DEVICE_TOKEN_KEY = 'fcm_device_token';
const PUSH_PROMPTED_KEY = 'push_permission_prompted';

let pushInitialized = false;

/**
 * Initialize Push Notification listeners. Runs only on native Android/iOS.
 */
export async function initPushNotifications(onOpenOrder?: (orderId: string) => void): Promise<void> {
  if (!isNativeApp() || pushInitialized) return;
  pushInitialized = true;

  try {
    // Tapping a notification opens order detail
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const orderId = action.notification?.data?.order_id;
      if (orderId && onOpenOrder) {
        onOpenOrder(String(orderId));
      }
    });

    // Successfully received device FCM token
    await PushNotifications.addListener('registration', async (token) => {
      if (token?.value) {
        await registerDeviceToken(token.value);
      }
    });

    // Registration error listener
    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('FCM registration error:', err);
    });

    // Check if permission is already granted; if so, register to keep token fresh
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'granted') {
      await PushNotifications.register();
    }
  } catch (err) {
    console.warn('Error setting up push notifications:', err);
  }
}

/**
 * Ask push permission ONLY after the first order is placed (Android 13+ POST_NOTIFICATIONS).
 * Never prompted on first app launch.
 */
export async function requestPushPermissionAfterOrder(): Promise<boolean> {
  if (!isNativeApp()) return false;

  try {
    const { value: alreadyPrompted } = await Preferences.get({ key: PUSH_PROMPTED_KEY });
    const currentStatus = await PushNotifications.checkPermissions();

    if (currentStatus.receive === 'granted') {
      await PushNotifications.register();
      return true;
    }

    if (currentStatus.receive === 'prompt' || !alreadyPrompted) {
      await Preferences.set({ key: PUSH_PROMPTED_KEY, value: 'true' });
      const requested = await PushNotifications.requestPermissions();
      if (requested.receive === 'granted') {
        await PushNotifications.register();
        return true;
      }
    }
  } catch (err) {
    console.warn('Could not request push notification permission:', err);
  }
  return false;
}

/**
 * Send device token to backend for the currently authenticated user.
 */
export async function registerDeviceToken(token: string): Promise<void> {
  if (!isNativeApp() || !token) return;

  try {
    await Preferences.set({ key: DEVICE_TOKEN_KEY, value: token });
    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    await api('/devices/', {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    });
  } catch (err) {
    console.warn('Failed to register device token with backend:', err);
  }
}

/**
 * Unregister device token with backend on logout.
 */
export async function unregisterDeviceToken(): Promise<void> {
  if (!isNativeApp()) return;

  try {
    const { value: token } = await Preferences.get({ key: DEVICE_TOKEN_KEY });
    if (token) {
      await api('/devices/', {
        method: 'DELETE',
        body: JSON.stringify({ token }),
      }).catch(() => {});
      await Preferences.remove({ key: DEVICE_TOKEN_KEY });
    }
  } catch (err) {
    console.warn('Failed to unregister device token:', err);
  }
}

/**
 * Update user's push notification preference on the backend.
 */
export async function updateOrderNotificationPreference(enabled: boolean): Promise<boolean> {
  try {
    await api('/auth/me/', {
      method: 'PATCH',
      body: JSON.stringify({ notify_order_updates: enabled }),
    });
    return true;
  } catch (err) {
    console.warn('Failed to update notification preferences:', err);
    return false;
  }
}
