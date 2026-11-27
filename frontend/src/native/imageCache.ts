const CACHE_NAME = 'schoolstore-product-images-v1';
const INDEX_STORAGE_KEY = 'schoolstore_image_cache_index';
export const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB cap

export interface CacheEntry {
  url: string;
  size: number;
  lastAccessed: number;
}

/**
 * Loads the LRU metadata index from storage.
 */
export function loadImageIndex(): Record<string, CacheEntry> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(INDEX_STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Saves the LRU metadata index to storage.
 */
export function saveImageIndex(index: Record<string, CacheEntry>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(INDEX_STORAGE_KEY, JSON.stringify(index));
    }
  } catch (err) {
    console.warn('Failed to save image cache index:', err);
  }
}

/**
 * Calculates current total size of cached images in bytes.
 */
export function getTotalCacheSize(index: Record<string, CacheEntry>): number {
  return Object.values(index).reduce((acc, entry) => acc + (entry.size || 0), 0);
}

/**
 * Evicts oldest accessed image entries until total size + requiredBytes <= MAX_CACHE_BYTES.
 */
export async function evictOldestEntries(
  index: Record<string, CacheEntry>,
  requiredBytes: number,
  cache?: Cache
): Promise<Record<string, CacheEntry>> {
  const currentTotal = getTotalCacheSize(index);
  if (currentTotal + requiredBytes <= MAX_CACHE_BYTES) {
    return index;
  }

  // Sort entries by lastAccessed ascending (oldest first)
  const sorted = Object.values(index).sort((a, b) => a.lastAccessed - b.lastAccessed);
  let currentBytes = currentTotal;
  const newIndex = { ...index };

  for (const item of sorted) {
    if (currentBytes + requiredBytes <= MAX_CACHE_BYTES) {
      break;
    }
    delete newIndex[item.url];
    currentBytes -= item.size;

    if (cache) {
      await cache.delete(item.url).catch(() => {});
    }
  }

  return newIndex;
}

/**
 * Caches a product image response, updating the LRU index and respecting the 50 MB cap.
 */
export async function cacheProductImage(url: string, response: Response): Promise<void> {
  if (typeof caches === 'undefined' || !url || !response.ok) return;

  try {
    const cloned = response.clone();
    const blob = await cloned.blob();
    const imageSize = blob.size;

    if (imageSize > MAX_CACHE_BYTES) {
      return; // Image alone is larger than total budget
    }

    const cache = await caches.open(CACHE_NAME);
    let index = loadImageIndex();

    // Evict oldest if needed
    index = await evictOldestEntries(index, imageSize, cache);

    // Save cloned response into cache storage
    await cache.put(url, response);

    // Update index
    index[url] = {
      url,
      size: imageSize,
      lastAccessed: Date.now(),
    };
    saveImageIndex(index);
  } catch (err) {
    console.warn('Could not cache product image:', err);
  }
}

/**
 * Retrieves a cached image URL or matches against CacheStorage.
 */
export async function getCachedImageUrl(url: string): Promise<string | null> {
  if (typeof caches === 'undefined' || !url) return null;

  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(url);
    if (match) {
      // Update last accessed time in index
      const index = loadImageIndex();
      if (index[url]) {
        index[url].lastAccessed = Date.now();
        saveImageIndex(index);
      }
      const blob = await match.blob();
      return URL.createObjectURL(blob);
    }
  } catch (err) {
    console.warn('Cache lookup failed:', err);
  }
  return null;
}
