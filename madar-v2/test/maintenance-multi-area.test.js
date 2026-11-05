import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-multi-area-'));
const storageRoot = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'test.sqlite');
process.env.MADAR_V2_DATA_DIR = join(temporaryDirectory, 'data');
process.env.MADAR_V2_STORAGE_ROOT = storageRoot;
process.env.MADAR_V2_BACKUP_ROOT = join(temporaryDirectory, 'Backups');
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }, {
  recoverMaintenanceCardDeletions,
  recoverMaintenanceMachineDecommissions,
  recoverUnmatchedMaintenanceFolderDeletions,
}] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/maintenance/service.js'),
]);

const adminPassword = 'multi-area-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
assert.equal(login.status, 200);
const cookie = (login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie'))?.split(';', 1)[0];
assert.ok(cookie);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), cookie },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { response, body };
}

function json(method, body) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function assertNoCache(response) {
  const cacheControl = response.headers.get('cache-control') ?? '';
  for (const directive of ['private', 'no-cache', 'no-store', 'must-revalidate']) {
    assert.ok(cacheControl.includes(directive), `cache-control must include ${directive}; got ${cacheControl}`);
  }
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
}

function createZip(entries) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.once('error', reject);
    archive.once('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, contents] of entries) archive.append(contents, { name });
    archive.finalize();
  });
}

test('maintenance orders accept multiple areas and use every selected area for population, matching, and filtering', async () => {
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run('C-MULTI-AREA', 'Multi Area Client').lastInsertRowid);
  const insertMachine = db.prepare('INSERT INTO machines (code, name_ar, area) VALUES (?, ?, ?)');
  const northMachine = Number(insertMachine.run('NORTH-AREA-01', 'ماكينة الشمال', 'North').lastInsertRowid);
  const southMachine = Number(insertMachine.run('SOUTH-AREA-01', 'ماكينة الجنوب', 'South').lastInsertRowid);
  const outsideMachine = Number(insertMachine.run('OUTSIDE-AREA-01', 'ماكينة خارج المناطق', 'West').lastInsertRowid);

  const arrayOrder = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['North', 'South', ' north '],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(arrayOrder.response.status, 201, JSON.stringify(arrayOrder.body));
  const ordersList = await request('/api/maintenance/orders?status=in_progress');
  assert.equal(ordersList.response.status, 200);
  assertNoCache(ordersList.response);
  const orderDetail = await request(`/api/maintenance/orders/${arrayOrder.body.id}`);
  assert.equal(orderDetail.response.status, 200);
  assertNoCache(orderDetail.response);
  assert.equal(arrayOrder.body.area, 'North، South');
  assert.deepEqual(new Set(arrayOrder.body.cards.map((card) => card.machine_id)), new Set([northMachine, southMachine]));
  assert.equal(arrayOrder.body.cards.some((card) => card.machine_id === outsideMachine), false);
  const initialProgress = await request(`/api/maintenance/orders/${arrayOrder.body.id}/trip-progress`);
  assert.equal(initialProgress.response.status, 200);
  assert.deepEqual(initialProgress.body, {
    percent: 0,
    processed: 0,
    total: 0,
    stage: 'بانتظار بدء فحص مجلد الرحلة...',
  });

  const areaFilteredMachines = await request('/api/maintenance/machines?area=North%2C%20South&limit=100');
  assert.equal(areaFilteredMachines.response.status, 200);
  assert.deepEqual(new Set(areaFilteredMachines.body.machines.map((machine) => machine.area)), new Set(['North', 'South']));
  assert.equal(areaFilteredMachines.body.total, 2);

  const legacyAreaOrder = await request('/api/maintenance/orders', json('POST', {
    clientId,
    area: 'North, South، North',
    employeeIds: [],
    autoPopulateAreaMachines: false,
  }));
  assert.equal(legacyAreaOrder.response.status, 201, JSON.stringify(legacyAreaOrder.body));
  assert.equal(legacyAreaOrder.body.area, 'North، South');

  const populatedSouth = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/populate-area`, json('POST', { area: 'South' }));
  assert.equal(populatedSouth.response.status, 200, JSON.stringify(populatedSouth.body));
  assert.equal(populatedSouth.body.addedCount, 1);
  const addedNorth = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/cards`, json('POST', { machineId: northMachine }));
  assert.equal(addedNorth.response.status, 201, JSON.stringify(addedNorth.body));

  const tripPhoto = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#357a68' } }).png().toBuffer();
  const tripZip = await createZip([
    ['Unknown Field Site/Before/before.png', tripPhoto],
    ['Unknown Field Site/After/after.png', tripPhoto],
  ]);
  const tripForm = new FormData();
  tripForm.append('file', new Blob([tripZip], { type: 'application/zip' }), 'multi-area-trip.zip');
  const processed = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/process-folder`, {
    method: 'POST',
    body: tripForm,
  });
  assert.equal(processed.response.status, 200, JSON.stringify(processed.body));
  assert.equal(processed.body.unmatchedFolderCount, 1);
  const completedProgress = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/trip-progress`);
  assert.equal(completedProgress.response.status, 200);
  assert.equal(completedProgress.body.percent, 100);
  assert.equal(completedProgress.body.processed, completedProgress.body.total);
  assert.match(completedProgress.body.stage, /اكتمل/);

  const candidates = processed.body.order.unmatched_machine_candidates;
  assert.ok(candidates.some((machine) => machine.id === northMachine));
  assert.ok(candidates.some((machine) => machine.id === southMachine));
  assert.equal(candidates.some((machine) => machine.id === outsideMachine), false);

  const unmatchedFolder = processed.body.order.unmatched_folders[0];
  const outsideBind = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/unmatched/${unmatchedFolder.id}/bind`, json('POST', { machineId: outsideMachine }));
  assert.equal(outsideBind.response.status, 400);

  const southBind = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/unmatched/${unmatchedFolder.id}/bind`, json('POST', { machineId: southMachine }));
  assert.equal(southBind.response.status, 200, JSON.stringify(southBind.body));
  assert.equal(southBind.body.machineCode, 'SOUTH-AREA-01');

  const invalidAreas = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: 'North, South',
    employeeIds: [],
  }));
  assert.equal(invalidAreas.response.status, 400);

  const progressFolder = join(storageRoot, 'Areas', 'North', 'Progress Trip');
  for (const folder of ['Unknown Progress A', 'Unknown Progress B']) {
    const beforeFolder = join(progressFolder, folder, 'Before');
    mkdirSync(beforeFolder, { recursive: true });
    for (let index = 0; index < 90; index += 1) {
      writeFileSync(join(beforeFolder, `photo-${String(index).padStart(3, '0')}.png`), tripPhoto);
    }
  }

  const processingPromise = request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/process-folder`, json('POST', {
    folderPath: 'Areas/North/Progress Trip',
  }));
  let intermediateProgress = null;
  const progressDeadline = Date.now() + 8000;
  while (!intermediateProgress && Date.now() < progressDeadline) {
    const progress = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/trip-progress`);
    if (progress.body.total > 0 && progress.body.processed > 0 && progress.body.percent > 0 && progress.body.percent < 100) {
      intermediateProgress = progress.body;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.ok(intermediateProgress, 'the progress endpoint should report a live in-progress scan');
  assert.deepEqual(Object.keys(intermediateProgress).sort(), ['percent', 'processed', 'stage', 'total']);
  assert.ok(intermediateProgress.processed <= intermediateProgress.total);
  assert.ok(intermediateProgress.stage);

  const storageProcessed = await processingPromise;
  assert.equal(storageProcessed.response.status, 200, JSON.stringify(storageProcessed.body));
  const storageCompletedProgress = await request(`/api/maintenance/orders/${legacyAreaOrder.body.id}/trip-progress`);
  assert.equal(storageCompletedProgress.body.percent, 100);
  assert.equal(storageCompletedProgress.body.processed, storageCompletedProgress.body.total);
});

