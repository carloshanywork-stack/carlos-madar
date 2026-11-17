/**
 * MADAR Client-Side Photo Cache
 * Stores machine and visit photos on the client's local disk/cache
 * using the standard Cache Storage API, eliminating repeated downloads.
 */

const CACHE_NAME = 'madar-photo-cache-v1';
const MAX_CACHE_ENTRIES = 500;

export async function getCachedPhotoUrl(url) {
  if (!url || typeof window === 'undefined' || !('caches' in window)) {
    return url;
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(url);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      return URL.createObjectURL(blob);
    }

    // Fetch and store in cache in background
    const response = await fetch(url, { mode: 'cors', credentials: 'include' });
    if (response.ok) {
      cache.put(url, response.clone()).catch(() => undefined);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch {
    // Return original url on cache failure
  }
  return url;
}

export async function preloadAndCachePhotos(urls = []) {
  if (!('caches' in window) || !urls.length) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const promises = urls.slice(0, 30).map(async (url) => {
      const match = await cache.match(url);
      if (!match) {
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) await cache.put(url, res);
      }
    });
    await Promise.allSettled(promises);
  } catch {}
}

export async function clearPhotoCache() {
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      await caches.delete(CACHE_NAME);
    } catch {}
  }
}
