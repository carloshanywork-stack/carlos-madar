export const OFFLINE_MAP_PACKS = Object.freeze([
  { id: 'greater-cairo', name: 'القاهرة الكبرى', minZoom: 8, maxZoom: 14, bounds: { west: 30.6, south: 29.4, east: 32.1, north: 31.0 } },
  { id: 'delta-canal', name: 'الدلتا والقناة', minZoom: 8, maxZoom: 13, bounds: { west: 29.3, south: 29.0, east: 33.4, north: 32.0 } },
  { id: 'alexandria-coast', name: 'الإسكندرية والساحل', minZoom: 8, maxZoom: 13, bounds: { west: 26.0, south: 29.0, east: 31.9, north: 32.0 } },
  { id: 'egypt-overview', name: 'مصر — خريطة عامة', minZoom: 5, maxZoom: 11, bounds: { west: 24.5, south: 21.5, east: 37.3, north: 32.6 } },
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