test('admins can edit archived card reasons, notes, and machine codes while photo edits stay blocked', async () => {
  const clientCode = 'ARCHIVED-CARD-EDIT-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)')
    .run(clientCode, 'Archived Card Edit Client').lastInsertRowid);
  const machineResponse = await request('/api/maintenance/machines', json('POST', {
    code: 'ARCHIVED-CARD-EDIT-01',
    name_ar: 'ماكينة اختبار تعديل بطاقة مؤرشفة',
    area: 'Archived Card Edit Area',
  }));
  assert.equal(machineResponse.response.status, 201, JSON.stringify(machineResponse.body));
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['Archived Card Edit Area'],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));
  const card = orderResponse.body.cards.find((item) => item.machine_id === machineResponse.body.id);
  assert.ok(card);

  const createReason = async (name) => {
    const result = await request('/api/maintenance/reasons', json('POST', { name }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body.id;
  };
  const removedReasonId = await createReason('سبب أرشيفي سيُزال');
  const keptReasonId = await createReason('سبب أرشيفي باقٍ');
  const addedReasonId = await createReason('سبب أرشيفي جديد');
  const initialUpdate = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, json('PATCH', {
    reasonIds: [removedReasonId, keptReasonId],
    notes: 'ملاحظة قبل الأرشفة',
  }));
  assert.equal(initialUpdate.response.status, 200, JSON.stringify(initialUpdate.body));

  db.prepare("UPDATE maintenance_orders SET status = 'archived', archived_at = '2026-11-05 12:00:00' WHERE id = ?")
    .run(orderResponse.body.id);
  const archivedUpdate = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, json('PATCH', {
    reasonIds: [keptReasonId, addedReasonId],
    notes: 'ملاحظة فنية محدّثة بعد الأرشفة',
  }));
  assert.equal(archivedUpdate.response.status, 200, JSON.stringify(archivedUpdate.body));
  assert.deepEqual(archivedUpdate.body.reason_ids, [keptReasonId, addedReasonId]);
  assert.equal(archivedUpdate.body.notes, 'ملاحظة فنية محدّثة بعد الأرشفة');
  assert.equal(archivedUpdate.body.reason_id, keptReasonId);

  const updatedMachineCode = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, json('PATCH', {
    machineCode: 'ARCHIVED-CARD-EDIT-01-RENAMED',
  }));
  assert.equal(updatedMachineCode.response.status, 200, JSON.stringify(updatedMachineCode.body));
  assert.equal(updatedMachineCode.body.machine_code, 'ARCHIVED-CARD-EDIT-01-RENAMED');
  const rejectedBeforePhotos = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, json('PATCH', {
    beforePhotos: [],
  }));
  assert.equal(rejectedBeforePhotos.response.status, 409);
  const rejectedAfterPhotos = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, json('PATCH', {
    afterPhotos: [],
  }));
  assert.equal(rejectedAfterPhotos.response.status, 409);

  assert.equal(db.prepare('SELECT code FROM machines WHERE id = ?').get(machineResponse.body.id).code, 'ARCHIVED-CARD-EDIT-01-RENAMED');
  const storedCard = db.prepare('SELECT reason_id, reason_ids_json, notes FROM maintenance_cards WHERE id = ?').get(card.id);
  assert.equal(storedCard.reason_id, keptReasonId);
  assert.deepEqual(JSON.parse(storedCard.reason_ids_json), [keptReasonId, addedReasonId]);
  assert.equal(storedCard.notes, 'ملاحظة فنية محدّثة بعد الأرشفة');
});

