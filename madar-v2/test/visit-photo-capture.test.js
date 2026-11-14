import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstUnusedPhotoIndex,
  isEligibleVisitGps,
  mergeCapturedPhotoResults,
  validateVisitPhotoCaptureLocation,
} from '../client/src/modules/rep/visit-photo-capture.js';

const now = Date.parse('2026-11-14T12:00:00.000Z');
const fix = (overrides = {}) => ({
  latitude: 30.0444,
  longitude: 31.2357,
  accuracy: 8,
  updatedAt: new Date(now).toISOString(),
  ...overrides,
});
const machine = { isLocationLocked: true, latitude: 30.0444, longitude: 31.2357, geofenceRadiusMeters: 50 };

test('visit capture requires a fresh, precise, non-mock fix and the existing machine geofence', () => {
  assert.equal(isEligibleVisitGps(fix(), now), true);
  assert.equal(isEligibleVisitGps(fix({ updatedAt: new Date(now - 5 * 60_000 - 1).toISOString() }), now), false);
  assert.equal(isEligibleVisitGps(fix({ mocked: true }), now), false);
  assert.equal(isEligibleVisitGps(fix({ accuracy: 101 }), now), false);
  assert.throws(() => validateVisitPhotoCaptureLocation(null, machine, now), /GPS حديث ودقيق/);
  assert.throws(() => validateVisitPhotoCaptureLocation(fix({ latitude: 31 }), machine, now), /خارج نطاق الماكينة/);
  assert.throws(() => validateVisitPhotoCaptureLocation(fix(), { ...machine, isLocationLocked: false }, now), /لم يتم تأكيد موقع/);
  assert.deepEqual(validateVisitPhotoCaptureLocation(fix(), machine, now), { radius: 50, effectiveDistance: 0 });
});

test('GPS failure leaves captured refs retryable once in both Before and After phases', () => {
  for (const phase of ['before', 'after']) {
    const captures = [0, 1, 2].map((index) => ({
      captureId: `${phase}-${index}`,
      sourceUri: `file:///private/${phase}-${index}.jpg`,
      photoIndex: index,
      capturedAt: new Date(now + index * 1000).toISOString(),
      location: fix({ updatedAt: new Date(now + index * 1000).toISOString() }),
    }));
    const pendingAfterFailedGpsLookup = mergeCapturedPhotoResults([], captures, 20);
    assert.equal(pendingAfterFailedGpsLookup.length, 3, `${phase}: captures survive a null GPS result`);
    const retried = mergeCapturedPhotoResults(pendingAfterFailedGpsLookup, captures, 20);
    assert.equal(retried.length, 3, `${phase}: retrying the returned group does not duplicate it`);
    assert.deepEqual(retried.map((item) => item.capturedAt), captures.map((item) => item.capturedAt));
    assert.deepEqual(retried.map((item) => item.location), captures.map((item) => item.location));
  }
});

test('processed slot selection skips occupied indexes and enforces the phase limit', () => {
  assert.equal(firstUnusedPhotoIndex([{ photoIndex: 0 }, { photoIndex: 2 }], 20), 1);
  assert.equal(firstUnusedPhotoIndex(Array.from({ length: 20 }, (_, photoIndex) => ({ photoIndex })), 20), -1);
});
