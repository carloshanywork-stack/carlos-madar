const DATABASE_NAME = 'madar-rep-offline';
export const DATABASE_VERSION = 5;
export const REQUIRED_OFFLINE_STORES = Object.freeze([
  'route_snapshots',
  'reason_snapshots',
  'pending_visits',
  'pending_machine_actions',
  'gps_samples',
  'offline_map_packs',
  'offline_map_tiles',
  'attendance_snapshots',
]);
const REQUIRED_OFFLINE_INDEXES = Object.freeze({
  pending_visits: { by_rep_created: ['repId', 'createdAt'] },
  pending_machine_actions: {
    by_rep_created: ['repId', 'createdAt'],
    by_machine_created: ['machineId', 'createdAt'],
  },
  gps_samples: { by_rep_captured: ['repId', 'capturedAt'] },
  offline_map_tiles: { by_pack: 'packId', by_pack_zoom: ['packId', 'z'] },
});
let databasePromise;
let databaseRecoveryPromise;

function createStore(database, transaction, name, keyPath, indexes = []) {
  const store = database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, { keyPath });
  for (const [indexName, path] of indexes) {
    if (!store.indexNames.contains(indexName)) store.createIndex(indexName, path, { unique: false });
  }
}

function migrateDatabase(request) {
  const database = request.result;
  const transaction = request.transaction;
  createStore(database, transaction, 'route_snapshots', 'repId');
  createStore(database, transaction, 'reason_snapshots', 'repId');
  createStore(database, transaction, 'pending_visits', 'visitUuid', [['by_rep_created', ['repId', 'createdAt']]]);
  createStore(database, transaction, 'pending_machine_actions', 'actionUuid', [
    ['by_rep_created', ['repId', 'createdAt']],
    ['by_machine_created', ['machineId', 'createdAt']],
  ]);
  createStore(database, transaction, 'gps_samples', 'sampleId', [['by_rep_captured', ['repId', 'capturedAt']]]);
  createStore(database, transaction, 'offline_map_packs', 'packId');
  createStore(database, transaction, 'offline_map_tiles', 'key', [
    ['by_pack', 'packId'],
    ['by_pack_zoom', ['packId', 'z']],
  ]);
  // RepApp has always cached attendance through getSnapshot/saveSnapshot; older
  // DB versions omitted this store, causing NotFoundError on first attendance use.
  createStore(database, transaction, 'attendance_snapshots', 'repId');
}

function openDatabaseAtVersion(version) {
  return new Promise((resolve, reject) => {
    const request = version === undefined
      ? indexedDB.open(DATABASE_NAME)
      : indexedDB.open(DATABASE_NAME, version);
    request.onupgradeneeded = () => migrateDatabase(request);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذر فتح التخزين المحلي.'));
    request.onblocked = () => reject(new Error('أغلق نسخة MADAR الأخرى لإكمال إصلاح قاعدة البيانات المحلية.'));
  });
}

function sameKeyPath(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((part, index) => actual[index] === part);
  }
  return actual === expected;
}

function hasRequiredSchema(database) {
  if (REQUIRED_OFFLINE_STORES.some((name) => !database.objectStoreNames.contains(name))) return false;
  try {
    const transaction = database.transaction(Object.keys(REQUIRED_OFFLINE_INDEXES), 'readonly');
    return Object.entries(REQUIRED_OFFLINE_INDEXES).every(([storeName, indexes]) => {
      const store = transaction.objectStore(storeName);
      return Object.entries(indexes).every(([indexName, keyPath]) => (
        store.indexNames.contains(indexName) && sameKeyPath(store.index(indexName).keyPath, keyPath)
      ));
    });
  } catch {
    return false;
  }
}

function attachDatabaseLifecycle(database) {
  database.onversionchange = () => {
    database.close();
    databasePromise = null;
  };
  return database;
}

