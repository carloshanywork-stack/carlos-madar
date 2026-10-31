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

const [{ app }, { db }, { initializeDatabase }, { recoverMaintenanceCardDeletions, recoverMaintenanceMachineDecommissions }] = await Promise.all([
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
