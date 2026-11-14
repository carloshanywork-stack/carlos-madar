import assert from 'node:assert/strict';
import test from 'node:test';
import { usableNativeGpsSnapshot } from '../client/src/modules/rep/native-gps-state.js';

const now = Date.parse('2026-11-14T08:00:00Z');
const state = { gpsEnabled: true, lastLocation: { latitude: 30, longitude: 31, accuracy: 5, timestamp: now } };

test('provider-disabled and mocked duty snapshots never restore a cached GPS fix', () => {
  assert.ok(usableNativeGpsSnapshot(state, now));
  assert.equal(usableNativeGpsSnapshot({ ...state, gpsEnabled: false }, now), null);
  assert.equal(usableNativeGpsSnapshot({ ...state, mocked: true }, now), null);
});

test('cached native GPS freshness has exact age/future boundaries and rejects malformed fixes', () => {
  const at = (timestamp) => ({ ...state, lastLocation: { ...state.lastLocation, timestamp } });
  assert.ok(usableNativeGpsSnapshot(at(now - 300000), now));
  assert.equal(usableNativeGpsSnapshot(at(now - 300001), now), null);
  assert.ok(usableNativeGpsSnapshot(at(now + 60000), now));
  assert.equal(usableNativeGpsSnapshot(at(now + 60001), now), null);
  assert.equal(usableNativeGpsSnapshot(at('bad'), now), null);
  assert.equal(usableNativeGpsSnapshot({ ...state, lastLocation: { ...state.lastLocation, accuracy: 251 } }, now), null);
});
