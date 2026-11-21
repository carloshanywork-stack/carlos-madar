/**
 * MADAR Authoritative PhotoRepository
 * Central gateway for operational image viewing across MADAR applications.
 *
 * Architecture:
 * OperationalImageViewer
 * -> PhotoRepository (deduplication, bounded concurrency queue, prefetch lifecycle)
 * -> mediaCache (session-scoped, bounded LRU, ETag/304 conditional revalidation)
 * -> Authenticated HTTP Endpoint (/api/maintenance/orders/:id/photos/...)
 * -> Server-Derived WebP Variant (thumbnails.js)
 * -> Protected Original File (byte-for-byte preserved storage)
 */

import { mediaCache } from './media-cache.js';
import { getActiveAdaptiveProfile } from '../adaptive-quality.js';

// In-flight request deduplication map: cacheKey -> Promise<Blob>
const inFlightRequests = new Map();

// Active prefetch controllers to support instant cancellation on rapid navigation / modal close
const activePrefetchControllers = new Set();

// Concurrency queue for active decode/fetch operations
class BoundedQueue {
  constructor(maxConcurrency = 4) {
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
    this.queue = [];
  }

  setMaxConcurrency(limit) {
    if (Number.isSafeInteger(limit) && limit >= 1) {
      this.maxConcurrency = limit;
      this.processNext();
    }
  }

  async run(task) {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      try {
        return await task();
      } finally {
        this.activeCount -= 1;
        this.processNext();
      }
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
    });
  }

  processNext() {
    if (this.activeCount >= this.maxConcurrency || this.queue.length === 0) return;
    const item = this.queue.shift();
    if (!item) return;

    this.activeCount += 1;
    (async () => {
      try {
        const result = await item.task();
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      } finally {
        this.activeCount -= 1;
        this.processNext();
      }
    })();
  }
}

const decodeQueue = new BoundedQueue(4);

export const photoRepository = {
  /**
   * Acquire a managed Object URL for viewing.
   * Guarantees bounded concurrency, request deduplication, and in-use protection.
   */
  async acquirePhoto(url, options = {}) {
    if (!url) throw new Error('A valid photo URL is required.');

    const profile = await getActiveAdaptiveProfile();
    decodeQueue.setMaxConcurrency(profile.maxConcurrentDecodes || 4);

    const variant = options.variant || profile.variant || 'preview';
    const requestKey = `${variant}::${url}`;

    // 1. In-flight request deduplication: share active acquisition promise
    if (inFlightRequests.has(requestKey)) {
      return inFlightRequests.get(requestKey);
    }

    const task = decodeQueue.run(async () => {
      return mediaCache.acquirePhotoUrl(url, {
        ...options,
        variant,
        inUse: options.inUse !== false,
      });
    }).finally(() => {
      inFlightRequests.delete(requestKey);
    });

    inFlightRequests.set(requestKey, task);
    return task;
  },

  /**
   * Prefetches an adjacent photo in the background.
   * Registered with activePrefetchControllers so rapid navigation cancels pending work.
   */
  prefetchPhoto(url, options = {}) {
    if (!url || typeof window === 'undefined') return;

    const controller = new AbortController();
    activePrefetchControllers.add(controller);

    const variant = options.variant || 'preview';

    (async () => {
      try {
        const profile = await getActiveAdaptiveProfile();
        decodeQueue.setMaxConcurrency(profile.maxConcurrentDecodes || 4);

        await decodeQueue.run(async () => {
          if (controller.signal.aborted) return;
          await mediaCache.prefetchPhoto(url, variant, { signal: controller.signal });
        });
      } catch {
        // Quietly absorb prefetch errors
      } finally {
        activePrefetchControllers.delete(controller);
      }
    })();

    return () => {
      controller.abort();
      activePrefetchControllers.delete(controller);
    };
  },

  /**
   * Cancels all pending background prefetch jobs immediately.
   * Called when the viewer closes or the user switches photos rapidly.
   */
  cancelPrefetches() {
    for (const controller of activePrefetchControllers) {
      try {
        controller.abort();
      } catch {}
    }
    activePrefetchControllers.clear();
  },

  /**
   * Releases an Object URL previously created by acquirePhoto.
   */
  releasePhoto(objectUrl) {
    mediaCache.releasePhotoUrl(objectUrl);
  },

  /**
   * Invalidates a photo when mutated (rotated, replaced, deleted).
   */
  async invalidatePhoto(url) {
    this.cancelPrefetches();
    await mediaCache.invalidatePhoto(url);
  },

  /**
   * Clears the active account's media cache partition completely.
   */
  async clearActiveCache() {
    this.cancelPrefetches();
    await mediaCache.clearActiveCache();
  },

  /**
   * Diagnostic statistics for Settings UI.
   */
  async getDiagnostics() {
    return mediaCache.getDiagnostics();
  },
};
