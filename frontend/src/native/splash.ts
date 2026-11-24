import { SplashScreen } from '@capacitor/splash-screen';
import { isNativeApp } from './nativePlatform';

let splashHidden = false;

/**
 * Hides the native splash screen after the first paint of the React application.
 */
export function hideSplashScreen(): void {
  if (splashHidden || !isNativeApp()) return;
  splashHidden = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      SplashScreen.hide().catch(() => {});
    });
  });
}
