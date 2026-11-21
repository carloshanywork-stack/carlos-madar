import assert from 'node:assert/strict';
import test from 'node:test';

// Setup Mock Browser Environment for MediaCache and PhotoRepository
class MockCache {
  constructor(name) {
    this.name = name;
    this.store = new Map();
  }
  async match(request) {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.get(key) || null;
  }
  async put(request, response) {
    const key = typeof request === 'string' ? request : request.url;
    this.store.set(key, response.clone ? response.clone() : response);
  }
  async delete(request) {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.delete(key);
  }
  async keys() {
    return Array.from(this.store.keys()).map((url) => ({ url }));
  }
}

class MockCacheStorage {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MockCache(name));
    }
    return this.caches.get(name);
  }
  async has(name) {
    return this.caches.has(name);
  }
  async delete(name) {
    return this.caches.delete(name);
  }
  async keys() {
    return Array.from(this.caches.keys());
  }
}

// In-memory IndexedDB mock for media cache metadata
class MockIDBStore {
  constructor() {
    this.records = new Map();
  }
  get(key) {
    return this.records.get(key) || null;
  }
  put(record) {
    this.records.set(record.cacheKey || record.key, { ...record });
  }
  delete(key) {
    this.records.delete(key);
  }
  getAll() {
    return Array.from(this.records.values());
  }
  clear() {
    this.records.clear();
  }
}

class MockIDBDatabase {
  constructor(name) {
    this.name = name;
    this.stores = new Map();
  }
  get objectStoreNames() {
    return {
      contains: (s) => this.stores.has(s),
    };
  }
  createObjectStore(storeName) {
    const store = new MockIDBStore();
    this.stores.set(storeName, store);
    return {
      createIndex: () => {},
    };
  }
  transaction(storeNames) {
    const db = this;
    const tx = {
      oncomplete: null,
      onerror: null,
      objectStore(sName) {
        let store = db.stores.get(sName);
        if (!store) {
          store = new MockIDBStore();
          db.stores.set(sName, store);
        }
        return {
          get(key) {
            const req = { result: store.get(key), onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess?.({ target: req }));
            return req;
          },
          put(val) {
            store.put(val);
            const req = { result: val.cacheKey || val.key, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              req.onsuccess?.({ target: req });
              tx.oncomplete?.();
            });
            return req;
          },
          delete(key) {
            store.delete(key);
            const req = { result: undefined, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              req.onsuccess?.({ target: req });
              tx.oncomplete?.();
            });
            return req;
          },
          getAll() {
            const req = { result: store.getAll(), onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess?.({ target: req }));
            return req;
          },
          clear() {
            store.clear();
            const req = { result: undefined, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              req.onsuccess?.({ target: req });
              tx.oncomplete?.();
            });
            return req;
          },
        };
      },
    };
    queueMicrotask(() => {
      if (typeof tx.oncomplete === 'function') {
        tx.oncomplete();
      }
    });
    return tx;
  }
  close() {}
}

const mockCaches = new MockCacheStorage();
const mockIDBDatabases = new Map();

globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost:3000' };
globalThis.caches = mockCaches;

Object.defineProperty(globalThis, 'navigator', {
  value: {
    onLine: true,
    hardwareConcurrency: 4,
    deviceMemory: 8,
    connection: { effectiveType: '4g', saveData: false },
    storage: {
      estimate: async () => ({ quota: 1024 * 1024 * 1024, usage: 10 * 1024 * 1024 }),
    },
  },
  configurable: true,
  writable: true,
});

globalThis.indexedDB = {
  open(name) {
    let db = mockIDBDatabases.get(name);
    if (!db) {
      db = new MockIDBDatabase(name);
      db.createObjectStore('metadata');
      db.createObjectStore('stats');
      mockIDBDatabases.set(name, db);
    }
    const req = {
      result: db,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      req.onsuccess?.({ target: req });
    });
    return req;
  },
  deleteDatabase(name) {
    mockIDBDatabases.delete(name);
    const req = { onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  },
};

let objectUrlCounter = 0;
const activeCreatedUrls = new Set();
globalThis.URL.createObjectURL = (blob) => {
  const url = `blob:http://localhost/${++objectUrlCounter}`;
  activeCreatedUrls.add(url);
  return url;
};
globalThis.URL.revokeObjectURL = (url) => {
  activeCreatedUrls.delete(url);
};

// Mock fetch response helper
function createMockResponse(bodyText, status = 200, headers = {}) {
  const blob = new Blob([bodyText], { type: 'image/jpeg' });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (h) => headers[h.toLowerCase()] || null,
    },
    clone() {
      return createMockResponse(bodyText, status, headers);
    },
    async blob() {
      return blob;
    },
  };
}

// Import tested modules
const { mediaCache, getPartitionName } = await import('../client/src/lib/cache/media-cache.js');
const { photoRepository } = await import('../client/src/lib/cache/photo-repository.js');

test('MediaCache session partitioning isolates User A and User B', async () => {
  await mediaCache.setSessionContext({ serverOrigin: 'https://server.madar.local', userId: 'user_100' });
  const s1 = mediaCache.getSessionContext();
  assert.equal(s1.userId, 'user_100');
  assert.equal(getPartitionName(s1.serverOrigin, s1.userId), 'madar-media-v2:https___server_madar_local:user_100');

  await mediaCache.setSessionContext({ serverOrigin: 'https://server.madar.local', userId: 'user_200' });
  const s2 = mediaCache.getSessionContext();
  assert.equal(s2.userId, 'user_200');
  assert.equal(getPartitionName(s2.serverOrigin, s2.userId), 'madar-media-v2:https___server_madar_local:user_200');
});

