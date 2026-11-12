import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import yauzl from 'yauzl';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-structured-maintenance-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'maintenance.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [
  { db, createConnection },
  { initializeDatabase, migrateStructuredMaintenanceLines },
  maintenance,
  repService,
  supervisorService,
  exportModule,
  analysisModule,
] = await Promise.all([
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/maintenance/service.js'),
  import('../server/modules/rep/service.js'),
  import('../server/modules/supervisor/service.js'),
  import('../server/modules/maintenance/export.js'),
  import('../server/modules/maintenance/analysis.js'),
]);

initializeDatabase({ initialAdminPassword: 'Structured-test-password-2026!' });

after(() => {
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function readAllSlideTexts(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const allTexts = [];
      zipfile.on('entry', (entry) => {
        if (/^ppt\/slides\/slide\d+\.xml$/.test(entry.fileName)) {
          zipfile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr) return reject(streamErr);
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => {
              allTexts.push(...pptxTextValues(Buffer.concat(chunks).toString('utf8')));
              zipfile.readEntry();
            });
            stream.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => resolve(allTexts));
      zipfile.readEntry();
    });
  });
}

function pptxTextValues(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map((match) => match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'"));
}

test('catalog API stores typed configuration, validates units, versions changes, and audits', () => {
  const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  const created = maintenance.createMaintenanceReason({
    name: 'اختبار تغيير سبوت', category: 'spotlights_transformers', actionMeaning: 'executed_work',
    countable: true, unit: 'piece',
  }, adminId, db);
  assert.equal(created.countable, 1);
  assert.equal(created.unit, 'piece');
  assert.throws(() => maintenance.createMaintenanceReason({
    name: 'كمية بلا وحدة', category: 'electrical_lighting', actionMeaning: 'executed_work', countable: true,
  }, adminId, db), /requires unit/);
  assert.throws(() => maintenance.createMaintenanceReason({
    name: 'وحدة دون كمية', category: 'electrical_lighting', actionMeaning: 'assessment', countable: false, unit: 'piece',
  }, adminId, db), /cannot have a unit/);
  maintenance.updateMaintenanceReason(created.id, { unit: 'set' }, adminId, db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_reason_versions WHERE reason_id = ?').get(created.id).count, 1);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'maintenance_reason' AND entity_id = ?").get(created.id));
});

test('legacy card backfill uses explicit defaults once, preserves explicit lines and snapshots, and reruns safely', () => {
  const legacy = createConnection(join(temporaryDirectory, 'legacy-maintenance.sqlite'));
  try {
    initializeDatabase({ database: legacy, initialAdminPassword: 'Legacy-test-password-2026!' });
    const clientId = Number(legacy.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('STRUCT-CLIENT', 'Test', 'STRUCT-CLIENT')").run().lastInsertRowid);
    const machineId = Number(legacy.prepare("INSERT INTO machines (code, name_ar, area) VALUES ('STRUCT-MACHINE', 'آلة اختبار', 'اختبار')").run().lastInsertRowid);
    const orderId = Number(legacy.prepare("INSERT INTO maintenance_orders (order_code, client_id) VALUES ('STRUCT-ORDER', ?)").run(clientId).lastInsertRowid);
    const firstCard = Number(legacy.prepare("INSERT INTO maintenance_cards (order_id, machine_id, reason_ids_json) VALUES (?, ?, '[1,4]')").run(orderId, machineId).lastInsertRowid);
    const secondCard = Number(legacy.prepare("INSERT INTO maintenance_cards (order_id, machine_id, reason_ids_json) VALUES (?, ?, '[1]')").run(orderId, machineId).lastInsertRowid);
    legacy.prepare(`INSERT INTO maintenance_card_lines
      (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
      VALUES (?, 1, 'قديم', 'electrical_lighting', 'executed_work', 8, 'piece', 'user_entered')`).run(secondCard);
    legacy.prepare("DELETE FROM schema_migrations WHERE version = '20261112-structured-maintenance-lines'").run();
    migrateStructuredMaintenanceLines(legacy);
    const lines = legacy.prepare('SELECT card_id, reason_id, quantity, unit_snapshot, quantity_provenance FROM maintenance_card_lines ORDER BY card_id, reason_id').all();
    assert.deepEqual(lines, [
      { card_id: firstCard, reason_id: 1, quantity: 1, unit_snapshot: 'piece', quantity_provenance: 'legacy_default' },
      { card_id: firstCard, reason_id: 4, quantity: 1, unit_snapshot: 'piece', quantity_provenance: 'legacy_default' },
      { card_id: secondCard, reason_id: 1, quantity: 8, unit_snapshot: 'piece', quantity_provenance: 'user_entered' },
    ]);
    migrateStructuredMaintenanceLines(legacy);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM maintenance_card_lines').get().count, 3);
    assert.equal(legacy.prepare('SELECT quantity FROM maintenance_card_lines WHERE card_id = ? AND reason_id = 1').get(secondCard).quantity, 8);
    assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  } finally { legacy.close(); }
});

test('getRepFaultReasons returns explicit countability metadata without active column', () => {
  const result = repService.getRepFaultReasons(db);
  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.reasons));
  assert.ok(result.reasons.length > 0);
  assert.ok(result.reasons.every((r) => !('active' in r)));
  const spotReason = result.reasons.find((r) => Number(r.id) === 4);
  assert.ok(spotReason, 'Reason 4 (Spot changed) should exist');
  assert.equal(spotReason.countable, 1, 'Reason 4 must be countable');
  assert.equal(spotReason.unit, 'piece');

  const inspectionReason = result.reasons.find((r) => Number(r.id) === 2);
  assert.ok(inspectionReason, 'Reason 2 should exist');
  assert.equal(inspectionReason.countable, 0, 'Reason 2 must be non-countable');
});

test('end-to-end representative visit with multiple quantities, validation, offline retry, and replay protection', async () => {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  // Create rep user
  const repUser = db.prepare("INSERT INTO users (username, full_name, role, password_hash) VALUES ('rep_qty_tester', 'Rep Tester', 'rep', 'hash')").run();
  const rep = { id: Number(repUser.lastInsertRowid), role: 'rep', username: 'rep_qty_tester' };

  // Setup client, machine, order, card
  const client = db.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('CL-QTY', 'Client Qty', 'CL-QTY')").run();
  const clientId = Number(client.lastInsertRowid);
  const machine = db.prepare(`INSERT INTO machines (code, name_ar, area, latitude, longitude, is_location_locked, geofence_radius_meters)
    VALUES ('MC-QTY-1', 'ماكينة اختبار الكميات', 'المعادي', 30.0444, 31.2357, 1, 100)`).run();
  const machineId = Number(machine.lastInsertRowid);
  const order = db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area) VALUES ('ORD-QTY-1', ?, 'المعادي')").run(clientId);
  const orderId = Number(order.lastInsertRowid);
  db.prepare("INSERT INTO maintenance_order_reps (order_id, user_id) VALUES (?, ?)").run(orderId, rep.id);
  const card = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status) VALUES (?, ?, 'pending')").run(orderId, machineId);
  const cardId = Number(card.lastInsertRowid);

  // Setup photo buffer
  const photoBuffer = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#7090a0' } }).jpeg().toBuffer();
  const files = {
    beforePhotos: [
      { buffer: photoBuffer, size: photoBuffer.length, originalname: 'before_0.jpg' },
      { buffer: photoBuffer, size: photoBuffer.length, originalname: 'before_1.jpg' },
      { buffer: photoBuffer, size: photoBuffer.length, originalname: 'before_2.jpg' },
    ],
    afterPhotos: [
      { buffer: photoBuffer, size: photoBuffer.length, originalname: 'after_0.jpg' },
    ],
  };

  const capturedNow = new Date().toISOString();
  const baseVisit = {
    cardId,
    machineCode: 'MC-QTY-1',
    regionName: 'المعادي',
    machineCondition: 'working',
    notes: 'تم تبديل السبوت والمحول',
    capturedAt: capturedNow,
    beforeCapturedAt: [capturedNow, capturedNow, capturedNow],
    afterCapturedAt: [capturedNow],
    location: { latitude: 30.0444, longitude: 31.2357, accuracy: 5, updatedAt: capturedNow },
  };

  // 1. Validation: Zero quantity on countable item must fail (400)
  await assert.rejects(async () => {
    await repService.syncRepVisit(rep, {
      ...baseVisit,
      visitUuid: randomUUID(),
      reasonIds: [4], // spot changed
      maintenanceLines: [{ reasonId: 4, quantity: 0 }],
    }, files, db);
  }, (err) => err.status === 400 && /positive whole number/.test(err.message));

  // 2. Validation: Negative quantity must fail (400)
  await assert.rejects(async () => {
    await repService.syncRepVisit(rep, {
      ...baseVisit,
      visitUuid: randomUUID(),
      reasonIds: [4],
      maintenanceLines: [{ reasonId: 4, quantity: -2 }],
    }, files, db);
  }, (err) => err.status === 400 && /positive whole number/.test(err.message));

  // 3. Validation: Fractional quantity must fail (400)
  await assert.rejects(async () => {
    await repService.syncRepVisit(rep, {
      ...baseVisit,
      visitUuid: randomUUID(),
      reasonIds: [4],
      maintenanceLines: [{ reasonId: 4, quantity: 2.5 }],
    }, files, db);
  }, (err) => err.status === 400 && /positive whole number/.test(err.message));

  // 4. Validation: Quantity on non-countable item must fail (400)
  await assert.rejects(async () => {
    await repService.syncRepVisit(rep, {
      ...baseVisit,
      visitUuid: randomUUID(),
      reasonIds: [2], // non-countable
      maintenanceLines: [{ reasonId: 2, quantity: 1 }],
    }, files, db);
  }, (err) => err.status === 400 && /not a selected countable/.test(err.message));

  // 5. Validation: Countable item selected without quantity must fail (400)
  await assert.rejects(async () => {
    await repService.syncRepVisit(rep, {
      ...baseVisit,
      visitUuid: randomUUID(),
      reasonIds: [4, 1], // both countable
      maintenanceLines: [{ reasonId: 4, quantity: 2 }], // reason 1 missing!
    }, files, db);
  }, (err) => err.status === 400 && /requires an explicitly entered quantity/.test(err.message));

  // 6. Valid Visit with Multiple Replacement Items and Quantities
  // Reason 4 (spot changed): qty 3
  // Reason 1 (transformer changed): qty 2
  // Reason 2 (non-countable observation): no quantity
  const visitUuid = randomUUID();
  const validSync = await repService.syncRepVisit(rep, {
    ...baseVisit,
    visitUuid,
    reasonIds: [4, 1, 2],
    maintenanceLines: [
      { reasonId: 4, quantity: 3 },
      { reasonId: 1, quantity: 2 },
    ],
  }, files, db);

  assert.equal(validSync.success, true);
  assert.equal(validSync.status, 'pending_review');
  assert.equal(validSync.visitUuid, visitUuid);

  // Verify rep_visit_lines persistence
  const savedVisit = db.prepare('SELECT id FROM rep_visits WHERE visit_uuid = ?').get(visitUuid);
  const repLines = db.prepare('SELECT reason_id, quantity, unit_snapshot, quantity_provenance FROM rep_visit_lines WHERE visit_id = ? ORDER BY reason_id').all(savedVisit.id);
  assert.deepEqual(repLines, [
    { reason_id: 1, quantity: 2, unit_snapshot: 'piece', quantity_provenance: 'user_entered' },
    { reason_id: 4, quantity: 3, unit_snapshot: 'piece', quantity_provenance: 'user_entered' },
  ]);

  // 7. Offline Retry: Replaying exact same visit payload returns idempotent: true
  const retrySync = await repService.syncRepVisit(rep, {
    ...baseVisit,
    visitUuid,
    reasonIds: [4, 1, 2],
    maintenanceLines: [
      { reasonId: 4, quantity: 3 },
      { reasonId: 1, quantity: 2 },
    ],
  }, files, db);
  assert.equal(retrySync.success, true);
  assert.equal(retrySync.idempotent, true);

  // 8. Changed-Payload Replay: Replaying same visitUuid with changed quantity must fail (409)
  await assert.rejects(async () => {
    await repService.syncRepVisit(rep, {
      ...baseVisit,
      visitUuid,
      reasonIds: [4, 1, 2],
      maintenanceLines: [
        { reasonId: 4, quantity: 4 }, // changed from 3 to 4!
        { reasonId: 1, quantity: 2 },
      ],
    }, files, db);
  }, (err) => err.status === 409 && /already used with different content/.test(err.message));

  // 9. Supervisor Review & Correction:
  // getPendingVisitReviews exposes maintenanceLines
  const pendingReviews = supervisorService.getPendingVisitReviews(db);
  const visitReview = pendingReviews.find((v) => v.visitUuid === visitUuid);
  assert.ok(visitReview);
  assert.equal(visitReview.maintenanceLines.length, 2);
  assert.equal(visitReview.maintenanceLines.find((l) => l.reasonId === 4).quantity, 3);
  assert.equal(visitReview.maintenanceLines.find((l) => l.reasonId === 1).quantity, 2);

  // Supervisor correction without justification fails (400)
  await assert.rejects(async () => {
    supervisorService.reviewRepVisit(savedVisit.id, {
      action: 'approve',
      maintenanceLines: [
        { reasonId: 4, quantity: 5 }, // corrected from 3 to 5 without justification
        { reasonId: 1, quantity: 2 },
      ],
    }, admin.id, db);
  }, (err) => err.status === 400 && err.apiCode === 'MAINTENANCE_QUANTITY_JUSTIFICATION_REQUIRED');

  // Supervisor approves with justified quantity correction for reason 4
  const approval = supervisorService.reviewRepVisit(savedVisit.id, {
    action: 'approve',
    note: 'معتمد بعد التصحيح',
    maintenanceLines: [
      { reasonId: 4, quantity: 5, justification: 'تم التأكد من الصور أنه تم تركيب 5 سبوتات' },
      { reasonId: 1, quantity: 2 },
    ],
  }, admin.id, db);
  assert.equal(approval.success, true);
  assert.equal(approval.status, 'approved');

  // Card lines now exist in maintenance_card_lines
  const cardLines = db.prepare('SELECT reason_id, quantity, quantity_provenance FROM maintenance_card_lines WHERE card_id = ? ORDER BY reason_id').all(cardId);
  assert.deepEqual(cardLines, [
    { reason_id: 1, quantity: 2, quantity_provenance: 'user_entered' },
    { reason_id: 4, quantity: 5, quantity_provenance: 'admin_correction' },
  ]);

  // Verify audit log recorded correction
  const auditEntry = db.prepare("SELECT * FROM audit_log WHERE action = 'correct_quantity' AND entity_type = 'maintenance_card_line' ORDER BY id DESC LIMIT 1").get();
  assert.ok(auditEntry);
  assert.match(auditEntry.new_values_json, /admin_correction/);
  assert.match(auditEntry.new_values_json, /تم التأكد من الصور/);
});

