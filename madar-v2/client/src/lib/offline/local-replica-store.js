/**
 * MADAR Local Replica Store (IndexedDB)
 * Stores local read copies of machines, clients, and materials on the user's device,
 * enabling instantaneous 0ms page loads and full offline directory browsing.
 */

const DB_NAME = 'madar-local-replica';
const DB_VERSION = 1;

function openDatabase() {
  const idb = typeof window !== 'undefined' ? window.indexedDB : globalThis.indexedDB;
  if (!idb) {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('machines')) {
        const machineStore = db.createObjectStore('machines', { keyPath: 'id' });
        machineStore.createIndex('by_code', 'code', { unique: false });
        machineStore.createIndex('by_area', 'area', { unique: false });
      }
      if (!db.objectStoreNames.contains('clients')) {
        const clientStore = db.createObjectStore('clients', { keyPath: 'id' });
        clientStore.createIndex('by_name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('materials')) {
        const materialStore = db.createObjectStore('materials', { keyPath: 'id' });
        materialStore.createIndex('by_sku', 'sku', { unique: false });
      }
      if (!db.objectStoreNames.contains('offline_actions')) {
        const actionStore = db.createObjectStore('offline_actions', { keyPath: 'id' });
        actionStore.createIndex('by_created', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(storeName, mode, callback) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

      result = callback(store);
    });
  });
}

// --- Machines Replica ---
export async function cacheReplicaMachines(machines = []) {
  if (!machines.length) return;
  return runTransaction('machines', 'readwrite', (store) => {
    for (const machine of machines) {
      if (machine?.id) store.put(machine);
    }
  });
}

export async function getReplicaMachines() {
  return runTransaction('machines', 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }).catch(() => []);
}

// --- Clients Replica ---
export async function cacheReplicaClients(clients = []) {
  if (!clients.length) return;
  return runTransaction('clients', 'readwrite', (store) => {
    for (const client of clients) {
      if (client?.id) store.put(client);
    }
  });
}

export async function getReplicaClients() {
  return runTransaction('clients', 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }).catch(() => []);
}

// --- Materials Replica ---
export async function cacheReplicaMaterials(materials = []) {
  if (!materials.length) return;
  return runTransaction('materials', 'readwrite', (store) => {
    for (const mat of materials) {
      if (mat?.id) store.put(mat);
    }
  });
}

export async function getReplicaMaterials() {
  return runTransaction('materials', 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }).catch(() => []);
}

// --- Generic Offline Actions Outbox ---
export async function enqueueOfflineAction(action) {
  const item = {
    id: action.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: action.type,
    endpoint: action.endpoint,
    payload: action.payload,
    label: action.label || action.type,
    createdAt: new Date().toISOString(),
    status: 'queued',
  };

  await runTransaction('offline_actions', 'readwrite', (store) => {
    store.put(item);
  });
  return item;
}

export async function listOfflineActions() {
  return runTransaction('offline_actions', 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }).catch(() => []);
}

export async function removeOfflineAction(id) {
  return runTransaction('offline_actions', 'readwrite', (store) => {
    store.delete(id);
  });
}
