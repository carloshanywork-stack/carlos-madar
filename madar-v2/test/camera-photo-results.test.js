import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNativeVisitPhotoResults } from '../client/src/modules/rep/camera-photo-results.js';

const photos = [0, 1, 2].map((index) => ({
  sourceUri: `file:///data/user/0/com.madar.rep.app/files/capture-${index}.jpg`,
  capturedAt: `2026-11-14T08:00:0${index}.000Z`,
  captureId: `00000000-0000-4000-8000-00000000000${index + 1}`,
  photoIndex: index,
  location: null,
}));

test('native camera object results preserve all three photos and optional location', () => {
  const normalized = normalizeNativeVisitPhotoResults({ photos });
  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized.map((photo) => photo.sourceUri), photos.map((photo) => photo.sourceUri));
  assert.deepEqual(normalized.map((photo) => photo.location), [null, null, null]);
  assert.deepEqual(normalized.map((photo) => photo.captureId), photos.map((photo) => photo.captureId));
  assert.deepEqual(normalized.map((photo) => photo.photoIndex), [0, 1, 2]);
});

test('the former JSON-string camera result is rejected visibly instead of filtered to zero', () => {
  const formerNativeShape = photos.map((photo) => JSON.stringify(photo));
  assert.throws(
    () => normalizeNativeVisitPhotoResults({ photos: formerNativeShape }),
    /تعذر استلام الصورة 1/,
  );
});

test('any malformed result rejects the complete group instead of returning a partial set', () => {
  assert.throws(
    () => normalizeNativeVisitPhotoResults({ photos: [photos[0], { ...photos[1], sourceUri: '' }, photos[2]] }),
    /مسار الصورة 2 غير صالح/,
  );
  assert.throws(
    () => normalizeNativeVisitPhotoResults({ photos: [{ ...photos[0], capturedAt: 'not-a-date' }] }),
    /وقت التقاط الصورة 1 غير صالح/,
  );
  assert.throws(
    () => normalizeNativeVisitPhotoResults({ photos: [{ ...photos[0], location: { latitude: 'bad' } }] }),
    /بيانات موقع الصورة 1 غير صالحة/,
  );
  assert.throws(
    () => normalizeNativeVisitPhotoResults({ photos: [{ ...photos[0], captureId: '' }] }),
    /معرّف أو ترتيب الصورة 1 غير صالح/,
  );
  assert.throws(
    () => normalizeNativeVisitPhotoResults({ photos: [photos[0], { ...photos[1], captureId: photos[0].captureId }] }),
    /نتيجة الكاميرا تحتوي صورة مكررة/,
  );
  assert.throws(
    () => normalizeNativeVisitPhotoResults({ photos: [photos[0], { ...photos[1], photoIndex: photos[0].photoIndex }] }),
    /نتيجة الكاميرا تحتوي صورة مكررة/,
  );
});
