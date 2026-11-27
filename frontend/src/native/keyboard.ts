import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';

export async function setupNativeKeyboard(
  onKeyboardVisibilityChange?: (visible: boolean) => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
  } catch {
    // Not supported or web fallback
  }

  const showSub = Keyboard.addListener('keyboardWillShow', () => {
    onKeyboardVisibilityChange?.(true);
  });
  const hideSub = Keyboard.addListener('keyboardWillHide', () => {
    onKeyboardVisibilityChange?.(false);
  });

  return () => {
    showSub.then((h) => h.remove()).catch(() => {});
    hideSub.then((h) => h.remove()).catch(() => {});
  };
}
