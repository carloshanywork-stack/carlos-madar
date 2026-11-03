export const GPS_POLLING = Object.freeze({
  movingIntervalMs: 12_000,
  stationaryIntervalMs: 60_000,
  stationaryAfterMs: 3 * 60_000,
  movementSpeedMetersPerSecond: 2 / 3.6,
  movementDistanceMeters: 15,
});

export function distanceBetweenGpsPointsMeters(left, right) {
  if (!left || !right) return 0;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

export function getAdaptiveGpsInterval({ speedMetersPerSecond = 0, displacementMeters = 0, stationaryDurationMs = 0 } = {}) {
  const moving = Number(speedMetersPerSecond) >= GPS_POLLING.movementSpeedMetersPerSecond
    || Number(displacementMeters) > GPS_POLLING.movementDistanceMeters;
  return !moving && Number(stationaryDurationMs) >= GPS_POLLING.stationaryAfterMs
    ? GPS_POLLING.stationaryIntervalMs
    : GPS_POLLING.movingIntervalMs;
}
