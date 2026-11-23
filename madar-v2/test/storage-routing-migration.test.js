import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

import {
  MONTH_ABBREVIATIONS,
  getBusinessTimeParts,
  buildMaintenancePhotoStoredPath,
  buildWorkshopOrderStoredPath,
} from '../server/modules/maintenance/photo-routing.js';

test('photo-routing: getBusinessTimeParts handles Cairo timezone, year rollover, and month formatting', () => {
  // Normal November date
  const novDate = new Date('2026-11-20T10:00:00Z');
  const novParts = getBusinessTimeParts(novDate, 'Africa/Cairo');
  assert.equal(novParts.year, '2026');
  assert.equal(novParts.monthAbbrev, 'NOV');
  assert.equal(novParts.monthNumber, '11');

  // Late night on Dec 31 UTC is Jan 1 Cairo (UTC+2) -> Year rollover
  const newYearUtc = new Date('2026-12-31T22:30:00Z');
  const cairoNewYear = getBusinessTimeParts(newYearUtc, 'Africa/Cairo');
  assert.equal(cairoNewYear.year, '2027');
  assert.equal(cairoNewYear.monthAbbrev, 'JAN');
  assert.equal(cairoNewYear.monthNumber, '01');
  assert.equal(cairoNewYear.day, '01');

  // All 12 months are uppercase 3-letter English abbreviations
  assert.deepEqual(MONTH_ABBREVIATIONS, [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ]);
});

test('photo-routing: buildMaintenancePhotoStoredPath generates canonical hierarchy', () => {
  const path = buildMaintenancePhotoStoredPath({
    date: new Date('2026-11-15T12:00:00Z'),
    timeZone: 'Africa/Cairo',
    area: 'شرم الشيخ ودهب',
    machineCode: '1617',
    machineName: 'نبق',
    orderCode: 'MN-1063',
    orderId: 71,
    phase: 'before',
    filename: 'photo_001.jpg',
  });

  // Expected: Areas/2026/NOV/<area>/<machine>/<orderCode>/Before/photo_001.jpg
  assert.equal(
    path,
    'Areas/2026/NOV/شرم الشيخ ودهب/1617_نبق/MN-1063/Before/photo_001.jpg',
  );

  // After phase
  const after = buildMaintenancePhotoStoredPath({
    date: new Date('2026-11-15T12:00:00Z'),
    timeZone: 'Africa/Cairo',
    area: 'شرم الشيخ ودهب',
    machineCode: '1617',
    machineName: 'نبق',
    orderCode: 'MN-1063',
    orderId: 71,
    phase: 'after',
    filename: 'photo_002.jpg',
  });
  assert.equal(
    after,
    'Areas/2026/NOV/شرم الشيخ ودهب/1617_نبق/MN-1063/After/photo_002.jpg',
  );
});

test('photo-routing: late offline sync in December routes by validated visit capture date in November', () => {
  // Representative captured on Nov 25th in field
  const captureDate = new Date('2026-11-25T14:30:00Z');
  // Uploaded/synced a week later on Dec 2nd
  const syncDate = new Date('2026-12-02T09:00:00Z');

  // Routing uses captureDate, so it MUST go to NOV, not DEC
  const storedPath = buildMaintenancePhotoStoredPath({
    date: captureDate,
    timeZone: 'Africa/Cairo',
    area: 'الدلتا',
    machineCode: '1205',
    machineName: 'طنطا',
    orderCode: 'MN-1070',
    orderId: 80,
    phase: 'after',
    filename: 'visit_evidence.jpg',
  });

  assert.ok(storedPath.startsWith('Areas/2026/NOV/'), `Expected Areas/2026/NOV/ but got ${storedPath}`);
});

test('photo-routing: buildWorkshopOrderStoredPath isolates factory workshop files from field photos', () => {
  const designPath = buildWorkshopOrderStoredPath({
    orderId: 105,
    subfolder: 'designs',
    filename: 'letters-acrylic-cut.dxf',
  });
  assert.equal(designPath, 'Workshop/Orders/105/designs/letters-acrylic-cut.dxf');

  const techPath = buildWorkshopOrderStoredPath({
    orderId: 105,
    subfolder: 'technicians',
    filename: 'welding-stage.jpg',
  });
  assert.equal(techPath, 'Workshop/Orders/105/technicians/welding-stage.jpg');

  assert.ok(!designPath.startsWith('Areas/'), 'Workshop files must not be placed in field maintenance Areas');
});

