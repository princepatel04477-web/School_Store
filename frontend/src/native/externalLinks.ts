import { Browser } from '@capacitor/browser';
import { isNativeApp } from './nativePlatform';

/**
 * Opens an external URL in the system browser or Capacitor in-app browser sheet.
 * Prevents opening outside links inside the application WebView on native platforms.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  if (isNativeApp()) {
    try {
      await Browser.open({ url });
      return;
    } catch {
      // Fallback to window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
