/**
 * MADAR Client-Side Photo Cache
 * Backward-compatible bridge delegating to the bounded, account-isolated mediaCache.
 */

import { acquireManagedObjectUrl, clearAccountMediaCache } from './media-cache.js';

export async function getCachedPhotoUrl(url) {
  if (!url) return url;
  try {
    const handle = await acquireManagedObjectUrl(url, { variant: 'original' });
    return handle ? handle.objectUrl : url;
  } catch {
    return url;
  }
}

export async function preloadAndCachePhotos(urls = []) {
  if (!urls.length) return;
  const promises = urls.slice(0, 20).map((url) => getCachedPhotoUrl(url).catch(() => undefined));
  await Promise.allSettled(promises);
}

export async function clearPhotoCache() {
  await clearAccountMediaCache();
}