async function openAndRepairDatabase() {
  let database;
  try {
    database = await openDatabaseAtVersion(DATABASE_VERSION);
  } catch (error) {
    // A previous auto-repair may have advanced the on-device DB beyond the app's
    // baseline version. Open the latest version rather than failing with VersionError.
    if (error?.name !== 'VersionError') throw error;
    database = await openDatabaseAtVersion();
  }
  if (!hasRequiredSchema(database)) {
    // Add missing stores/indexes in place. Never delete the DB: it may contain
    // visits, photos, GPS samples, and maps that have not reached the server yet.
    const repairVersion = database.version + 1;
    database.close();
    database = await openDatabaseAtVersion(repairVersion);
    if (!hasRequiredSchema(database)) {
      database.close();
      throw new Error('تعذر إصلاح مخازن وفهارس قاعدة البيانات المحلية.');
    }
  }
  return attachDatabaseLifecycle(database);
}

function isMissingSchemaError(error) {
  return error?.name === 'NotFoundError'
    || /object store .*not found|object store .*does not exist|missing object store/i.test(String(error?.message ?? ''));
}

async function recoverMissingSchema(database) {
  if (databaseRecoveryPromise) return databaseRecoveryPromise;
  const recovery = (async () => {
    const previousPromise = databasePromise;
    database.close();
    const previousDatabase = await previousPromise?.catch(() => null);
    if (previousDatabase && previousDatabase !== database) previousDatabase.close();

    const latestDatabase = await openDatabaseAtVersion();
    if (hasRequiredSchema(latestDatabase)) return attachDatabaseLifecycle(latestDatabase);
    const repairVersion = latestDatabase.version + 1;
    latestDatabase.close();
    const repairedDatabase = await openDatabaseAtVersion(repairVersion);
    if (!hasRequiredSchema(repairedDatabase)) {
      repairedDatabase.close();
      throw new Error('تعذر إصلاح مخازن وفهارس قاعدة البيانات المحلية.');
    }
    return attachDatabaseLifecycle(repairedDatabase);
  })();
  databaseRecoveryPromise = recovery;
  databasePromise = recovery;
  try {
    return await recovery;
  } catch (error) {
    if (databasePromise === recovery) databasePromise = null;
    throw error;
  } finally {
    if (databaseRecoveryPromise === recovery) databaseRecoveryPromise = null;
  }
}

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('التخزين المحلي غير متاح في هذا المتصفح.'));
  if (databaseRecoveryPromise) return databaseRecoveryPromise;
  if (databasePromise) return databasePromise;

  databasePromise = openAndRepairDatabase().catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

async function createTransaction(storeNames, mode) {
  let database = await openDatabase();
  try {
    return database.transaction(storeNames, mode);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    database = await recoverMissingSchema(database);
    return database.transaction(storeNames, mode);
  }
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذر قراءة التخزين المحلي.'));
  });
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    // The browser can deny persistence; IndexedDB remains available until evicted.
  }
  return false;
}

/** Persist browser GPS breadcrumbs before attempting the network sync. */
export async function saveGpsSample(repId, location) {
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
      || !Number.isFinite(location.accuracy) || !Number.isFinite(Date.parse(location.updatedAt))) return false;
  const transaction = await createTransaction('gps_samples', 'readwrite');
  const capturedAt = new Date(location.updatedAt).toISOString();
  const sampleId = `${Number(repId)}:${capturedAt}:${Math.random().toString(36).slice(2, 10)}`;
  transaction.objectStore('gps_samples').put({
    sampleId,
    repId: Number(repId),
    capturedAt,
    location: { ...location, updatedAt: capturedAt },
  });
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ نقطة GPS محلياً.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ نقطة GPS المحلية.'));
  });
}

export async function listGpsSamples(repId, limit = 20000) {
  const transaction = await createTransaction('gps_samples', 'readonly');
  const samples = await requestValue(transaction.objectStore('gps_samples').index('by_rep_captured').getAll(
    IDBKeyRange.bound([Number(repId), ''], [Number(repId), '\uffff']),
  ));
  return selectGpsSamplesForSync(samples, limit);
}

/** Keep the oldest unsynced points first so a long offline backlog cannot starve earlier GPS data. */
export function selectGpsSamplesForSync(samples, limit = 20000) {
  const maximum = Number.isSafeInteger(limit) && limit > 0 ? limit : 20000;
  return [...samples]
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt))
    .slice(0, maximum);
}

