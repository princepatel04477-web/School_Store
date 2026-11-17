import { describe, it, expect, vi, beforeEach } from 'vitest';
import { haptic } from './haptics';
import { shareSchoolProducts, shareOrderDetails } from './share';
import { compareVersions, checkAppVersion, INSTALLED_APP_VERSION } from './appVersion';
import { saveLastSelection, getLastSelection, clearLastSelection } from './lastSelection';
import {
  isBiometricsEnabled,
  enableBiometrics,
  clearBiometrics,
  promptBiometricUnlock,
  recordBiometricCancellation,
  resetBiometricCancelCount,
} from './biometrics';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: {
    Light: 'LIGHT',
    Medium: 'MEDIUM',
    Heavy: 'HEAVY',
  },
  NotificationType: {
    Success: 'SUCCESS',
    Warning: 'WARNING',
    Error: 'ERROR',
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    canShare: vi.fn().mockResolvedValue({ value: true }),
    share: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockPreferencesStore: Record<string, string> = {};
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: mockPreferencesStore[key] || null,
    })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      mockPreferencesStore[key] = value;
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      delete mockPreferencesStore[key];
    }),
  },
}));

describe('Prompt 4: Native Touches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockPreferencesStore).forEach((k) => delete mockPreferencesStore[k]);
    resetBiometricCancelCount();
  });

  describe('Haptics (no-op on web, active on native)', () => {
    it('does nothing on web when isNativePlatform is false', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      await haptic.impactLight();
      await haptic.success();
      await haptic.warning();

      expect(Haptics.impact).not.toHaveBeenCalled();
      expect(Haptics.notification).not.toHaveBeenCalled();
    });

    it('triggers haptics on native platform', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      await haptic.impactLight();
      expect(Haptics.impact).toHaveBeenCalledWith({ style: ImpactStyle.Light });

      await haptic.success();
      expect(Haptics.notification).toHaveBeenCalledWith({ type: NotificationType.Success });

      await haptic.warning();
      expect(Haptics.notification).toHaveBeenCalledWith({ type: NotificationType.Warning });
    });
  });

  describe('Native Share', () => {
    it('shares school product list via @capacitor/share on native', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      await shareSchoolProducts('DPS Surat', 'https://school-store.aqualite.workers.dev/shop');

      expect(Share.share).toHaveBeenCalledWith({
        title: 'DPS Surat Uniforms & Books List',
        text: expect.stringContaining('DPS Surat'),
        url: 'https://school-store.aqualite.workers.dev/shop',
        dialogTitle: 'Share School List',
      });
    });

    it('shares order details with order number and total', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      await shareOrderDetails('ORD-999', 2450, 'https://school-store.aqualite.workers.dev/parent/orders');

      expect(Share.share).toHaveBeenCalledWith({
        title: 'School Store Order #ORD-999',
        text: expect.stringContaining('₹2450'),
        url: 'https://school-store.aqualite.workers.dev/parent/orders',
        dialogTitle: 'Share Order Details',
      });
    });
  });

  describe('Version Comparison', () => {
    it('correctly compares semantic versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
      expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
      expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
      expect(compareVersions('1.0.5', '1.1.0')).toBe(-1);
    });
  });

  describe('Preferences Persistence (School / Class / Gender)', () => {
    it('saves and restores last selected school and grade', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      await saveLastSelection({
        schoolId: 'sch-1',
        schoolName: 'Delhi Public School',
        classId: 'grade-5',
        className: '5',
        gender: 'MALE',
      });

      const restored = await getLastSelection();
      expect(restored).toEqual({
        schoolId: 'sch-1',
        schoolName: 'Delhi Public School',
        classId: 'grade-5',
        className: '5',
        gender: 'MALE',
      });

      await clearLastSelection();
      const afterClear = await getLastSelection();
      expect(afterClear).toBeNull();
    });
  });

  describe('Biometric Unlock Flow', () => {
    it('stores token on enable and clears on logout', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      expect(await isBiometricsEnabled()).toBe(false);

      await enableBiometrics('refresh-token-xyz');
      expect(await isBiometricsEnabled()).toBe(true);

      const token = await promptBiometricUnlock();
      expect(token).toBe('refresh-token-xyz');

      await clearBiometrics();
      expect(await isBiometricsEnabled()).toBe(false);
      expect(await promptBiometricUnlock()).toBeNull();
    });

    it('falls back to password after 3 consecutive cancellations', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      await enableBiometrics('secret-token');

      recordBiometricCancellation();
      recordBiometricCancellation();
      recordBiometricCancellation();

      const result = await promptBiometricUnlock();
      expect(result).toBeNull();
    });
  });
});
