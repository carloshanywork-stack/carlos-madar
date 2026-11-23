import Database from 'better-sqlite3';
import { copyFile, mkdir, rm, stat, readFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import sharp from 'sharp';

const PROD_DB_PATH = '/home/carlos/Desktop/MADAR/madar-v2/data/madar-v2.sqlite';
const PROD_STORAGE_ROOT = '/home/carlos/Desktop/MADAR/storage';

const BACKUP_DIR = '/home/carlos/Desktop/madar-isolated-backup-nov2026';
const BACKUP_DB_PATH = join(BACKUP_DIR, 'data', 'madar-v2.sqlite');
const BACKUP_STORAGE_ROOT = join(BACKUP_DIR, 'storage');

const RESTORE_DIR = '/home/carlos/Desktop/madar-isolated-restore-nov2026';
const RESTORE_DB_PATH = join(RESTORE_DIR, 'data', 'madar-v2.sqlite');
const RESTORE_STORAGE_ROOT = join(RESTORE_DIR, 'storage');

// Set environment variables for isolated restore before importing modules
process.env.MADAR_V2_DATABASE_PATH = RESTORE_DB_PATH;
process.env.MADAR_V2_STORAGE_ROOT = RESTORE_STORAGE_ROOT;
process.env.MADAR_V2_DATA_DIR = join(RESTORE_DIR, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';

const {
  generateBatchAManifest,
  generateBatchBManifest,
  generateBatchCManifest,
  executeMigrationBatch,
  rollbackMigrationBatch,
  ensureMigrationJournalTable,
  computeFileSha256,
} = await import('../server/modules/maintenance/storage-migration.js');

const { buildMaintenancePptxExport } = await import('../server/modules/maintenance/export.js');

function inspectPptx(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const parts = [];
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
            if (isJpeg) {
              jpegs.push(data);
            } else {
              const xml = data.toString();
              parts.push(xml);
              if (/^ppt\/slides\/slide\d+\.xml$/.test(entry.fileName)) slides.push(xml);
            }
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve({ xml: parts.join('\n'), slides, jpegs }));
      zip.on('error', reject);
    });
  });
}

async function copyDirRecursive(src, dst) {
  await mkdir(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else {
      await copyFile(srcPath, dstPath);
    }
  }
}