test('PowerPoint export includes explicit and historical quantities with action wording', async () => {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  const client = db.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('CL-PPTX', 'Client PPTX', 'CL-PPTX')").run();
  const clientId = Number(client.lastInsertRowid);
  const order = db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area) VALUES ('ORD-PPTX-1', ?, 'مدينة نصر')").run(clientId);
  const orderId = Number(order.lastInsertRowid);

  // Machine 1: User-entered quantities on countable items + 1 non-countable item
  const m1 = db.prepare("INSERT INTO machines (code, name_ar, area) VALUES ('PPTX-M1', 'ماكينة عادية', 'مدينة نصر')").run();
  const m1Id = Number(m1.lastInsertRowid);
  const c1 = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status, before_photos_json, reason_ids_json) VALUES (?, ?, 'completed', '[\"server/assets/report-logo.png\"]', '[4, 2]')").run(orderId, m1Id);
  const c1Id = Number(c1.lastInsertRowid);
  // c1 has user_entered quantity of 4 on reason 4 (Spot changed), and reason 2 is non-countable
  db.prepare(`INSERT INTO maintenance_card_lines (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 4, 'تغيير سبوت', 'spotlights_transformers', 'executed_work', 4, 'piece', 'user_entered')`).run(c1Id);

  // Machine 2: Historical default item (legacy_default) on reason 1 (transformer changed)
  const m2 = db.prepare("INSERT INTO machines (code, name_ar, area) VALUES ('PPTX-M2', 'ماكينة قديمة', 'مدينة نصر')").run();
  const m2Id = Number(m2.lastInsertRowid);
  const c2 = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status, before_photos_json, reason_ids_json) VALUES (?, ?, 'completed', '[\"server/assets/report-logo.png\"]', '[1]')").run(orderId, m2Id);
  const c2Id = Number(c2.lastInsertRowid);
  db.prepare(`INSERT INTO maintenance_card_lines (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 1, 'تغيير ترانس', 'electrical_lighting', 'executed_work', 1, 'piece', 'legacy_default')`).run(c2Id);

  const pptxResult = await exportModule.buildMaintenancePptxExport({
    orderIds: [orderId],
    groupBy: 'none',
  }, db);

  assert.ok(pptxResult.buffer);
  assert.equal(pptxResult.contentType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

  // Inspect all slide XMLs in the PPTX
  const allTexts = await readAllSlideTexts(pptxResult.buffer);

  const reason4Name = db.prepare('SELECT name FROM maintenance_reasons WHERE id = 4').get().name;
  const reason1Name = db.prepare('SELECT name FROM maintenance_reasons WHERE id = 1').get().name;
  const userEnteredMatch = allTexts.find((t) => /تم تغيير عدد 4 .*سبوت/u.test(t));
  assert.ok(userEnteredMatch, `Expected explicit spotlight quantity in PPTX: ${JSON.stringify(allTexts)}`);
  const nonCountableMatch = allTexts.find((t) => t.startsWith('2.'));
  assert.ok(nonCountableMatch);
  assert.ok(!nonCountableMatch.includes('العدد:') && !nonCountableMatch.includes('عدد 1'));
  const legacyDefaultMatch = allTexts.find((t) => /تم تغيير عدد 1 .*ترانس/u.test(t));
  assert.ok(legacyDefaultMatch, `Historical quantity one must remain visible: ${JSON.stringify(allTexts)}`);

});