test('duplicate trip folders keep the first machine match and route later folders to review without merging photos', async () => {
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run('C-DUPLICATE-FOLDERS', 'Duplicate Folder Client').lastInsertRowid);
  const machineId = Number(db.prepare(`
    INSERT INTO machines (code, name_ar, name_en, area) VALUES (?, ?, ?, ?)
  `).run('DUNES-DUP-01', 'فرع ديونز', 'Dunes Branch', 'Duplicate Area').lastInsertRowid);
  const order = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['Duplicate Area'],
    employeeIds: [],
    autoPopulateAreaMachines: false,
  }));
  assert.equal(order.response.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.cards.length, 0);

  const photo = await sharp({ create: { width: 24, height: 18, channels: 3, background: '#ba542c' } }).png().toBuffer();
  const tripZip = await createZip([
    ['فرع ديونز/Before/before.png', photo],
    ['DUNES-DUP-01/After/after.png', photo],
  ]);
  const tripForm = new FormData();
  tripForm.append('file', new Blob([tripZip], { type: 'application/zip' }), 'duplicate-match-trip.zip');
  const processed = await request(`/api/maintenance/orders/${order.body.id}/process-folder`, {
    method: 'POST',
    body: tripForm,
  });
  assert.equal(processed.response.status, 200, JSON.stringify(processed.body));
  assert.equal(processed.body.matchedMachineCount, 1);
  assert.equal(processed.body.unmatchedFolderCount, 1);
  assert.deepEqual(processed.body.duplicateWarnings, [{
    machineId,
    machineName: 'فرع ديونز',
    originalFolder: 'فرع ديونز',
    duplicateFolder: 'DUNES-DUP-01',
  }]);

  const card = processed.body.order.cards.find((candidate) => candidate.machine_id === machineId);
  assert.ok(card);
  assert.equal(card.before_photos.length, 1);
  assert.equal(card.after_photos.length, 0);
  const thumbnail = await request(card.before_thumbnail_urls[0]);
  assert.equal(thumbnail.response.status, 200, JSON.stringify(thumbnail.body));
  assert.equal(thumbnail.response.headers.get('content-type'), 'image/webp');
  assertNoCache(thumbnail.response);
  assert.deepEqual((await sharp(thumbnail.body).metadata()).format, 'webp');
  const originalPhoto = await request(card.before_photo_urls[0]);
  assert.equal(originalPhoto.response.status, 200);
  assertNoCache(originalPhoto.response);
  const [duplicateFolder] = processed.body.order.unmatched_folders;
  assert.equal(duplicateFolder.folder_name, 'DUNES-DUP-01');
  assert.equal(duplicateFolder.is_duplicate, true);
  assert.equal(duplicateFolder.duplicate_of_folder, 'فرع ديونز');
  assert.equal(duplicateFolder.duplicate_machine_id, machineId);
  assert.equal(duplicateFolder.before_photos.length, 0);
  assert.equal(duplicateFolder.after_photos.length, 1);
});

