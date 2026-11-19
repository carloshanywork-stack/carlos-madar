/** A persisted fix is evidence of a past position, not proof that GPS is currently enabled. */
export function usableNativeGpsSnapshot(state, now = Date.now()) {
  const fix = state?.lastLocation;
  const timestamp = Number(fix?.timestamp);
  if (!fix || state.mocked || state.gpsEnabled === false
      || !Number.isFinite(timestamp) || now - timestamp > 5 * 60 * 1000 || timestamp - now > 60 * 1000
      || !Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90
      || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180
      || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 15) return null;
  return {
    latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy,
    speed: fix.speed ?? 0, updatedAt: new Date(timestamp).toISOString(),
  };
}
