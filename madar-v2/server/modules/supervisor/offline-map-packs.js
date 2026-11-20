import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../../config/env.js';
import { offlineMapDirectory } from '../../config/paths.js';
import { HttpError } from '../http.js';
import {
  getOfflineMapPackCatalog as getLegacyCatalog,
  getOfflineMapPackManifest as getLegacyManifest,
  getOfflineMapStatus as getLegacyStatus,
  readOfflineMapPackTile as readLegacyTile,
} from './offline-tiles.js';

const MAX_PACK_BYTES = 120 * 1024 * 1024;
const MAX_PACK_TILES = 50_000;
const FORMAT_MIME = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' });
const ALIASES = Object.freeze({ 'all-egypt': 'egypt-overview' });
const databases = new Map();
let catalogCache;

function regularNoSymlink(path, label) {
  const absolute = resolve(path);
  const parts = absolute.split('/').filter(Boolean);
  let current = absolute.startsWith('/') ? '/' : '';
  for (const part of parts) {
    current = current === '/' ? `/${part}` : join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(503, `${label} is missing.`);
      throw error;
    }
    if (stat.isSymbolicLink()) throw new HttpError(503, `${label} must not pass through a symbolic link.`);
    if (current !== absolute && !stat.isDirectory()) throw new HttpError(503, `${label} has a non-directory parent.`);
    if (current === absolute && !stat.isFile()) throw new HttpError(503, `${label} must be a regular file.`);
  }
  return lstatSync(absolute);
}

function sha256FileSync(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
    return hash.digest('hex');
  } finally { closeSync(fd); }
}

function loadCatalog() {
  const directory = resolve(offlineMapDirectory);
  let directoryStat;
  try { directoryStat = lstatSync(directory); }
  catch (error) {
    if (error.code === 'ENOENT' && !env.offlineMapDirectory) return null;
    if (error.code === 'ENOENT') throw new HttpError(503, 'Configured offline map directory is missing.');
    throw error;
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new HttpError(503, 'Offline map directory must be a real directory.');
  const catalogPath = join(directory, 'catalog.json');
  let stat;
  try { lstatSync(catalogPath); }
  catch (error) {
    if (error.code === 'ENOENT' && !env.offlineMapDirectory) return null;
    if (error.code === 'ENOENT') throw new HttpError(503, 'Configured offline map catalog is missing.');
    throw error;
  }
  stat = regularNoSymlink(catalogPath, 'Offline map catalog');
  const signature = `${stat.size}:${stat.mtimeMs}`;
  if (catalogCache?.signature !== signature) {
    let catalog;
    try { catalog = JSON.parse(readFileSync(catalogPath, 'utf8')); }
    catch { throw new HttpError(503, 'Offline map catalog is invalid.'); }
    if (!Array.isArray(catalog.packs) || !catalog.packs.length) throw new HttpError(503, 'Offline map catalog has no packs.');
    const ids = new Set();
    for (const pack of catalog.packs) {
      if (!/^[a-z0-9-]{1,64}$/.test(pack.id) || ids.has(pack.id)) throw new HttpError(503, 'Offline map catalog contains invalid pack identities.');
      ids.add(pack.id);
    }
    catalogCache = { signature, catalog };
  }
  return catalogCache.catalog;
}

function manifestFor(id) {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new HttpError(404, 'Offline map pack was not found.');
  const catalog = loadCatalog();
  return catalog?.packs.find((pack) => pack.id === id) ?? null;
}

function mapFor(pack) {
  const id = pack.id;
  const path = join(resolve(offlineMapDirectory), `${id}.mbtiles`);
  const metadata = regularNoSymlink(path, `Offline map ${id}`);
  const manifestPath = join(resolve(offlineMapDirectory), `${id}.manifest.json`);
  regularNoSymlink(manifestPath, `Offline map manifest ${id}`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch { throw new HttpError(503, `Offline map manifest ${id} is invalid.`); }
  const signature = `${metadata.size}:${metadata.mtimeMs}:${manifest.sha256}`;
  const existing = databases.get(id);
  if (existing?.signature === signature && existing.database.open) return existing;
  if (existing?.database.open) existing.database.close();
  if (manifest.id !== id || manifest.fileBytes !== metadata.size || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')) {
    throw new HttpError(503, `Offline map ${id} does not match its manifest.`);
  }
  let database;
  try {
    if (sha256FileSync(path) !== manifest.sha256) throw new Error('MBTiles SHA-256 mismatch');
    database = new Database(path, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    if (!tables.has('metadata') || !tables.has('tiles')) throw new Error('missing MBTiles tables');
    const dbMetadata = Object.fromEntries(database.prepare('SELECT name, value FROM metadata').all().map((row) => [row.name, row.value]));
    const format = String(dbMetadata.format ?? '').toLowerCase();
    if (!FORMAT_MIME[format] || dbMetadata.license !== manifest.metadata?.license || dbMetadata.sourceSha256 !== manifest.metadata?.sourceSha256) {
      throw new Error('MBTiles metadata does not match the generated manifest');
    }
    const counts = database.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(tile_data)),0) AS bytes FROM tiles').get();
    if (Number(counts.count) !== manifest.tileCount || Number(counts.bytes) !== manifest.tileBytes
        || counts.count > MAX_PACK_TILES || counts.bytes > MAX_PACK_BYTES) throw new Error('MBTiles limits or tile totals do not match');
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('MBTiles integrity check failed');
    const value = {
      id, path, signature, database, metadata: dbMetadata,
      tileStatement: database.prepare('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1'),
      manifest,
    };
    databases.set(id, value);
    return value;
  } catch (error) {
    if (database?.open) database.close();
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, `Offline map ${id} failed integrity verification.`);
  }
}