test('maintenance card decommission stages files, rolls them back on database failure, audits, and deactivates the machine', async () => {
  const clientCode = 'DECOMMISSION-CARD-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Decommission Test Client').lastInsertRowid);
  const area = 'Decommission North';
  const machineCode = 'DECOMMISSION-CARD-01';
  const machineName = 'ماكينة اختبار الإزالة';
  const machineResponse = await request('/api/maintenance/machines', json('POST', {
    code: machineCode,
    name_ar: machineName,
    area,
  }));
  assert.equal(machineResponse.response.status, 201, JSON.stringify(machineResponse.body));
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: [area],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));
  const card = orderResponse.body.cards.find((item) => item.machine_id === machineResponse.body.id);
  assert.ok(card);

  const archivePrefix = `Clients/${clientCode}/Archived_Orders/${orderResponse.body.order_code}/${machineCode}`;
  const activePrefix = `clients/${clientCode}/maintenance/${orderResponse.body.order_code}/${machineCode}`;
  const areaFolderPath = `Areas/${area}/${machineCode} — ${machineName}`;
  const beforePhotoPath = `${archivePrefix}/Before/archive-photo.png`;
  const afterPhotoPath = `${activePrefix}/after/active-photo.png`;
  for (const [path, contents] of [
    [beforePhotoPath, 'archived-photo'],
    [afterPhotoPath, 'active-photo'],
    [`${areaFolderPath}/Before/source-photo.png`, 'area-source-photo'],
    [`Machines/${machineCode}/machine.txt`, 'machine-folder'],
  ]) {
    const segments = path.split('/');
    mkdirSync(join(storageRoot, ...segments.slice(0, -1)), { recursive: true });
    writeFileSync(join(storageRoot, ...segments), contents);
  }
  db.prepare(`
    UPDATE maintenance_cards
    SET before_photos_json = ?, after_photos_json = ?
    WHERE id = ?
  `).run(JSON.stringify([beforePhotoPath]), JSON.stringify([afterPhotoPath]), card.id);

  db.exec(`
    CREATE TRIGGER fail_maintenance_card_decommission
    BEFORE UPDATE OF deleted_at ON maintenance_cards
    WHEN OLD.id = ${card.id}
    BEGIN SELECT RAISE(ABORT, 'forced card decommission failure'); END;
  `);
  const failedDelete = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, { method: 'DELETE' });
  assert.equal(failedDelete.response.status, 500);
  assert.equal(db.prepare('SELECT deleted_at FROM maintenance_cards WHERE id = ?').get(card.id).deleted_at, null);
  assert.ok(existsSync(join(storageRoot, ...archivePrefix.split('/'))));
  assert.ok(existsSync(join(storageRoot, ...activePrefix.split('/'))));
  assert.ok(existsSync(join(storageRoot, ...areaFolderPath.split('/'))));
  assert.ok(existsSync(join(storageRoot, 'Machines', machineCode)));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_card_deletion_operations').get().count, 0);
  db.exec('DROP TRIGGER fail_maintenance_card_decommission');

  db.exec(`
    CREATE TRIGGER fail_machine_decommission_after_card_update
    BEFORE UPDATE OF active ON machines
    WHEN OLD.id = ${machineResponse.body.id}
    BEGIN SELECT RAISE(ABORT, 'forced machine decommission failure'); END;
  `);
  const failedMachineUpdate = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, { method: 'DELETE' });
  assert.equal(failedMachineUpdate.response.status, 500);
  assert.equal(db.prepare('SELECT deleted_at FROM maintenance_cards WHERE id = ?').get(card.id).deleted_at, null);
  assert.equal(db.prepare('SELECT active, deleted_at FROM machines WHERE id = ?').get(machineResponse.body.id).active, 1);
  assert.ok(existsSync(join(storageRoot, ...archivePrefix.split('/'))));
  assert.ok(existsSync(join(storageRoot, ...activePrefix.split('/'))));
  assert.ok(existsSync(join(storageRoot, ...areaFolderPath.split('/'))));
  assert.ok(existsSync(join(storageRoot, 'Machines', machineCode)));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_card_deletion_operations').get().count, 0);
  db.exec('DROP TRIGGER fail_machine_decommission_after_card_update');

  const deleted = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.deleted, true);
  assert.equal(deleted.body.machineId, machineResponse.body.id);
  assert.ok(db.prepare('SELECT deleted_at FROM maintenance_cards WHERE id = ?').get(card.id).deleted_at);
  const refreshedOrder = await request(`/api/maintenance/orders/${orderResponse.body.id}`);
  assert.equal(refreshedOrder.body.cards.some((item) => item.id === card.id), false);
  for (const path of [archivePrefix, activePrefix, areaFolderPath, `Machines/${machineCode}`]) {
    assert.equal(existsSync(join(storageRoot, ...path.split('/'))), false, `${path} should be removed after commit`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_card_deletion_operations').get().count, 0);
  const audit = db.prepare(`
    SELECT action, entity_type, entity_id, old_values_json, new_values_json
    FROM audit_log WHERE entity_type = 'maintenance_card' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(card.id);
  assert.equal(audit.action, 'decommission');
  assert.equal(audit.entity_type, 'maintenance_card');
  assert.equal(audit.entity_id, card.id);
  assert.equal(JSON.parse(audit.old_values_json).machine_code, machineCode);
  assert.ok(JSON.parse(audit.new_values_json).deleted_at);

  const machine = db.prepare('SELECT active, deleted_at FROM machines WHERE id = ?').get(machineResponse.body.id);
  assert.equal(machine.active, 0);
  assert.ok(machine.deleted_at);
  const machineAudit = db.prepare(`
    SELECT action, old_values_json, new_values_json
    FROM audit_log WHERE entity_type = 'machine' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(machineResponse.body.id);
  assert.equal(machineAudit.action, 'decommission');
  assert.equal(JSON.parse(machineAudit.old_values_json).code, machineCode);
  assert.equal(JSON.parse(machineAudit.new_values_json).active, 0);
  assert.deepEqual(await recoverMaintenanceCardDeletions(), { recoveredCount: 0 });
});

test('maintenance card photos can be moved or deleted without losing files on DB failure', async () => {
  const clientCode = 'PHOTO-PHASE-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Photo Phase Client').lastInsertRowid);
  const area = 'Photo Phase North';
  const machineResponse = await request('/api/maintenance/machines', json('POST', {
    code: 'PHOTO-PHASE-01',
    name_ar: 'ماكينة اختبار الصور',
    area,
  }));
  assert.equal(machineResponse.response.status, 201, JSON.stringify(machineResponse.body));
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: [area],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));
  const card = orderResponse.body.cards.find((item) => item.machine_id === machineResponse.body.id);
  assert.ok(card);

  const photoBytes = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#496b52' },
  }).png().toBuffer();
  async function uploadPhoto(phase, index) {
    const form = new FormData();
    form.append('photo', new Blob([photoBytes], { type: 'image/png' }), `${phase}-${index}.png`);
    const result = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/${phase}`, {
      method: 'POST',
      body: form,
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body;
  }

  const beforePhotos = [];
  for (let index = 0; index < 4; index += 1) beforePhotos.push(await uploadPhoto('before', index));
  const afterPhoto = await uploadPhoto('after', 0);
  const movedPhoto = beforePhotos[0];
  const movedFilename = movedPhoto.path.split('/').at(-1);
  const movedStoredPath = movedPhoto.path.replace(/\/before\//i, '/after/');
  db.prepare("UPDATE maintenance_cards SET status = 'completed' WHERE id = ?").run(card.id);

  // Unrelated edits should not revalidate paths left in the old phase by earlier move operations.
  db.prepare('UPDATE maintenance_cards SET after_photos_json = ? WHERE id = ?')
    .run(JSON.stringify([beforePhotos[1].path]), card.id);
  const notesOnlyUpdate = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, json('PATCH', {
    notes: 'Card update without photo changes.',
  }));
  assert.equal(notesOnlyUpdate.response.status, 200, JSON.stringify(notesOnlyUpdate.body));
  const restoreAfterPhotos = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}`, json('PATCH', {
    afterPhotos: [afterPhoto.path],
  }));
  assert.equal(restoreAfterPhotos.response.status, 200, JSON.stringify(restoreAfterPhotos.body));

  const fullPhaseMove = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/move`, json('POST', {
    fromPhase: 'after',
    toPhase: 'before',
    filename: afterPhoto.path.split('/').at(-1),
  }));
  assert.equal(fullPhaseMove.response.status, 400);
  assert.equal(db.prepare('SELECT status FROM maintenance_cards WHERE id = ?').get(card.id).status, 'completed');

  const moved = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/move`, json('POST', {
    fromPhase: 'before',
    toPhase: 'after',
    filename: movedFilename,
  }));
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.status, 'completed');
  assert.equal(moved.body.path, movedStoredPath);
  assert.equal(existsSync(join(storageRoot, ...movedPhoto.path.split('/'))), false, 'the old phase path should no longer exist');
  assert.equal(existsSync(join(storageRoot, ...movedStoredPath.split('/'))), true, 'moving a photo should relocate its file');
  assert.ok(moved.body.path.includes('/after/'), 'the stored path should reflect the destination phase');
  const movedDownload = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/after/${encodeURIComponent(movedFilename)}`);
  assert.equal(movedDownload.response.status, 200);
  const movedMetadata = await sharp(movedDownload.body).metadata();
  assert.equal(movedMetadata.format, 'jpeg');
  assert.equal(movedMetadata.width, 32);
  assert.equal(movedMetadata.height, 24);

  const deletedMovedPhoto = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/after/${encodeURIComponent(movedFilename)}`, {
    method: 'DELETE',
  });
  assert.equal(deletedMovedPhoto.response.status, 200, JSON.stringify(deletedMovedPhoto.body));
  assert.equal(existsSync(join(storageRoot, ...movedStoredPath.split('/'))), false, 'deleting a photo should remove its stored file');
  assert.equal(db.prepare('SELECT status FROM maintenance_cards WHERE id = ?').get(card.id).status, 'completed');

  const afterFilename = afterPhoto.path.split('/').at(-1);
  const deletedLastAfterPhoto = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/after/${encodeURIComponent(afterFilename)}`, {
    method: 'DELETE',
  });
  assert.equal(deletedLastAfterPhoto.response.status, 200, JSON.stringify(deletedLastAfterPhoto.body));
  assert.equal(deletedLastAfterPhoto.body.status, 'pending');
  assert.equal(db.prepare('SELECT status FROM maintenance_cards WHERE id = ?').get(card.id).status, 'pending');

  const retainedPhoto = beforePhotos[1];
  const retainedFilename = retainedPhoto.path.split('/').at(-1);
  db.exec(`
    CREATE TRIGGER fail_maintenance_photo_update
    BEFORE UPDATE OF before_photos_json, after_photos_json ON maintenance_cards
    WHEN OLD.id = ${card.id}
    BEGIN SELECT RAISE(ABORT, 'forced photo update failure'); END;
  `);
  const failedDelete = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/before/${encodeURIComponent(retainedFilename)}`, {
    method: 'DELETE',
  });
  assert.equal(failedDelete.response.status, 500);
  assert.equal(existsSync(join(storageRoot, ...retainedPhoto.path.split('/'))), true, 'the file must remain when its database update fails');
  assert.ok(JSON.parse(db.prepare('SELECT before_photos_json FROM maintenance_cards WHERE id = ?').get(card.id).before_photos_json).includes(retainedPhoto.path));
  db.exec('DROP TRIGGER fail_maintenance_photo_update');

  db.prepare("UPDATE maintenance_orders SET status = 'archived' WHERE id = ?").run(orderResponse.body.id);
  const archivedMove = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/move`, json('POST', {
    fromPhase: 'before',
    toPhase: 'after',
    filename: retainedFilename,
  }));
  const archivedMovedPath = retainedPhoto.path.replace(/\\/g, '/').replace(/\/before\//i, '/after/');
  assert.equal(archivedMove.response.status, 409);
  assert.equal(existsSync(join(storageRoot, ...retainedPhoto.path.split('/'))), true, 'archived move keeps the source photo in place');
  assert.equal(existsSync(join(storageRoot, ...archivedMovedPath.split('/'))), false, 'archived move must not create a destination photo');
  assert.ok(JSON.parse(db.prepare('SELECT before_photos_json FROM maintenance_cards WHERE id = ?').get(card.id).before_photos_json).includes(retainedPhoto.path));

  const archivedDelete = await request(`/api/maintenance/orders/${orderResponse.body.id}/cards/${card.id}/photos/before/${encodeURIComponent(retainedFilename)}`, {
    method: 'DELETE',
  });
  assert.equal(archivedDelete.response.status, 409);
  assert.equal(existsSync(join(storageRoot, ...retainedPhoto.path.split('/'))), true, 'archived deletion must preserve the original photo');
  assert.ok(JSON.parse(db.prepare('SELECT before_photos_json FROM maintenance_cards WHERE id = ?').get(card.id).before_photos_json).includes(retainedPhoto.path));

  const moveAudit = db.prepare(`
    SELECT action, old_values_json, new_values_json
    FROM audit_log WHERE entity_type = 'maintenance_card' AND entity_id = ? AND action = 'photo_move'
    ORDER BY id DESC LIMIT 1
  `).get(card.id);
  assert.equal(moveAudit.action, 'photo_move');
  assert.equal(JSON.parse(moveAudit.old_values_json).fromPhase, 'before');
  assert.equal(JSON.parse(moveAudit.new_values_json).status, 'completed');
  const deleteAudit = db.prepare(`
    SELECT action, old_values_json FROM audit_log
    WHERE entity_type = 'maintenance_card' AND entity_id = ? AND action = 'photo_delete'
    ORDER BY id DESC LIMIT 1
  `).get(card.id);
  assert.equal(deleteAudit.action, 'photo_delete');
  assert.equal(JSON.parse(deleteAudit.old_values_json).phase, 'after');
  assert.equal(JSON.parse(deleteAudit.old_values_json).photo, afterPhoto.path);
});

test('maintenance card startup recovery restores staged folders for an uncommitted deletion', async () => {
  const clientCode = 'CARD-RECOVERY-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Card Recovery Client').lastInsertRowid);
  const machineCode = 'CARD-RECOVERY-01';
  const machineResponse = await request('/api/maintenance/machines', json('POST', {
    code: machineCode,
    name_ar: 'ماكينة استعادة الكارت',
    area: 'Recovery North',
  }));
  assert.equal(machineResponse.response.status, 201, JSON.stringify(machineResponse.body));
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['Recovery North'],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));
  const card = orderResponse.body.cards.find((item) => item.machine_id === machineResponse.body.id);
  assert.ok(card);

  const originalPath = join(storageRoot, 'Machines', machineCode);
  writeFileSync(join(originalPath, 'recovery-marker.txt'), 'restore me');
  const operationId = randomUUID();
  const stageDirectory = join(storageRoot, '.madar-recovery', 'maintenance-card-deletions', operationId);
  mkdirSync(stageDirectory, { recursive: true });
  renameSync(originalPath, join(stageDirectory, 'item-0'));
  db.prepare(`
    INSERT INTO maintenance_card_deletion_operations (operation_id, card_id, order_id, targets_json, state)
    VALUES (?, ?, ?, ?, 'prepared')
  `).run(operationId, card.id, orderResponse.body.id, JSON.stringify([
    { path: `Machines/${machineCode}`, kind: 'directory' },
  ]));

  assert.deepEqual(await recoverMaintenanceCardDeletions(), { recoveredCount: 1 });
  assert.equal(existsSync(join(originalPath, 'recovery-marker.txt')), true);
  assert.equal(existsSync(stageDirectory), false);
  assert.equal(db.prepare('SELECT deleted_at FROM maintenance_cards WHERE id = ?').get(card.id).deleted_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_card_deletion_operations').get().count, 0);
});

test('missing trip machine without a card is decommissioned with staged folder cleanup', async () => {
  const clientCode = 'MISSING-MACHINE-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Missing Machine Client').lastInsertRowid);
  const machineCode = 'MISSING-MACHINE-01';
  const machineResponse = await request('/api/maintenance/machines', json('POST', {
    code: machineCode,
    name_ar: 'ماكينة غير موجودة بالموقع',
    area: 'Missing North',
  }));
  assert.equal(machineResponse.response.status, 201, JSON.stringify(machineResponse.body));
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['Missing North'],
    employeeIds: [],
    autoPopulateAreaMachines: false,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));
  assert.equal(orderResponse.body.cards.length, 0);

  const directories = [
    `Machines/${machineCode}`,
    `clients/${clientCode}/maintenance/${orderResponse.body.order_code}/${machineCode}`,
    `Clients/${clientCode}/Archived_Orders/${orderResponse.body.order_code}/${machineCode}`,
    `Areas/Missing North/${machineCode} — ماكينة غير موجودة بالموقع`,
    `Areas/Missing North/2026/11/${machineCode}_ماكينة غير موجودة بالموقع`,
  ];
  for (const directory of directories) {
    const absolute = join(storageRoot, ...directory.split('/'));
    mkdirSync(absolute, { recursive: true });
    writeFileSync(join(absolute, 'folder-marker.txt'), 'retain until commit');
  }

  db.exec(`
    CREATE TRIGGER fail_machine_decommission
    BEFORE UPDATE OF active ON machines
    WHEN OLD.id = ${machineResponse.body.id}
    BEGIN SELECT RAISE(ABORT, 'forced machine decommission failure'); END;
  `);
  const failed = await request(`/api/maintenance/orders/${orderResponse.body.id}/machines/${machineResponse.body.id}`, { method: 'DELETE' });
  assert.equal(failed.response.status, 500);
  for (const directory of directories) assert.equal(existsSync(join(storageRoot, ...directory.split('/'))), true);
  assert.equal(db.prepare('SELECT active, deleted_at FROM machines WHERE id = ?').get(machineResponse.body.id).active, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_machine_decommission_operations').get().count, 0);
  db.exec('DROP TRIGGER fail_machine_decommission');

  const decommissioned = await request(`/api/maintenance/orders/${orderResponse.body.id}/machines/${machineResponse.body.id}`, { method: 'DELETE' });
  assert.equal(decommissioned.response.status, 200, JSON.stringify(decommissioned.body));
  assert.equal(decommissioned.body.active, 0);
  for (const directory of directories) assert.equal(existsSync(join(storageRoot, ...directory.split('/'))), false);
  assert.ok(db.prepare('SELECT deleted_at FROM machines WHERE id = ?').get(machineResponse.body.id).deleted_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_machine_decommission_operations').get().count, 0);
});

test('machine decommission startup recovery restores folders before the DB commit', async () => {
  const clientCode = 'MACHINE-RECOVERY-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Machine Recovery Client').lastInsertRowid);
  const machineCode = 'MACHINE-RECOVERY-01';
  const machineResponse = await request('/api/maintenance/machines', json('POST', {
    code: machineCode,
    name_ar: 'ماكينة استعادة الإزالة',
    area: 'Machine Recovery North',
  }));
  assert.equal(machineResponse.response.status, 201, JSON.stringify(machineResponse.body));
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['Machine Recovery North'],
    employeeIds: [],
    autoPopulateAreaMachines: false,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));

  const originalPath = join(storageRoot, 'Machines', machineCode);
  mkdirSync(originalPath, { recursive: true });
  writeFileSync(join(originalPath, 'recovery-marker.txt'), 'restore machine folder');
  const operationId = randomUUID();
  const stageDirectory = join(storageRoot, '.madar-recovery', 'maintenance-machine-decommissions', operationId);
  mkdirSync(stageDirectory, { recursive: true });
  renameSync(originalPath, join(stageDirectory, 'item-0'));
  db.prepare(`
    INSERT INTO maintenance_machine_decommission_operations (operation_id, machine_id, order_id, targets_json, state)
    VALUES (?, ?, ?, ?, 'prepared')
  `).run(operationId, machineResponse.body.id, orderResponse.body.id, JSON.stringify([
    { path: `Machines/${machineCode}`, kind: 'directory' },
  ]));

  assert.deepEqual(await recoverMaintenanceMachineDecommissions(), { recoveredCount: 1 });
  assert.equal(existsSync(join(originalPath, 'recovery-marker.txt')), true);
  assert.equal(existsSync(stageDirectory), false);
  const machine = db.prepare('SELECT active, deleted_at FROM machines WHERE id = ?').get(machineResponse.body.id);
  assert.equal(machine.active, 1);
  assert.equal(machine.deleted_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_machine_decommission_operations').get().count, 0);
});

test('unmatched-folder purge stages archive/source directories, rolls back failures, deletes rows, and audits', async () => {
  const clientCode = 'UNMATCHED-PURGE-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Unmatched Purge Client').lastInsertRowid);
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['Purge North'],
    employeeIds: [],
    autoPopulateAreaMachines: false,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));

  const folderName = 'Unknown Compressor';
  const sourceName = 'Areas/Purge Source';
  const archiveDirectory = `Clients/${clientCode}/Archived_Orders/${orderResponse.body.order_code}/Unmatched/${folderName}`;
  const sourceDirectory = `${sourceName}/ ${folderName}`;
  const beforePhoto = `${archiveDirectory}/Before/before.png`;
  const afterPhoto = `${archiveDirectory}/After/after.png`;
  for (const [path, contents] of [
    [beforePhoto, 'before-photo'],
    [afterPhoto, 'after-photo'],
    [`${sourceDirectory}/Before/source-before.png`, 'source-before'],
    [`${sourceDirectory}/After/source-after.png`, 'source-after'],
  ]) {
    const segments = path.split('/');
    mkdirSync(join(storageRoot, ...segments.slice(0, -1)), { recursive: true });
    writeFileSync(join(storageRoot, ...segments), contents);
  }
  const folderId = Number(db.prepare(`
    INSERT INTO maintenance_unmatched_folders
      (order_id, folder_name, source_name, before_photos_json, after_photos_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderResponse.body.id, folderName, sourceName, JSON.stringify([beforePhoto]), JSON.stringify([afterPhoto])).lastInsertRowid);

  db.exec(`
    CREATE TRIGGER fail_unmatched_folder_purge
    BEFORE DELETE ON maintenance_unmatched_folders
    WHEN OLD.id = ${folderId}
    BEGIN SELECT RAISE(ABORT, 'forced unmatched folder purge failure'); END;
  `);
  const failed = await request(`/api/maintenance/orders/${orderResponse.body.id}/unmatched/${folderId}`, { method: 'DELETE' });
  assert.equal(failed.response.status, 500);
  assert.equal(db.prepare('SELECT status FROM maintenance_unmatched_folders WHERE id = ?').get(folderId).status, 'pending');
  assert.equal(existsSync(join(storageRoot, ...archiveDirectory.split('/'))), true);
  assert.equal(existsSync(join(storageRoot, ...sourceDirectory.split('/'))), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_unmatched_folder_deletion_operations').get().count, 0);
  db.exec('DROP TRIGGER fail_unmatched_folder_purge');

  const deleted = await request(`/api/maintenance/orders/${orderResponse.body.id}/unmatched/${folderId}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.deleted, true);
  assert.equal(deleted.body.folderName, folderName);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_unmatched_folders WHERE id = ?').get(folderId).count, 0);
  assert.equal(existsSync(join(storageRoot, ...archiveDirectory.split('/'))), false);
  assert.equal(existsSync(join(storageRoot, ...sourceDirectory.split('/'))), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_unmatched_folder_deletion_operations').get().count, 0);
  const audit = db.prepare(`
    SELECT action, entity_type, entity_id, old_values_json, new_values_json
    FROM audit_log WHERE action = 'delete_unmatched_folder' AND entity_type = 'maintenance_unmatched_folder' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(folderId);
  assert.equal(audit.action, 'delete_unmatched_folder');
  assert.equal(audit.entity_type, 'maintenance_unmatched_folder');
  assert.equal(audit.entity_id, folderId);
  assert.deepEqual(JSON.parse(audit.old_values_json), {
    folder_name: folderName,
    source_name: sourceName,
    before_count: 1,
    after_count: 1,
  });
  assert.equal(audit.new_values_json, null);
});

