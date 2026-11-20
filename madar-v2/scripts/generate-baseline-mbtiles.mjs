import Database from 'better-sqlite3';
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const dataDir = resolve(import.meta.dirname, '../data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const mbtilesPath = join(dataDir, 'offline-maps.mbtiles');

const db = new Database(mbtilesPath);
db.exec('CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);');
db.exec('CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row);');

const meta = [
  ['name', 'MADAR Egypt Baseline Offline Map'],
  ['format', 'png'],
  ['minzoom', '5'],
  ['maxzoom', '10'],
  ['bounds', '24.5,21.5,37.2,32.6'],
  ['attribution', '© OpenStreetMap contributors · MADAR Offline'],
  ['version', '1.0.0'],
];
const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)');
for (const [k, v] of meta) insertMeta.run(k, v);

function tileCoordinate(lon, lat, zoom) {
  const count = 2 ** zoom;
  const safeLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = safeLat * Math.PI / 180;
  return {
    x: Math.max(0, Math.min(count - 1, Math.floor(((lon + 180) / 360) * count))),
    y: Math.max(0, Math.min(count - 1, Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * count))),
  };
}

const svg = `<svg width='256' height='256' xmlns='http://www.w3.org/2000/svg'>
  <rect width='256' height='256' fill='#eaf2f8'/>
  <path d='M0 128 Q 64 120, 128 135 T 256 128' stroke='#d4e6f1' stroke-width='2' fill='none'/>
  <rect x='10' y='10' width='236' height='236' fill='none' stroke='#d5dbdb' stroke-width='1' stroke-dasharray='4,4'/>
  <text x='128' y='132' font-family='sans-serif' font-size='11' fill='#7f8c8d' text-anchor='middle'>MADAR Offline</text>
</svg>`;

const tileBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
const insertStmt = db.prepare('INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)');
let tileCount = 0;

db.transaction(() => {
  for (let z = 5; z <= 10; z++) {
    const count = 2 ** z;
    const nw = tileCoordinate(24.5, 32.6, z);
    const se = tileCoordinate(37.2, 21.5, z);
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        insertStmt.run(z, x, count - 1 - y, tileBuffer);
        tileCount++;
      }
    }
  }
})();

console.log('Successfully generated baseline MBTiles with', tileCount, 'tiles at', mbtilesPath);
db.close();
