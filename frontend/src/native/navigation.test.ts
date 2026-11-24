import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleNativeBack, resetLastBackPressedTime, type BackButtonContext } from './backButton';
import { setupNativeKeyboard } from './keyboard';
import { setupNativeStatusBar } from './statusBar';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(),
    exitApp: vi.fn(),
  },
}));

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
    setStyle: vi.fn().mockResolvedValue(undefined),
    setOverlaysWebView: vi.fn().mockResolvedValue(undefined),
  },
  Style: {
    Dark: 'DARK',
    Light: 'LIGHT',
    Default: 'DEFAULT',
  },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    setResizeMode: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockReturnValue(Promise.resolve({ remove: vi.fn() })),
  },
  KeyboardResize: {
    Body: 'body',
    Native: 'native',
    None: 'none',
    Ionic: 'ionic',
  },
}));

describe('Prompt 3: Native Navigation & Back Button Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLastBackPressedTime();
  });

  it('closes open modal first if closeModals returns true', () => {
    const onGoBack = vi.fn();
    const closeModals = vi.fn().mockReturnValue(true);

    const ctx: BackButtonContext = {
      canGoBack: true,
      onGoBack,
      isTabRoot: false,
      isShopTab: false,
      onSwitchToShop: vi.fn(),
      showExitToast: vi.fn(),
      closeModals,
    };

    handleNativeBack(ctx);
    expect(closeModals).toHaveBeenCalledTimes(1);
    expect(onGoBack).not.toHaveBeenCalled();
  });

  it('navigates back within current tab if not tab root', () => {
    const onGoBack = vi.fn();

    const ctx: BackButtonContext = {
      canGoBack: true,
      onGoBack,
      isTabRoot: false,
      isShopTab: false,
      onSwitchToShop: vi.fn(),
      showExitToast: vi.fn(),
    };

    handleNativeBack(ctx);
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it('switches to shop tab if at tab root of non-shop tab', () => {
    const onSwitchToShop = vi.fn();

    const ctx: BackButtonContext = {
      canGoBack: false,
      onGoBack: vi.fn(),
      isTabRoot: true,
      isShopTab: false,
      onSwitchToShop,
      showExitToast: vi.fn(),
    };

    handleNativeBack(ctx);
    expect(onSwitchToShop).toHaveBeenCalledTimes(1);
  });

  it('shows exit toast on first press at shop tab root', () => {
    const showExitToast = vi.fn();

    const ctx: BackButtonContext = {
      canGoBack: false,
      onGoBack: vi.fn(),
      isTabRoot: true,
      isShopTab: true,
      onSwitchToShop: vi.fn(),
      showExitToast,
    };

    handleNativeBack(ctx);
    expect(showExitToast).toHaveBeenCalledWith('Press back again to exit');
    expect(CapApp.exitApp).not.toHaveBeenCalled();
  });

  it('exits app on double back within 2 seconds at shop tab root', () => {
    const showExitToast = vi.fn();

    const ctx: BackButtonContext = {
      canGoBack: false,
      onGoBack: vi.fn(),
      isTabRoot: true,
      isShopTab: true,
      onSwitchToShop: vi.fn(),
      showExitToast,
    };

    // First press sets timestamp
    handleNativeBack(ctx);
    // Second press immediately after (< 2000ms)
    handleNativeBack(ctx);

    expect(CapApp.exitApp).toHaveBeenCalledTimes(1);
  });

  it('configures status bar on native platform', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    await setupNativeStatusBar();
    expect(StatusBar.setBackgroundColor).toHaveBeenCalledWith({ color: '#2F5D50' });
    expect(StatusBar.setStyle).toHaveBeenCalledWith({ style: Style.Dark });
  });

  it('configures keyboard resize mode and registers show/hide listeners on native', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const onVisibility = vi.fn();

    const cleanup = await setupNativeKeyboard(onVisibility);
    expect(Keyboard.setResizeMode).toHaveBeenCalledWith({ mode: KeyboardResize.Body });
    expect(Keyboard.addListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
    expect(Keyboard.addListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
    expect(typeof cleanup).toBe('function');
  });
});
