import Database from 'better-sqlite3';
import { lstatSync } from 'node:fs';
import { offlineMapPath } from '../../config/paths.js';
import { HttpError } from '../http.js';

const RASTER_MIME_TYPES = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
});

const MAX_PACK_BYTES = 120 * 1024 * 1024;
const MAX_PACK_TILES = 50_000;
const OFFLINE_MAP_PACKS = Object.freeze([
  { id: 'greater-cairo', name: 'القاهرة الكبرى', minZoom: 8, maxZoom: 15,
    bounds: { west: 30.6, south: 29.4, east: 32.1, north: 31.0 } },
  { id: 'delta-canal', name: 'الدلتا والقناة', minZoom: 8, maxZoom: 14,
    bounds: { west: 29.3, south: 29.0, east: 33.4, north: 32.0 } },
  { id: 'alexandria-coast', name: 'الإسكندرية والساحل', minZoom: 8, maxZoom: 14,
    bounds: { west: 26.0, south: 29.0, east: 31.9, north: 32.0 } },
  { id: 'all-egypt', name: 'خريطة مصر بالكامل', minZoom: 5, maxZoom: 11,
    bounds: { west: 24.5, south: 21.5, east: 37.2, north: 31.8 } },
]);

let cached = null;

export function closeOfflineMap() {
  if (cached?.database.open) cached.database.close();
  cached = null;
}

function mapDatabase() {
  let metadata;
  try {
    metadata = lstatSync(offlineMapPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new HttpError(503, 'The configured local offline map must be a regular MBTiles file.');
  }
  const signature = `${metadata.size}:${metadata.mtimeMs}`;
  if (cached?.signature === signature && cached.database.open) return cached;
  closeOfflineMap();
  try {
    const database = new Database(offlineMapPath, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tables.has('metadata') || !tables.has('tiles')) {
      database.close();
      throw new Error('Missing MBTiles metadata or tiles table.');
    }
    cached = {
      database,
      signature,
      metadata: Object.fromEntries(database.prepare('SELECT name, value FROM metadata').all().map((row) => [row.name, row.value])),
      tileStatement: database.prepare('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1'),
    };
    return cached;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'The configured local map file is not a valid MBTiles package.');
  }
}

export function getOfflineMapStatus() {
  const map = mapDatabase();
  if (!map) return { available: false, renderable: false, message: 'No local MBTiles package is installed.' };
  const format = String(map.metadata.format ?? '').toLowerCase();
  return {
    available: true,
    renderable: Boolean(RASTER_MIME_TYPES[format]),
    format,
    name: String(map.metadata.name ?? 'Offline map'),
    attribution: String(map.metadata.attribution ?? ''),
    minZoom: Number.isInteger(Number(map.metadata.minzoom)) ? Number(map.metadata.minzoom) : 0,
    maxZoom: Number.isInteger(Number(map.metadata.maxzoom)) ? Number(map.metadata.maxzoom) : 18,
    bounds: map.metadata.bounds ?? null,
  };
}

export function isOfflineMapPackId(packId) {
  return OFFLINE_MAP_PACKS.some((pack) => pack.id === packId);
}

function tileCoordinate(longitude, latitude, zoom) {
  const count = 2 ** zoom;
  const safeLatitude = Math.max(-85.051129, Math.min(85.051129, latitude));
  const radians = safeLatitude * Math.PI / 180;
  return {
    x: Math.max(0, Math.min(count - 1, Math.floor(((longitude + 180) / 360) * count))),
    y: Math.max(0, Math.min(count - 1, Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * count))),
  };
}

function packZoomRange(pack, map) {
  const minZoom = Math.max(pack.minZoom, map.minZoom);
  const maxZoom = Math.min(pack.maxZoom, map.maxZoom);
  return { minZoom, maxZoom };
}

function tileBounds(pack, zoom) {
  const northwest = tileCoordinate(pack.bounds.west, pack.bounds.north, zoom);
  const southeast = tileCoordinate(pack.bounds.east, pack.bounds.south, zoom);
  return {
    minColumn: northwest.x,
    maxColumn: southeast.x,
    minXyzRow: northwest.y,
    maxXyzRow: southeast.y,
  };
}

function listPackTiles(pack, map, { includeTiles = false } = {}) {
  const { minZoom, maxZoom } = packZoomRange(pack, map);
  if (minZoom > maxZoom) return { tiles: [], tileCount: 0, sizeBytes: 0, minZoom, maxZoom };

  const rows = [];
  let sizeBytes = 0;
  let availableMinZoom = null;
  let availableMaxZoom = null;
  const select = map.database.prepare(`
    SELECT tile_column, tile_row, length(tile_data) AS size_bytes
    FROM tiles
    WHERE zoom_level = ? AND tile_column BETWEEN ? AND ? AND tile_row BETWEEN ? AND ?
    ORDER BY tile_column, tile_row
  `);
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    const count = 2 ** zoom;
    const bounds = tileBounds(pack, zoom);
    const tmsMinRow = count - 1 - bounds.maxXyzRow;
    const tmsMaxRow = count - 1 - bounds.minXyzRow;
    for (const row of select.iterate(zoom, bounds.minColumn, bounds.maxColumn, tmsMinRow, tmsMaxRow)) {
      availableMinZoom ??= zoom;
      availableMaxZoom = zoom;
      const tileSize = Number(row.size_bytes) || 0;
      sizeBytes += tileSize;
      if (includeTiles) rows.push({ z: zoom, x: Number(row.tile_column), y: count - 1 - Number(row.tile_row), sizeBytes: tileSize });
      else rows.push(null);
      if (rows.length > MAX_PACK_TILES || sizeBytes > MAX_PACK_BYTES) {
        return {
          tiles: [], tileCount: rows.length, sizeBytes,
          minZoom: availableMinZoom, maxZoom: availableMaxZoom, overLimit: true,
        };
      }
    }
  }
  return {
    tiles: includeTiles ? rows : [],
    tileCount: rows.length,
    sizeBytes,
    minZoom: availableMinZoom ?? minZoom,
    maxZoom: availableMaxZoom ?? maxZoom,
    overLimit: false,
  };
}

