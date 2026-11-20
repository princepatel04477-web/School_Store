/**
 * What this phone or browser is allowed to remember.
 *
 * Rule from the client: someone who is not signed in leaves nothing behind. No school,
 * class, bag, size answer, language or half-placed order is written to the browser or the
 * app on disk, so opening the site or app again always starts clean.
 *
 * Only a signed-in parent's bag, language and pending order are kept on the device, and
 * `purgeSavedData` deletes all of it on sign-out. The sign-in tokens themselves live in
 * `api.ts` and are the only thing that marks someone as signed in.
 *
 * The chosen school, class, boy/girl and size answers are never written to disk at all,
 * signed in or not. They live in memory for the open page only.
 */

const ACCESS_KEY = 'access';

/** Every key this site ever wrote, including ones from earlier versions. Not the sign-in tokens. */
const SAVED_KEYS = [
  'schoolstore_cart',
  'schoolstore_active_selection',
  'schoolstore_lang',
  'schoolstore_pending_order',
  'schoolstore_fit',
  'schoolstore_welcome_seen',
  'school_store_selection_flow',
  'school_store_stationery_prompt_dismissed',
  'schoolstore_stationery_asked',
];

export function isSignedIn(): boolean {
  try {
    return Boolean(localStorage.getItem(ACCESS_KEY));
  } catch {
    return false;
  }
}

/** Reads a saved value, but only for a signed-in parent. */
export function readSaved(key: string): string | null {
  if (!isSignedIn()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves a value, but only for a signed-in parent. A guest's value stays in memory. */
export function writeSaved(key: string, value: string): void {
  if (!isSignedIn()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked or full: it lasts until the page closes
  }
}

export function removeSaved(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing saved
  }
}

/** Deletes everything remembered on this device except the sign-in tokens. */
export function purgeSavedData(): void {
  for (const key of SAVED_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // storage blocked
    }
    try {
      sessionStorage.removeItem(key);
    } catch {
      // storage blocked
    }
  }
}

// A guest, or an old install with leftovers from earlier versions: wipe it before anything
// reads it. This module is imported ahead of every store that loads saved data.
if (!isSignedIn()) purgeSavedData();
