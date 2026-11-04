import assert from 'node:assert/strict';
import test from 'node:test';
import { selectGpsSamplesForSync } from '../client/src/modules/rep/offline-store.js';

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
