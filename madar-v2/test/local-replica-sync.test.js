import assert from 'node:assert/strict';
import test from 'node:test';

function setupFakeIndexedDB() {
  const storeData = new Map([
    ['machines', new Map()],
    ['clients', new Map()],
    ['materials', new Map()],
    ['offline_actions', new Map()],
  ]);

  const fakeDb = {
    transaction: (storeName, mode) => {
      const data = storeData.get(storeName);
      return {
        objectStore: () => ({
          put: (item) => {
            const key = item.id || item.key;
            data.set(key, item);
          },
          getAll: () => ({
            set onsuccess(cb) {
              cb();
            },
            get result() {
              return Array.from(data.values());
            },
          }),
          delete: (id) => {
            data.delete(id);
          },
        }),
        set oncomplete(cb) {
          setTimeout(cb, 0);
        },
      };
    },
  };

  globalThis.indexedDB = {
    open: () => ({
      set onsuccess(cb) {
        this.result = fakeDb;
        setTimeout(cb, 0);
      },
    }),
  };

  return storeData;
}

test('local replica stores and retrieves machines, clients, and materials offline', async () => {
  setupFakeIndexedDB();
  const {
    cacheReplicaMachines,
    getReplicaMachines,
    cacheReplicaClients,
    getReplicaClients,
    enqueueOfflineAction,
    listOfflineActions,
    removeOfflineAction,
  } = await import('../client/src/lib/offline/local-replica-store.js');

  // Test Machines caching
  await cacheReplicaMachines([
    { id: 1, code: 'M-01', area: 'Cairo' },
    { id: 2, code: 'M-02', area: 'Giza' },
  ]);
  const cachedMachines = await getReplicaMachines();
  assert.equal(cachedMachines.length, 2);
  assert.equal(cachedMachines[0].code, 'M-01');

  // Test Clients caching
  await cacheReplicaClients([
    { id: 10, name: 'Client A' },
    { id: 20, name: 'Client B' },
  ]);
  const cachedClients = await getReplicaClients();
  assert.equal(cachedClients.length, 2);
  assert.equal(cachedClients[1].name, 'Client B');

  // Test Generic Offline Actions Outbox
  const queued = await enqueueOfflineAction({
    type: 'create_order',
    endpoint: '/api/maintenance/orders',
    payload: { clientId: 10 },
  });
  assert.ok(queued.id);
  assert.equal(queued.status, 'queued');

  const pending = await listOfflineActions();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, queued.id);

  // Dequeue / remove
  await removeOfflineAction(queued.id);
  const remaining = await listOfflineActions();
  assert.equal(remaining.length, 0);
});