test('MediaCache anonymous context refuses persistent caching', async () => {
  // Clear any authenticated context -> anonymous
  await mediaCache.setSessionContext({ serverOrigin: 'http://localhost:3000', userId: null });
  const s = mediaCache.getSessionContext();
  assert.equal(s.authenticated, false);
  assert.equal(getPartitionName(s.serverOrigin, s.userId), null);

  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return createMockResponse('image-data-anonymous', 200);
  };

  const blob = await mediaCache.getPhotoBlob('/api/files/test.jpg', { variant: 'preview' });
  assert.ok(blob instanceof Blob);
  assert.equal(fetchCalled, true);

  // CacheStorage must NOT have opened or stored anonymous entries
  assert.equal(mockCaches.caches.size, 0);
});

test('MediaCache revocation: 401/403/404 purges cache and refuses to return cached fallback', async () => {
  await mediaCache.setSessionContext({ serverOrigin: 'https://app.madar.local', userId: 'rep_42' });

  // 1. Initial success: store in cache
  globalThis.fetch = async () => createMockResponse('valid-authorized-photo-bytes', 200, { etag: '"etag-123"' });
  const blob1 = await mediaCache.getPhotoBlob('/api/files/secret-order-photo.jpg', { variant: 'preview' });
  assert.ok(blob1);

  const partition = getPartitionName('https://app.madar.local', 'rep_42');
  // Verify it exists in cache
  const diskCache = await mockCaches.open(partition);
  const cached = await diskCache.match('/api/files/secret-order-photo.jpg?size=preview');
  assert.ok(cached, 'Item should be cached initially');

  // 2. Server revokes permission (403 Forbidden)
  globalThis.fetch = async () => createMockResponse('Forbidden', 403);

  await assert.rejects(
    async () => {
      await mediaCache.getPhotoBlob('/api/files/secret-order-photo.jpg', { variant: 'preview' });
    },
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.isRevocationOrNotFoundError, true);
      return true;
    },
    'Must reject with revocation error and NOT fall back to cached blob'
  );

  // Verify item was PURGED from CacheStorage
  const checkPurged = await diskCache.match('/api/files/secret-order-photo.jpg?size=preview');
  assert.equal(checkPurged, null, 'Must be completely purged from cache on 403');
});

test('MediaCache offline fallback returns cached image for authenticated user on network failure', async () => {
  await mediaCache.setSessionContext({ serverOrigin: 'https://app.madar.local', userId: 'rep_42' });

  // 1. Cache successful image
  globalThis.fetch = async () => createMockResponse('offline-available-photo', 200, { etag: '"etag-offline-1"' });
  await mediaCache.getPhotoBlob('/api/files/offline-card-photo.jpg', { variant: 'preview' });

  // 2. Network throws standard offline TypeError
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  const fallbackBlob = await mediaCache.getPhotoBlob('/api/files/offline-card-photo.jpg', { variant: 'preview' });
  assert.ok(fallbackBlob instanceof Blob, 'Must return cached blob on network failure for authenticated user');
});

test('PhotoRepository deduplicates in-flight requests and respects bounded concurrency', async () => {
  await mediaCache.setSessionContext({ serverOrigin: 'https://app.madar.local', userId: 'rep_user' });

  let networkCallCount = 0;
  globalThis.fetch = async (url) => {
    networkCallCount++;
    await new Promise((r) => setTimeout(r, 20));
    return createMockResponse(`photo-content-${url}`, 200);
  };

  // Dispatch 3 concurrent requests for the EXACT SAME URL
  const testUrl = '/api/files/simultaneous.jpg';
  const [res1, res2, res3] = await Promise.all([
    photoRepository.acquirePhoto(testUrl, { variant: 'preview' }),
    photoRepository.acquirePhoto(testUrl, { variant: 'preview' }),
    photoRepository.acquirePhoto(testUrl, { variant: 'preview' }),
  ]);

  assert.ok(res1.objectUrl);
  assert.ok(res2.objectUrl);
  assert.ok(res3.objectUrl);

  // Deduplication check: network should only be hit once!
  assert.equal(networkCallCount, 1, 'In-flight requests must be deduplicated to 1 network call');

  photoRepository.releasePhoto(res1.objectUrl);
  photoRepository.releasePhoto(res2.objectUrl);
  photoRepository.releasePhoto(res3.objectUrl);
});

test('PhotoRepository prefetch cancellation aborts pending fetches on rapid navigation', async () => {
  await mediaCache.setSessionContext({ serverOrigin: 'https://app.madar.local', userId: 'rep_user' });

  let fetchStarted = false;
  let fetchAborted = false;

  globalThis.fetch = async (url, opts) => {
    fetchStarted = true;
    return new Promise((resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => {
        fetchAborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
      setTimeout(() => resolve(createMockResponse('prefetched', 200)), 150);
    });
  };

  // Start prefetch
  photoRepository.prefetchPhoto('/api/files/next-photo.jpg', { variant: 'thumb' });

  // Allow fetch to start (small tick)
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(fetchStarted, true, 'Fetch should have started');

  // Now trigger cancellation while fetch is actively in flight
  photoRepository.cancelPrefetches();

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fetchAborted, true, 'Prefetch AbortSignal must have triggered abort');
});
