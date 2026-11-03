import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distanceBetweenGpsPointsMeters,
  getAdaptiveGpsInterval,
  GPS_POLLING,
} from '../client/src/modules/rep/gps-adaptive.js';

test('adaptive GPS reduces polling only after three stationary minutes', () => {
  assert.equal(getAdaptiveGpsInterval({ stationaryDurationMs: 179_999 }), GPS_POLLING.movingIntervalMs);
  assert.equal(getAdaptiveGpsInterval({ speedMetersPerSecond: 0.4, displacementMeters: 2, stationaryDurationMs: 180_000 }), GPS_POLLING.stationaryIntervalMs);
});

test('adaptive GPS immediately restores high-frequency polling on speed or displacement', () => {
  assert.equal(getAdaptiveGpsInterval({ speedMetersPerSecond: 0.6, stationaryDurationMs: 240_000 }), GPS_POLLING.movingIntervalMs);
  assert.equal(getAdaptiveGpsInterval({ displacementMeters: 16, stationaryDurationMs: 240_000 }), GPS_POLLING.movingIntervalMs);
  assert.ok(distanceBetweenGpsPointsMeters({ latitude: 30, longitude: 31 }, { latitude: 30, longitude: 31.001 }) > 90);
});
