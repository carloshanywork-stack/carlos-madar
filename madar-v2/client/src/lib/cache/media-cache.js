/**
 * MADAR Secure Bounded Media Cache Engine
 * Provides account-isolated, server-isolated, byte-bounded, and LRU-evicted
 * caching for operational photos with conditional ETag/304 revalidation.
 *
 * Security & Reliability Invariants:
 * 1. Session Isolation: Never stores media under an anonymous or 'default' partition.
 *    Partitions are scoped to `madar-media-v2:<origin>:<userId>`.
 * 2. Revocation Safety: HTTP 401, 403, 404, and 410 immediately purge local cache
 *    and NEVER fall back to a previously cached image.
 * 3. Exact Key LRU: Deletions from CacheStorage target the exact stored request URL (including ?size=).
 * 4. In-Use Protection: Images currently visible in an active viewer are never evicted.
 * 5. Lifecycle Management: Clean object URL acquisition and deterministic revocation.
 */

import { getActiveAdaptiveProfile } from '../adaptive-quality.js';

const DB_NAME = 'madar_media_cache_db';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const STATS_STORE = 'stats';

let dbPromise = null;

let activeSessionContext = {
  serverOrigin: typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost',
  userId: null,
  authenticated: false,
};

// In-memory tracking of active Object URLs and in-use keys
const activeObjectUrls = new Map(); // objectUrl -> { cacheKey, refCount }
const inUseKeys = new Set();        // cacheKeys currently rendered in an active viewer
const sessionStats = {
  hits: 0,
  misses: 0,
  bytesSaved: 0,
};

export function getPartitionName(serverOrigin, userId) {
  if (!serverOrigin || !userId || userId === 'default' || userId === 'anonymous') {
    return null;
  }
  const safeOrigin = String(serverOrigin).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeUser = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `madar-media-v2:${safeOrigin}:${safeUser}`;
}

