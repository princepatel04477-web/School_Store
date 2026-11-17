import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './nativePlatform';

const KEY_LAST_SELECTION = 'schoolstore_last_selection';

export interface SavedSelection {
  schoolId?: string;
  schoolName?: string;
  classId?: string;
  className?: string;
  gender?: string;
}

export async function saveLastSelection(sel: SavedSelection): Promise<void> {
  const data = JSON.stringify(sel);
  if (isNativeApp()) {
    try {
      await Preferences.set({ key: KEY_LAST_SELECTION, value: data });
      return;
    } catch {}
  }
  try {
    localStorage.setItem(KEY_LAST_SELECTION, data);
  } catch {}
}

export async function getLastSelection(): Promise<SavedSelection | null> {
  if (isNativeApp()) {
    try {
      const { value } = await Preferences.get({ key: KEY_LAST_SELECTION });
      if (value) {
        return JSON.parse(value);
      }
    } catch {}
  }
  try {
    const raw = localStorage.getItem(KEY_LAST_SELECTION);
    if (raw) return JSON.parse(raw);
  } catch {}
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
