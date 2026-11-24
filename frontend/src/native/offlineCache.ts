import { Preferences } from '@capacitor/preferences';
import type { QueryClient, DehydratedState } from '@tanstack/react-query';
import { isNativeApp } from './nativePlatform';

export const CACHE_STORAGE_KEY = 'schoolstore_offline_query_cache_v1';
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Allowed catalogue query prefixes/keys
export const ALLOWED_QUERY_KEYS = [
  'schools',
  'school',
  'classes',
  'grades',
  'products',
  'product',
  'catalog',
  'categories',
  'size_chart',
  'size-chart',
  'uniform-items',
  'app-version',
];

// Strictly forbidden keys that MUST NEVER be persisted to disk
export const FORBIDDEN_QUERY_KEYS = [
  'auth',
  'token',
  'user',
  'me',
  'cart',
  'payment',
  'razorpay',
  'order',
  'orders',
  'measure',
  'measurement',
  'measurements',
  'photo',
  'photos',
  'student',
  'students',
  'consent',
];

/**
 * Validates whether a given query key is safe to persist offline.
 * Returns true only if it matches the allow-list AND contains zero forbidden keywords.
 */
export function isQueryKeyAllowed(queryKey: readonly unknown[] | unknown): boolean {
  if (!Array.isArray(queryKey) || queryKey.length === 0) {
    return false;
  }

  const keyParts = queryKey.map((k) => String(k).toLowerCase());
  const combined = keyParts.join('/');

  // If any forbidden keyword is found, strictly reject
  for (const forbidden of FORBIDDEN_QUERY_KEYS) {
    if (keyParts.some((p) => p.includes(forbidden)) || combined.includes(forbidden)) {
      return false;
    }
  }

  // Must match at least one allowed key pattern
  return keyParts.some((part) =>
    ALLOWED_QUERY_KEYS.some((allowed) => part.startsWith(allowed) || part === allowed)
  );
}

export interface SerializedQueryEntry {
  queryKey: readonly unknown[];
  data: unknown;
  updatedAt: number;
}

/**
 * Filter and serialize only allowed catalogue queries from the React Query cache.
 */
export function filterAllowedQueries(queryClient: QueryClient): SerializedQueryEntry[] {
  const cache = queryClient.getQueryCache();
  const allQueries = cache.getAll();
  const allowedEntries: SerializedQueryEntry[] = [];
  const now = Date.now();

  for (const q of allQueries) {
    if (isQueryKeyAllowed(q.queryKey) && q.state.data !== undefined) {
      allowedEntries.push({
        queryKey: q.queryKey,
        data: q.state.data,
        updatedAt: q.state.dataUpdatedAt || now,
      });
    }
  }

  return allowedEntries;
}

/**
 * Persists filtered catalogue cache to device storage.
 */
export async function persistOfflineCatalogue(queryClient: QueryClient): Promise<void> {
  try {
    const entries = filterAllowedQueries(queryClient);
    if (entries.length === 0) return;

    const payload = JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      entries,
    });

    if (isNativeApp()) {
      await Preferences.set({ key: CACHE_STORAGE_KEY, value: payload });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CACHE_STORAGE_KEY, payload);
    }
  } catch (err) {
    console.warn('Could not persist offline catalogue:', err);
  }
}

/**
 * Restores cached catalogue queries into QueryClient on boot.
 */
export async function restoreOfflineCatalogue(queryClient: QueryClient): Promise<number> {
  try {
    let raw: string | null = null;
    if (isNativeApp()) {
      const res = await Preferences.get({ key: CACHE_STORAGE_KEY });
      raw = res.value;
    } else if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(CACHE_STORAGE_KEY);
    }

    if (!raw) return 0;

    const parsed = JSON.parse(raw);
    const now = Date.now();

    // Check expiration (7 days)
    if (!parsed.savedAt || now - parsed.savedAt > CACHE_MAX_AGE_MS) {
      if (isNativeApp()) {
        await Preferences.remove({ key: CACHE_STORAGE_KEY });
      } else {
        localStorage.removeItem(CACHE_STORAGE_KEY);
      }
      return 0;
    }

    let restoredCount = 0;
    if (Array.isArray(parsed.entries)) {
      for (const entry of parsed.entries) {
        if (isQueryKeyAllowed(entry.queryKey) && entry.data !== undefined) {
          queryClient.setQueryData(entry.queryKey, entry.data, {
            updatedAt: entry.updatedAt || parsed.savedAt,
          });
          restoredCount++;
        }
      }
    }

    return restoredCount;
  } catch (err) {
    console.warn('Could not restore offline catalogue:', err);
    return 0;
  }
}