test('analytics records and workbook aggregate quantities and include summary sheets', () => {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  const client = db.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('CL-ANL', 'Client Analysis', 'CL-ANL')").run();
  const clientId = Number(client.lastInsertRowid);
  const order = db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area, status) VALUES ('ORD-ANL-1', ?, 'الدقي', 'archived')").run(clientId);
  const orderId = Number(order.lastInsertRowid);

  const m1 = db.prepare("INSERT INTO machines (code, name_ar, area) VALUES ('ANL-M1', 'ماكينة تحليل 1', 'الدقي')").run();
  const m1Id = Number(m1.lastInsertRowid);
  const c1 = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status) VALUES (?, ?, 'completed')").run(orderId, m1Id);
  const c1Id = Number(c1.lastInsertRowid);

  db.prepare(`INSERT INTO maintenance_card_lines (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 4, 'تغيير سبوت', 'spotlights_transformers', 'executed_work', 6, 'piece', 'user_entered')`).run(c1Id);
  db.prepare(`INSERT INTO maintenance_card_lines (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 1, 'تغيير ترانس', 'electrical_lighting', 'executed_work', 2, 'piece', 'user_entered')`).run(c1Id);

  // 1. getMaintenanceAnalysisRecords
  const records = analysisModule.getMaintenanceAnalysisRecords({}, db);
  const targetRecord = records.find((r) => r.machine_code === 'ANL-M1');
  assert.ok(targetRecord);
  assert.equal(targetRecord.total_quantity, 8);
  assert.equal(targetRecord.maintenance_lines.length, 2);
  assert.match(targetRecord.items_summary, /تغيير سبوت \(6 قطعة\)/);
  assert.match(targetRecord.items_summary, /تغيير ترانس \(2 قطعة\)/);

  // 2. buildMaintenanceAnalysisWorkbook
  const workbookBuffer = analysisModule.buildMaintenanceAnalysisWorkbook({}, db);
  assert.ok(workbookBuffer instanceof Buffer);
  const workbook = XLSX.read(workbookBuffer, { type: 'buffer' });
  assert.ok(workbook.SheetNames.includes('تحليل الصيانة'));
  assert.ok(workbook.SheetNames.includes('ملخص القطع المستبدلة'));

  const summarySheet = workbook.Sheets['ملخص القطع المستبدلة'];
  const summaryJson = XLSX.utils.sheet_to_json(summarySheet);
  const spotSummary = summaryJson.find((row) => row['بند الصيانة / القطعة'] === 'تغيير سبوت');
  assert.ok(spotSummary);
  assert.ok(Number(spotSummary['إجمالي الكمية المستبدلة']) >= 6);

  // 3. supervisor approved visits workbook
  const approvedWorkbookBuffer = supervisorService.buildApprovedVisitsWorkbook(new Date().toISOString().slice(0, 10), db);
  assert.ok(approvedWorkbookBuffer instanceof Buffer);
  const approvedWb = XLSX.read(approvedWorkbookBuffer, { type: 'buffer' });
  assert.ok(approvedWb.SheetNames.includes('الزيارات المعتمدة'));
});

