import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export async function setupNativeStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setBackgroundColor({ color: '#2F5D50' });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    // Graceful fallback if StatusBar plugin fails or runs on web
  }
}
