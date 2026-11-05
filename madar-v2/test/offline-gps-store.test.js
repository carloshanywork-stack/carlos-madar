import assert from 'node:assert/strict';
import test from 'node:test';
import { DATABASE_VERSION, REQUIRED_OFFLINE_STORES, selectGpsSamplesForSync } from '../client/src/modules/rep/offline-store.js';

test('IndexedDB v5 includes every offline queue, map store, and the attendance cache RepApp reads', () => {
  assert.equal(DATABASE_VERSION, 5);
  for (const store of [
    'route_snapshots', 'reason_snapshots', 'pending_visits', 'pending_machine_actions',
    'gps_samples', 'offline_map_packs', 'offline_map_tiles', 'attendance_snapshots',
  ]) assert.ok(REQUIRED_OFFLINE_STORES.includes(store), `missing IndexedDB store ${store}`);
});

test('GPS recovery drains the oldest unsynced samples first without mutating the IndexedDB result', () => {
  const samples = [
    { sampleId: 'latest', capturedAt: '2026-11-03T12:00:03.000Z' },
    { sampleId: 'middle', capturedAt: '2026-11-03T12:00:02.000Z' },
    { sampleId: 'oldest', capturedAt: '2026-11-03T12:00:01.000Z' },
  ];
  const selected = selectGpsSamplesForSync(samples, 2);
  assert.deepEqual(selected.map((sample) => sample.sampleId), ['oldest', 'middle']);
  assert.deepEqual(samples.map((sample) => sample.sampleId), ['latest', 'middle', 'oldest']);
});

function fakeOfflineIndexedDB() {
  const databases = new Map();
  const requiredStores = {
    route_snapshots: ['repId', {}],
    reason_snapshots: ['repId', {}],
    pending_visits: ['visitUuid', { by_rep_created: ['repId', 'createdAt'] }],
    pending_machine_actions: ['actionUuid', {
      by_rep_created: ['repId', 'createdAt'],
      by_machine_created: ['machineId', 'createdAt'],
    }],
    gps_samples: ['sampleId', { by_rep_captured: ['repId', 'capturedAt'] }],
    offline_map_packs: ['packId', {}],
    offline_map_tiles: ['key', { by_pack: 'packId', by_pack_zoom: ['packId', 'z'] }],
    attendance_snapshots: ['repId', {}],
  };

  class NameList {
    constructor(values) { this.values = values; }
    contains(value) { return this.values().includes(value); }
  }

  class FakeStore {
    constructor(definition) { this.definition = definition; }
    get indexNames() { return new NameList(() => [...this.definition.indexes.keys()]); }
    createIndex(name, keyPath) {
      this.definition.indexes.set(name, { keyPath });
      return this.index(name);
    }
    index(name) {
      const index = this.definition.indexes.get(name);
      if (!index) throw new DOMException(`Index ${name} not found`, 'NotFoundError');
      return index;
    }
    put(value) {
      const key = Array.isArray(this.definition.keyPath)
        ? this.definition.keyPath.map((path) => value[path])
        : value[this.definition.keyPath];
      this.definition.records.set(JSON.stringify(key), structuredClone(value));
      return {};
    }
    get(key) {
      const request = { result: this.definition.records.get(JSON.stringify(key)) };
      setTimeout(() => request.onsuccess?.(), 0);
      return request;
    }
  }

  class FakeTransaction {
    constructor(database, storeNames) {
      this.database = database;
      this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
      for (const name of this.storeNames) {
        if (!database.state.stores.has(name)) throw new DOMException(`Object store ${name} not found`, 'NotFoundError');
      }
      setTimeout(() => this.oncomplete?.(), 0);
    }
    objectStore(name) {
      if (!this.storeNames.includes(name) || !this.database.state.stores.has(name)) {
        throw new DOMException(`Object store ${name} not found`, 'NotFoundError');
      }
      return new FakeStore(this.database.state.stores.get(name));
    }
  }

  class FakeDatabase {
    constructor(state) { this.state = state; }
    get version() { return this.state.version; }
    get objectStoreNames() { return new NameList(() => [...this.state.stores.keys()]); }
    createObjectStore(name, { keyPath }) {
      this.state.stores.set(name, { keyPath, indexes: new Map(), records: new Map() });
      return new FakeStore(this.state.stores.get(name));
    }
    transaction(storeNames) { return new FakeTransaction(this, storeNames); }
    close() {}
  }

  function upgrade(request, state, nextVersion) {
    const oldVersion = state.version;
    state.version = nextVersion;
    request.result = new FakeDatabase(state);
    request.transaction = new FakeTransaction(request.result, [...state.stores.keys()]);
    request.onupgradeneeded?.({ oldVersion, newVersion: nextVersion });
  }

  return {
    databases,
    seedCompleteDatabase(name) {
      const stores = new Map(Object.entries(requiredStores).map(([storeName, [keyPath, indexes]]) => [
        storeName,
        {
          keyPath,
          indexes: new Map(Object.entries(indexes).map(([indexName, indexKeyPath]) => [indexName, { keyPath: indexKeyPath }])),
          records: new Map(),
        },
      ]));
      stores.get('route_snapshots').records.set('42', {
        repId: 42,
        route: { regions: [{ name: 'preserved offline route' }] },
      });
      databases.set(name, { version: 5, stores });
      return databases.get(name);
    },
    open(name, requestedVersion) {
      const request = { result: null, transaction: null, error: null };
      setTimeout(() => {
        try {
          let state = databases.get(name);
          if (!state) {
            state = { version: 0, stores: new Map() };
            databases.set(name, state);
          }
          if (requestedVersion !== undefined && requestedVersion < state.version) {
            throw new DOMException('Requested version is lower than the current version', 'VersionError');
          }
          if (requestedVersion !== undefined && requestedVersion > state.version) upgrade(request, state, requestedVersion);
          else request.result = new FakeDatabase(state);
          request.onsuccess?.();
        } catch (error) {
          request.error = error;
          request.onerror?.();
        }
      }, 0);
      return request;
    },
  };
}

