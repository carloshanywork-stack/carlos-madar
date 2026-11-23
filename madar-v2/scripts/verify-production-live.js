import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import yauzl from 'yauzl';
import sharp from 'sharp';

import { getMaintenancePhotoDetails } from '../server/modules/maintenance/service.js';
import { buildMaintenancePptxExport } from '../server/modules/maintenance/export.js';

const DB_PATH = '/home/carlos/Desktop/MADAR/madar-v2/data/madar-v2.sqlite';
const STORAGE_ROOT = '/home/carlos/Desktop/MADAR/storage';

function inspectPptx(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const slides = [];
      const jpegs = [];
      zip.readEntry();
      zip.on('entry', (entry) => {
        const isJpeg = /^ppt\/media\/.+\.jpe?g$/i.test(entry.fileName);
        if (!isJpeg && !entry.fileName.endsWith('.xml')) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            const data = Buffer.concat(chunks);
            if (isJpeg) jpegs.push(data);
            else if (/^ppt\/slides\/slide\d+\.xml$/.test(entry.fileName)) slides.push(data.toString());
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve({ slides, jpegs }));
      zip.on('error', reject);
    });
  });
}

async function main() {
  console.log('=== Production Verification: Migrated November Storage & Integrity ===');

  const db = new Database(DB_PATH, { readonly: true });

  // 1. Database check
  const unmigratedNov = db.prepare("SELECT count(*) AS c FROM rep_visit_photos WHERE stored_path NOT LIKE 'Areas/2026/nov/%'").get();
  const migratedNov = db.prepare("SELECT count(*) AS c FROM rep_visit_photos WHERE stored_path LIKE 'Areas/2026/nov/%'").get();
  console.log(`rep_visit_photos: migrated to Areas/2026/nov = ${migratedNov.c}, unmigrated = ${unmigratedNov.c}`);

  const cardStats = db.prepare(`
    SELECT count(*) AS total_cards,
      sum(case when before_photos_json LIKE '%Areas/2026/nov/%' or after_photos_json LIKE '%Areas/2026/nov/%' then 1 else 0 end) AS migrated_cards
    FROM maintenance_cards WHERE order_id >= 55 AND order_id <= 75
  `).get();
  console.log(`November cards (Orders 55-75): total cards = ${cardStats.total_cards}, with Areas/2026/nov = ${cardStats.migrated_cards}`);

  // 2. Photo details and thumbnails on Order 72 (Representative visits)
  console.log('\n--- Checking Order 72 (November Rep Visit) ---');
  const samplePhoto = db.prepare("SELECT * FROM rep_visit_photos WHERE stored_path LIKE '%8289448f%' LIMIT 1").get();
  const filename = samplePhoto.stored_path.split('/').at(-1);

  const beforeDetails = await getMaintenancePhotoDetails(72, 2009, 'before', filename, db);
  console.log('Order 72 Before Photo Details:');
  console.log(`  Stored Path: ${beforeDetails.storedPath}`);
  console.log(`  Absolute Path: ${beforeDetails.absolutePath}`);
  console.log(`  Exists on disk: ${existsSync(beforeDetails.absolutePath)}`);

  const afterDetails = await getMaintenancePhotoDetails(72, 2009, 'after', filename, db);
  console.log('Order 72 After Photo Details:');
  console.log(`  Stored Path: ${afterDetails.storedPath}`);
  console.log(`  Absolute Path: ${afterDetails.absolutePath}`);
  console.log(`  Exists on disk: ${existsSync(afterDetails.absolutePath)}`);

  // Verify thumbnail generation for both
  const beforeThumb = await sharp(beforeDetails.absolutePath).resize(200, 200, { fit: 'cover' }).webp().toBuffer();
  console.log(`  Thumbnail generated for Before photo: ${beforeThumb.length} bytes (WebP)`);
  const afterThumb = await sharp(afterDetails.absolutePath).resize(200, 200, { fit: 'cover' }).webp().toBuffer();
  console.log(`  Thumbnail generated for After photo: ${afterThumb.length} bytes (WebP)`);

  // 3. Checking Office Photos (Order 57 / MN-1057)
  console.log('\n--- Checking Order 57 (November Office Photos) ---');
  const card57 = db.prepare("SELECT id, before_photos_json, after_photos_json FROM maintenance_cards WHERE order_id = 57 AND deleted_at IS NULL AND before_photos_json LIKE '%Areas/2026/nov/%' LIMIT 1").get();
  if (card57) {
    const list = JSON.parse(card57.before_photos_json);
    const officeFilename = list[0].split('/').at(-1);
    const officeDetails = await getMaintenancePhotoDetails(57, card57.id, 'before', officeFilename, db);
    console.log(`  Office photo storedPath: ${officeDetails.storedPath}`);
    console.log(`  Exists on disk: ${existsSync(officeDetails.absolutePath)}`);
  }

  // 4. Checking Historical Order 31 (October untouched)
  console.log('\n--- Checking Historical Order 31 (October Untouched) ---');
  const card31 = db.prepare('SELECT id, before_photos_json FROM maintenance_cards WHERE order_id = 31 LIMIT 1').get();
  const histList = JSON.parse(card31.before_photos_json);
  const histFilename = histList[0].split('/').at(-1);
  const histDetails = await getMaintenancePhotoDetails(31, card31.id, 'before', histFilename, db);
  console.log(`  Historical photo storedPath: ${histDetails.storedPath}`);
  console.log(`  Historical photo absolutePath: ${histDetails.absolutePath}`);
  console.log(`  Exists on disk: ${existsSync(histDetails.absolutePath)}`);
  if (!histDetails.storedPath.startsWith('Clients/C-1001/Archived_Orders/MN-1031/')) {
    throw new Error('Historical photo path was modified unexpectedly!');
  }

  // 5. PowerPoint Generation on Production DB & Storage for Order 72
  console.log('\n--- PowerPoint Export Verification for Order 72 ---');
  const pptxReport = await buildMaintenancePptxExport({ orderIds: [72] }, db);
  console.log(`  PPTX Report generated: ${pptxReport.filename} (${(pptxReport.buffer.length / 1024).toFixed(1)} KB)`);
  const { slides, jpegs } = await inspectPptx(pptxReport.buffer);
  console.log(`  PPTX slides count: ${slides.length}, embedded JPEG images: ${jpegs.length}`);
  if (jpegs.length === 0) {
    throw new Error('PowerPoint export contains 0 images!');
  }

  db.close();
  console.log('\n=== All Production Verifications PASSED 100%! ===');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
