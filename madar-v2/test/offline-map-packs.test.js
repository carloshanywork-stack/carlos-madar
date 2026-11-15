import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const directory = mkdtempSync(join(tmpdir(), 'madar-offline-packs-'));
process.env.MADAR_V2_OFFLINE_MAPS_DIR = directory;
process.env.NODE_ENV = 'test';

function latitudeAt(y, zoom) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (2 ** zoom)))) * 180 / Math.PI;
}

const zoom = 5;
const x = 18;
const y = 13;
const n = 2 ** zoom;
const west = ((x + 0.1) / n) * 360 - 180;
const east = ((x + 0.9) / n) * 360 - 180;
const north = latitudeAt(y + 0.1, zoom);
const south = latitudeAt(y + 0.9, zoom);
const tileData = Buffer.from('fixture-raster-tile');
const license = 'https://opendatacommons.org/licenses/odbl/1-0/';
const sourceSha256 = 'a'.repeat(64);

mkdirSync(directory, { recursive: true });
const mapPath = join(directory, 'egypt-overview.mbtiles');
const database = new Database(mapPath);
database.exec('CREATE TABLE metadata(name TEXT PRIMARY KEY,value TEXT); CREATE TABLE tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB,PRIMARY KEY(zoom_level,tile_column,tile_row));');
database.prepare('INSERT INTO metadata VALUES (?,?)').run('format', 'png');
database.prepare('INSERT INTO metadata VALUES (?,?)').run('license', license);
database.prepare('INSERT INTO metadata VALUES (?,?)').run('sourceSha256', sourceSha256);
database.prepare('INSERT INTO tiles VALUES (?,?,?,?)').run(zoom, x, n - 1 - y, tileData);
database.close();

const fileBytes = readFileSync(mapPath);
const sha256 = createHash('sha256').update(fileBytes).digest('hex');
const tileSha256 = createHash('sha256').update(tileData).digest('hex');
const pack = {
  id: 'egypt-overview', name: 'Egypt overview', bounds: [west, south, east, north],
  minZoom: zoom, maxZoom: zoom, tileCount: 1, tileBytes: tileData.length,
  fileBytes: fileBytes.length, sha256,
  metadata: { format: 'png', minzoom: String(zoom), maxzoom: String(zoom), license, attribution: '© OpenStreetMap contributors', source: 'Geofabrik', sourceSha256, version: sourceSha256, description: 'Roads and waterways only.' },
};
writeFileSync(join(directory, 'egypt-overview.manifest.json'), JSON.stringify(pack));
writeFileSync(join(directory, 'catalog.json'), JSON.stringify({ packs: [pack] }));
writeFileSync(join(directory, 'source-verification.json'), JSON.stringify({ officialMd5Verified: true, sourceBounds: '(24.6/21.9 37.1/32.5)' }));

const { getOfflineMapPackCatalog, getOfflineMapPackManifest, readOfflineMapPackTile } = await import('../server/modules/supervisor/offline-map-packs.js');

test('verified generated packs expose truthful bounds, per-tile hashes, and legacy overview alias', () => {
  const [listed] = getOfflineMapPackCatalog();
  assert.equal(listed.id, 'egypt-overview');
  assert.equal(listed.available, true);
  assert.equal(listed.minZoom, zoom);
  assert.equal(listed.maxZoom, zoom);
  assert.equal(listed.tileCount, 1);
  assert.equal(listed.bounds, [west, south, east, north].join(','));
  assert.equal(listed.sourceBounds, '24.6,21.9,37.1,32.5');

  const manifest = getOfflineMapPackManifest('all-egypt');
  assert.equal(manifest.id, 'egypt-overview');
  assert.deepEqual(manifest.tiles, [{ z: zoom, x, y, sizeBytes: tileData.length, sha256: tileSha256 }]);
  assert.deepEqual(readOfflineMapPackTile('egypt-overview', zoom, x, y).data, tileData);
  assert.throws(() => readOfflineMapPackTile('egypt-overview', zoom, 0, 0), { status: 400 });
});