function readAllDocxTexts(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const allTexts = [];
      zipfile.on('entry', (entry) => {
        if (entry.fileName === 'word/document.xml') {
          zipfile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr) return reject(streamErr);
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => {
              const xml = Buffer.concat(chunks).toString('utf8');
              const matches = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/gu)].map((m) => m[1]);
              allTexts.push(...matches);
              zipfile.readEntry();
            });
            stream.on('error', reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => resolve(allTexts));
      zipfile.readEntry();
    });
  });
}

test('supervisor review preserves existing card lines when approving visit with different reason', async () => {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  const repUser = db.prepare("INSERT INTO users (username, full_name, role, password_hash) VALUES ('rep_preserve_tester', 'Preserve Tester', 'rep', 'hash')").run();
  const rep = { id: Number(repUser.lastInsertRowid), role: 'rep', username: 'rep_preserve_tester' };

  const client = db.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('CL-PRESERVE', 'Preserve Client', 'CL-PRESERVE')").run();
  const clientId = Number(client.lastInsertRowid);
  const machine = db.prepare("INSERT INTO machines (code, name_ar, area, latitude, longitude, is_location_locked, geofence_radius_meters) VALUES ('MC-PRS-1', 'ماكينة حفظ الخطوط', 'الدقي', 30.0444, 31.2357, 1, 100)").run();
  const machineId = Number(machine.lastInsertRowid);
  const order = db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area) VALUES ('ORD-PRS-1', ?, 'الدقي')").run(clientId);
  const orderId = Number(order.lastInsertRowid);
  db.prepare("INSERT INTO maintenance_order_reps (order_id, user_id) VALUES (?, ?)").run(orderId, rep.id);

  // Card already has reason 4 (spot changed) with quantity 8
  const card = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status, reason_id, reason_ids_json) VALUES (?, ?, 'pending', 4, '[4]')").run(orderId, machineId);
  const cardId = Number(card.lastInsertRowid);
  db.prepare(`INSERT INTO maintenance_card_lines
    (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 4, 'تغيير سبوت', 'spotlights_transformers', 'executed_work', 8, 'piece', 'user_entered')`).run(cardId);

  // Rep submits visit with reason 1 (transformer changed, quantity 2)
  const photoBuffer = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#7090a0' } }).jpeg().toBuffer();
  const files = {
    beforePhotos: [
      { buffer: photoBuffer, size: photoBuffer.length, originalname: 'before_0.jpg' },
      { buffer: photoBuffer, size: photoBuffer.length, originalname: 'before_1.jpg' },
      { buffer: photoBuffer, size: photoBuffer.length, originalname: 'before_2.jpg' },
    ],
    afterPhotos: [{ buffer: photoBuffer, size: photoBuffer.length, originalname: 'after_0.jpg' }],
  };
  const now = new Date().toISOString();
  const visitUuid = randomUUID();
  await repService.syncRepVisit(rep, {
    visitUuid, cardId, machineCode: 'MC-PRS-1', regionName: 'الدقي', machineCondition: 'working',
    reasonIds: [1], maintenanceLines: [{ reasonId: 1, quantity: 2 }],
    notes: 'تم استبدال المحول', capturedAt: now, beforeCapturedAt: [now, now, now], afterCapturedAt: [now],
    location: { latitude: 30.0444, longitude: 31.2357, accuracy: 5, updatedAt: now },
  }, files, db);

  const savedVisit = db.prepare('SELECT id FROM rep_visits WHERE visit_uuid = ?').get(visitUuid);
  // Supervisor approves visit
  const approval = supervisorService.reviewRepVisit(savedVisit.id, { action: 'approve' }, admin.id, db);
  assert.equal(approval.success, true);

  // Assert card has BOTH lines, and reason 4 retained quantity 8 (NOT overwritten to 1!)
  const cardLines = db.prepare('SELECT reason_id, quantity, quantity_provenance FROM maintenance_card_lines WHERE card_id = ? ORDER BY reason_id').all(cardId);
  assert.deepEqual(cardLines, [
    { reason_id: 1, quantity: 2, quantity_provenance: 'user_entered' },
    { reason_id: 4, quantity: 8, quantity_provenance: 'user_entered' },
  ]);
});

