const DATABASE_NAME = 'madar-rep-offline';
const DATABASE_VERSION = 4;
let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('التخزين المحلي غير متاح في هذا المتصفح.'));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('route_snapshots')) {
        database.createObjectStore('route_snapshots', { keyPath: 'repId' });
      }
      if (!database.objectStoreNames.contains('reason_snapshots')) {
        database.createObjectStore('reason_snapshots', { keyPath: 'repId' });
      }
      if (!database.objectStoreNames.contains('pending_visits')) {
        const visits = database.createObjectStore('pending_visits', { keyPath: 'visitUuid' });
        visits.createIndex('by_rep_created', ['repId', 'createdAt'], { unique: false });
      }
      if (!database.objectStoreNames.contains('pending_machine_actions')) {
        const actions = database.createObjectStore('pending_machine_actions', { keyPath: 'actionUuid' });
        actions.createIndex('by_rep_created', ['repId', 'createdAt'], { unique: false });
        actions.createIndex('by_machine_created', ['machineId', 'createdAt'], { unique: false });
      }
      if (!database.objectStoreNames.contains('gps_samples')) {
        const gps = database.createObjectStore('gps_samples', { keyPath: 'sampleId' });
        gps.createIndex('by_rep_captured', ['repId', 'capturedAt'], { unique: false });
      }
      if (!database.objectStoreNames.contains('offline_map_packs')) {
        database.createObjectStore('offline_map_packs', { keyPath: 'packId' });
      }
      if (!database.objectStoreNames.contains('offline_map_tiles')) {
        const tiles = database.createObjectStore('offline_map_tiles', { keyPath: 'key' });
        tiles.createIndex('by_pack', 'packId', { unique: false });
        tiles.createIndex('by_pack_zoom', ['packId', 'z'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('تعذر فتح التخزين المحلي.'));
    request.onblocked = () => reject(new Error('أغلق نسخة MADAR الأخرى ثم حاول مجدداً.'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
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
  const database = await openDatabase();
  const transaction = database.transaction('gps_samples', 'readwrite');
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
  const database = await openDatabase();
  const transaction = database.transaction('gps_samples', 'readonly');
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
  const database = await openDatabase();
  const transaction = database.transaction('gps_samples', 'readwrite');
  const store = transaction.objectStore('gps_samples');
  for (const sampleId of sampleIds) store.delete(sampleId);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(sampleIds.length);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر تنظيف نقاط GPS التي تمت مزامنتها.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي تنظيف نقاط GPS المحلية.'));
  });
}

export async function getSnapshot(storeName, repId) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  return requestValue(transaction.objectStore(storeName).get(Number(repId)));
}

export async function saveSnapshot(storeName, repId, data) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put({ repId: Number(repId), ...data });
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ بيانات المسار محلياً.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ البيانات المحلية.'));
  });
}

export async function listOfflineMapPacks() {
  const database = await openDatabase();
  const transaction = database.transaction('offline_map_packs', 'readonly');
  return requestValue(transaction.objectStore('offline_map_packs').getAll());
}

export async function saveOfflineMapPack(pack) {
  if (!pack?.packId) throw new Error('معرّف حزمة الخريطة غير صالح.');
  const database = await openDatabase();
  const transaction = database.transaction('offline_map_packs', 'readwrite');
  transaction.objectStore('offline_map_packs').put({ ...pack, packId: String(pack.packId), updatedAt: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ بيانات حزمة الخريطة.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ بيانات حزمة الخريطة.'));
  });
}

export async function saveOfflineMapTiles(packId, tiles) {
  if (!tiles?.length) return 0;
  const database = await openDatabase();
  const transaction = database.transaction('offline_map_tiles', 'readwrite');
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
  const database = await openDatabase();
  const transaction = database.transaction('offline_map_tiles', 'readonly');
  const tile = await requestValue(transaction.objectStore('offline_map_tiles').get([
    String(packId), Number(zoom), Number(column), Number(row),
  ]));
  return tile?.blob ?? null;
}

export async function listOfflineMapTileKeys(packId) {
  const database = await openDatabase();
  const transaction = database.transaction('offline_map_tiles', 'readonly');
  const keys = await requestValue(transaction.objectStore('offline_map_tiles').index('by_pack')
    .getAllKeys(IDBKeyRange.only(String(packId))));
  return keys.map((key) => `${key[1]}/${key[2]}/${key[3]}`);
}

export async function deleteOfflineMapPack(packId) {
  const database = await openDatabase();
  const transaction = database.transaction(['offline_map_tiles', 'offline_map_packs'], 'readwrite');
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
  const database = await openDatabase();
  const transaction = database.transaction('pending_visits', 'readwrite');
  transaction.objectStore('pending_visits').add(visit);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(visit);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ الزيارة على الهاتف.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ الزيارة على الهاتف.'));
  });
}

export async function listPendingVisits(repId) {
  const database = await openDatabase();
  const transaction = database.transaction('pending_visits', 'readonly');
  const visits = await requestValue(
    transaction.objectStore('pending_visits').index('by_rep_created').getAll(
      IDBKeyRange.bound([Number(repId), ''], [Number(repId), '\uffff']),
    ),
  );
  return visits.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function getPendingVisit(visitUuid) {
  const database = await openDatabase();
  const transaction = database.transaction('pending_visits', 'readonly');
  return requestValue(transaction.objectStore('pending_visits').get(visitUuid));
}

export async function updatePendingVisit(visitUuid, updates) {
  const database = await openDatabase();
  const transaction = database.transaction('pending_visits', 'readwrite');
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
  const database = await openDatabase();
  const transaction = database.transaction('pending_visits', 'readwrite');
  transaction.objectStore('pending_visits').delete(visitUuid);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف الزيارة المزامنة.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حذف الزيارة المزامنة.'));
  });
}

/** Durable outbox for first-visit confirmations and wrong-machine corrections (including photo evidence). */
export async function addPendingMachineAction(action) {
  const database = await openDatabase();
  const transaction = database.transaction('pending_machine_actions', 'readwrite');
  transaction.objectStore('pending_machine_actions').add(action);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(action);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حفظ إجراء الماكينة على الهاتف.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حفظ إجراء الماكينة على الهاتف.'));
  });
}

export async function listPendingMachineActions(repId) {
  const database = await openDatabase();
  const transaction = database.transaction('pending_machine_actions', 'readonly');
  const actions = await requestValue(transaction.objectStore('pending_machine_actions').index('by_rep_created').getAll(
    IDBKeyRange.bound([Number(repId), ''], [Number(repId), '\uffff']),
  ));
  return actions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function updatePendingMachineAction(actionUuid, updates) {
  const database = await openDatabase();
  const transaction = database.transaction('pending_machine_actions', 'readwrite');
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
  const database = await openDatabase();
  const transaction = database.transaction('pending_machine_actions', 'readwrite');
  transaction.objectStore('pending_machine_actions').delete(actionUuid);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error ?? new Error('تعذر حذف الإجراء المزامن.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('أُلغي حذف الإجراء المزامن.'));
  });
}

export async function markRouteCardSubmitted(repId, cardId, status = 'pending_review') {
  const database = await openDatabase();
  const transaction = database.transaction('route_snapshots', 'readwrite');
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
