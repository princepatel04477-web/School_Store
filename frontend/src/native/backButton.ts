import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

let lastBackPressedTime = 0;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export interface BackButtonContext {
  canGoBack: boolean;
  onGoBack: () => void;
  isTabRoot: boolean;
  isShopTab: boolean;
  onSwitchToShop: () => void;
  showExitToast: (msg: string) => void;
  closeModals?: () => boolean; // returns true if a modal was closed
  /** Steps back inside the page (shop: school > city > state, items > class); true if it did. */
  pageBack?: () => boolean;
}

export function handleNativeBack(ctx: BackButtonContext): void {
  // 1. If a modal/drawer is open, dismiss it first
  if (ctx.closeModals && ctx.closeModals()) {
    return;
  }

  // 1b. A page with its own steps goes back one step before leaving
  if (ctx.pageBack && ctx.pageBack()) {
    return;
  }

  // 2. If inner screen in current tab, go back
  if (ctx.canGoBack && !ctx.isTabRoot) {
    ctx.onGoBack();
    return;
  }

  // 3. If at root of a tab other than Shop, switch to Shop tab
  if (!ctx.isShopTab) {
    ctx.onSwitchToShop();
    return;
  }

  // 4. If at Shop root, double back within 2s to exit
  const now = Date.now();
  if (now - lastBackPressedTime < 2000) {
    if (toastTimeout) clearTimeout(toastTimeout);
    lastBackPressedTime = 0;
    CapApp.exitApp();
  } else {
    lastBackPressedTime = now;
    ctx.showExitToast('Press back again to exit');
  }
}

export function resetLastBackPressedTime(): void {
  lastBackPressedTime = 0;
}

export function setupNativeBackButton(getContext: () => BackButtonContext): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  const listener = CapApp.addListener('backButton', () => {
    const ctx = getContext();
    handleNativeBack(ctx);
  });

  return () => {
    listener.then((h) => h.remove()).catch(() => {});
  };
}