test('Word DOCX export carries replacement quantities and formats correctly', async () => {
  const client = db.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('CL-DOCX', 'Client DOCX', 'CL-DOCX')").run();
  const clientId = Number(client.lastInsertRowid);
  const order = db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area, status) VALUES ('ORD-DOCX-1', ?, 'مدينة نصر', 'in_progress')").run(clientId);
  const orderId = Number(order.lastInsertRowid);

  const m1 = db.prepare("INSERT INTO machines (code, name_ar, area) VALUES ('MC-DOCX-1', 'ماكينة وورد', 'مدينة نصر')").run();
  const m1Id = Number(m1.lastInsertRowid);
  const c1 = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status, before_photos_json, reason_ids_json) VALUES (?, ?, 'completed', '[\"server/assets/report-logo.png\"]', '[4]')").run(orderId, m1Id);
  const c1Id = Number(c1.lastInsertRowid);

  db.prepare(`INSERT INTO maintenance_card_lines (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 4, 'تغيير سبوت', 'spotlights_transformers', 'executed_work', 7, 'piece', 'user_entered')`).run(c1Id);

  const docxResult = await exportModule.buildMaintenanceDocx(orderId, db);
  assert.ok(docxResult.buffer);
  assert.equal(docxResult.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const docxTexts = await readAllDocxTexts(docxResult.buffer);
  const hasQtyText = docxTexts.some((t) => t.includes('تم تغيير عدد 7 سبوت'));
  assert.ok(hasQtyText, `Expected "تم تغيير عدد 7 سبوت" in DOCX texts, found: ${JSON.stringify(docxTexts)}`);
});

