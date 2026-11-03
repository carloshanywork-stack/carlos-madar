const DATABASE_NAME = 'madar-rep-offline';
const DATABASE_VERSION = 1;
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
