import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const haptic = {
  impactLight: async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Ignored if device lacks vibration hardware
    }
  },

  impactMedium: async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {}
  },

  success: async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {}
  },

  warning: async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch {}
  },

  error: async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch {}
  },
};