export function getCacheKey(partition, url, variant = 'original') {
  const safePartition = partition || 'ephemeral';
  return `${safePartition}::${variant}::${url}`;
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve) => {
    try {
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
    } catch {
      resolve(null);
    }
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
  if (!db) return false;
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
  if (!db) return false;
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
  if (!partition) return [];
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
   * If switching accounts, previous Object URLs are revoked and the prior user's cache is purged.
   */
  async setSessionContext({ serverOrigin, userId }) {
    const origin = serverOrigin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const newUserId = userId ? String(userId) : null;
    const isAuth = Boolean(newUserId && newUserId !== 'default' && newUserId !== 'anonymous');

    const previousPartition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    const newPartition = getPartitionName(origin, newUserId);

    if (previousPartition && previousPartition !== newPartition) {
      this.revokeAllObjectUrls();
      await this.purgePartition(previousPartition);
    }

    activeSessionContext = {
      serverOrigin: origin,
      userId: newUserId,
      authenticated: isAuth,
    };
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
    if (partition) {
      await this.purgePartition(partition);
    }
    activeSessionContext = {
      serverOrigin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
      userId: null,
      authenticated: false,
    };
    sessionStats.hits = 0;
    sessionStats.misses = 0;
    sessionStats.bytesSaved = 0;
  },

  async purgePartition(partition) {
    if (!partition || typeof window === 'undefined') return;
    if ('caches' in window) {
      try {
        await caches.delete(partition);
      } catch {}
    }

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
   * Guarantees exact CacheStorage key deletion and protects currently rendered entries.
   */
  async enforceQuota(incomingBytes = 0) {
    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    if (!partition) return;

    const profile = await getActiveAdaptiveProfile();
    const entries = await getPartitionEntries(partition);

    let totalBytes = entries.reduce((sum, e) => sum + (e.byteSize || 0), 0);

    // Compute dynamic ceiling using profile maxCacheBytes or storage estimate
    let maxBytes = profile.maxCacheBytes;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota && Number.isFinite(estimate.quota)) {
          const dynamicLimit = Math.floor(estimate.quota * (profile.storageFraction || 0.05));
          maxBytes = Math.min(maxBytes, dynamicLimit);
        }
      } catch {}
    }

    const targetBytes = Math.round(maxBytes * 0.85);
    if (totalBytes + incomingBytes <= maxBytes) return;

    // Sort by lastAccessedAt ascending (oldest first)
    entries.sort((a, b) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0));

    let cache = null;
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        cache = await caches.open(partition);
      } catch {}
    }

    for (const entry of entries) {
      if (totalBytes + incomingBytes <= targetBytes) break;
      // Never evict an entry actively rendered in the viewer
      if (inUseKeys.has(entry.cacheKey)) continue;

      if (cache) {
        try {
          // Evict the exact stored fetchUrl (or fallback to url)
          await cache.delete(entry.fetchUrl || entry.url);
        } catch {}
      }
      await idbDelete(META_STORE, entry.cacheKey);
      totalBytes -= (entry.byteSize || 0);
    }
  },

  /**
   * Retrieves a photo blob with ETag/304 conditional revalidation.
   * On HTTP 401, 403, 404, or 410, local cache is immediately deleted and NO fallback is returned.
   */
  async getPhotoBlob(url, options = {}) {
    const {
      variant = 'preview',
      signal = null,
      timeoutMs = 15000,
      skipCache = false,
    } = options;

    if (!url || typeof window === 'undefined') {
      throw new Error('Valid photo URL is required.');
    }

    // Determine target variant query param
    let fetchUrl = url;
    if (variant && variant !== 'original' && !url.includes('size=') && !url.includes('variant=')) {
      const separator = url.includes('?') ? '&' : '?';
      fetchUrl = `${url}${separator}size=${encodeURIComponent(variant)}`;
    }

    const partition = getPartitionName(activeSessionContext.serverOrigin, activeSessionContext.userId);
    const cacheKey = getCacheKey(partition, url, variant);

    // If session is unauthenticated, do not read or write persistent cache
    const canPersist = Boolean(partition && activeSessionContext.authenticated);

    let cachedMeta = null;
    let cachedResponse = null;

    if (canPersist && !skipCache && 'caches' in window) {
      try {
        const cache = await caches.open(partition);
        cachedResponse = await cache.match(fetchUrl);
        if (cachedResponse) {
          cachedMeta = await idbGet(META_STORE, cacheKey);
        }
      } catch {}
    }

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

    // If offline and a cached response exists for this authenticated user, return it
    if (isOffline && cachedResponse) {
      sessionStats.hits += 1;
      return await cachedResponse.blob();
    }

    // Prepare conditional validation headers if ETag exists
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

      // Handle 304 Not Modified -> Cache HIT
      if (response.status === 304 && cachedResponse) {
        sessionStats.hits += 1;
        const blob = await cachedResponse.blob();
        sessionStats.bytesSaved += blob.size;

        if (cachedMeta) {
          cachedMeta.lastAccessedAt = Date.now();
          await idbPut(META_STORE, cachedMeta);
        }
        return blob;
      }

      // Handle 200 OK -> Fresh content
      if (response.ok) {
        sessionStats.misses += 1;
        const blob = await response.blob();
        const byteSize = blob.size;

        if (canPersist && 'caches' in window) {
          try {
            await this.enforceQuota(byteSize);
            const cache = await caches.open(partition);
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

      // Handle authorization or not-found errors: Purge local cache and FAIL IMMEDIATELY
      if ([401, 403, 404, 410].includes(response.status)) {
        if (canPersist && 'caches' in window) {
          try {
            const cache = await caches.open(partition);
            await cache.delete(fetchUrl);
          } catch {}
          await idbDelete(META_STORE, cacheKey);
        }
        const authErr = new Error(`Failed to load photo: Server returned status ${response.status}`);
        authErr.status = response.status;
        authErr.isRevocationOrNotFoundError = true;
        throw authErr;
      }

      const serverErr = new Error(`Failed to load photo (${response.status})`);
      serverErr.status = response.status;
      throw serverErr;
    } catch (err) {
      // Never fall back to cached content if authorization was revoked or resource deleted
      if (err.isRevocationOrNotFoundError || [401, 403, 404, 410].includes(err.status)) {
        throw err;
      }

      // Genuine network failure / offline fallback only
      if (cachedResponse && !signal?.aborted && (err.name === 'TypeError' || !navigator.onLine)) {
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

    if (options.inUse !== false) {
      inUseKeys.add(cacheKey);
    }

    return {
      objectUrl,
      release: () => {
        if (options.inUse !== false) {
          inUseKeys.delete(cacheKey);
        }
        this.releasePhotoUrl(objectUrl);
      },
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
  async prefetchPhoto(url, variant = 'preview', options = {}) {
    if (!url || typeof window === 'undefined') return;
    try {
      await this.getPhotoBlob(url, { variant, inUse: false, ...options });
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
    const variants = ['thumb', 'preview', 'high', '800', '2400', 'original'];

    for (const variant of variants) {
      const cacheKey = getCacheKey(partition, url, variant);
      await idbDelete(META_STORE, cacheKey);
    }

    if (partition && typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(partition);
        await cache.delete(url);
        for (const variant of variants) {
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
    if (partition) {
      await this.purgePartition(partition);
    }
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
      partition: partition || 'unauthenticated',
      activeProfile: profile,
      authenticated: activeSessionContext.authenticated,
    };
  },
};

export async function acquireManagedObjectUrl(url, options = {}) {
  return mediaCache.acquirePhotoUrl(url, options);
}

export async function clearAccountMediaCache() {
  return mediaCache.clearActiveCache();
}
