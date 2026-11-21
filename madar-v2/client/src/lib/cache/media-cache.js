/**
 * MADAR Secure Bounded Media Cache Engine
 * Provides account-isolated, server-isolated, byte-bounded, and LRU-evicted
 * caching for operational photos with conditional ETag/304 revalidation.
 */

import { getActiveAdaptiveProfile } from '../adaptive-quality.js';

const DB_NAME = 'madar_media_cache_db';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const STATS_STORE = 'stats';

let dbPromise = null;
let activeSessionContext = {
  serverOrigin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  userId: 'default',
};

// In-memory tracking of active Object URLs and in-use keys
const activeObjectUrls = new Map(); // objectUrl -> { cacheKey, refCount }
const inUseKeys = new Set();        // cacheKeys currently rendered in an active viewer
const sessionStats = {
  hits: 0,
  misses: 0,
  bytesSaved: 0,
};

function getPartitionName(serverOrigin, userId) {
  const safeOrigin = (serverOrigin || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeUser = (userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `madar-media-v2:${safeOrigin}:${safeUser}`;
}

function getCacheKey(partition, url, variant = 'original') {
  return `${partition}::${variant}::${url}`;
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        const store = db.createObjectStore(META_STORE, { keyPath: 'cacheKey' });
        store.createIndex('partition', 'partition', { unique: false });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STATS_STORE)) {
        db.createObjectStore(STATS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('Could not open MediaCache IndexedDB, falling back to ephemeral caching');
      resolve(null);
    };
  });

  return dbPromise;
}

