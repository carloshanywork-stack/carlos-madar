import { copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { resolveMonthDirectory, safeMachineStorageSegment } from './photo-routing.js';

/**
 * Calculates SHA-256 checksum of a file on disk.
 */
export function computeFileSha256(filePath) {
  const buffer = readFileSync(filePath);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    byteSize: buffer.length,
  };
}

/**
 * Ensures table storage_migration_journal exists in the database.
 */
export function ensureMigrationJournalTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_migration_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      card_id INTEGER,
      order_id INTEGER,
      phase TEXT,
      old_path TEXT NOT NULL,
      new_path TEXT NOT NULL,
      sha256 TEXT,
      byte_size INTEGER,
      status TEXT NOT NULL,
      error_message TEXT,
      migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      rolled_back_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_storage_migration_journal_batch ON storage_migration_journal (batch_name, status);
  `);
}

/**
 * Generates the manifest for Batch A (Representative Visit Photos).
 */
export function generateBatchAManifest(db, storageRoot) {
  const query = `
    SELECT 
      rvp.id AS photo_id,
      rvp.visit_id,
      rvp.phase,
      rvp.stored_path,
      rvp.captured_at,
      rv.visit_uuid,
      rv.order_id,
      rv.card_id,
      rv.order_code,
      rv.machine_code,
      rv.region_name,
      m.name_ar AS machine_name_ar,
      m.area AS machine_area,
      mo.area AS order_area
    FROM rep_visit_photos rvp
    JOIN rep_visits rv ON rv.id = rvp.visit_id
    LEFT JOIN machines m ON m.id = rv.machine_id OR m.code = rv.machine_code
    LEFT JOIN maintenance_orders mo ON mo.id = rv.order_id
    WHERE rvp.stored_path NOT LIKE 'Areas/2026/nov/%'
      AND rvp.stored_path NOT LIKE 'Areas/2026/NOV/%'
    ORDER BY rvp.id ASC
  `;

  const rows = db.prepare(query).all();
  const manifest = [];

  for (const row of rows) {
    const sourceRelative = row.stored_path.replace(/\\/g, '/');
    const sourceAbsolute = join(storageRoot, sourceRelative);
    const exists = existsSync(sourceAbsolute);

    let sha256 = null;
    let byteSize = null;
    if (exists) {
      const stats = computeFileSha256(sourceAbsolute);
      sha256 = stats.sha256;
      byteSize = stats.byteSize;
    }

    // Determine year/month from captured_at or fallback to 2026 NOV
    const date = row.captured_at ? new Date(row.captured_at) : new Date('2026-11-20T12:00:00Z');
    const year = String(date.getFullYear() || '2026');
    const monthFolder = resolveMonthDirectory(year, 'NOV', storageRoot);

    const area = safeMachineStorageSegment(row.machine_area || row.order_area || 'Unassigned Area');
    const machine = safeMachineStorageSegment(`${row.machine_code}_${row.machine_name_ar || ''}`, row.machine_code || 'unknown');
    const orderKey = safeMachineStorageSegment(row.order_code || `order_${row.order_id}`, `order_${row.order_id}`);
    const phaseDir = String(row.phase).toLowerCase() === 'before' ? 'Before' : 'After';
    const filename = sourceRelative.split('/').pop();

    const destRelative = `Areas/${year}/${monthFolder}/${area}/${machine}/${orderKey}/${phaseDir}/${filename}`;

    manifest.push({
      batch: 'Batch_A_Rep_Visits',
      entityType: 'rep_visit_photo',
      photoId: row.photo_id,
      visitId: row.visit_id,
      cardId: row.card_id,
      orderId: row.order_id,
      orderCode: row.order_code,
      phase: row.phase,
      sourcePath: sourceRelative,
      destPath: destRelative,
      sourceExists: exists,
      sha256,
      byteSize,
      isException: !exists,
      exceptionReason: exists ? null : 'Source file missing on storage disk',
    });
  }

  return manifest;
}

/**
 * Generates the manifest for Batch B (Office Maintenance Photos).
 */
export function generateBatchBManifest(db, storageRoot) {
  const query = `
    SELECT 
      mc.id AS card_id,
      mc.order_id,
      mc.before_photos_json,
      mc.after_photos_json,
      m.code AS machine_code,
      m.name_ar AS machine_name_ar,
      m.area AS machine_area,
      mo.order_code,
      mo.area AS order_area,
      mo.created_at AS order_created_at
    FROM maintenance_cards mc
    JOIN maintenance_orders mo ON mo.id = mc.order_id
    LEFT JOIN machines m ON m.id = mc.machine_id
    WHERE mo.id >= 55 AND mo.id <= 75
      AND (
        (mc.before_photos_json IS NOT NULL AND mc.before_photos_json != '[]')
        OR
        (mc.after_photos_json IS NOT NULL AND mc.after_photos_json != '[]')
      )
    ORDER BY mc.id ASC
  `;

  const rows = db.prepare(query).all();
  const manifest = [];

  for (const row of rows) {
    const date = row.order_created_at ? new Date(row.order_created_at) : new Date('2026-11-15T12:00:00Z');
    const year = String(date.getFullYear() || '2026');
    const monthFolder = resolveMonthDirectory(year, 'NOV', storageRoot);

    const area = safeMachineStorageSegment(row.machine_area || row.order_area || 'Unassigned Area');
    const machine = safeMachineStorageSegment(`${row.machine_code}_${row.machine_name_ar || ''}`, row.machine_code || 'unknown');
    const orderKey = safeMachineStorageSegment(row.order_code || `order_${row.order_id}`, `order_${row.order_id}`);

    for (const phase of ['before', 'after']) {
      const rawJson = phase === 'before' ? row.before_photos_json : row.after_photos_json;
      let photoList = [];
      try {
        photoList = JSON.parse(rawJson || '[]');
      } catch {
        photoList = [];
      }

      for (let i = 0; i < photoList.length; i++) {
        const sourceRelative = String(photoList[i]).replace(/\\/g, '/');
        // If already canonical Areas/2026/nov, skip
        if (sourceRelative.startsWith('Areas/2026/nov/') || sourceRelative.startsWith('Areas/2026/NOV/')) {
          continue;
        }

        const sourceAbsolute = join(storageRoot, sourceRelative);
        const exists = existsSync(sourceAbsolute);

        let sha256 = null;
        let byteSize = null;
        if (exists) {
          const stats = computeFileSha256(sourceAbsolute);
          sha256 = stats.sha256;
          byteSize = stats.byteSize;
        }

        const phaseDir = phase === 'before' ? 'Before' : 'After';
        const filename = sourceRelative.split('/').pop();
        const destRelative = `Areas/${year}/${monthFolder}/${area}/${machine}/${orderKey}/${phaseDir}/${filename}`;

        manifest.push({
          batch: 'Batch_B_Office_Photos',
          entityType: 'maintenance_card_photo',
          cardId: row.card_id,
          orderId: row.order_id,
          orderCode: row.order_code,
          phase,
          photoIndex: i,
          sourcePath: sourceRelative,
          destPath: destRelative,
          sourceExists: exists,
          sha256,
          byteSize,
          isException: !exists,
          exceptionReason: exists ? null : 'Source file missing on storage disk',
        });
      }
    }
  }

  return manifest;
}

/**
 * Generates the manifest for Batch C (Workshop Orders).
 */
export function generateBatchCManifest(db, storageRoot) {
  // Check if workshop_design_files table exists
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workshop_design_files'").get();
  if (!hasTable) return [];

  const query = `
    SELECT 
      wdf.id AS file_id,
      wdf.order_id,
      wdf.stored_path,
      wdf.original_name,
      wo.order_code,
      wo.client_id
    FROM workshop_design_files wdf
    JOIN workshop_orders wo ON wo.id = wdf.order_id
    ORDER BY wdf.id ASC
  `;

  let rows = [];
  try {
    rows = db.prepare(query).all();
  } catch {
    return [];
  }

  const manifest = [];
  for (const row of rows) {
    const sourceRelative = row.stored_path.replace(/\\/g, '/');
    const filename = sourceRelative.split('/').pop();
    const destRelative = `Workshop/Orders/${row.order_id}/designs/${filename}`;

    const sourceAbsolute = join(storageRoot, sourceRelative);
    const exists = existsSync(sourceAbsolute);
    let sha256 = null;
    let byteSize = null;
    if (exists) {
      const stats = computeFileSha256(sourceAbsolute);
      sha256 = stats.sha256;
      byteSize = stats.byteSize;
    }

    manifest.push({
      batch: 'Batch_C_Workshop_Orders',
      entityType: 'workshop_design',
      fileId: row.file_id,
      orderId: row.order_id,
      orderCode: row.order_code,
      clientId: row.client_id,
      sourcePath: sourceRelative,
      destPath: destRelative,
      sourceExists: exists,
      sha256,
      byteSize,
      isException: !exists,
      exceptionReason: exists ? null : 'Source file missing on storage disk',
    });
  }

  return manifest;
}

/**
 * Executes migration for a given manifest list.
 * Copies files first, verifies SHA-256 and byte sizes, then executes transactional DB update.
 */
export async function executeMigrationBatch({
  manifest,
  batchName,
  storageRoot,
  db,
  dryRun = false,
}) {
  ensureMigrationJournalTable(db);
  db.pragma('busy_timeout = 30000');

  const results = {
    batchName,
    totalItems: manifest.length,
    copied: 0,
    alreadyInPlace: 0,
    exceptionsSkipped: 0,
    conflicts: 0,
    dbUpdated: 0,
    items: [],
  };

  const toUpdateInDb = [];

  // Pass 1: Disk operations (Copy-first and verification)
  for (const item of manifest) {
    // 1. Check if already migrated and completed
    const existingJournal = db.prepare(`
      SELECT status, new_path FROM storage_migration_journal 
      WHERE batch_name = ? AND old_path = ? AND status = 'completed'
    `).get(batchName, item.sourcePath);

    if (existingJournal) {
      results.alreadyInPlace += 1;
      results.items.push({ ...item, status: 'already_migrated' });
      continue;
    }

    // 2. If source is missing, record exception and skip DB switch
    if (!item.sourceExists) {
      results.exceptionsSkipped += 1;
      if (!dryRun) {
        db.prepare(`
          INSERT INTO storage_migration_journal 
          (batch_name, entity_type, entity_id, card_id, order_id, phase, old_path, new_path, status, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'missing_skipped', ?)
        `).run(
          batchName,
          item.entityType,
          item.photoId || item.cardId || item.fileId || 0,
          item.cardId || null,
          item.orderId || null,
          item.phase || null,
          item.sourcePath,
          item.destPath,
          item.exceptionReason || 'Source missing',
        );
      }
      results.items.push({ ...item, status: 'missing_skipped' });
      continue;
    }

    const sourceAbsolute = join(storageRoot, item.sourcePath);
    const destAbsolute = join(storageRoot, item.destPath);

    // 3. Destination checking & copy
    let destAlreadyMatches = false;
    if (existsSync(destAbsolute)) {
      const destCheck = computeFileSha256(destAbsolute);
      if (destCheck.sha256 === item.sha256 && destCheck.byteSize === item.byteSize) {
        destAlreadyMatches = true;
        results.alreadyInPlace += 1;
      } else {
        results.conflicts += 1;
        throw new Error(
          `Destination conflict: file exists at ${item.destPath} with different checksum! Expected ${item.sha256}, got ${destCheck.sha256}`,
        );
      }
    }

    if (!dryRun && !destAlreadyMatches) {
      await mkdir(dirname(destAbsolute), { recursive: true });
      await copyFile(sourceAbsolute, destAbsolute);

      // Verify copied file byte-for-byte
      const verified = computeFileSha256(destAbsolute);
      if (verified.sha256 !== item.sha256 || verified.byteSize !== item.byteSize) {
        await unlink(destAbsolute).catch(() => {});
        throw new Error(
          `Copy verification failed for ${item.destPath}: expected SHA ${item.sha256}, got ${verified.sha256}`,
        );
      }
      results.copied += 1;
    } else if (dryRun && !destAlreadyMatches) {
      results.copied += 1;
    }

    toUpdateInDb.push(item);
    results.items.push({ ...item, status: 'completed' });
  }

  // Pass 2: Transactional database switch in chunks
  if (!dryRun && toUpdateInDb.length > 0) {
    const updateRep = db.prepare('UPDATE rep_visit_photos SET stored_path = ? WHERE id = ?');
    const selectCard = db.prepare('SELECT before_photos_json, after_photos_json FROM maintenance_cards WHERE id = ?');
    const updateCard = db.prepare('UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const updateDesign = db.prepare('UPDATE workshop_design_files SET stored_path = ? WHERE id = ?');
    const insertJournal = db.prepare(`
      INSERT INTO storage_migration_journal 
      (batch_name, entity_type, entity_id, card_id, order_id, phase, old_path, new_path, sha256, byte_size, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
    `);

    // Chunk size 100 for fast atomic commits without holding locks long
    const CHUNK_SIZE = 100;
    for (let c = 0; c < toUpdateInDb.length; c += CHUNK_SIZE) {
      const chunk = toUpdateInDb.slice(c, c + CHUNK_SIZE);
      const executeChunkTransaction = db.transaction(() => {
        for (const item of chunk) {
          if (item.entityType === 'rep_visit_photo') {
            updateRep.run(item.destPath, item.photoId);
          } else if (item.entityType === 'maintenance_card_photo') {
            const card = selectCard.get(item.cardId);
            if (card) {
              const beforeList = JSON.parse(card.before_photos_json || '[]');
              const afterList = JSON.parse(card.after_photos_json || '[]');
              const nextBefore = beforeList.map((p) => (p.replace(/\\/g, '/') === item.sourcePath ? item.destPath : p));
              const nextAfter = afterList.map((p) => (p.replace(/\\/g, '/') === item.sourcePath ? item.destPath : p));
              updateCard.run(JSON.stringify(nextBefore), JSON.stringify(nextAfter), item.cardId);
            }
          } else if (item.entityType === 'workshop_design') {
            updateDesign.run(item.destPath, item.fileId);
          }

          insertJournal.run(
            batchName,
            item.entityType,
            item.photoId || item.cardId || item.fileId || 0,
            item.cardId || null,
            item.orderId || null,
            item.phase || null,
            item.sourcePath,
            item.destPath,
            item.sha256,
            item.byteSize,
          );
        }
      });

      executeChunkTransaction();
      results.dbUpdated += chunk.length;
    }
  }

  return results;
}

/**
 * Rolls back a completed batch using the storage_migration_journal in reverse order.
 */
export function rollbackMigrationBatch({ batchName, storageRoot, db }) {
  ensureMigrationJournalTable(db);

  const completedEntries = db.prepare(`
    SELECT * FROM storage_migration_journal 
    WHERE batch_name = ? AND status = 'completed'
    ORDER BY id DESC
  `).all(batchName);

  let restoredCount = 0;

  db.transaction(() => {
    for (const entry of completedEntries) {
      if (entry.entity_type === 'rep_visit_photo') {
        db.prepare('UPDATE rep_visit_photos SET stored_path = ? WHERE id = ?').run(
          entry.old_path,
          entry.entity_id,
        );
      } else if (entry.entity_type === 'maintenance_card_photo') {
        const card = db.prepare('SELECT before_photos_json, after_photos_json FROM maintenance_cards WHERE id = ?').get(entry.card_id);
        if (card) {
          const col = entry.phase === 'before' ? 'before_photos_json' : 'after_photos_json';
          const list = JSON.parse(card[col] || '[]');
          const restored = list.map((p) => (p.replace(/\\/g, '/') === entry.new_path ? entry.old_path : p));
          db.prepare(`UPDATE maintenance_cards SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
            JSON.stringify(restored),
            entry.card_id,
          );
        }
      } else if (entry.entity_type === 'workshop_design') {
        db.prepare('UPDATE workshop_design_files SET stored_path = ? WHERE id = ?').run(
          entry.old_path,
          entry.entity_id,
        );
      }

      db.prepare(`
        UPDATE storage_migration_journal 
        SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(entry.id);

      restoredCount += 1;
    }
  })();

  return {
    batchName,
    entriesRolledBack: restoredCount,
  };
}
