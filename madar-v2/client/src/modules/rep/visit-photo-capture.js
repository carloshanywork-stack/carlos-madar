const MAX_LOCATION_AGE_MS = 5 * 60 * 1000;

export function isEligibleVisitGps(location, now = Date.now()) {
  const updatedAt = Date.parse(location?.updatedAt ?? '');
  return Boolean(location)
    && location.mocked !== true
    && Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90
    && Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180
    && Number.isFinite(location.accuracy) && location.accuracy >= 0 && location.accuracy <= 100
    && Number.isFinite(updatedAt) && updatedAt <= now + 30_000 && now - updatedAt <= MAX_LOCATION_AGE_MS;
}

export function distanceBetweenPointsMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function validateVisitPhotoCaptureLocation(location, machine, now = Date.now()) {
  if (!isEligibleVisitGps(location, now)) {
    throw new Error('لا يوجد GPS حديث ودقيق بما يكفي؛ الصور المحفوظة لم تُحذف. حدّث الموقع ثم أعد معالجة المجموعة.');
  }
  const latitude = Number(machine?.latitude);
  const longitude = Number(machine?.longitude);
  if (machine?.isLocationLocked !== true || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('لم يتم تأكيد موقع هذه الماكينة بعد؛ أكّد الموقع قبل التصوير.');
  }
  const radius = Math.max(1, Number(machine.geofenceRadiusMeters) || 50);
  const effectiveDistance = Math.max(0, distanceBetweenPointsMeters(location, { latitude, longitude }) - location.accuracy);
  if (effectiveDistance > radius) {
    throw new Error(`أنت خارج نطاق الماكينة (المسافة الفعالة: ${Math.round(effectiveDistance)} متر، المسموح: ${radius} متر).`);
  }
  return { radius, effectiveDistance };
}

export function mergeCapturedPhotoResults(existing, incoming, maxPhotos) {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('تعذر استعادة صور المجموعة المحفوظة.');
  const merged = [...existing];
  const keyFor = (photo) => photo?.captureId || photo?.sourceUri
    || (typeof Blob !== 'undefined' && photo instanceof Blob ? photo : `${photo?.name ?? ''}\n${photo?.lastModified ?? ''}\n${photo?.size ?? ''}`);
  const keys = new Set(existing.map(keyFor));
  for (const photo of incoming) {
    const key = keyFor(photo);
    if (typeof photo?.sourceUri !== 'string' || !photo.sourceUri.trim() || keys.has(key)) continue;
    keys.add(key);
    merged.push(photo);
  }
  if (merged.length > maxPhotos) throw new Error(`تجاوزت صور المجموعة الحد المسموح (${maxPhotos}).`);
  return merged;
}

export function firstUnusedPhotoIndex(photos, maxPhotos) {
  const used = new Set(photos.map((photo) => Number(photo.photoIndex)).filter(Number.isInteger));
  for (let index = 0; index < maxPhotos; index += 1) if (!used.has(index)) return index;
  return -1;
}
