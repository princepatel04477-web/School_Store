import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './nativePlatform';

/**
 * The phone app no longer remembers the school, class or boy/girl someone picked.
 * Opening the app always starts with nothing chosen, so saving is switched off and
 * anything saved by an earlier version is deleted.
 */
const KEY_LAST_SELECTION = 'schoolstore_last_selection';

export interface SavedSelection {
  schoolId?: string;
  schoolName?: string;
  classId?: string;
  className?: string;
  gender?: string;
}

export async function saveLastSelection(_sel: SavedSelection): Promise<void> {
  // Deliberately saves nothing.
}

export async function getLastSelection(): Promise<SavedSelection | null> {
  return null;
}

export async function clearLastSelection(): Promise<void> {
  if (isNativeApp()) {
    try {
      await Preferences.remove({ key: KEY_LAST_SELECTION });
    } catch {}
  }
  try {
    localStorage.removeItem(KEY_LAST_SELECTION);
  } catch {}
}