test('unmatched-folder startup recovery restores prepared purges and completes committed purges', async () => {
  const clientCode = 'UNMATCHED-RECOVERY-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Unmatched Recovery Client').lastInsertRowid);
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['Purge Recovery North'],
    employeeIds: [],
    autoPopulateAreaMachines: false,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));

  const createFixture = (folderName, sourceName) => {
    const archiveDirectory = `Clients/${clientCode}/Archived_Orders/${orderResponse.body.order_code}/Unmatched/${folderName}`;
    const sourceDirectory = `${sourceName}/${folderName}`;
    mkdirSync(join(storageRoot, ...archiveDirectory.split('/')), { recursive: true });
    mkdirSync(join(storageRoot, ...sourceDirectory.split('/')), { recursive: true });
    writeFileSync(join(storageRoot, ...archiveDirectory.split('/'), 'photo.png'), folderName);
    writeFileSync(join(storageRoot, ...sourceDirectory.split('/'), 'source.png'), folderName);
    const folderId = Number(db.prepare(`
      INSERT INTO maintenance_unmatched_folders (order_id, folder_name, source_name)
      VALUES (?, ?, ?)
    `).run(orderResponse.body.id, folderName, sourceName).lastInsertRowid);
    const targets = [
      { path: archiveDirectory, kind: 'directory' },
      { path: sourceDirectory, kind: 'directory' },
    ];
    return { folderId, folderName, sourceName, archiveDirectory, sourceDirectory, targets };
  };
  const stageFixture = (fixture, state) => {
    const operationId = randomUUID();
    const stageDirectory = join(storageRoot, '.madar-recovery', 'maintenance-unmatched-folder-deletions', operationId);
    mkdirSync(stageDirectory, { recursive: true });
    for (const [index, target] of fixture.targets.entries()) {
      const source = join(storageRoot, ...target.path.split('/'));
      renameSync(source, join(stageDirectory, `item-${index}`));
    }
    db.prepare(`
      INSERT INTO maintenance_unmatched_folder_deletion_operations
        (operation_id, folder_id, order_id, client_code, order_code, folder_name, source_name, targets_json, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      operationId,
      fixture.folderId,
      orderResponse.body.id,
      clientCode,
      orderResponse.body.order_code,
      fixture.folderName,
      fixture.sourceName,
      JSON.stringify(fixture.targets),
      state,
    );
    return { operationId, stageDirectory };
  };

  const preparedFixture = createFixture('Prepared Unknown', 'Areas/Prepared Purge');
  const preparedStage = stageFixture(preparedFixture, 'prepared');
  const committedFixture = createFixture('Committed Unknown', 'Areas/Committed Purge');
  const committedStage = stageFixture(committedFixture, 'committed');
  db.prepare('DELETE FROM maintenance_unmatched_folders WHERE id = ?').run(committedFixture.folderId);
  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, old_values_json, new_values_json)
    VALUES ('delete_unmatched_folder', 'maintenance_unmatched_folder', ?, '{}', NULL)
  `).run(committedFixture.folderId);

  assert.deepEqual(await recoverUnmatchedMaintenanceFolderDeletions(), { recoveredCount: 2 });
  assert.equal(existsSync(join(storageRoot, ...preparedFixture.archiveDirectory.split('/'))), true);
  assert.equal(existsSync(join(storageRoot, ...preparedFixture.sourceDirectory.split('/'))), true);
  assert.equal(existsSync(preparedStage.stageDirectory), false);
  assert.equal(db.prepare('SELECT status FROM maintenance_unmatched_folders WHERE id = ?').get(preparedFixture.folderId).status, 'pending');
  assert.equal(existsSync(join(storageRoot, ...committedFixture.archiveDirectory.split('/'))), false);
  assert.equal(existsSync(join(storageRoot, ...committedFixture.sourceDirectory.split('/'))), false);
  assert.equal(existsSync(committedStage.stageDirectory), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_unmatched_folder_deletion_operations').get().count, 0);
});