export async function deleteGpsSamples(sampleIds) {
  if (!sampleIds?.length) return 0;
  const transaction = await createTransaction('gps_samples', 'readwrite');
  const store = transaction.objectStore('gps_samples');
  for (const sampleId of sampleIds) store.delete(sampleId);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(sampleIds.length);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر تنظيف نقاط GPS التي تمت مزامنتها.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي تنظيف نقاط GPS المحلية.'));
  });
}

export async function getSnapshot(storeName, repId) {
  const transaction = await createTransaction(storeName, 'readonly');
  return requestValue(transaction.objectStore(storeName).get(Number(repId)));
}

export async function saveSnapshot(storeName, repId, data) {
  const transaction = await createTransaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put({ repId: Number(repId), ...data });
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ بيانات المسار محلياً.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ البيانات المحلية.'));
  });
}

export async function clearSnapshot(storeName, repId) {
  const transaction = await createTransaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(Number(repId));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف النسخة المحلية.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حذف النسخة المحلية.'));
  });
}

export async function listOfflineMapPacks() {
  const transaction = await createTransaction('offline_map_packs', 'readonly');
  return requestValue(transaction.objectStore('offline_map_packs').getAll());
}

export async function saveOfflineMapPack(pack) {
  if (!pack?.packId) throw new Error('معرّف حزمة الخريطة غير صالح.');
  const transaction = await createTransaction('offline_map_packs', 'readwrite');
  transaction.objectStore('offline_map_packs').put({ ...pack, packId: String(pack.packId), updatedAt: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ بيانات حزمة الخريطة.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ بيانات حزمة الخريطة.'));
  });
}

export async function saveOfflineMapTiles(packId, tiles) {
  if (!tiles?.length) return 0;
  const transaction = await createTransaction('offline_map_tiles', 'readwrite');
  const store = transaction.objectStore('offline_map_tiles');
  for (const tile of tiles) {
    store.put({
      key: [String(packId), Number(tile.z), Number(tile.x), Number(tile.y)],
      packId: String(packId),
      z: Number(tile.z),
      x: Number(tile.x),
      y: Number(tile.y),
      blob: tile.blob,
    });
  }
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(tiles.length);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ بلاطات الخريطة على الهاتف.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ بلاطات الخريطة المحلية.'));
  });
}

export async function getOfflineMapTile(packId, zoom, column, row) {
  const transaction = await createTransaction('offline_map_tiles', 'readonly');
  const tile = await requestValue(transaction.objectStore('offline_map_tiles').get([
    String(packId), Number(zoom), Number(column), Number(row),
  ]));
  return tile?.blob ?? null;
}

export async function listOfflineMapTileKeys(packId) {
  const transaction = await createTransaction('offline_map_tiles', 'readonly');
  const keys = await requestValue(transaction.objectStore('offline_map_tiles').index('by_pack')
    .getAllKeys(IDBKeyRange.only(String(packId))));
  return keys.map((key) => `${key[1]}/${key[2]}/${key[3]}`);
}

export async function deleteOfflineMapPack(packId) {
  const transaction = await createTransaction(['offline_map_tiles', 'offline_map_packs'], 'readwrite');
  const tileStore = transaction.objectStore('offline_map_tiles');
  const cursorRequest = tileStore.index('by_pack').openKeyCursor(IDBKeyRange.only(String(packId)));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      tileStore.delete(cursor.primaryKey);
      cursor.continue();
    }
  };
  transaction.objectStore('offline_map_packs').delete(String(packId));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف حزمة الخريطة المحلية.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حذف حزمة الخريطة المحلية.'));
  });
}

export async function addPendingVisit(visit) {
  const transaction = await createTransaction('pending_visits', 'readwrite');
  transaction.objectStore('pending_visits').add(visit);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(visit);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ الزيارة على الهاتف.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ الزيارة على الهاتف.'));
  });
}