function unavailablePack(pack, map, summary, reason) {
  return {
    ...pack,
    available: false,
    renderable: Boolean(map?.renderable),
    tileCount: summary?.tileCount ?? 0,
    sizeBytes: summary?.sizeBytes ?? 0,
    minZoom: summary?.minZoom ?? pack.minZoom,
    maxZoom: summary?.maxZoom ?? pack.maxZoom,
    format: map?.format ?? null,
    attribution: map?.attribution ?? '',
    reason,
  };
}

export function getOfflineMapPackCatalog() {
  const map = mapDatabase();
  if (!map) return OFFLINE_MAP_PACKS.map((pack) => unavailablePack(pack, null, null, 'لا توجد حزمة MBTiles محلية على الخادم.'));
  const status = getOfflineMapStatus();
  return OFFLINE_MAP_PACKS.map((pack) => {
    if (!status.renderable) return unavailablePack(pack, status, null, 'حزم التطبيق تحتاج إلى MBTiles نقطية بصيغة PNG أو JPEG أو WebP.');
    const summary = listPackTiles(pack, { ...map, minZoom: status.minZoom, maxZoom: status.maxZoom });
    if (!summary.tileCount) return unavailablePack(pack, status, summary, 'لا توجد بلاطات محلية ضمن نطاق هذه المنطقة ومستويات التكبير المطلوبة.');
    if (summary.overLimit) return unavailablePack(pack, status, summary, 'حجم الحزمة يتجاوز حد التنزيل الآمن (120 MB أو 50,000 بلاطة).');
    return {
      ...pack,
      available: true,
      renderable: true,
      tileCount: summary.tileCount,
      sizeBytes: summary.sizeBytes,
      minZoom: summary.minZoom,
      maxZoom: summary.maxZoom,
      format: status.format,
      attribution: status.attribution,
      sourceName: status.name,
    };
  });
}

export function getOfflineMapPackManifest(packId) {
  const pack = OFFLINE_MAP_PACKS.find((item) => item.id === packId);
  if (!pack) throw new HttpError(404, 'Offline map pack was not found.');
  const catalogPack = getOfflineMapPackCatalog().find((item) => item.id === packId);
  if (!catalogPack?.available) return { ...catalogPack, tiles: [] };
  const map = mapDatabase();
  const summary = listPackTiles(pack, { ...map, minZoom: catalogPack.minZoom, maxZoom: catalogPack.maxZoom }, { includeTiles: true });
  if (summary.overLimit || !summary.tileCount) {
    return { ...unavailablePack(pack, catalogPack, summary, 'تعذر تجهيز الحزمة ضمن حدود التنزيل المحلي.'), tiles: [] };
  }
  return { ...catalogPack, tileCount: summary.tileCount, sizeBytes: summary.sizeBytes, tiles: summary.tiles };
}

export function readOfflineMapTile(zoomInput, columnInput, rowInput) {
  const zoom = Number(zoomInput);
  const column = Number(columnInput);
  const row = Number(rowInput);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22) throw new HttpError(400, 'Tile zoom is invalid.');
  const count = 2 ** zoom;
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column >= count || row >= count) {
    throw new HttpError(400, 'Tile coordinates are invalid.');
  }
  const map = mapDatabase();
  if (!map) return null;
  const format = String(map.metadata.format ?? '').toLowerCase();
  const contentType = RASTER_MIME_TYPES[format];
  if (!contentType) throw new HttpError(503, 'The local MBTiles package must contain raster PNG, JPEG, or WebP tiles.');
  const tile = map.tileStatement.get(zoom, column, count - 1 - row);
  return tile?.tile_data ? { contentType, data: tile.tile_data } : null;
}

export function readOfflineMapPackTile(packId, zoomInput, columnInput, rowInput) {
  const pack = OFFLINE_MAP_PACKS.find((item) => item.id === packId);
  if (!pack) throw new HttpError(404, 'Offline map pack was not found.');
  const zoom = Number(zoomInput);
  const column = Number(columnInput);
  const row = Number(rowInput);
  if (!Number.isInteger(zoom) || zoom < pack.minZoom || zoom > pack.maxZoom) {
    throw new HttpError(400, 'Tile zoom is outside this offline map pack.');
  }
  const bounds = tileBounds(pack, zoom);
  if (!Number.isInteger(column) || !Number.isInteger(row)
      || column < bounds.minColumn || column > bounds.maxColumn
      || row < bounds.minXyzRow || row > bounds.maxXyzRow) {
    throw new HttpError(400, 'Tile coordinates are outside this offline map pack.');
  }
  const map = mapDatabase();
  if (!map) return null;
  const minZoom = Number(map.metadata.minzoom ?? 0);
  const maxZoom = Number(map.metadata.maxzoom ?? 18);
  if (zoom < minZoom || zoom > maxZoom) return null;
  return readOfflineMapTile(zoom, column, row);
}