function sourceBounds() {
  const path = join(resolve(offlineMapDirectory), 'source-verification.json');
  try {
    regularNoSymlink(path, 'Offline map source verification');
    const source = JSON.parse(readFileSync(path, 'utf8'));
    const match = String(source.sourceBounds ?? '').match(/\(([\d.-]+)\/([\d.-]+)\s+([\d.-]+)\/([\d.-]+)\)/);
    if (!match || source.officialMd5Verified !== true) return null;
    return { west: Number(match[1]), south: Number(match[2]), east: Number(match[3]), north: Number(match[4]) };
  } catch { return null; }
}

function normalizeId(id) { return ALIASES[id] ?? id; }

function generatedPackView(pack, map) {
  const metadata = map.metadata;
  const boundsArray = pack.bounds;
  if (!Array.isArray(boundsArray) || boundsArray.length !== 4) throw new HttpError(503, `Offline map ${pack.id} has invalid bounds.`);
  const bounds = boundsArray.join(',');
  const coverageBounds = { west: boundsArray[0], south: boundsArray[1], east: boundsArray[2], north: boundsArray[3] };
  return {
    id: pack.id,
    name: pack.name,
    available: true,
    renderable: true,
    format: String(metadata.format).toLowerCase(),
    tileCount: map.manifest.tileCount,
    sizeBytes: map.manifest.tileBytes,
    fileBytes: map.manifest.fileBytes,
    sha256: map.manifest.sha256,
    minZoom: pack.minZoom,
    maxZoom: pack.maxZoom,
    bounds,
    coverageBounds,
    sourceBounds: (() => { const b = sourceBounds(); return b ? [b.west, b.south, b.east, b.north].join(',') : ''; })(),
    attribution: metadata.attribution,
    license: metadata.license,
    source: metadata.source,
    sourceName: 'Geofabrik · OpenStreetMap',
    sourceSha256: metadata.sourceSha256,
    version: metadata.version,
    description: metadata.description,
  };
}

export function getOfflineMapStatus() {
  const catalog = loadCatalog();
  if (catalog?.packs?.length) {
    const overview = catalog.packs.find((p) => p.id === 'egypt-overview') || catalog.packs[0];
    return {
      available: true,
      renderable: true,
      format: String(overview.metadata?.format || overview.format || 'png').toLowerCase(),
      name: String(overview.name || 'مصر — خريطة عامة'),
      attribution: String(overview.metadata?.attribution || overview.attribution || '© OpenStreetMap contributors'),
      license: String(overview.metadata?.license || overview.license || ''),
      minZoom: Number.isInteger(Number(overview.minZoom)) ? Number(overview.minZoom) : 5,
      maxZoom: Number.isInteger(Number(overview.maxZoom)) ? Number(overview.maxZoom) : 11,
      bounds: Array.isArray(overview.bounds) ? overview.bounds.join(',') : String(overview.bounds || '24.5,21.5,37.3,32.6'),
      tileCount: Number(overview.tileCount) || 7268,
    };
  }
  return getLegacyStatus();
}

