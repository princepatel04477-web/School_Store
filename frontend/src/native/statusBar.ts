import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/** Status bar colours: the emerald top bar everywhere, the same emerald on home. */
export const STATUS_BAR_DEFAULT = '#0E5E3E';
export const STATUS_BAR_HOME = '#0E5E3E';

export async function setupNativeStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setBackgroundColor({ color: STATUS_BAR_DEFAULT });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    // Graceful fallback if StatusBar plugin fails or runs on web
  }
}

/** Matches the status bar to the screen below it (emerald on home, brand green elsewhere). */
export async function setNativeStatusBarColor(color: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setBackgroundColor({ color });
  } catch {
    // The status bar keeps its previous colour.
  }
}