test('missing IndexedDB stores recover in place and remain readable after a repaired DB version is reopened', async () => {
  const priorWindow = globalThis.window;
  const priorIndexedDB = globalThis.indexedDB;
  const fakeIndexedDB = fakeOfflineIndexedDB();
  const name = 'madar-rep-offline';
  const state = fakeIndexedDB.seedCompleteDatabase(name);
  globalThis.indexedDB = fakeIndexedDB;
  globalThis.window = globalThis;

  try {
    const store = await import(`../client/src/modules/rep/offline-store.js?schema-recovery=${Date.now()}`);
    const route = await store.getSnapshot('route_snapshots', 42);
    assert.equal(route.route.regions[0].name, 'preserved offline route');

    // Simulate a legacy/corrupt store list after the connection was already opened.
    state.stores.delete('gps_samples');
    const location = {
      latitude: 30.0444,
      longitude: 31.2357,
      accuracy: 18,
      updatedAt: new Date().toISOString(),
    };
    assert.equal(await store.saveGpsSample(42, location), true);
    assert.ok(state.version > DATABASE_VERSION, 'schema repair should advance the on-device DB version');
    assert.equal(state.stores.get('route_snapshots').records.get('42').route.regions[0].name, 'preserved offline route');
    assert.equal(state.stores.get('gps_samples').records.size, 1);

    // A fresh app module starts at the static baseline version; it must open a
    // previously auto-repaired newer DB instead of throwing VersionError.
    const reloadedStore = await import(`../client/src/modules/rep/offline-store.js?schema-reopen=${Date.now()}`);
    const reopenedRoute = await reloadedStore.getSnapshot('route_snapshots', 42);
    assert.equal(reopenedRoute.route.regions[0].name, 'preserved offline route');
  } finally {
    if (priorIndexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = priorIndexedDB;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});