test('explicit user submission transitions legacy_default to user_entered', async () => {
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  const client = db.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('CL-TRANS', 'Trans Client', 'CL-TRANS')").run();
  const clientId = Number(client.lastInsertRowid);
  const order = db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area, status) VALUES ('ORD-TRANS-1', ?, 'المهندسين', 'in_progress')").run(clientId);
  const orderId = Number(order.lastInsertRowid);

  const machine = db.prepare("INSERT INTO machines (code, name_ar, area) VALUES ('MC-TRANS-1', 'ماكينة انتقال', 'المهندسين')").run();
  const machineId = Number(machine.lastInsertRowid);
  const card = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status, reason_id, reason_ids_json) VALUES (?, ?, 'pending', 4, '[4]')").run(orderId, machineId);
  const cardId = Number(card.lastInsertRowid);

  // Initially legacy_default with quantity 1
  db.prepare(`INSERT INTO maintenance_card_lines (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 4, 'تغيير سبوت', 'spotlights_transformers', 'executed_work', 1, 'piece', 'legacy_default')`).run(cardId);

  // Admin explicitly confirms quantity 1 via maintenanceLines
  await maintenance.updateMaintenanceCard(orderId, cardId, {
    reasonIds: [4],
    maintenanceLines: [{ reasonId: 4, quantity: 1 }],
  }, admin.id, db);

  const updatedLine = db.prepare('SELECT quantity, quantity_provenance FROM maintenance_card_lines WHERE card_id = ? AND reason_id = 4').get(cardId);
  assert.equal(updatedLine.quantity, 1);
  assert.equal(updatedLine.quantity_provenance, 'user_entered', 'Explicit submission must transition legacy_default to user_entered');
});

