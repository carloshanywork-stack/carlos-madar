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
