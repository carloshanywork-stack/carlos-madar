/**
 * Validate the JSON result returned by RepEngine.captureVisitPhotos.
 * Reject malformed entries rather than silently dropping them: a partial or
 * empty handoff must be visible to the representative instead of looking like
 * a successful camera sequence.
 */
export function normalizeNativeVisitPhotoResults(result) {
  if (!Array.isArray(result?.photos) || result.photos.length < 1 || result.photos.length > 3) {
    throw new Error('لم تُرجع الكاميرا صوراً صالحة. أعد التقاط المجموعة.');
  }

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

    return { sourceUri: photo.sourceUri, capturedAt: photo.capturedAt, location };
  });
}