test('PowerPoint export correctly handles filtered reasons and maintains reason ID alignment', async () => {
  const client = db.prepare("INSERT INTO clients (code, name, storage_code) VALUES ('CL-PPTX-ALIGN', 'Client PPTX Align', 'CL-PPTX-ALIGN')").run();
  const clientId = Number(client.lastInsertRowid);
  const order = db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area) VALUES ('ORD-PPTX-ALIGN', ?, 'المعادي')").run(clientId);
  const orderId = Number(order.lastInsertRowid);

  const m1 = db.prepare("INSERT INTO machines (code, name_ar, area) VALUES ('PPTX-ALIGN-M1', 'ماكينة محاذاة', 'المعادي')").run();
  const m1Id = Number(m1.lastInsertRowid);
  const dummyReason = db.prepare("INSERT INTO maintenance_reasons (name, category, action_meaning, is_countable, unit, active) VALUES ('غير محدد', 'general_observation', 'observation', 0, null, 1)").run();
  const dummyReasonId = Number(dummyReason.lastInsertRowid);

  const card = db.prepare("INSERT INTO maintenance_cards (order_id, machine_id, status, before_photos_json, reason_ids_json) VALUES (?, ?, 'completed', '[\"server/assets/report-logo.png\"]', ?)").run(orderId, m1Id, JSON.stringify([dummyReasonId, 4]));
  const cardId = Number(card.lastInsertRowid);
  db.prepare(`INSERT INTO maintenance_card_lines (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot, quantity, unit_snapshot, quantity_provenance)
    VALUES (?, 4, 'تغيير سبوت', 'spotlights_transformers', 'executed_work', 12, 'piece', 'user_entered')`).run(cardId);

  const pptxResult = await exportModule.buildMaintenancePptxExport({
    orderIds: [orderId],
    groupBy: 'none',
  }, db);

  const allTexts = await readAllSlideTexts(pptxResult.buffer);
  const match = allTexts.find((t) => /تم تغيير عدد 12 .*سبوت/u.test(t));
  assert.ok(match, `Expected explicit quantity 12 despite first reason being filtered, found: ${JSON.stringify(allTexts)}`);
});