async function idbGet(storeName, key) {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(storeName, value) {
  const db = await openDatabase();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbDelete(storeName, key) {
  const db = await openDatabase();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function getPartitionEntries(partition) {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(META_STORE, 'readonly');
      const index = tx.objectStore(META_STORE).index('partition');
      const req = index.getAll(partition);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export const mediaCache = {
  /**
   * Set the authenticated user and server origin to enforce strict partition isolation.
   */
  setSessionContext({ serverOrigin, userId }) {
    if (activeSessionContext.userId !== userId || activeSessionContext.serverOrigin !== serverOrigin) {
      // Revoke any in-memory object URLs from previous session
      this.revokeAllObjectUrls();
      activeSessionContext = {
        serverOrigin: serverOrigin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
        userId: userId ? String(userId) : 'default',
      };
    }
  },

  getSessionContext() {
    return { ...activeSessionContext };
  },

  /**
   * Cleanly handles user logout: revokes active object URLs and purges customer photos
   * from the active user's partition so sensitive files are not left on shared PCs.
   */
  async onLogout() {
    this.revokeAllObjectUrls();
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    await this.purgePartition(partition);
    sessionStats.hits = 0;
    sessionStats.misses = 0;
    sessionStats.bytesSaved = 0;
  },

  async purgePartition(partition) {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    try {
      await caches.delete(partition);
    } catch {}

    const entries = await getPartitionEntries(partition);
    for (const entry of entries) {
      await idbDelete(META_STORE, entry.cacheKey);
    }
  },

  /**
   * Marks a cache key as in-use by an active viewer to prevent eviction.
   */
  markInUse(url, variant, inUse = true) {
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    const key = getCacheKey(partition, url, variant);
    if (inUse) inUseKeys.add(key);
    else inUseKeys.delete(key);
  },

  /**
   * Evicts least-recently-used entries in the current partition when over quota.
   */
  async enforceQuota(incomingBytes = 0) {
    const profile = await getActiveAdaptiveProfile();
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    const entries = await getPartitionEntries(partition);

    let totalBytes = entries.reduce((sum, e) => sum + (e.byteSize || 0), 0);
    const maxBytes = profile.maxCacheBytes;
    const targetBytes = Math.round(maxBytes * 0.85);

    if (totalBytes + incomingBytes <= maxBytes) return;

    // Sort by lastAccessedAt ascending (oldest first)
    entries.sort((a, b) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0));

    let cache = null;
    try {
      cache = await caches.open(partition);
    } catch {}

    for (const entry of entries) {
      if (totalBytes + incomingBytes <= targetBytes) break;
      // Never evict an entry actively rendered in the viewer
      if (inUseKeys.has(entry.cacheKey)) continue;

      if (cache) {
        try { await cache.delete(entry.url); } catch {}
      }
      await idbDelete(META_STORE, entry.cacheKey);
      totalBytes -= (entry.byteSize || 0);
    }
  },

  /**
   * Retrieves a photo blob with ETag/304 conditional revalidation.
   */
  async getPhotoBlob(url, options = {}) {
    const {
      variant = 'preview',
      signal = null,
      priority = 'normal',
      timeoutMs = 15000,
      skipCache = false,
    } = options;

    if (!url || typeof window === 'undefined') {
      throw new Error('Valid photo URL is required.');
    }

    // If variant is requested (thumb, preview, high), append variant query param if not already present
    let fetchUrl = url;
    if (variant && variant !== 'original' && !url.includes('size=') && !url.includes('variant=')) {
      const separator = url.includes('?') ? '&' : '?';
      fetchUrl = `${url}${separator}size=${encodeURIComponent(variant)}`;
    }

    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    const cacheKey = getCacheKey(partition, url, variant);

    // 1. Check existing cache entry and metadata
    let cachedMeta = null;
    let cachedResponse = null;

    if (!skipCache && 'caches' in window) {
      try {
        const cache = await caches.open(partition);
        cachedResponse = await cache.match(fetchUrl);
        if (cachedResponse) {
          cachedMeta = await idbGet(META_STORE, cacheKey);
        }
      } catch {}
    }

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

    // If offline and we have a cached response, return it immediately
    if (isOffline && cachedResponse) {
      sessionStats.hits += 1;
      return await cachedResponse.blob();
    }

    // 2. Prepare headers with conditional validation if we have ETag
    const headers = new Headers();
    if (cachedMeta?.etag) {
      headers.set('If-None-Match', cachedMeta.etag);
    }
    if (cachedMeta?.lastModified) {
      headers.set('If-Modified-Since', cachedMeta.lastModified);
    }

    const controller = new AbortController();
    const abortHandler = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortHandler();
    else signal?.addEventListener('abort', abortHandler, { once: true });

    let timeoutId = null;
    if (timeoutMs > 0) {
      timeoutId = window.setTimeout(() => controller.abort(new Error('Photo request timed out')), timeoutMs);
    }

    try {
      const response = await fetch(fetchUrl, {
        method: 'GET',
        credentials: 'include',
        headers,
        signal: controller.signal,
      });

      // 3. Handle 304 Not Modified -> Cache HIT
      if (response.status === 304 && cachedResponse) {
        sessionStats.hits += 1;
        const blob = await cachedResponse.blob();
        sessionStats.bytesSaved += blob.size;

        // Touch LRU timestamp
        if (cachedMeta) {
          cachedMeta.lastAccessedAt = Date.now();
          await idbPut(META_STORE, cachedMeta);
        }
        return blob;
      }

      // 4. Handle 200 OK -> Fresh content
      if (response.ok) {
        sessionStats.misses += 1;
        const blob = await response.blob();
        const byteSize = blob.size;

        // Store in Cache Storage and update IndexedDB metadata
        if ('caches' in window) {
          try {
            await this.enforceQuota(byteSize);
            const cache = await caches.open(partition);
            // Cache a synthetic response from the blob
            const responseToCache = new Response(blob, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            await cache.put(fetchUrl, responseToCache);

            const meta = {
              cacheKey,
              partition,
              url,
              fetchUrl,
              variant,
              byteSize,
              etag: response.headers.get('ETag') || null,
              lastModified: response.headers.get('Last-Modified') || null,
              lastAccessedAt: Date.now(),
              createdAt: Date.now(),
            };
            await idbPut(META_STORE, meta);
          } catch (err) {
            console.warn('Could not cache photo in MediaCache:', err.message);
          }
        }
        return blob;
      }

      // 5. Handle errors: if 401, 403, 404, or 410, invalidate any existing cached entry
      if ([401, 403, 404, 410].includes(response.status)) {
        if ('caches' in window) {
          try {
            const cache = await caches.open(partition);
            await cache.delete(fetchUrl);
          } catch {}
          await idbDelete(META_STORE, cacheKey);
        }
      }

      throw new Error(`Failed to load photo (${response.status})`);
    } catch (err) {
      // If network error occurred but we have a cached copy, fall back to cached copy
      if (cachedResponse && !signal?.aborted) {
        sessionStats.hits += 1;
        return await cachedResponse.blob();
      }
      throw err;
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);
    }
  },

  /**
   * Safe Object URL manager: acquires an Object URL for rendering
   * and tracks it for deterministic revocation.
   */
  async acquirePhotoUrl(url, options = {}) {
    const blob = await this.getPhotoBlob(url, options);
    const objectUrl = URL.createObjectURL(blob);
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    const cacheKey = getCacheKey(partition, url, options.variant || 'original');

    activeObjectUrls.set(objectUrl, { cacheKey, refCount: 1 });

    return {
      objectUrl,
      release: () => this.releasePhotoUrl(objectUrl),
    };
  },

  releasePhotoUrl(objectUrl) {
    if (!objectUrl || !activeObjectUrls.has(objectUrl)) return;
    const entry = activeObjectUrls.get(objectUrl);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      URL.revokeObjectURL(objectUrl);
      activeObjectUrls.delete(objectUrl);
    }
  },

  revokeAllObjectUrls() {
    for (const objectUrl of activeObjectUrls.keys()) {
      try { URL.revokeObjectURL(objectUrl); } catch {}
    }
    activeObjectUrls.clear();
    inUseKeys.clear();
  },

  /**
   * Prefetch a photo in the background without locking it as in-use.
   */
  async prefetchPhoto(url, variant = 'preview') {
    if (!url || typeof window === 'undefined') return;
    try {
      await this.getPhotoBlob(url, { variant, inUse: false });
    } catch {
      // Quietly ignore background prefetch errors
    }
  },

  /**
   * Invalidate all variants of a photo when mutated (rotated, replaced, deleted).
   */
  async invalidatePhoto(url) {
    if (!url) return;
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    for (const variant of ['thumb', 'preview', 'high', '800', 'original']) {
      const cacheKey = getCacheKey(partition, url, variant);
      await idbDelete(META_STORE, cacheKey);
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(partition);
        await cache.delete(url);
        for (const variant of ['thumb', 'preview', 'high', '800']) {
          const sep = url.includes('?') ? '&' : '?';
          await cache.delete(`${url}${sep}size=${variant}`);
        }
      } catch {}
    }
  },

  /**
   * Clears the active account's media cache partition completely.
   */
  async clearActiveCache() {
    this.revokeAllObjectUrls();
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    await this.purgePartition(partition);
  },

  /**
   * Collects detailed diagnostics for Settings UI.
   */
  async getDiagnostics() {
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    const entries = await getPartitionEntries(partition);
    const totalBytes = entries.reduce((sum, e) => sum + (e.byteSize || 0), 0);
    const profile = await getActiveAdaptiveProfile();

    const totalRequests = sessionStats.hits + sessionStats.misses;
    const hitRatio = totalRequests > 0 ? Math.round((sessionStats.hits / totalRequests) * 100) : 100;

    return {
      totalBytes,
      entryCount: entries.length,
      maxBytes: profile.maxCacheBytes,
      hits: sessionStats.hits,
      misses: sessionStats.misses,
      bytesSaved: sessionStats.bytesSaved,
      hitRatio,
      partition,
      activeProfile: profile,
    };
  },
};

export async function acquireManagedObjectUrl(url, options = {}) {
  return mediaCache.acquirePhotoUrl(url, options);
}

export async function clearAccountMediaCache() {
  return mediaCache.clearActiveCache();
}
