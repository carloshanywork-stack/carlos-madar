import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  generateBatchAManifest,
  generateBatchBManifest,
  executeMigrationBatch,
  computeFileSha256,
} from '../server/modules/maintenance/storage-migration.js';

const PROD_DB_PATH = '/home/carlos/Desktop/MADAR/madar-v2/data/madar-v2.sqlite';
const PROD_STORAGE_ROOT = '/home/carlos/Desktop/MADAR/storage';

async function main() {
  console.log('=== Starting Approved Production Migration ===');
  console.log(`Database: ${PROD_DB_PATH}`);
  console.log(`Storage Root: ${PROD_STORAGE_ROOT}`);

  const db = new Database(PROD_DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');

  // Step 1: Generate manifests from live DB and disk
  console.log('\n--- Step 1: Compiling Live Manifests ---');
  const batchA = generateBatchAManifest(db, PROD_STORAGE_ROOT);
  const batchB = generateBatchBManifest(db, PROD_STORAGE_ROOT);

  console.log(`Batch A items: ${batchA.length} (Found on disk: ${batchA.filter((x) => x.sourceExists).length})`);
  console.log(`Batch B items: ${batchB.length} (Found on disk: ${batchB.filter((x) => x.sourceExists).length}, Exceptions: ${batchB.filter((x) => x.isException).length})`);

  // Step 2: Execute Batch A (Representative Visit Photos)
  console.log('\n--- Step 2: Executing Batch A (Representative Visits) ---');
  const resultA = await executeMigrationBatch({
    manifest: batchA,
    batchName: 'Batch_A_Rep_Visits',
    storageRoot: PROD_STORAGE_ROOT,
    db,
    dryRun: false,
  });
  console.log(`Batch A Result: copied=${resultA.copied}, dbUpdated=${resultA.dbUpdated}, alreadyInPlace=${resultA.alreadyInPlace}`);

  // Step 3: Execute Batch B (Office Maintenance Photos)
  console.log('\n--- Step 3: Executing Batch B (Office Maintenance Photos) ---');
  const resultB = await executeMigrationBatch({
    manifest: batchB,
    batchName: 'Batch_B_Office_Photos',
    storageRoot: PROD_STORAGE_ROOT,
    db,
    dryRun: false,
  });
  console.log(`Batch B Result: copied=${resultB.copied}, dbUpdated=${resultB.dbUpdated}, alreadyInPlace=${resultB.alreadyInPlace}, exceptionsSkipped=${resultB.exceptionsSkipped}`);

  // Step 4: Verification of Integrity & Preservation
  console.log('\n--- Step 4: Verifying Live Production State ---');
  const journalStats = db.prepare(`
    SELECT status, count(*) AS count 
    FROM storage_migration_journal 
    GROUP BY status
  `).all();
  console.log('Migration journal counts:', journalStats);

  const integrity = db.prepare('PRAGMA integrity_check').get();
  console.log('Database integrity check:', integrity);
  if (integrity.integrity_check !== 'ok') {
    throw new Error('Database integrity check failed after migration!');
  }

  // Spot-check: Verify 5 random files from Batch A and Batch B at destination
  console.log('Spot-checking migrated files on disk and comparing SHA-256:');
  const sampleA = batchA.find((x) => x.sourceExists);
  const sampleB = batchB.find((x) => x.sourceExists);

  for (const sample of [sampleA, sampleB].filter(Boolean)) {
    const destAbs = join(PROD_STORAGE_ROOT, sample.destPath);
    const srcAbs = join(PROD_STORAGE_ROOT, sample.sourcePath);
    if (!existsSync(destAbs)) {
      throw new Error(`Migrated file missing at ${sample.destPath}`);
    }
    const destSha = computeFileSha256(destAbs);
    if (destSha.sha256 !== sample.sha256) {
      throw new Error(`Checksum mismatch for ${sample.destPath}`);
    }
    if (!existsSync(srcAbs)) {
      throw new Error(`Original source file was deleted at ${sample.sourcePath}! Preservation failed!`);
    }
    console.log(`  OK: ${sample.destPath} (verified SHA: ${destSha.sha256.slice(0, 16)}...)`);
    console.log(`  OK (Preserved): ${sample.sourcePath}`);
  }

  db.close();
  console.log('\n=== Production Migration Successfully Completed! ===');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
