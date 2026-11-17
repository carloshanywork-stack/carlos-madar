import assert from 'node:assert/strict';
import test from 'node:test';

// Set up mock window and localStorage for Node test environment
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const {
  getFinanceQueue,
  enqueueFinanceOperation,
  removeFinanceQueueItem,
  clearFinanceQueue,
  syncFinanceQueue,
} = await import('../client/src/modules/finance/finance-offline-queue.js');

test('finance offline queue enqueues, reads, and removes items cleanly', () => {
  clearFinanceQueue();
  assert.equal(getFinanceQueue().length, 0);

  const item1 = enqueueFinanceOperation({
    type: 'treasury_entry',
    label: 'حركة خزينة (إيراد 500 ج.م)',
    endpoint: '/api/finance/treasury/entries',
    payload: { kind: 'income', category: 'مبيعات', amountCents: 50000 },
  });

  assert.ok(item1.id);
  assert.equal(item1.status, 'queued');
  assert.equal(getFinanceQueue().length, 1);
  assert.equal(getFinanceQueue()[0].label, 'حركة خزينة (إيراد 500 ج.م)');

  const item2 = enqueueFinanceOperation({
    type: 'purchase_invoice',
    label: 'فاتورة شراء: مورد الأمل',
    endpoint: '/api/finance/invoices/purchase',
    payload: { supplier: 'الأمل', items: [] },
  });

  assert.equal(getFinanceQueue().length, 2);

  removeFinanceQueueItem(item1.id);
  assert.equal(getFinanceQueue().length, 1);
  assert.equal(getFinanceQueue()[0].id, item2.id);

  clearFinanceQueue();
  assert.equal(getFinanceQueue().length, 0);
});

test('syncFinanceQueue processes queued items and handles network vs business errors', async () => {
  clearFinanceQueue();

  const { api, ApiError } = await import('../client/src/lib/api.js');
  const originalPost = api.post;

  try {
    enqueueFinanceOperation({
      type: 'treasury_entry',
      label: 'حركة ناجحة',
      endpoint: '/api/finance/treasury/entries',
      payload: { amountCents: 1000 },
    });

    enqueueFinanceOperation({
      type: 'purchase_invoice',
      label: 'حركة خطأ تحقق',
      endpoint: '/api/finance/invoices/purchase',
      payload: { supplier: '' },
    });

    api.post = async (path, body) => {
      if (path === '/api/finance/treasury/entries') {
        return { ok: true, id: 101 };
      }
      throw new ApiError('المورد مطلوب', 400, { error: 'SUPPLIER_REQUIRED' });
    };

    const res = await syncFinanceQueue();
    assert.equal(res.syncedCount, 1);
    assert.equal(res.failedCount, 1);
    assert.equal(res.remainingCount, 1);

    const remaining = getFinanceQueue();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].status, 'failed');
    assert.match(remaining[0].lastError, /المورد مطلوب/);
  } finally {
    api.post = originalPost;
    clearFinanceQueue();
  }
});
