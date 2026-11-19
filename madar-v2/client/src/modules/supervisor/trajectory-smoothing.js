/**
 * Pure ESM module for GPS trajectory smoothing, accuracy filtering, and stationary jitter suppression.
 * Conforms to MADAR GIS Architecture Standards:
 * - GPS Acquisition Threshold: accuracy <= 15m
 * - Stationary Jitter Suppression: collapse points < 12m apart
 * - Outlier Spike Rejection: suppress speed & acute angular reversal jumps cutting through buildings
 */

export const DEFAULT_ACCURACY_THRESHOLD = 15;
export const DEFAULT_STATIONARY_THRESHOLD = 12;
export const MAX_TRANSIT_SPEED_METERS_PER_SECOND = 36.1; // ~130 km/h

/**
 * High-precision distance calculation between two WGS-84 coordinates in meters (Haversine formula).
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (!Number.isFinite(nLat1) || !Number.isFinite(nLon1) || !Number.isFinite(nLat2) || !Number.isFinite(nLon2)) {
    return 0;
  }
  const R = 6371000; // Earth's mean radius in meters
  const dLat = (nLat2 - nLat1) * (Math.PI / 180);
  const dLon = (nLon2 - nLon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(nLat1 * (Math.PI / 180)) * Math.cos(nLat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Filter out invalid coordinates and coarse GPS fixes (> 15m accuracy).
 */
export function filterGpsAccuracy(points, maxAccuracy = DEFAULT_ACCURACY_THRESHOLD) {
  if (!Array.isArray(points)) return [];
  return points.filter((p) => {
    if (!p) return false;
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    const acc = p.accuracy !== null && p.accuracy !== undefined ? Number(p.accuracy) : null;
    if (acc !== null && (!Number.isFinite(acc) || acc > maxAccuracy)) return false;
    return true;
  });
}

function parsePointTime(point) {
  const raw = point?.capturedAt || point?.recordedAt || point?.timestamp || point?.updatedAt;
  if (!raw) return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reconcile point-to-point velocity and suppress acute angular reversal spikes
 * that jump laterally into buildings or across waterways (e.g. Belbaisi drain / Abu Hashin mosque).
 */
export function smoothTrajectoryOutliers(points, options = {}) {
  const maxSpeed = options.maxSpeedMetersPerSecond ?? MAX_TRANSIT_SPEED_METERS_PER_SECOND;
  if (!Array.isArray(points) || points.length <= 2) return points || [];

  const cleaned = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const prev = cleaned[cleaned.length - 1];
    const curr = points[i];
    const next = i + 1 < points.length ? points[i + 1] : null;

    if (!next) {
      cleaned.push(curr);
      break;
    }

    const dPrevCurr = calculateDistanceMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    const dCurrNext = calculateDistanceMeters(curr.latitude, curr.longitude, next.latitude, next.longitude);
    const dPrevNext = calculateDistanceMeters(prev.latitude, prev.longitude, next.latitude, next.longitude);

    const tPrev = parsePointTime(prev);
    const tCurr = parsePointTime(curr);
    const tNext = parsePointTime(next);

    let isOutlier = false;

    // Check 1: Impossible velocity jump and return
    if (tCurr > tPrev && tNext > tCurr) {
      const dt1 = (tCurr - tPrev) / 1000;
      const dt2 = (tNext - tCurr) / 1000;
      const speed1 = dPrevCurr / dt1;
      const speed2 = dCurrNext / dt2;
      const dtTotal = (tNext - tPrev) / 1000;
      const speedDirect = dPrevNext / dtTotal;

      if ((speed1 > maxSpeed || speed2 > maxSpeed) && speedDirect <= maxSpeed && dPrevCurr > 20) {
        isOutlier = true;
      }
    }

    // Check 2: Acute angular reversal spike (> 135 deg deflection with immediate return)
    if (!isOutlier && dPrevCurr >= 12 && dCurrNext >= 12) {
      const detourRatio = (dPrevCurr + dCurrNext) / Math.max(dPrevNext, 1);
      if (detourRatio > 2.0) {
        const latPrev = Number(prev.latitude);
        const lonPrev = Number(prev.longitude);
        const latCurr = Number(curr.latitude);
        const lonCurr = Number(curr.longitude);
        const latNext = Number(next.latitude);
        const lonNext = Number(next.longitude);

        const cosLat = Math.cos((latCurr * Math.PI) / 180);
        const dx1 = (lonCurr - lonPrev) * 111139 * cosLat;
        const dy1 = (latCurr - latPrev) * 111139;
        const dx2 = (lonNext - lonCurr) * 111139 * cosLat;
        const dy2 = (latNext - latCurr) * 111139;

        const mag1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const mag2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        if (mag1 > 0 && mag2 > 0) {
          const dot = dx1 * dx2 + dy1 * dy2;
          const cosAngle = dot / (mag1 * mag2);
          // Acute heading reversal spike (cosAngle < -0.6 equates to > 127 degrees deflection)
          const timeGap = (tNext > 0 && tPrev > 0) ? (tNext - tPrev) / 1000 : 0;
          if (cosAngle < -0.6 && (timeGap <= 300 || timeGap === 0)) {
            isOutlier = true;
          }
        }
      }
    }

    if (!isOutlier) {
      cleaned.push(curr);
    }
  }

  return cleaned;
}