test('secondary reasons remain searchable while replaced totals exclude pending and required work', () => {
  const clientId = Number(db.prepare("INSERT INTO clients(code,name,storage_code) VALUES ('Q-REG','Quantity Regression','Q-REG')").run().lastInsertRowid);
  const orderId = Number(db.prepare("INSERT INTO maintenance_orders(order_code,client_id,area) VALUES ('Q-REG-O',?,'Q-REG')").run(clientId).lastInsertRowid);
  db.prepare("UPDATE maintenance_orders SET created_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(orderId);
  const machineId = Number(db.prepare("INSERT INTO machines(code,name_ar,area) VALUES ('Q-REG-M','Quantity Machine','Q-REG')").run().lastInsertRowid);
  const cardId = Number(db.prepare("INSERT INTO maintenance_cards(order_id,machine_id,status,reason_id,reason_ids_json) VALUES (?,?,'pending',4,'[4,1]')").run(orderId,machineId).lastInsertRowid);
  const insert = db.prepare("INSERT INTO maintenance_card_lines(card_id,reason_id,reason_label_snapshot,category_snapshot,action_meaning_snapshot,quantity,unit_snapshot,quantity_provenance) VALUES (?,?,?,?,?,?,?,?)");
  insert.run(cardId,4,'Regression spot','lighting','executed_work',3,'piece','user_entered');
  insert.run(cardId,1,'Regression required transformer','lighting','required_work',2,'piece','legacy_default');
  assert.ok(analysisModule.getMaintenanceAnalysisRecords({reasonId:1},db).some(r=>r.card_id===cardId));
  const summary = () => {
    const wb = XLSX.read(analysisModule.buildMaintenanceAnalysisWorkbook({from:'2099-01-01',to:'2099-01-01'},db),{type:'buffer'});
    return XLSX.utils.sheet_to_json(wb.Sheets['ملخص القطع المستبدلة']);
  };
  assert.ok(!summary().some(r=>r['بند الصيانة / القطعة']==='Regression spot'));
  db.prepare("UPDATE maintenance_cards SET status='completed' WHERE id=?").run(cardId);
  const completed = summary();
  assert.ok(completed.some(r=>r['بند الصيانة / القطعة']==='Regression spot' && r['إجمالي الكمية المستبدلة']===3));
  assert.ok(!completed.some(r=>r['بند الصيانة / القطعة']==='Regression required transformer'));
});
