import { MAX_VISIT_PHOTOS_PER_PHASE } from '../../../../shared/visit-photo-policy.js';
/**
 * Validate the JSON result returned by RepEngine.captureVisitPhotos.
 * Reject malformed entries rather than silently dropping them: a partial or
 * empty handoff must be visible to the representative instead of looking like
 * a successful camera sequence.
 */
export function normalizeNativeVisitPhotoResults(result) {
  if (!Array.isArray(result?.photos) || result.photos.length < 1 || result.photos.length > MAX_VISIT_PHOTOS_PER_PHASE) {
    throw new Error('لم تُرجع الكاميرا صوراً صالحة. أعد التقاط المجموعة.');
  }

  const captureIds = new Set();
  const photoIndexes = new Set();
  const sourceUris = new Set();
  return result.photos.map((photo, index) => {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
      throw new Error(`تعذر استلام الصورة ${index + 1} من الكاميرا؛ أعد التقاط المجموعة.`);
    }
    if (typeof photo.sourceUri !== 'string' || !photo.sourceUri.trim()) {
      throw new Error(`مسار الصورة ${index + 1} غير صالح؛ لم تُضف الصورة إلى الزيارة.`);
    }
    if (typeof photo.capturedAt !== 'string' || !Number.isFinite(Date.parse(photo.capturedAt))) {
      throw new Error(`وقت التقاط الصورة ${index + 1} غير صالح؛ أعد التقاط المجموعة.`);
    }
    if (typeof photo.captureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photo.captureId)
        || !Number.isInteger(photo.photoIndex) || photo.photoIndex < 0 || photo.photoIndex >= MAX_VISIT_PHOTOS_PER_PHASE) {
      throw new Error(`معرّف أو ترتيب الصورة ${index + 1} غير صالح؛ أعد فتح مجموعة الصور المحفوظة.`);
    }
    if (captureIds.has(photo.captureId) || photoIndexes.has(photo.photoIndex) || sourceUris.has(photo.sourceUri)) {
      throw new Error(`نتيجة الكاميرا تحتوي صورة مكررة (${index + 1})؛ لم تُضف المجموعة مرتين.`);
    }
    captureIds.add(photo.captureId);
    photoIndexes.add(photo.photoIndex);
    sourceUris.add(photo.sourceUri);

    let location = null;
    if (photo.location !== null && photo.location !== undefined) {
      const candidate = photo.location;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
          || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)
          || !Number.isFinite(candidate.accuracy) || typeof candidate.updatedAt !== 'string'
          || !Number.isFinite(Date.parse(candidate.updatedAt))) {
        throw new Error(`بيانات موقع الصورة ${index + 1} غير صالحة؛ أعد التقاط المجموعة.`);
      }
      location = candidate;
    }

    return { sourceUri: photo.sourceUri, capturedAt: photo.capturedAt, location, captureId: photo.captureId, photoIndex: photo.photoIndex };
  });
}