export async function listPendingVisits(repId) {
  const transaction = await createTransaction('pending_visits', 'readonly');
  const visits = await requestValue(
    transaction.objectStore('pending_visits').index('by_rep_created').getAll(
      IDBKeyRange.bound([Number(repId), ''], [Number(repId), '\uffff']),
    ),
  );
  return visits.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function getPendingVisit(visitUuid) {
  const transaction = await createTransaction('pending_visits', 'readonly');
  return requestValue(transaction.objectStore('pending_visits').get(visitUuid));
}

export async function updatePendingVisit(visitUuid, updates) {
  const transaction = await createTransaction('pending_visits', 'readwrite');
  const store = transaction.objectStore('pending_visits');
  const request = store.get(visitUuid);
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, ...updates });
  };
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(Boolean(request.result));
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر تحديث حالة الزيارة.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي تحديث الزيارة.'));
  });
}

export async function deletePendingVisit(visitUuid) {
  const transaction = await createTransaction('pending_visits', 'readwrite');
  transaction.objectStore('pending_visits').delete(visitUuid);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف الزيارة المزامنة.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حذف الزيارة المزامنة.'));
  });
}

/** Durable outbox for first-visit confirmations and wrong-machine corrections (including photo evidence). */
export async function addPendingMachineAction(action) {
  const transaction = await createTransaction('pending_machine_actions', 'readwrite');
  transaction.objectStore('pending_machine_actions').add(action);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(action);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ إجراء الماكينة على الهاتف.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ إجراء الماكينة على الهاتف.'));
  });
}

export async function listPendingMachineActions(repId) {
  const transaction = await createTransaction('pending_machine_actions', 'readonly');
  const actions = await requestValue(transaction.objectStore('pending_machine_actions').index('by_rep_created').getAll(
    IDBKeyRange.bound([Number(repId), ''], [Number(repId), '\uffff']),
  ));
  return actions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function updatePendingMachineAction(actionUuid, updates) {
  const transaction = await createTransaction('pending_machine_actions', 'readwrite');
  const store = transaction.objectStore('pending_machine_actions');
  const request = store.get(actionUuid);
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, ...updates });
  };
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(Boolean(request.result));
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر تحديث إجراء الماكينة.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي تحديث إجراء الماكينة.'));
  });
}

export async function deletePendingMachineAction(actionUuid) {
  const transaction = await createTransaction('pending_machine_actions', 'readwrite');
  transaction.objectStore('pending_machine_actions').delete(actionUuid);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف الإجراء المزامن.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حذف الإجراء المزامن.'));
  });
}

export async function markRouteCardSubmitted(repId, cardId, status = 'pending_review') {
  const transaction = await createTransaction('route_snapshots', 'readwrite');
  const store = transaction.objectStore('route_snapshots');
  const request = store.get(Number(repId));
  request.onsuccess = () => {
    const snapshot = request.result;
    if (!snapshot?.route) return;
    for (const region of snapshot.route.regions ?? []) {
      for (const machine of region.machines ?? []) {
        if (Number(machine.cardId) === Number(cardId)) {
          machine.isCompleted = status === 'approved';
          machine.isSubmitted = status !== 'reshoot_requested';
          machine.reviewStatus = status === 'approved' ? 'approved' : status === 'reshoot_requested' ? 'reshoot' : 'pending';
          machine.canVisit = status === 'reshoot_requested';
        }
      }
    }
    const machines = (snapshot.route.regions ?? []).flatMap((region) => region.machines ?? []);
    const completed = machines.filter((machine) => machine.isCompleted).length;
    snapshot.route.summary = {
      totalMachines: machines.length,
      completed,
      pending: machines.length - completed,
      pendingReview: machines.filter((machine) => machine.isSubmitted && !machine.isCompleted).length,
      progress: machines.length ? Math.floor((completed / machines.length) * 100) : 0,
    };
    snapshot.cachedAt = new Date().toISOString();
    store.put(snapshot);
  };
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(Boolean(request.result));
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر تحديث المسار المحلي.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي تحديث المسار المحلي.'));
  });
}