/**
 * Stationary Jitter Suppression: Collapse stationary stops separated by < 12m
 * into single anchor/centroid nodes so no spiderwebs or sharp zig-zags appear.
 */
export function suppressStationaryJitter(points, minDistance = DEFAULT_STATIONARY_THRESHOLD, stops = []) {
  if (!Array.isArray(points) || points.length <= 1) return points || [];

  const stopCentroids = (stops || [])
    .map((s) => ({
      lat: Number(s.latitude),
      lng: Number(s.longitude),
      start: s.arrivedAt ? new Date(s.arrivedAt).getTime() : 0,
      end: s.departedAt ? new Date(s.departedAt).getTime() : Infinity,
      anchored: false,
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

  const smoothed = [];
  let anchor = null;

  for (let i = 0; i < points.length; i += 1) {
    const curr = points[i];
    const lat = Number(curr.latitude);
    const lon = Number(curr.longitude);
    const time = parsePointTime(curr);

    // Stop centroid matching
    if (time > 0 && stopCentroids.length > 0) {
      const match = stopCentroids.find((s) => time >= s.start && time <= s.end);
      if (match) {
        if (!match.anchored) {
          match.anchored = true;
          const anchorPoint = { ...curr, latitude: match.lat, longitude: match.lng };
          smoothed.push(anchorPoint);
          anchor = anchorPoint;
        }
        continue;
      }
    }

    if (!anchor) {
      smoothed.push(curr);
      anchor = curr;
      continue;
    }

    const distMeters = calculateDistanceMeters(anchor.latitude, anchor.longitude, lat, lon);

    // Only advance when displacement is >= 12m (or if final point and sufficiently distant)
    if (distMeters >= minDistance) {
      smoothed.push(curr);
      anchor = curr;
    }
  }

  // Ensure last point is retained if route moved significantly from the final anchor
  if (points.length > 1 && smoothed.length > 0) {
    const lastRaw = points[points.length - 1];
    const lastSmoothed = smoothed[smoothed.length - 1];
    const distFromLast = calculateDistanceMeters(lastSmoothed.latitude, lastSmoothed.longitude, lastRaw.latitude, lastRaw.longitude);
    if (distFromLast >= minDistance) {
      smoothed.push(lastRaw);
    }
  }

  return smoothed;
}

/**
 * Comprehensive polyline smoothing pipeline:
 * 1. Filter out coarse GPS fixes (> 15m accuracy)
 * 2. Reject trajectory outlier velocity/heading spikes
 * 3. Collapse stationary stops separated by < 12m
 */
export function smoothPolyline(rawPoints, stops = [], options = {}) {
  if (!rawPoints || rawPoints.length <= 1) return rawPoints || [];

  const maxAccuracy = options.maxAccuracy ?? DEFAULT_ACCURACY_THRESHOLD;
  const minDistance = options.minDistance ?? DEFAULT_STATIONARY_THRESHOLD;

  // Step 1: Accuracy filtering (<= 15m)
  const accuratePoints = filterGpsAccuracy(rawPoints, maxAccuracy);
  if (accuratePoints.length <= 2) return accuratePoints;

  // Step 2: Trajectory outlier spike rejection
  const continuousPoints = smoothTrajectoryOutliers(accuratePoints, options);
  if (continuousPoints.length <= 2) return continuousPoints;

  // Step 3: Stationary jitter suppression (< 12m collapse)
  return suppressStationaryJitter(continuousPoints, minDistance, stops);
}
