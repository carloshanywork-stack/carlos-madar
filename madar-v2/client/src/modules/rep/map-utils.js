export const OFFLINE_MAP_PACKS = Object.freeze([
  { id: 'greater-cairo', name: 'القاهرة الكبرى', minZoom: 8, maxZoom: 15,
    bounds: { west: 30.6, south: 29.4, east: 32.1, north: 31.0 } },
  { id: 'delta-canal', name: 'الدلتا والقناة', minZoom: 8, maxZoom: 14,
    bounds: { west: 29.3, south: 29.0, east: 33.4, north: 32.0 } },
  { id: 'alexandria-coast', name: 'الإسكندرية والساحل', minZoom: 8, maxZoom: 14,
    bounds: { west: 26.0, south: 29.0, east: 31.9, north: 32.0 } },
  { id: 'all-egypt', name: 'خريطة مصر بالكامل', minZoom: 5, maxZoom: 11,
    bounds: { west: 24.5, south: 21.5, east: 37.2, north: 31.8 } },
]);

export function googleMapsNavigationUrl(machine) {
  if (Number.isFinite(Number(machine?.latitude)) && Number.isFinite(Number(machine?.longitude))) {
    const destination = `${Number(machine.latitude)},${Number(machine.longitude)}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  }
  const address = String(machine?.address ?? '').trim();
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function projectToWorld(location, zoom) {
  const latitude = Math.max(-85.051129, Math.min(85.051129, Number(location.latitude)));
  const longitude = Number(location.longitude);
  const size = 256 * (2 ** zoom);
  const sine = Math.sin(latitude * Math.PI / 180);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  };
}

export function unprojectFromWorld(point, zoom) {
  const size = 256 * (2 ** zoom);
  const longitude = (point.x / size) * 360 - 180;
  const mercator = Math.PI * (1 - (2 * point.y) / size);
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercator));
  return { latitude, longitude };
}

export function getVisibleTileCoordinates(center, zoom, width = 900, height = 500) {
  const projected = projectToWorld(center, zoom);
  const worldTiles = 2 ** zoom;
  const firstX = Math.floor((projected.x - width / 2) / 256);
  const lastX = Math.floor((projected.x + width / 2) / 256);
  const firstY = Math.max(0, Math.floor((projected.y - height / 2) / 256));
  const lastY = Math.min(worldTiles - 1, Math.floor((projected.y + height / 2) / 256));
  const tiles = [];
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = firstX; x <= lastX; x += 1) {
      if (x < 0 || x >= worldTiles) continue;
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}