test('unmatched-folder purge rejects archived and bound folders without deleting ZIP sources', async () => {
  const clientCode = 'UNMATCHED-PURGE-ZIP-CLIENT';
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(clientCode, 'Unmatched ZIP Client').lastInsertRowid);
  const orderResponse = await request('/api/maintenance/orders', json('POST', {
    clientId,
    areas: ['ZIP Purge North'],
    employeeIds: [],
    autoPopulateAreaMachines: false,
  }));
  assert.equal(orderResponse.response.status, 201, JSON.stringify(orderResponse.body));

  const folderName = 'ZIP Unknown';
  const sourceName = 'maintenance-trip.zip';
  const archiveDirectory = `Clients/${clientCode}/Archived_Orders/${orderResponse.body.order_code}/Unmatched/${folderName}`;
  const photoPath = `${archiveDirectory}/Before/photo.png`;
  mkdirSync(join(storageRoot, ...archiveDirectory.split('/'), 'Before'), { recursive: true });
  writeFileSync(join(storageRoot, ...photoPath.split('/')), 'zip-photo');
  const zipPath = join(storageRoot, sourceName);
  writeFileSync(zipPath, 'original-zip');
  const folderId = Number(db.prepare(`
    INSERT INTO maintenance_unmatched_folders
      (order_id, folder_name, source_name, before_photos_json)
    VALUES (?, ?, ?, ?)
  `).run(orderResponse.body.id, folderName, sourceName, JSON.stringify([photoPath])).lastInsertRowid);

  db.prepare("UPDATE maintenance_orders SET status = 'archived' WHERE id = ?").run(orderResponse.body.id);
  const archivedDelete = await request(`/api/maintenance/orders/${orderResponse.body.id}/unmatched/${folderId}`, { method: 'DELETE' });
  assert.equal(archivedDelete.response.status, 409);
  assert.equal(db.prepare('SELECT status FROM maintenance_unmatched_folders WHERE id = ?').get(folderId).status, 'pending');
  assert.equal(existsSync(join(storageRoot, ...archiveDirectory.split('/'))), true);
  assert.equal(existsSync(zipPath), true);

  db.prepare("UPDATE maintenance_orders SET status = 'in_progress' WHERE id = ?").run(orderResponse.body.id);
  const deleted = await request(`/api/maintenance/orders/${orderResponse.body.id}/unmatched/${folderId}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  assert.equal(existsSync(join(storageRoot, ...archiveDirectory.split('/'))), false);
  assert.equal(existsSync(zipPath), true, 'the original ZIP source must not be deleted');

  const boundFolderId = Number(db.prepare(`
    INSERT INTO maintenance_unmatched_folders (order_id, folder_name, source_name, status)
    VALUES (?, 'Already Bound', ?, 'bound')
  `).run(orderResponse.body.id, sourceName).lastInsertRowid);
  const boundDelete = await request(`/api/maintenance/orders/${orderResponse.body.id}/unmatched/${boundFolderId}`, { method: 'DELETE' });
  assert.equal(boundDelete.response.status, 404);
  assert.equal(db.prepare('SELECT status FROM maintenance_unmatched_folders WHERE id = ?').get(boundFolderId).status, 'bound');
});

test('machine creation restores matching soft-deleted and inactive codes, audits changes, and rejects active duplicates', async () => {
  const softDeleted = await request('/api/maintenance/machines', json('POST', {
    code: 'RESTORE-SOFT-DELETE-01',
    name_ar: 'ماكينة قبل الاستعادة',
    name_en: 'Before Restore',
    area: 'North',
  }));
  assert.equal(softDeleted.response.status, 201, JSON.stringify(softDeleted.body));
  const softDeletedId = softDeleted.body.id;

  const deactivated = await request(`/api/maintenance/machines/${softDeletedId}`, { method: 'DELETE' });
  assert.equal(deactivated.response.status, 200, JSON.stringify(deactivated.body));
  const restoreSoftDeleted = await request('/api/maintenance/machines', json('POST', {
    code: 'restore-soft-delete-01',
    name_ar: 'ماكينة مستعادة',
    name_en: 'Restored Machine',
    area: 'South',
  }));
  assert.equal(restoreSoftDeleted.response.status, 201, JSON.stringify(restoreSoftDeleted.body));
  assert.equal(restoreSoftDeleted.body.id, softDeletedId);
  assert.equal(restoreSoftDeleted.body.code, 'RESTORE-SOFT-DELETE-01');
  assert.equal(restoreSoftDeleted.body.name_ar, 'ماكينة مستعادة');
  assert.equal(restoreSoftDeleted.body.name_en, 'Restored Machine');
  assert.equal(restoreSoftDeleted.body.area, 'South');
  assert.equal(restoreSoftDeleted.body.active, 1);
  assert.equal(db.prepare('SELECT deleted_at FROM machines WHERE id = ?').get(softDeletedId).deleted_at, null);

  const inactive = await request('/api/maintenance/machines', json('POST', {
    code: 'RESTORE-INACTIVE-01',
    name_ar: 'ماكينة غير نشطة',
    area: 'North',
  }));
  assert.equal(inactive.response.status, 201, JSON.stringify(inactive.body));
  db.prepare('UPDATE machines SET active = 0 WHERE id = ?').run(inactive.body.id);
  const restoreInactive = await request('/api/maintenance/machines', json('POST', {
    code: 'RESTORE-INACTIVE-01',
    name_ar: 'ماكينة عادت للعمل',
    area: 'South',
  }));
  assert.equal(restoreInactive.response.status, 201, JSON.stringify(restoreInactive.body));
  assert.equal(restoreInactive.body.id, inactive.body.id);
  assert.equal(restoreInactive.body.active, 1);
  assert.equal(restoreInactive.body.name_ar, 'ماكينة عادت للعمل');

  const audit = db.prepare(`
    SELECT action, entity_type, entity_id, old_values_json, new_values_json
    FROM audit_log
    WHERE entity_type = 'machine' AND entity_id = ? AND action = 'restore_and_update'
    ORDER BY id DESC LIMIT 1
  `).get(softDeletedId);
  assert.equal(audit.action, 'restore_and_update');
  assert.equal(audit.entity_type, 'machine');
  assert.equal(audit.entity_id, softDeletedId);
  assert.equal(JSON.parse(audit.old_values_json).active, 0);
  assert.ok(JSON.parse(audit.old_values_json).deleted_at);
  assert.deepEqual(JSON.parse(audit.new_values_json), {
    code: 'restore-soft-delete-01',
    nameAr: 'ماكينة مستعادة',
    nameEn: 'Restored Machine',
    area: 'South',
    active: 1,
    deleted_at: null,
  });

  const activeCollision = await request('/api/maintenance/machines', json('POST', {
    code: 'RESTORE-SOFT-DELETE-01',
    name_ar: 'اسم لا يجب حفظه',
    area: 'West',
  }));
  assert.equal(activeCollision.response.status, 409);
  assert.equal(activeCollision.body.error, 'الماكينة بكود (RESTORE-SOFT-DELETE-01) مسجلة ونشطة بالفعل باسم "ماكينة مستعادة". يمكنك تعديلها من الجدول.');
  assert.equal(db.prepare('SELECT name_ar, area FROM machines WHERE id = ?').get(softDeletedId).name_ar, 'ماكينة مستعادة');
});