export function getOfflineMapPackCatalog() {
  const catalog = loadCatalog();
  if (!catalog) return getLegacyCatalog();
  const packs = catalog.packs.map((pack) => {
    try { return generatedPackView(pack, mapFor(pack)); }
    catch (error) {
      return {
        id: pack.id, name: pack.name, available: false, renderable: false,
        minZoom: pack.minZoom, maxZoom: pack.maxZoom, bounds: pack.bounds,
        reason: error.message,
      };
    }
  });
  if (packs.some((pack) => pack.id === 'egypt-overview') && !packs.some((pack) => pack.id === 'all-egypt')) {
    // The alias is intentionally addressable by old clients but not duplicated in the visible catalog.
  }
  return packs;
}

export function getOfflineMapPackManifest(packId) {
  const requestedId = normalizeId(packId);
  const pack = manifestFor(requestedId);
  if (!pack) {
    if (env.offlineMapDirectory) throw new HttpError(404, 'Offline map pack was not found.');
    return getLegacyManifest(packId);
  }
  const map = mapFor(pack);
  const view = generatedPackView(pack, map);
  const { west, south, east, north } = view.coverageBounds;
  const tiles = [];
  let sizeBytes = 0;
  const statement = map.database.prepare(`
    SELECT tile_column,tile_row,length(tile_data) AS size_bytes,tile_data
    FROM tiles WHERE zoom_level=? AND tile_column BETWEEN ? AND ? AND tile_row BETWEEN ? AND ?
  `);
  for (let z = pack.minZoom; z <= pack.maxZoom; z += 1) {
    const n = 2 ** z;
    const x0 = Math.max(0, Math.floor(((west + 180) / 360) * n));
    const x1 = Math.min(n - 1, Math.floor(((east + 180) / 360) * n));
    const y = (lat) => Math.floor(((1 - Math.asinh(Math.tan(Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180)) / Math.PI) / 2) * n);
    const y0 = Math.max(0, Math.floor(y(north)));
    const y1 = Math.min(n - 1, Math.floor(y(south)));
    const result = statement.iterate(z, x0, x1, n - 1 - y1, n - 1 - y0);
    for (const row of result) {
      const data = row.tile_data;
      sizeBytes += Number(row.size_bytes);
      tiles.push({ z, x: Number(row.tile_column), y: n - 1 - Number(row.tile_row), sizeBytes: Number(row.size_bytes), sha256: createHash('sha256').update(data).digest('hex') });
      if (tiles.length > MAX_PACK_TILES) throw new HttpError(503, `Offline map ${requestedId} exceeds the tile limit.`);
    }
  }
  if (tiles.length !== view.tileCount || sizeBytes !== view.sizeBytes) throw new HttpError(503, `Offline map ${requestedId} tile coverage differs from its verified manifest.`);
  return { ...view, tiles };
}

export function readOfflineMapPackTile(packId, zoomInput, columnInput, rowInput) {
  const requestedId = normalizeId(packId);
  const pack = manifestFor(requestedId);
  if (!pack) {
    if (env.offlineMapDirectory) throw new HttpError(404, 'Offline map pack was not found.');
    return readLegacyTile(packId, zoomInput, columnInput, rowInput);
  }
  const map = mapFor(pack);
  const z = Number(zoomInput); const x = Number(columnInput); const y = Number(rowInput);
  if (!Number.isInteger(z) || z < pack.minZoom || z > pack.maxZoom) throw new HttpError(400, 'Tile zoom is outside this offline map pack.');
  const n = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) throw new HttpError(400, 'Tile coordinates are invalid.');
  const [west, south, east, north] = pack.bounds;
  const x0 = Math.floor(((west + 180) / 360) * n); const x1 = Math.floor(((east + 180) / 360) * n);
  const tileY = (lat) => Math.floor(((1 - Math.asinh(Math.tan(Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180)) / Math.PI) / 2) * n);
  if (x < x0 || x > x1 || y < tileY(north) || y > tileY(south)) throw new HttpError(400, 'Tile coordinates are outside this offline map pack.');
  const tile = map.tileStatement.get(z, x, n - 1 - y);
  if (!tile?.tile_data) return null;
  return { contentType: FORMAT_MIME[String(map.metadata.format).toLowerCase()], data: tile.tile_data };
}
