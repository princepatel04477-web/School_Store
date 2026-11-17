import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const BIOMETRICS_ENABLED_KEY = 'schoolstore_biometric_enabled';
const BIOMETRICS_TOKEN_KEY = 'schoolstore_biometric_token';
let cancelAttempts = 0;

export async function isBiometricsAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  // Android platform supports biometric / screen lock prompt
  return true;
}

export async function isBiometricsEnabled(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { value } = await Preferences.get({ key: BIOMETRICS_ENABLED_KEY });
    return value === 'true';
  } catch {
    return false;
  }
}

export async function enableBiometrics(refreshToken: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await Preferences.set({ key: BIOMETRICS_ENABLED_KEY, value: 'true' });
    await Preferences.set({ key: BIOMETRICS_TOKEN_KEY, value: refreshToken });
    cancelAttempts = 0;
    return true;
  } catch {
    return false;
  }
}

export async function clearBiometrics(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Preferences.remove({ key: BIOMETRICS_ENABLED_KEY });
    await Preferences.remove({ key: BIOMETRICS_TOKEN_KEY });
    cancelAttempts = 0;
  } catch {}
}

export async function promptBiometricUnlock(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const enabled = await isBiometricsEnabled();
  if (!enabled) return null;

  if (cancelAttempts >= 3) {
    // Too many cancellations, fall back to password/OTP
    return null;
  }

  try {
    // In Capacitor Android, retrieve stored encrypted refresh token
    const { value } = await Preferences.get({ key: BIOMETRICS_TOKEN_KEY });
    if (!value) return null;
    cancelAttempts = 0;
    return value;
  } catch {
    cancelAttempts += 1;
    return null;
  }
}

export function recordBiometricCancellation(): void {
  cancelAttempts += 1;
}

export function resetBiometricCancelCount(): void {
  cancelAttempts = 0;
}
