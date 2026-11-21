export const OFFLINE_MAP_PACKS = Object.freeze([
  { id: 'egypt-overview', name: 'مصر — خريطة عامة', minZoom: 5, maxZoom: 11, bounds: { west: 24.5, south: 21.5, east: 37.3, north: 32.6 } },
  { id: 'greater-cairo', name: 'القاهرة الكبرى', minZoom: 8, maxZoom: 14, bounds: { west: 30.6, south: 29.4, east: 32.1, north: 31.0 } },
  { id: 'delta-canal', name: 'الدلتا والقناة', minZoom: 8, maxZoom: 13, bounds: { west: 29.3, south: 29.0, east: 33.4, north: 32.0 } },
  { id: 'alexandria-coast', name: 'الإسكندرية والساحل', minZoom: 8, maxZoom: 13, bounds: { west: 26.0, south: 29.0, east: 31.9, north: 32.0 } },
  { id: 'upper-egypt', name: 'صعيد مصر', minZoom: 8, maxZoom: 12, bounds: { west: 30.5, south: 21.5, east: 33.8, north: 29.5 } },
  { id: 'sinai-red-sea', name: 'سيناء والبحر الأحمر', minZoom: 8, maxZoom: 12, bounds: { west: 31.7, south: 21.5, east: 37.2, north: 31.8 } },
  { id: 'western-desert', name: 'الصحراء الغربية', minZoom: 8, maxZoom: 12, bounds: { west: 24.5, south: 21.5, east: 30.8, north: 31.8 } },
]);

export function projectToWorld(location, zoom) {
  const latitude = Math.max(-85.051129, Math.min(85.051129, Number(location.latitude)));
  const longitude = Number(location.longitude);
  const size = 256 * (2 ** zoom);
  const sine = Math.sin(latitude * Math.PI / 180);
  return { x: ((longitude + 180) / 360) * size, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size };
}

export function unprojectFromWorld(point, zoom) {
  const size = 256 * (2 ** zoom);
  const longitude = (point.x / size) * 360 - 180;
  const mercator = Math.PI * (1 - (2 * point.y) / size);
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(mercator)), longitude };
}

export function getVisibleTileCoordinates(center, zoom, width = 900, height = 500) {
  const projected = projectToWorld(center, zoom);
  const worldTiles = 2 ** zoom;
  const firstX = Math.floor((projected.x - width / 2) / 256);
  const lastX = Math.floor((projected.x + width / 2) / 256);
  const firstY = Math.max(0, Math.floor((projected.y - height / 2) / 256));
  const lastY = Math.min(worldTiles - 1, Math.floor((projected.y + height / 2) / 256));
  const tiles = [];
  for (let y = firstY; y <= lastY; y += 1) for (let x = firstX; x <= lastX; x += 1) {
    if (x >= 0 && x < worldTiles) tiles.push({ z: zoom, x, y });
  }
  return tiles;
}

export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (!Number.isFinite(nLat1) || !Number.isFinite(nLon1) || !Number.isFinite(nLat2) || !Number.isFinite(nLon2)) {
    return 0;
  }
  const R = 6371000;
  const dLat = (nLat2 - nLat1) * (Math.PI / 180);
  const dLon = (nLon2 - nLon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(nLat1 * (Math.PI / 180)) * Math.cos(nLat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function suppressStationaryJitter(points, thresholdMeters = 12) {
  if (!Array.isArray(points) || points.length <= 1) return points || [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = result[result.length - 1];
    const curr = points[i];
    if (i === points.length - 1) {
      result.push(curr);
      break;
    }
    const dist = calculateDistanceMeters(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    if (dist >= thresholdMeters) {
      result.push(curr);
    }
  }
  return result;
}

export function computeFitBounds(points, viewWidth = 900, viewHeight = 500, minZoom = 5, maxZoom = 14) {
  const valid = (points || []).filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (!valid.length) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of valid) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }

  const center = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
  };

  if (maxLat - minLat < 0.0001 && maxLng - minLng < 0.0001) {
    return {
      center,
      zoom: Math.min(maxZoom, Math.max(minZoom, 13)),
    };
  }

  let bestZoom = minZoom;
  for (let z = maxZoom; z >= minZoom; z -= 1) {
    const pMin = projectToWorld({ latitude: maxLat, longitude: minLng }, z);
    const pMax = projectToWorld({ latitude: minLat, longitude: maxLng }, z);
    const spanX = Math.abs(pMax.x - pMin.x);
    const spanY = Math.abs(pMax.y - pMin.y);

    if (spanX <= viewWidth * 0.70 && spanY <= viewHeight * 0.70) {
      bestZoom = z;
      break;
    }
  }

  return {
    center,
    zoom: bestZoom,
  };
}