test('migration rehearsal: transactional reference switch preserves photo SHA-256 and supports rollback', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'madar-migration-test-'));
  const db = new Database(':memory:');
  try {
    // Setup test schema mimicking production
    db.exec(`
      CREATE TABLE maintenance_orders (id INTEGER PRIMARY KEY, order_code TEXT, area TEXT);
      CREATE TABLE maintenance_cards (id INTEGER PRIMARY KEY, order_id INTEGER, before_photos_json TEXT, after_photos_json TEXT);
      CREATE TABLE rep_visits (id INTEGER PRIMARY KEY, order_id INTEGER, card_id INTEGER);
      CREATE TABLE rep_visit_photos (id INTEGER PRIMARY KEY, visit_id INTEGER, phase TEXT, stored_path TEXT);
      CREATE TABLE migration_backup_log (id INTEGER PRIMARY KEY, photo_id INTEGER, old_path TEXT, new_path TEXT, sha256 TEXT);
    `);

    // Create sample order, card, visit, and photo
    db.prepare("INSERT INTO maintenance_orders VALUES (71, 'MN-1063', 'شرم الشيخ ودهب')").run();
    db.prepare("INSERT INTO maintenance_cards VALUES (2001, 71, '[]', '[]')").run();
    db.prepare("INSERT INTO rep_visits VALUES (10, 71, 2001)").run();

    const oldStoredPath = 'Areas/شرم الشيخ ودهب/2026/11/1617_نبق/Before/sample_0001.jpg';
    db.prepare("INSERT INTO rep_visit_photos VALUES (101, 10, 'before', ?)").run(oldStoredPath);

    // Create dummy image file and compute SHA-256
    const sourceDir = join(tempDir, 'Areas/شرم الشيخ ودهب/2026/11/1617_نبق/Before');
    mkdirSync(sourceDir, { recursive: true });
    const sourceFile = join(sourceDir, 'sample_0001.jpg');
    const imageBytes = Buffer.from('TEST_JPEG_IMAGE_PAYLOAD_EVIDENCE_FOR_NOVEMBER_MIGRATION_AUDIT');
    writeFileSync(sourceFile, imageBytes);
    const originalSha256 = createHash('sha256').update(imageBytes).digest('hex');

    // 1. Target destination
    const newStoredPath = 'Areas/2026/NOV/شرم الشيخ ودهب/1617_نبق/MN-1063/Before/sample_0001.jpg';
    const destDir = join(tempDir, 'Areas/2026/NOV/شرم الشيخ ودهب/1617_نبق/MN-1063/Before');
    mkdirSync(destDir, { recursive: true });
    const destFile = join(destDir, 'sample_0001.jpg');

    // 2. Step 1: Copy first (preserving original)
    writeFileSync(destFile, readFileSync(sourceFile));

    // 3. Step 2: Verify copy SHA-256 matches byte-for-byte
    const copiedSha256 = createHash('sha256').update(readFileSync(destFile)).digest('hex');
    assert.equal(copiedSha256, originalSha256, 'Copied file SHA-256 must match original exactly');

    // 4. Step 3: Transactional switch of DB reference
    db.transaction(() => {
      // Record migration mapping in audit backup log
      db.prepare('INSERT INTO migration_backup_log (photo_id, old_path, new_path, sha256) VALUES (?, ?, ?, ?)').run(
        101, oldStoredPath, newStoredPath, copiedSha256,
      );
      // Switch DB reference
      db.prepare('UPDATE rep_visit_photos SET stored_path = ? WHERE id = ?').run(newStoredPath, 101);
    })();

    // Assert reference switched
    assert.equal(
      db.prepare('SELECT stored_path FROM rep_visit_photos WHERE id = 101').get().stored_path,
      newStoredPath,
    );

    // 5. Test Rollback: Can safely revert reference back using migration_backup_log
    db.transaction(() => {
      const log = db.prepare('SELECT old_path FROM migration_backup_log WHERE photo_id = 101').get();
      db.prepare('UPDATE rep_visit_photos SET stored_path = ? WHERE id = 101').run(log.old_path);
    })();

    assert.equal(
      db.prepare('SELECT stored_path FROM rep_visit_photos WHERE id = 101').get().stored_path,
      oldStoredPath,
      'Rollback must safely restore old stored_path',
    );

    // Both files still exist on disk (originals were never deleted)
    assert.ok(readFileSync(sourceFile).equals(imageBytes));
    assert.ok(readFileSync(destFile).equals(imageBytes));
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
