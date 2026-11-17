import { api } from '../../lib/api.js';

const STORAGE_KEY = 'madar-finance-offline-queue';
let isSyncing = false;

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'fin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

export function getFinanceQueue() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Could not read finance offline queue:', err);
    return [];
  }
}

function persistQueue(queue) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    window.dispatchEvent(new CustomEvent('madar-finance-queue-updated', { detail: { queue } }));
  } catch (err) {
    console.error('Could not persist finance offline queue:', err);
  }
}

export function enqueueFinanceOperation({ type, label, endpoint, payload }) {
  const item = {
    id: generateId(),
    type,
    label: label || 'معاملة مالية',
    endpoint,
    payload,
    createdAt: new Date().toISOString(),
    status: 'queued',
    attempts: 0,
  };
  const current = getFinanceQueue();
  const updated = [...current, item];
  persistQueue(updated);
  return item;
}

export function removeFinanceQueueItem(id) {
  const current = getFinanceQueue();
  const updated = current.filter((item) => item.id !== id);
  persistQueue(updated);
}

export function clearFinanceQueue() {
  persistQueue([]);
}

export async function syncFinanceQueue(onProgress) {
  if (isSyncing) return { status: 'already_syncing' };
  isSyncing = true;

  try {
    let queue = getFinanceQueue();
    if (queue.length === 0) return { syncedCount: 0, failedCount: 0, remainingCount: 0 };

    let syncedCount = 0;
    let failedCount = 0;

    for (const item of [...queue]) {
      if (item.status === 'syncing') continue;

      item.status = 'syncing';
      item.attempts = (item.attempts || 0) + 1;
      persistQueue(queue);
      onProgress?.(item);

      try {
        await api.post(item.endpoint, item.payload);
        syncedCount += 1;
        queue = queue.filter((q) => q.id !== item.id);
        persistQueue(queue);
      } catch (err) {
        if (!err.status || err.status === 0 || err.status >= 500) {
          item.status = 'queued';
          item.lastError = 'الخادم غير متاح حالياً؛ ستتم إعادة المحاولة تلقائياً عند الاتصال.';
          persistQueue(queue);
          break;
        } else {
          failedCount += 1;
          item.status = 'failed';
          item.lastError = err.message || `خطأ (${err.status})`;
          persistQueue(queue);
        }
      }
    }

    const remaining = getFinanceQueue();
    return { syncedCount, failedCount, remainingCount: remaining.length };
  } finally {
    isSyncing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void syncFinanceQueue();
  });
}