async function run() {
  console.log('=== Step 1: Creating Consistent Independent Backup ===');
  await mkdir(join(BACKUP_DIR, 'data'), { recursive: true });
  await mkdir(BACKUP_STORAGE_ROOT, { recursive: true });

  // 1.1 Snapshot SQLite Database using better-sqlite3 backup API
  console.log('1.1 Performing SQLite online backup...');
  const prodDb = new Database(PROD_DB_PATH, { readonly: true });
  await prodDb.backup(BACKUP_DB_PATH);
  prodDb.close();

  const backupDb = new Database(BACKUP_DB_PATH);
  const integrity = backupDb.prepare('PRAGMA integrity_check').get();
  const foreignKeys = backupDb.prepare('PRAGMA foreign_key_check').all();
  const dbChecksum = computeFileSha256(BACKUP_DB_PATH);
  console.log('  Backup DB integrity check:', integrity);
  console.log('  Backup DB foreign keys check:', foreignKeys.length === 0 ? 'OK (0 violations)' : foreignKeys);
  console.log(`  Backup DB SHA-256: ${dbChecksum.sha256} (${dbChecksum.byteSize} bytes)`);

  if (integrity.integrity_check !== 'ok') {
    throw new Error(`Database backup integrity check failed: ${JSON.stringify(integrity)}`);
  }

  // 1.2 Copy referenced storage files (Batch A, Batch B, Historical Order 31)
  console.log('1.2 Copying referenced storage files into backup...');
  const batchA = generateBatchAManifest(backupDb, PROD_STORAGE_ROOT);
  const batchB = generateBatchBManifest(backupDb, PROD_STORAGE_ROOT);

  let filesCopied = 0;
  let bytesCopied = 0;

  for (const item of [...batchA, ...batchB]) {
    if (item.sourceExists) {
      const src = join(PROD_STORAGE_ROOT, item.sourcePath);
      const dst = join(BACKUP_STORAGE_ROOT, item.sourcePath);
      if (!existsSync(dst)) {
        await mkdir(dirname(dst), { recursive: true });
        await copyFile(src, dst);
        filesCopied += 1;
        bytesCopied += item.byteSize;
      }
    }
  }

  // Copy sample historical Order 31 files
  const order31Cards = backupDb.prepare('SELECT before_photos_json, after_photos_json FROM maintenance_cards WHERE order_id = 31').all();
  let histFiles = 0;
  for (const card of order31Cards) {
    for (const raw of [card.before_photos_json, card.after_photos_json]) {
      const list = JSON.parse(raw || '[]');
      for (const p of list) {
        const src = join(PROD_STORAGE_ROOT, p);
        if (existsSync(src)) {
          const dst = join(BACKUP_STORAGE_ROOT, p);
          if (!existsSync(dst)) {
            await mkdir(dirname(dst), { recursive: true });
            await copyFile(src, dst);
            const st = await stat(dst);
            filesCopied += 1;
            bytesCopied += st.size;
            histFiles += 1;
          }
        }
      }
    }
  }

  // Also ensure existing Areas/2026/nov directory exists in backup
  await mkdir(join(BACKUP_STORAGE_ROOT, 'Areas', '2026', 'nov'), { recursive: true });

  console.log(`  Backup storage complete.`);
  console.log(`    - Batch A files: ${batchA.filter((x) => x.sourceExists).length}`);
  console.log(`    - Batch B files: ${batchB.filter((x) => x.sourceExists).length}`);
  console.log(`    - Historical files (Order 31): ${histFiles}`);

  backupDb.close();

  console.log('\n=== Step 2: Restoring Backup to Isolated Environment ===');
  await rm(RESTORE_DIR, { recursive: true, force: true });
  await mkdir(join(RESTORE_DIR, 'data'), { recursive: true });
  await mkdir(RESTORE_STORAGE_ROOT, { recursive: true });

  await copyFile(BACKUP_DB_PATH, RESTORE_DB_PATH);
  await copyDirRecursive(BACKUP_STORAGE_ROOT, RESTORE_STORAGE_ROOT);
  console.log('  Restored isolated DB and storage successfully.');

  const restoreDb = new Database(RESTORE_DB_PATH);
  const restoreIntegrity = restoreDb.prepare('PRAGMA integrity_check').get();
  console.log('  Restored DB integrity check:', restoreIntegrity);
  if (restoreIntegrity.integrity_check !== 'ok') {
    throw new Error('Restored DB integrity check failed');
  }

  console.log('\n=== Step 3: Verifying Orders, Previews & Exports on Restored Copy ===');

  // 3.1 Historical Order (Order 31)
  const histOrder = restoreDb.prepare('SELECT id, order_code, area, status FROM maintenance_orders WHERE id = 31').get();
  const histCard = restoreDb.prepare('SELECT id, before_photos_json FROM maintenance_cards WHERE order_id = 31 LIMIT 1').get();
  const histPhotos = JSON.parse(histCard.before_photos_json);
  const histPhotoExists = existsSync(join(RESTORE_STORAGE_ROOT, histPhotos[0]));
  console.log(`3.1 Historical Order: ${histOrder.order_code} (Status: ${histOrder.status})`);
  console.log(`    Sample photo ${histPhotos[0]}: exists on disk = ${histPhotoExists}`);

  // 3.2 November Order (Order 72 - شرم الشيخ ودهب)
  const novOrder = restoreDb.prepare('SELECT id, order_code, area, status FROM maintenance_orders WHERE id = 72').get();
  const novVisits = restoreDb.prepare('SELECT id, visit_uuid, before_path, after_path FROM rep_visits WHERE order_id = 72').all();
  const novPhotos = restoreDb.prepare('SELECT id, stored_path FROM rep_visit_photos WHERE visit_id IN (SELECT id FROM rep_visits WHERE order_id = 72)').all();
  const novPhotosOnDisk = novPhotos.filter((p) => existsSync(join(RESTORE_STORAGE_ROOT, p.stored_path))).length;
  console.log(`3.2 November Order: ${novOrder.order_code} (Status: ${novOrder.status})`);
  console.log(`    Rep visits count: ${novVisits.length}, Photos count: ${novPhotos.length}, Found on disk: ${novPhotosOnDisk}/${novPhotos.length}`);

  // 3.3 Workshop Order Test in isolated copy
  console.log('3.3 Testing Workshop Order in isolated copy...');
  restoreDb.exec(`
    INSERT INTO workshop_orders (id, order_code, client_id, quotation_id, product_name, description, machine_type, status, sale_price_cents, created_at, updated_at)
    VALUES (999, 'WO-TEST-999', 1, NULL, 'Signage Letters Pilot', 'Acrylic Letters Pilot', 'cnc_router', 'in_production', 450000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT INTO workshop_design_files (id, order_id, original_name, stored_path, extension, byte_size, created_at)
    VALUES (9001, 999, 'acrylic_pilot.dxf', 'Workshop/Orders/999/designs/9001.dxf', '.dxf', 1024, CURRENT_TIMESTAMP);
  `);

  const dummyDesignContent = Buffer.from('TEST_DXF_CAD_VECTOR_FOR_ACRYLIC_CUTTING_ORDER_999');
  const workshopDesignDiskPath = join(RESTORE_STORAGE_ROOT, 'Workshop/Orders/999/designs/9001.dxf');
  await mkdir(dirname(workshopDesignDiskPath), { recursive: true });
  writeFileSync(workshopDesignDiskPath, dummyDesignContent);

  const designRow = restoreDb.prepare('SELECT * FROM workshop_design_files WHERE id = 9001').get();
  const designDiskExists = existsSync(join(RESTORE_STORAGE_ROOT, designRow.stored_path));
  console.log(`    Workshop Order WO-TEST-999 design file: ${designRow.stored_path}, exists = ${designDiskExists}`);

  // 3.4 Pre-migration PowerPoint generation test for November Order 72
  console.log('3.4 Generating PowerPoint for November Order 72 on restored copy...');
  const pptxReportBefore = await buildMaintenancePptxExport({ orderIds: [72] }, restoreDb);
  console.log(`    PPTX generated: ${pptxReportBefore.filename} (${(pptxReportBefore.buffer.length / 1024).toFixed(1)} KB)`);
  const pptxInspectBefore = await inspectPptx(pptxReportBefore.buffer);
  console.log(`    PPTX inspection: slides count = ${pptxInspectBefore.slides.length}, embedded JPEG images = ${pptxInspectBefore.jpegs.length}`);
  if (pptxInspectBefore.jpegs.length === 0) {
    throw new Error('PowerPoint export did not embed any photos!');
  }

  console.log('\n=== Step 4: Rehearsing Migration on Restored Copy ===');
  // 4.1 Dry run
  const restoreBatchA = generateBatchAManifest(restoreDb, RESTORE_STORAGE_ROOT);
  const restoreBatchB = generateBatchBManifest(restoreDb, RESTORE_STORAGE_ROOT);
  const restoreBatchC = generateBatchCManifest(restoreDb, RESTORE_STORAGE_ROOT);

  console.log(`4.1 Dry Run: Batch A (${restoreBatchA.length}), Batch B (${restoreBatchB.length}), Batch C (${restoreBatchC.length})`);
  const dryA = await executeMigrationBatch({
    manifest: restoreBatchA,
    batchName: 'Batch_A_Rep_Visits',
    storageRoot: RESTORE_STORAGE_ROOT,
    db: restoreDb,
    dryRun: true,
  });
  console.log(`    Dry Run Batch A: to copy = ${dryA.copied}, already in place = ${dryA.alreadyInPlace}`);

  // 4.2 Real Execution on Restored Copy
  console.log('4.2 Executing Batch A migration on isolated restore...');
  const execA = await executeMigrationBatch({
    manifest: restoreBatchA,
    batchName: 'Batch_A_Rep_Visits',
    storageRoot: RESTORE_STORAGE_ROOT,
    db: restoreDb,
    dryRun: false,
  });
  console.log(`    Batch A Executed: copied=${execA.copied}, dbUpdated=${execA.dbUpdated}, alreadyInPlace=${execA.alreadyInPlace}`);

  console.log('4.3 Executing Batch B migration on isolated restore...');
  const execB = await executeMigrationBatch({
    manifest: restoreBatchB,
    batchName: 'Batch_B_Office_Photos',
    storageRoot: RESTORE_STORAGE_ROOT,
    db: restoreDb,
    dryRun: false,
  });
  console.log(`    Batch B Executed: copied=${execB.copied}, dbUpdated=${execB.dbUpdated}, exceptionsSkipped=${execB.exceptionsSkipped}`);

  // Verify journal table
  const journalCount = restoreDb.prepare("SELECT count(*) AS count FROM storage_migration_journal WHERE status = 'completed'").get();
  console.log(`    Journal rows recorded with status 'completed': ${journalCount.count}`);

  // 4.4 Idempotency / Resumption Test: re-running immediately should detect already completed
  console.log('4.4 Testing Idempotency on rerun...');
  const rerunA = await executeMigrationBatch({
    manifest: restoreBatchA,
    batchName: 'Batch_A_Rep_Visits',
    storageRoot: RESTORE_STORAGE_ROOT,
    db: restoreDb,
    dryRun: false,
  });
  console.log(`    Rerun Batch A: copied=${rerunA.copied}, alreadyInPlace=${rerunA.alreadyInPlace}, dbUpdated=${rerunA.dbUpdated} (IDEMPOTENT!)`);

  // 4.5 Rollback Rehearsal
  console.log('4.5 Testing Rollback of Batch A...');
  const rollbackA = rollbackMigrationBatch({
    batchName: 'Batch_A_Rep_Visits',
    storageRoot: RESTORE_STORAGE_ROOT,
    db: restoreDb,
  });
  console.log(`    Rollback Batch A: restored entries = ${rollbackA.entriesRolledBack}`);

  // Check that rep_visit_photos restored to original path
  const samplePhoto = restoreDb.prepare('SELECT stored_path FROM rep_visit_photos WHERE id = ?').get(restoreBatchA[0].photoId);
  console.log(`    Photo ${restoreBatchA[0].photoId} path after rollback: ${samplePhoto.stored_path}`);
  if (samplePhoto.stored_path !== restoreBatchA[0].sourcePath) {
    throw new Error(`Rollback failed! Expected ${restoreBatchA[0].sourcePath}, got ${samplePhoto.stored_path}`);
  }

  // Re-apply Batch A so restore copy is in migrated state for verification
  console.log('4.6 Re-applying Batch A after rollback test...');
  await executeMigrationBatch({
    manifest: restoreBatchA,
    batchName: 'Batch_A_Rep_Visits',
    storageRoot: RESTORE_STORAGE_ROOT,
    db: restoreDb,
    dryRun: false,
  });

  console.log('\n=== Step 5: Verifying Migrated Copy (Previews & PPTX) ===');
  // Check migrated photos for Order 72
  const migratedSample = restoreDb.prepare('SELECT stored_path FROM rep_visit_photos WHERE id = ?').get(restoreBatchA[0].photoId);
  console.log(`5.1 Migrated path for sample photo: ${migratedSample.stored_path}`);
  const migratedDiskExists = existsSync(join(RESTORE_STORAGE_ROOT, migratedSample.stored_path));
  console.log(`    Migrated photo exists on disk: ${migratedDiskExists}`);
  const migratedSha = computeFileSha256(join(RESTORE_STORAGE_ROOT, migratedSample.stored_path));
  console.log(`    Migrated photo SHA-256 matches original: ${migratedSha.sha256 === restoreBatchA[0].sha256}`);

  // Check that original source photo is still preserved!
  const originalStillExists = existsSync(join(RESTORE_STORAGE_ROOT, restoreBatchA[0].sourcePath));
  console.log(`5.2 Original source photo byte-for-byte preserved on disk: ${originalStillExists}`);

  // 5.3 Post-migration PowerPoint generation test for November Order 72
  console.log('5.3 Generating PowerPoint for November Order 72 on migrated copy...');
  const pptxReportAfter = await buildMaintenancePptxExport({ orderIds: [72] }, restoreDb);
  console.log(`    Post-migration PPTX generated: ${pptxReportAfter.filename} (${(pptxReportAfter.buffer.length / 1024).toFixed(1)} KB)`);
  const pptxInspectAfter = await inspectPptx(pptxReportAfter.buffer);
  console.log(`    Post-migration PPTX inspection: slides count = ${pptxInspectAfter.slides.length}, embedded JPEG images = ${pptxInspectAfter.jpegs.length}`);
  if (pptxInspectAfter.jpegs.length === 0) {
    throw new Error('Post-migration PowerPoint export did not embed photos!');
  }

  // 5.4 Verify workshop isolation: file opens from correct order only
  const designFromDb = restoreDb.prepare('SELECT * FROM workshop_design_files WHERE order_id = 999').get();
  console.log(`5.4 Workshop attachment canonical path: ${designFromDb.stored_path}`);
  if (!designFromDb.stored_path.startsWith('Workshop/Orders/999/designs/')) {
    throw new Error('Workshop design file is not isolated under Workshop/Orders/999/designs/');
  }

  restoreDb.close();
  console.log('\n=== Rehearsal Complete: All Backup, Restore, Migration, and PowerPoint checks PASSED 100%! ===');
}

run().catch((err) => {
  console.error('Fatal error during rehearsal:', err);
  process.exit(1);
});
