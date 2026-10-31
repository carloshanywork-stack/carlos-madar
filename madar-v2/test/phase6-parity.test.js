import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import yauzl from 'yauzl';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-parity-'));
const storageRoot = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'parity.sqlite');
process.env.MADAR_V2_DATA_DIR = join(temporaryDirectory, 'data');
process.env.MADAR_V2_STORAGE_ROOT = storageRoot;
process.env.MADAR_V2_BACKUP_ROOT = join(temporaryDirectory, 'Backups');
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }, { classifyMachinePhotos, matchMachineFolder }, { renameAreaSourceDirectory }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/maintenance/trip-folder.js'),
  import('../server/modules/maintenance/service.js'),
]);

const adminPassword = 'phase6-test-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
assert.equal(loginResponse.status, 200);
let cookie = (loginResponse.headers.getSetCookie?.()[0] ?? loginResponse.headers.get('set-cookie'))?.split(';', 1)[0];
assert.ok(cookie);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...(options.headers ?? {}), cookie } });
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
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

function zipEntryNames(buffer) {
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  assert.notEqual(endOffset, -1, 'ZIP end-of-central-directory record should exist');
  const count = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'ZIP central directory entry should exist');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function readZipEntry(buffer, targetName) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) return reject(openError);
      zipfile.once('error', reject);
      zipfile.once('end', () => resolve(null));
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== targetName) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            zipfile.close();
            reject(streamError);
            return;
          }
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.once('error', reject);
          stream.once('end', () => {
            zipfile.close();
            resolve(Buffer.concat(chunks));
          });
        });
      });
      zipfile.readEntry();
    });
  });
}

test('maintenance Storage explorer browses safe Areas folders and reports direct photos', async () => {
  const areasRoot = join(storageRoot, 'Areas');
  const region = join(areasRoot, 'شرم الشيخ');
  const branch = join(region, 'نبق');
  mkdirSync(join(branch, 'رحلة 01'), { recursive: true });
  mkdirSync(join(areasRoot, '.incoming'), { recursive: true });
  mkdirSync(join(areasRoot, '.private'), { recursive: true });
  mkdirSync(join(region, '.incoming'), { recursive: true });
  writeFileSync(join(region, 'area-photo.jpg'), Buffer.from('image'));
  writeFileSync(join(branch, 'before.jpeg'), Buffer.from('image'));
  writeFileSync(join(branch, 'after.PNG'), Buffer.from('image'));
  writeFileSync(join(branch, 'ignored.webp'), Buffer.from('image'));

  const root = await request('/api/maintenance/storage-explorer');
  assert.equal(root.response.status, 200, JSON.stringify(root.body));
  assert.equal(root.body.currentPath, '');
  assert.deepEqual(root.body.breadcrumbs, [{ name: 'Areas', path: '' }]);
  assert.deepEqual(root.body.folders.map((folder) => folder.name), ['شرم الشيخ']);
  assert.equal(root.body.folders[0].path, 'شرم الشيخ');
  assert.equal(root.body.folders[0].fullStoragePath, 'Areas/شرم الشيخ');
  assert.equal(root.body.folders[0].photoCount, 1);
  assert.equal(root.body.folders[0].hasSubfolders, true);

  const area = await request(`/api/maintenance/storage-explorer?path=${encodeURIComponent('شرم الشيخ')}`);
  assert.equal(area.response.status, 200, JSON.stringify(area.body));
  assert.deepEqual(area.body.breadcrumbs, [
    { name: 'Areas', path: '' },
    { name: 'شرم الشيخ', path: 'شرم الشيخ' },
  ]);
  assert.deepEqual(area.body.folders.map((folder) => folder.name), ['نبق']);
  assert.equal(area.body.folders[0].fullStoragePath, 'Areas/شرم الشيخ/نبق');
  assert.equal(area.body.folders[0].photoCount, 2);
  assert.equal(area.body.folders[0].hasSubfolders, true);

  const traversal = await request(`/api/maintenance/storage-explorer?path=${encodeURIComponent('../outside')}`);
  assert.equal(traversal.response.status, 400);
  const hiddenPath = await request(`/api/maintenance/storage-explorer?path=${encodeURIComponent('شرم الشيخ/.incoming')}`);
  assert.equal(hiddenPath.response.status, 400);
});

test('area folder renames translate Windows EPERM locks into an actionable Arabic error', async () => {
  const lockedError = Object.assign(new Error('Access denied'), { code: 'EPERM' });
  await assert.rejects(
    renameAreaSourceDirectory({ sourceDirectory: 'source', destinationDirectory: 'target' }, async () => { throw lockedError; }),
    (error) => error.status === 409 && error.message === 'يرجى إغلاق المجلد إذا كان مفتوحاً في برنامج آخر',
  );
});

test('V2 parity operations cover imports, area maintenance, HR, exports, users, and backups', async () => {
  const createdClient = await request('/api/clients', json('POST', { name: 'Parity Import Client' }));
  assert.equal(createdClient.response.status, 201);
  const clientId = createdClient.body.id;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { code: 'PARITY-01', name_ar: 'ماكينة الاختبار الأولى', name_en: 'Parity Machine One', area: 'Cairo' },
    { code: 'PARITY-02', name_ar: 'ماكينة الاختبار الثانية', name_en: 'Parity Machine Two', area: 'Cairo' },
    { code: 'BROKEN', name_ar: '', name_en: 'Missing Arabic Name', area: 'Cairo' },
  ]), 'Machines');
  const excel = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  const importForm = new FormData();
  importForm.append('file', new Blob([excel], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'machines.xlsx');
  const imported = await request('/api/maintenance/machines/import', { method: 'POST', body: importForm });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
  assert.deepEqual(imported.body, { added: 2, updated: 0, skipped: 1 });
  assert.equal(existsSync(join(storageRoot, 'Machines', 'PARITY-01')), true);
  assert.equal(existsSync(join(storageRoot, 'Areas', 'Cairo')), true);

  const matcherMachines = [
    { id: 1, code: '143', name_ar: 'مدارس جيل المستقبل', name_en: 'Future Generation Schools' },
    { id: 2, code: '2', name_ar: 'فرع الباشا', name_en: '' },
    { id: 3, code: '208', name_ar: 'ماكينة الباشا', name_en: 'Pasha Machine' },
    { id: 4, code: 'PARITY-02', name_ar: 'ماكينة الاختبار الثانية', name_en: 'Parity Machine Two' },
  ];
  assert.equal(matchMachineFolder('مدارس جيل المستقبل - 143', matcherMachines)?.id, 1);
  assert.equal(matchMachineFolder('143 - مدارس جيل المستقبل', matcherMachines)?.id, 1);
  assert.equal(matchMachineFolder('[143] مدارس جيل المستقبل', matcherMachines)?.id, 1);
  assert.equal(matchMachineFolder('مدارس جيل المستقبل', matcherMachines)?.id, 1);
  assert.equal(matchMachineFolder('مدارس جيل المستقبل سوهاج', matcherMachines)?.id, 1);
  assert.equal(matchMachineFolder('Future Generation Schools', matcherMachines)?.id, 1);
  assert.equal(matchMachineFolder('unit-PARITY-02-Inspection', matcherMachines)?.id, 4);
  assert.equal(matchMachineFolder('فرع الباشا 2 - 208', matcherMachines)?.id, 2);

  const previewForm = new FormData();
  previewForm.append('file', new Blob([excel], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'machines.xlsx');
  const preview = await request('/api/maintenance/machines/import/preview', { method: 'POST', body: previewForm });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.totalRows, 3);

  const machines = await request('/api/maintenance/machines?area=Cairo&page=1&limit=1');
  assert.equal(machines.body.total, 2);
  assert.equal(machines.body.machines.length, 1);
  assert.deepEqual(machines.body.areas, ['Cairo']);

  const maintenanceEmployeeId = Number(db.prepare(`INSERT INTO employees (name, department) VALUES ('Area Technician', 'Maintenance')`).run().lastInsertRowid);
  const missingArea = await request('/api/maintenance/orders', json('POST', { clientId, employeeIds: [] }));
  assert.equal(missingArea.response.status, 400);
  const order = await request('/api/maintenance/orders', json('POST', {
    clientId, area: 'Cairo', employeeIds: [maintenanceEmployeeId], autoPopulateAreaMachines: true,
  }));
  assert.equal(order.response.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.area, 'Cairo');
  assert.equal(order.body.cards.length, 2);
  const sourcePhoto = await sharp({ create: { width: 120, height: 60, channels: 3, background: '#d94841' } }).png().toBuffer();
  const otherAreaMachine = await request('/api/maintenance/machines', json('POST', {
    code: 'OTHER-AREA-01', name_ar: 'ماكينة منطقة أخرى', name_en: 'Other Area Machine', area: 'Alexandria',
  }));
  assert.equal(otherAreaMachine.response.status, 201);
  const crossAreaCard = await request(`/api/maintenance/orders/${order.body.id}/cards`, json('POST', {
    machineId: otherAreaMachine.body.id,
  }));
  assert.equal(crossAreaCard.response.status, 404);
  const sourceDirectory = join(storageRoot, 'Incoming', 'Cairo', 'PARITY-01', 'Before');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(join(sourceDirectory, 'before.png'), sourcePhoto);
  const folderImport = await request(`/api/maintenance/orders/${order.body.id}/import-server-folder`, json('POST', { folderPath: 'Incoming/Cairo' }));
  assert.equal(folderImport.response.status, 200, JSON.stringify(folderImport.body));
  assert.equal(folderImport.body.attachedBefore, 1);
  const refreshedOrder = await request(`/api/maintenance/orders/${order.body.id}`);
  const photoCard = refreshedOrder.body.cards.find((item) => item.machine_code === 'PARITY-01');
  assert.equal(photoCard.before_photos.length, 1);
  assert.deepEqual(readFileSync(join(storageRoot, ...photoCard.before_photos[0].split('/'))), sourcePhoto);
  const chronologicalPhotos = await classifyMachinePhotos([1, 2, 3, 4].map((modifiedAt) => ({
    relativePath: `machine/${modifiedAt}.png`, name: `${modifiedAt}.png`, machineRelativePath: '', buffer: sourcePhoto, modifiedAt,
  })));
  assert.equal(chronologicalPhotos.before.length, 2);
  assert.equal(chronologicalPhotos.after.length, 2);
  const tiedPhotos = await classifyMachinePhotos([1, 2].map((index) => ({
    relativePath: `machine/tie-${index}.png`, name: `tie-${index}.png`, machineRelativePath: '', buffer: sourcePhoto, modifiedAt: 1000,
  })));
  assert.equal(tiedPhotos.before.length, 2);
  assert.equal(tiedPhotos.after.length, 0);
  const reasonList = await request('/api/maintenance/reasons');
  assert.equal(reasonList.body.length, 6);
  const card = order.body.cards[0];
  const reasonUpdate = await request(`/api/maintenance/orders/${order.body.id}/cards/${card.id}`, json('PATCH', { reasonId: reasonList.body[0].id }));
  assert.equal(reasonUpdate.response.status, 200);
  assert.equal(reasonUpdate.body.reason_id, reasonList.body[0].id);
  assert.equal(reasonUpdate.body.reason_name, reasonList.body[0].name);

  const machineBeforeUpsert = db.prepare('SELECT id FROM machines WHERE code = ?').get('PARITY-01');
  const deployedBeforeUpsert = db.prepare('SELECT client_id, machine_id FROM client_machines WHERE client_id = ? AND machine_id = ?').get(clientId, machineBeforeUpsert.id);
  const updateWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(updateWorkbook, XLSX.utils.json_to_sheet([
    { code: 'PARITY-01', name_ar: 'ماكينة الاختبار الأولى', name_en: 'Updated Parity Machine One', area: 'Cairo' },
  ]), 'Machines');
  const updateForm = new FormData();
  updateForm.append('file', new Blob([XLSX.write(updateWorkbook, { bookType: 'xlsx', type: 'buffer' })]), 'machine-update.xlsx');
  const upsert = await request('/api/maintenance/machines/import', { method: 'POST', body: updateForm });
  assert.equal(upsert.response.status, 200);
  assert.deepEqual(upsert.body, { added: 0, updated: 1, skipped: 0 });
  assert.equal(db.prepare('SELECT id FROM machines WHERE code = ?').get('PARITY-01').id, machineBeforeUpsert.id);
  assert.deepEqual(db.prepare('SELECT client_id, machine_id FROM client_machines WHERE client_id = ? AND machine_id = ?').get(clientId, machineBeforeUpsert.id), deployedBeforeUpsert);
  assert.equal(db.prepare('SELECT name_en FROM machines WHERE id = ?').get(machineBeforeUpsert.id).name_en, 'Updated Parity Machine One');

  const englishMachine = await request('/api/maintenance/machines', json('POST', {
    code: 'PARITY-03', name_ar: 'ماكينة ثالثة', name_en: 'English Parity Machine', area: 'Cairo',
  }));
  const remainingMachine = await request('/api/maintenance/machines', json('POST', {
    code: 'PARITY-04', name_ar: 'ماكينة غير مصورة', name_en: 'Unpictured Machine', area: 'Cairo',
  }));
  assert.equal(englishMachine.response.status, 201);
  assert.equal(remainingMachine.response.status, 201);

  const tripZip = await createZip([
    ['Weekend Trip/ماكينة الاختبار الأولى/قبل/old.png', sourcePhoto],
    ['Weekend Trip/ماكينة الاختبار الأولى/بعد/new.png', sourcePhoto],
    ['Weekend Trip/ماكينة الاختبار الأولى/a-unknown.png', sourcePhoto],
    ['Weekend Trip/ماكينة الاختبار الأولى/b-unknown.png', sourcePhoto],
    ['Weekend Trip/unit-PARITY-02-Inspection/Before/01-before.png', sourcePhoto],
    ['Weekend Trip/unit-PARITY-02-Inspection/After/02-after.png', sourcePhoto],
    ['Weekend Trip/English Parity Machine/01-first.png', sourcePhoto],
    ['Weekend Trip/English Parity Machine/02-second.png', sourcePhoto],
    ['Weekend Trip/Mystery Terminal/01-before.png', sourcePhoto],
    ['Weekend Trip/Mystery Terminal/02-after.png', sourcePhoto],
  ]);
  const tripForm = new FormData();
  tripForm.append('file', new Blob([tripZip], { type: 'application/zip' }), 'weekend-trip.zip');
  const processedTrip = await request(`/api/maintenance/orders/${order.body.id}/process-folder`, { method: 'POST', body: tripForm });
  assert.equal(processedTrip.response.status, 200, JSON.stringify(processedTrip.body));
  assert.equal(processedTrip.body.matchedMachineCount, 3);
  assert.equal(processedTrip.body.unmatchedFolderCount, 1);
  assert.equal(processedTrip.body.attachedBefore, 5);
  assert.equal(processedTrip.body.attachedAfter, 3);
  const arabicNameCard = processedTrip.body.order.cards.find((item) => item.machine_code === 'PARITY-01');
  assert.equal(arabicNameCard.before_photos.length, 4);
  assert.equal(arabicNameCard.after_photos.length, 1);
  const matchedSourcePhoto = await request(arabicNameCard.before_photo_urls[0]);
  assert.equal(matchedSourcePhoto.response.status, 200);
  assert.deepEqual(matchedSourcePhoto.body, sourcePhoto);
  const unmatchedReview = processedTrip.body.order.unmatched_folders[0];
  assert.equal(unmatchedReview.folder_name, 'Mystery Terminal');
  assert.equal(unmatchedReview.photo_count, 2);
  const unmatchedPhoto = await request(unmatchedReview.before_photo_urls[0]);
  assert.equal(unmatchedPhoto.response.status, 200);
  assert.deepEqual(unmatchedPhoto.body, sourcePhoto);
  assert.match(unmatchedReview.before_photos[0], /Clients\/C-1001\/Archived_Orders\/MN-/);
  assert.match(unmatchedReview.before_photos[0], /\/Unmatched\/Mystery Terminal\/Before\//);
  assert.equal(processedTrip.body.order.unmatched_machine_candidates.length, 1);
  assert.equal(processedTrip.body.order.unmatched_machine_candidates[0].id, remainingMachine.body.id);

  const bound = await request(`/api/maintenance/orders/${order.body.id}/unmatched/${unmatchedReview.id}/bind`, json('POST', { machineId: remainingMachine.body.id }));
  assert.equal(bound.response.status, 200, JSON.stringify(bound.body));
  assert.equal(bound.body.machineCode, 'PARITY-04');
  assert.equal(bound.body.order.unmatched_folders.length, 0);
  const boundCard = bound.body.order.cards.find((item) => item.machine_id === remainingMachine.body.id);
  assert.equal(boundCard.status, 'completed');
  assert.equal(boundCard.before_photos.length, 1);
  assert.equal(boundCard.after_photos.length, 1);
  assert.match(boundCard.before_photos[0], /\/PARITY-04\/Before\//);

  const areaMachine = await request('/api/maintenance/machines', json('POST', {
    code: 'PARITY-05', name_ar: 'ماكينة غير معروفة', name_en: 'Field Unit Five', area: 'Cairo',
  }));
  assert.equal(areaMachine.response.status, 201);
  const areaSourceFolder = join(storageRoot, 'Areas', 'Cairo', 'Unlabeled Pump');
  const areaSourceBefore = join(areaSourceFolder, 'Before');
  const areaSourceAfter = join(areaSourceFolder, 'After');
  mkdirSync(areaSourceBefore, { recursive: true });
  mkdirSync(areaSourceAfter, { recursive: true });
  writeFileSync(join(areaSourceBefore, 'before.png'), sourcePhoto);
  writeFileSync(join(areaSourceAfter, 'after.png'), sourcePhoto);
  const sourceCard = bound.body.order.cards.find((item) => item.machine_code === 'PARITY-01');
  const directSourcePath = 'Areas/Cairo/Unlabeled Pump/Before/before.png';
  db.prepare('UPDATE maintenance_cards SET before_photos_json = ? WHERE id = ?')
    .run(JSON.stringify([...sourceCard.before_photos, directSourcePath]), sourceCard.id);

  const areaTrip = await request(`/api/maintenance/orders/${order.body.id}/process-folder`, json('POST', { folderPath: 'Areas/Cairo' }));
  assert.equal(areaTrip.response.status, 200, JSON.stringify(areaTrip.body));
  const areaUnmatched = areaTrip.body.order.unmatched_folders.find((item) => item.folder_name === 'Unlabeled Pump');
  assert.ok(areaUnmatched);
  assert.equal(areaUnmatched.source_name, 'Areas/Cairo');
  assert.ok(areaTrip.body.order.unmatched_machine_candidates.some((item) => item.id === areaMachine.body.id));

  const areaBound = await request(`/api/maintenance/orders/${order.body.id}/unmatched/${areaUnmatched.id}/bind`, json('POST', { machineId: areaMachine.body.id }));
  assert.equal(areaBound.response.status, 200, JSON.stringify(areaBound.body));
  const renamedAreaSource = join(storageRoot, 'Areas', 'Cairo', 'PARITY-05 - Unlabeled Pump');
  assert.equal(existsSync(areaSourceFolder), false);
  assert.equal(existsSync(renamedAreaSource), true);
  assert.deepEqual(readFileSync(join(renamedAreaSource, 'Before', 'before.png')), sourcePhoto);
  assert.deepEqual(readFileSync(join(renamedAreaSource, 'After', 'after.png')), sourcePhoto);
  const remappedSourceCard = areaBound.body.order.cards.find((item) => item.id === sourceCard.id);
  assert.ok(remappedSourceCard.before_photos.includes('Areas/Cairo/PARITY-05 - Unlabeled Pump/Before/before.png'));
  assert.ok(!remappedSourceCard.before_photos.includes(directSourcePath));
  const areaBoundCard = areaBound.body.order.cards.find((item) => item.machine_id === areaMachine.body.id);
  assert.equal(areaBoundCard.status, 'completed');
  assert.deepEqual(readFileSync(join(storageRoot, ...areaBoundCard.before_photos[0].split('/'))), sourcePhoto);

  const rollbackMachine = await request('/api/maintenance/machines', json('POST', {
    code: 'PARITY-06', name_ar: 'ماكينة اختبار التراجع', name_en: 'Rollback Test Unit', area: 'Cairo',
  }));
  assert.equal(rollbackMachine.response.status, 201);
  const rollbackSourceFolder = join(storageRoot, 'Areas', 'Rollback Test', 'Mystery Side');
  mkdirSync(join(rollbackSourceFolder, 'Before'), { recursive: true });
  mkdirSync(join(rollbackSourceFolder, 'After'), { recursive: true });
  writeFileSync(join(rollbackSourceFolder, 'Before', 'before.png'), sourcePhoto);
  writeFileSync(join(rollbackSourceFolder, 'After', 'after.png'), sourcePhoto);
  const rollbackTrip = await request(`/api/maintenance/orders/${order.body.id}/process-folder`, json('POST', { folderPath: 'Areas/Rollback Test' }));
  assert.equal(rollbackTrip.response.status, 200, JSON.stringify(rollbackTrip.body));
  const rollbackUnmatched = rollbackTrip.body.order.unmatched_folders.find((item) => item.folder_name === 'Mystery Side');
  assert.ok(rollbackUnmatched);
  const triggerName = 'test_abort_unmatched_folder_binding';
  db.exec(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON maintenance_unmatched_folders
    WHEN OLD.id = ${rollbackUnmatched.id}
    BEGIN SELECT RAISE(ABORT, 'forced isolated test failure'); END`);
  let failedBind;
  try {
    failedBind = await request(`/api/maintenance/orders/${order.body.id}/unmatched/${rollbackUnmatched.id}/bind`, json('POST', { machineId: rollbackMachine.body.id }));
  } finally {
    db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  }
  assert.equal(failedBind.response.status, 500);
  assert.equal(existsSync(rollbackSourceFolder), true);
  assert.equal(existsSync(join(storageRoot, 'Areas', 'Rollback Test', 'PARITY-06 - Mystery Side')), false);
  assert.equal(db.prepare('SELECT status FROM maintenance_unmatched_folders WHERE id = ?').get(rollbackUnmatched.id).status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_cards WHERE order_id = ? AND machine_id = ?').get(order.body.id, rollbackMachine.body.id).count, 0);

  const serverTripBefore = join(storageRoot, 'Areas', 'Server Trip', 'PARITY-04', 'Before');
  const serverTripAfter = join(storageRoot, 'Areas', 'Server Trip', 'PARITY-04', 'After');
  const serverTripIncoming = join(storageRoot, 'Areas', 'Server Trip', 'PARITY-04', '.incoming', 'Before');
  mkdirSync(serverTripBefore, { recursive: true });
  mkdirSync(serverTripAfter, { recursive: true });
  mkdirSync(serverTripIncoming, { recursive: true });
  writeFileSync(join(serverTripBefore, 'before.png'), sourcePhoto);
  writeFileSync(join(serverTripAfter, 'after.png'), sourcePhoto);
  writeFileSync(join(serverTripIncoming, 'partial.png'), sourcePhoto);
  const serverTrip = await request(`/api/maintenance/orders/${order.body.id}/process-folder`, json('POST', { folderPath: 'Areas/Server Trip' }));
  assert.equal(serverTrip.response.status, 200, JSON.stringify(serverTrip.body));
  assert.equal(serverTrip.body.matchedMachineCount, 1);
  assert.equal(serverTrip.body.attachedBefore, 1);
  assert.equal(serverTrip.body.attachedAfter, 1);
  const outsidePath = await request(`/api/maintenance/orders/${order.body.id}/process-folder`, json('POST', { folderPath: 'Incoming/Cairo' }));
  assert.equal(outsidePath.response.status, 400);

  const newEmployee = await request('/api/employees', json('POST', {
    name: 'Parity Payroll Employee', department: 'Management', job_title: 'Supervisor', phone: '01000000000', monthly_salary_cents: 2600000,
  }));
  assert.equal(newEmployee.response.status, 201, JSON.stringify(newEmployee.body));
  assert.equal(newEmployee.body.department, 'Management');
  assert.equal(newEmployee.body.monthly_salary_cents, 2600000);
  const employeeLoginUserId = Number(db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role) VALUES ('parity-employee-login', 'test-hash', 'Parity Employee', 'operations')
  `).run().lastInsertRowid);
  db.prepare('UPDATE employees SET user_id = ? WHERE id = ?').run(employeeLoginUserId, newEmployee.body.id);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run('parity-employee-session-hash', employeeLoginUserId, '2030-01-01T00:00:00.000Z');
  const deactivatedEmployee = await request(`/api/employees/${newEmployee.body.id}`, json('PATCH', { active: false }));
  assert.equal(deactivatedEmployee.response.status, 200);
  assert.equal(deactivatedEmployee.body.active, 0);
  assert.equal(db.prepare('SELECT active FROM users WHERE id = ?').get(employeeLoginUserId).active, 0);
  assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE token_hash = ?').get('parity-employee-session-hash').revoked_at);
  const reactivatedEmployee = await request(`/api/employees/${newEmployee.body.id}`, json('PATCH', { active: true }));
  assert.equal(reactivatedEmployee.response.status, 200);
  assert.equal(reactivatedEmployee.body.active, 1);
  assert.equal(db.prepare('SELECT active FROM users WHERE id = ?').get(employeeLoginUserId).active, 0);
  assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE token_hash = ?').get('parity-employee-session-hash').revoked_at);
  for (const [date, status, overtimeHours] of [
    ['2026-01-05', 'absent', 0], ['2026-01-06', 'absent', 0], ['2026-01-07', 'present', 9],
  ]) {
    const attendance = await request('/api/employees/attendance', json('POST', {
      date, records: [{ employeeId: newEmployee.body.id, status, overtimeHours }],
    }));
    assert.equal(attendance.response.status, 200, JSON.stringify(attendance.body));
  }
  const calculatedPayroll = await request('/api/employees/payroll?month=2026-01');
  const payrollLine = calculatedPayroll.body.lines.find((line) => line.employee_id === newEmployee.body.id);
  assert.equal(payrollLine.present_days, 1);
  assert.equal(payrollLine.absent_days, 2);
  assert.equal(payrollLine.overtime_amount_cents, 150000);
  assert.equal(payrollLine.deductions_cents, 200000);
  assert.equal(payrollLine.net_salary_cents, 2550000);

  const funding = await request('/api/finance/treasury/entries', json('POST', {
    kind: 'income', category: 'Payroll Test Funding', amountCents: 3000000,
  }));
  assert.equal(funding.response.status, 201);
  const finalized = await request('/api/employees/payroll/finalize', json('POST', { month: '2026-01' }));
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.body));
  assert.equal(finalized.body.finalized, true);
  const payrollEntries = await request('/api/finance/treasury');
  assert.ok(payrollEntries.body.entries.some((entry) => entry.category === 'رواتب وأجور' && entry.employee_id === newEmployee.body.id && entry.amount_cents === 2550000));

  const pptx = await request(`/api/maintenance/orders/${order.body.id}/export.pptx`);
  assert.equal(pptx.response.status, 200);
  assert.match(pptx.response.headers.get('content-type'), /presentationml\.presentation/);
  assert.match(pptx.response.headers.get('content-disposition'), /filename\*=UTF-8''MN-1001_Cairo_Report\.pptx/);
  assert.equal(pptx.body.subarray(0, 2).toString(), 'PK');
  const singlePptxEntries = zipEntryNames(pptx.body);
  assert.equal(singlePptxEntries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, areaBound.body.order.cards.length + 2,
    'the compatible per-order route should include a cover, index, and one slide per maintenance card');
  const perOrderIndex = (await readZipEntry(pptx.body, 'ppt/slides/slide2.xml')).toString('utf8');
  assert.match(perOrderIndex, /فهرس الماكينات/);
  assert.doesNotMatch(perOrderIndex, /سبب الصيانة/);
  const noReasonMachineSlide = (await readZipEntry(pptx.body, 'ppt/slides/slide4.xml')).toString('utf8');
  assert.match(noReasonMachineSlide, /After/);
  assert.match(noReasonMachineSlide, /Before/);
  assert.doesNotMatch(noReasonMachineSlide, /سبب الصيانة|الفنيون|ملاحظات فنية|ملاحظات الزيارة|رقم الأمر|MADAR|منجز|مكتمل/);
  const bulkPptx = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [order.body.id], reasonId: reasonList.body[0].id, area: 'cairo', groupBy: 'area', showReasonFooter: true,
  }));
  assert.equal(bulkPptx.response.status, 200, JSON.stringify(bulkPptx.body));
  assert.match(bulkPptx.response.headers.get('content-type'), /presentationml\.presentation/);
  assert.match(bulkPptx.response.headers.get('content-disposition'), /filename\*=UTF-8''Madar_Report_/);
  assert.equal(bulkPptx.body.subarray(0, 2).toString(), 'PK');
  const bulkPptxEntries = zipEntryNames(bulkPptx.body);
  assert.equal(bulkPptxEntries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 4,
    'a filtered, area-grouped deck should contain its cover, index, one divider, and one matching machine slide');
  const machineSlide = (await readZipEntry(bulkPptx.body, 'ppt/slides/slide4.xml')).toString('utf8');
  assert.match(machineSlide, /سبب الصيانة/);
  const exportedPhotoName = bulkPptxEntries.find((name) => name.startsWith('ppt/media/') && name.toLowerCase().endsWith('.jpeg'));
  assert.ok(exportedPhotoName, 'PPTX should contain a derived JPEG photo');
  const exportedPhoto = await readZipEntry(bulkPptx.body, exportedPhotoName);
  const exportedPhotoInfo = await sharp(exportedPhoto).metadata();
  assert.deepEqual({ width: exportedPhotoInfo.width, height: exportedPhotoInfo.height }, { width: 60, height: 120 },
    'exported landscape photos are rotated 90 degrees clockwise in-memory');
  const noMatchingReason = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [order.body.id], reasonId: reasonList.body[1].id, area: null, groupBy: 'none',
  }));
  assert.equal(noMatchingReason.response.status, 404);
  const invalidBulkExport = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [order.body.id, order.body.id], reasonId: null, area: null, groupBy: 'client',
  }));
  assert.equal(invalidBulkExport.response.status, 400);
  const docx = await request(`/api/maintenance/orders/${order.body.id}/export.docx`);
  assert.equal(docx.response.status, 200);
  assert.match(docx.response.headers.get('content-type'), /wordprocessingml\.document/);
  assert.equal(docx.body.subarray(0, 2).toString(), 'PK');
  const warehouseExport = await request('/api/warehouse/export.xlsx');
  assert.equal(warehouseExport.response.status, 200);
  assert.equal(warehouseExport.body.subarray(0, 2).toString(), 'PK');

  const users = await request('/api/auth/users');
  assert.equal(users.response.status, 200);
  assert.ok(users.body.some((user) => user.username === 'admin'));
  const createdUser = await request('/api/auth/users', json('POST', {
    username: 'parity-ops', full_name: 'Parity Operations User', role: 'operations', password: 'phase6-new-user-password',
  }));
  assert.equal(createdUser.response.status, 201, JSON.stringify(createdUser.body));
  const disabledUser = await request(`/api/auth/users/${createdUser.body.id}`, json('DELETE', {}));
  assert.equal(disabledUser.response.status, 200);

  const backup = await request('/api/system/backup', json('POST', {}));
  assert.equal(backup.response.status, 201, JSON.stringify(backup.body));
  assert.ok(backup.body.sizeBytes > 0);
  const backups = await request('/api/system/backups');
  assert.equal(backups.response.status, 200);
  assert.ok(backups.body.some((item) => item.filename === backup.body.filename));
  const backupFile = await request(`/api/system/backups/${encodeURIComponent(backup.body.filename)}/download`);
  assert.equal(backupFile.response.status, 200);
  const restoreForm = new FormData();
  restoreForm.append('file', new Blob([backupFile.body], { type: 'application/zip' }), backup.body.filename);
  const restored = await request('/api/system/backup/restore', { method: 'POST', body: restoreForm });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.restored, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM machines WHERE code LIKE \'PARITY-%\'').get().count, 6);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payroll_runs WHERE month_year = \'2026-01\' AND status = \'finalized\'').get().count, 1);
});

test('maintenance reasons support audited soft deactivation and area analysis exports filtered Excel records', async () => {
  const postRestoreLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  assert.equal(postRestoreLogin.status, 200);
  cookie = (postRestoreLogin.headers.getSetCookie?.()[0] ?? postRestoreLogin.headers.get('set-cookie'))?.split(';', 1)[0];
  assert.ok(cookie);

  const createdReason = await request('/api/maintenance/reasons', json('POST', { name: 'سبب تحليل تجريبي' }));
  assert.equal(createdReason.response.status, 201, JSON.stringify(createdReason.body));
  const reasonId = createdReason.body.id;
  const renamedReason = await request(`/api/maintenance/reasons/${reasonId}`, json('PATCH', { name: 'سبب تحليل معدّل' }));
  assert.equal(renamedReason.response.status, 200);
  assert.equal(renamedReason.body.name, 'سبب تحليل معدّل');

  const createdClient = await request('/api/clients', json('POST', { name: 'Analysis Test Client' }));
  assert.equal(createdClient.response.status, 201);
  const machineOne = await request('/api/maintenance/machines', json('POST', {
    code: 'ANALYSIS-01', name_ar: 'ماكينة التحليل الأولى', area: 'مدينة التحليل',
  }));
  const machineTwo = await request('/api/maintenance/machines', json('POST', {
    code: 'ANALYSIS-02', name_ar: 'ماكينة التحليل الثانية', area: 'مدينة التحليل',
  }));
  assert.equal(machineOne.response.status, 201);
  assert.equal(machineTwo.response.status, 201);
  const order = await request('/api/maintenance/orders', json('POST', {
    clientId: createdClient.body.id,
    area: 'مدينة التحليل',
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(order.response.status, 201, JSON.stringify(order.body));
  const completedCard = order.body.cards.find((card) => card.machine_id === machineOne.body.id);
  const updatedCard = await request(`/api/maintenance/orders/${order.body.id}/cards/${completedCard.id}`, json('PATCH', {
    reasonId,
    notes: 'ملاحظة فنية للاختبار',
  }));
  assert.equal(updatedCard.response.status, 200);
  db.prepare("UPDATE maintenance_orders SET status = 'archived', archived_at = '2026-02-14 12:00:00' WHERE id = ?").run(order.body.id);
  db.prepare("UPDATE maintenance_cards SET status = 'completed' WHERE id = ?").run(completedCard.id);

  const allArchivedPptx = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [], reasonId, area: 'مدينة التحليل', groupBy: 'reason',
  }));
  assert.equal(allArchivedPptx.response.status, 200, JSON.stringify(allArchivedPptx.body));
  assert.match(allArchivedPptx.response.headers.get('content-disposition'), /Madar_Report_/);
  assert.equal(zipEntryNames(allArchivedPptx.body).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 4,
    'an empty orderIds list should include the matching archived card, index, and group divider');

  const queryPptx = await request(`/api/maintenance/export/pptx?orderIds=${order.body.id}&reasonId=${reasonId}&groupBy=reason&showReasonFooter=true`);
  assert.equal(queryPptx.response.status, 200, JSON.stringify(queryPptx.body));
  assert.equal(zipEntryNames(queryPptx.body).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 4,
    'GET query parameters should support an explicit order and optional reason filter');
  const coverSlide = (await readZipEntry(queryPptx.body, 'ppt/slides/slide1.xml')).toString('utf8');
  assert.match(coverSlide, /تقرير صيانة الشهر/);
  assert.match(coverSlide, /ماكينات الصراف الآلي \(ATM Maintenance\)/);
  assert.match(coverSlide, /Periodic ATM Fleet Inspection/);
  assert.match(coverSlide, /فترة التقرير: فبراير 2026/);
  assert.match(coverSlide, /إجمالي الماكينات المشمولة: 1 ماكينة ATM/);
  assert.match(coverSlide, /فهرس المناطق المشمولة بالتقرير/);
  assert.match(coverSlide, /Index of Covered Service Areas/);
  assert.match(coverSlide, /مدينة التحليل/);
  assert.match(coverSlide, /1 ماكينة/);
  assert.match(coverSlide, /ص 2/);
  assert.match(coverSlide, /البنك التجاري الدولي \(CIB\)/);
  assert.doesNotMatch(coverSlide, /MADAR|FIELD MAINTENANCE|رقم الأمر|عدد أوامر الصيانة|عدد الماكينات في التقرير|شهر التقرير/);
  const indexSlide = (await readZipEntry(queryPptx.body, 'ppt/slides/slide2.xml')).toString('utf8');
  assert.match(indexSlide, /فهرس الماكينات/);
  assert.match(indexSlide, /ANALYSIS-01/);
  assert.match(indexSlide, /صفحة/);
  assert.doesNotMatch(indexSlide, /سبب الصيانة/);
  const indexedMachineSlide = (await readZipEntry(queryPptx.body, 'ppt/slides/slide4.xml')).toString('utf8');
  assert.match(indexedMachineSlide, /سبب الصيانة/);
  assert.match(indexedMachineSlide, /After/);
  assert.match(indexedMachineSlide, /Before/);
  assert.doesNotMatch(indexedMachineSlide, /MADAR|رقم الأمر|ماكينة التحليل|الفنيون|ملاحظات فنية|ملاحظات الزيارة|صفحة 4 من/);

  const filteredAnalysis = await request(`/api/maintenance/analysis/areas?from=2026-02-01&to=2026-02-28&reasonId=${reasonId}`);
  assert.equal(filteredAnalysis.response.status, 200, JSON.stringify(filteredAnalysis.body));
  const analysisArea = filteredAnalysis.body.find((area) => area.area === 'مدينة التحليل');
  assert.deepEqual({
    total_count: analysisArea.total_count,
    completed_count: analysisArea.completed_count,
    missing_count: analysisArea.missing_count,
    completion_ratio: analysisArea.completion_ratio,
  }, { total_count: 2, completed_count: 1, missing_count: 1, completion_ratio: 0.5 });
  assert.deepEqual(analysisArea.missing_machines, [{
    id: machineTwo.body.id, code: 'ANALYSIS-02', name_ar: 'ماكينة التحليل الثانية',
  }]);

  const outsideDateRange = await request(`/api/maintenance/analysis/areas?from=2026-03-01&reasonId=${reasonId}`);
  const outsideArea = outsideDateRange.body.find((area) => area.area === 'مدينة التحليل');
  assert.equal(outsideArea.completed_count, 0);
  assert.equal(outsideArea.missing_count, 2);
  assert.equal((await request('/api/maintenance/analysis/areas?from=2026-03-01&to=2026-02-01')).response.status, 400);

  const workbookResponse = await request(`/api/maintenance/analysis/export.xlsx?from=2026-02-01&to=2026-02-28&reasonId=${reasonId}`);
  assert.equal(workbookResponse.response.status, 200);
  assert.match(workbookResponse.response.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.match(workbookResponse.response.headers.get('content-disposition'), /Madar-Maintenance-Analysis\.xlsx/);
  assert.equal(workbookResponse.body.subarray(0, 2).toString(), 'PK');
  const workbook = XLSX.read(workbookResponse.body, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
  assert.deepEqual(rows[0], ['المنطقة / Area', 'كود الماكينة', 'اسم الماكينة', 'رقم أمر الخدمة', 'سبب العطل', 'الملاحظات الفنية', 'تاريخ الخدمة', 'الفنيون المكلفون', 'الحالة']);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'مدينة التحليل');
  assert.equal(rows[1][1], 'ANALYSIS-01');
  assert.equal(rows[1][4], 'سبب تحليل معدّل');
  assert.equal(rows[1][5], 'ملاحظة فنية للاختبار');
  assert.equal(rows[1][8], 'مؤرشف');

  const deactivated = await request(`/api/maintenance/reasons/${reasonId}`, { method: 'DELETE' });
  assert.equal(deactivated.response.status, 200);
  assert.equal(deactivated.body.active, 0);
  assert.equal((await request('/api/maintenance/reasons')).body.some((reason) => reason.id === reasonId), false);
  const allReasons = await request('/api/maintenance/reasons?includeInactive=true');
  assert.equal(allReasons.body.find((reason) => reason.id === reasonId).active, 0);
  const reactivated = await request(`/api/maintenance/reasons/${reasonId}`, json('PATCH', { active: true }));
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.body.active, 1);
  assert.equal(db.prepare('SELECT reason_id FROM maintenance_cards WHERE id = ?').get(completedCard.id).reason_id, reasonId);
  assert.deepEqual(db.prepare(`SELECT action FROM audit_log WHERE entity_type = 'maintenance_reason' AND entity_id = ? ORDER BY id`)
    .all(reasonId).map((entry) => entry.action), ['create', 'update', 'deactivate', 'update']);
});

test('area maintenance notes show the latest eligible note, export styled area groups, and clear notes with audit', async () => {
  const createdClient = await request('/api/clients', json('POST', { name: 'Area Notes Test Client' }));
  assert.equal(createdClient.response.status, 201, JSON.stringify(createdClient.body));

  const createMachine = async (code, nameAr, nameEn = '') => {
    const result = await request('/api/maintenance/machines', json('POST', {
      code, name_ar: nameAr, name_en: nameEn, area: 'Area Notes East',
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const machine = await createMachine('AREA-NOTES-01', 'ماكينة ملاحظات المنطقة', 'Area Notes Machine');
  const emptyMachine = await createMachine('AREA-NOTES-02', 'ماكينة بلا ملاحظات');
  const inactiveMachine = await createMachine('AREA-NOTES-03', 'ماكينة متوقفة');
  db.prepare('UPDATE machines SET active = 0 WHERE id = ?').run(inactiveMachine.id);

  const noteFixtures = [
    { notes: 'ملاحظة قديمة', updatedAt: '2026-01-15 12:00:00' },
    { notes: 'الملاحظة الأحدث', updatedAt: '2026-01-01 12:00:00', archivedAt: '2026-02-15 12:00:00' },
    { notes: 'أمر أُرشف قبل ذلك', updatedAt: '2026-03-01 12:00:00', archivedAt: '2025-01-15 12:00:00' },
    { notes: 'ملاحظة من أمر محذوف', updatedAt: '2027-01-01 12:00:00', deletedAt: '2027-01-02 12:00:00' },
    { notes: '   ', updatedAt: '2028-01-01 12:00:00' },
  ];
  const cards = [];
  for (const [index, fixture] of noteFixtures.entries()) {
    const order = await request('/api/maintenance/orders', json('POST', {
      clientId: createdClient.body.id, area: 'Area Notes East', employeeIds: [], autoPopulateAreaMachines: false,
    }));
    assert.equal(order.response.status, 201, JSON.stringify(order.body));
    const addedCard = await request(`/api/maintenance/orders/${order.body.id}/cards`, json('POST', {
      machineId: machine.id, notes: fixture.notes,
    }));
    assert.equal(addedCard.response.status, 201, JSON.stringify(addedCard.body));
    cards.push({ orderId: order.body.id, cardId: addedCard.body.id });
    db.prepare(`
      UPDATE maintenance_orders
      SET created_at = ?, updated_at = ?, archived_at = ?, deleted_at = ?
      WHERE id = ?
    `).run(
      `2026-01-0${index + 1} 08:00:00`, fixture.updatedAt, fixture.archivedAt ?? null, fixture.deletedAt ?? null, order.body.id,
    );
  }
  db.prepare('UPDATE maintenance_cards SET notes = ? WHERE id = ?').run('   ', cards.at(-1).cardId);

  const listing = await request('/api/maintenance/area-notes');
  assert.equal(listing.response.status, 200, JSON.stringify(listing.body));
  const group = listing.body.find((item) => item.area === 'Area Notes East');
  assert.ok(group);
  assert.deepEqual(group.machines.map((item) => item.code), ['AREA-NOTES-01', 'AREA-NOTES-02']);
  assert.equal(group.machines[0].notes, 'الملاحظة الأحدث', 'archived_at wins over a later updated_at, and deleted/blank-note orders are excluded');
  assert.equal(group.machines[1].notes, '');
  assert.equal(listing.body.flatMap((item) => item.machines).some((item) => item.id === inactiveMachine.id), false);

  const allExport = await request('/api/maintenance/area-notes/export.xlsx');
  assert.equal(allExport.response.status, 200);
  assert.match(allExport.response.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.match(allExport.response.headers.get('content-disposition'), /Madar-Area-Maintenance\.xlsx/);
  assert.equal(allExport.body.subarray(0, 2).toString(), 'PK');
  const allWorkbook = XLSX.read(allExport.body, { type: 'buffer', cellStyles: true });
  const allSheet = allWorkbook.Sheets[allWorkbook.SheetNames[0]];
  assert.equal(allSheet['!merges'].length, listing.body.length);
  const styleXml = (await readZipEntry(allExport.body, 'xl/styles.xml')).toString('utf8');
  const sheetXml = (await readZipEntry(allExport.body, 'xl/worksheets/sheet1.xml')).toString('utf8');
  assert.match(styleXml, /174F63/, 'area banner fill color should be written into the workbook styles');
  assert.match(styleXml, /DCEBF0/, 'table header fill color should be written into the workbook styles');
  assert.match(sheetXml, /mergeCell ref="A\d+:D\d+"/);
  assert.match(sheetXml, /r="A1" s="\d+"/, 'the merged area banner cell should have a style');

  const filteredExport = await request(`/api/maintenance/area-notes/export.xlsx?area=${encodeURIComponent('Area Notes East')}`);
  assert.equal(filteredExport.response.status, 200);
  const filteredWorkbook = XLSX.read(filteredExport.body, { type: 'buffer' });
  const filteredSheet = filteredWorkbook.Sheets[filteredWorkbook.SheetNames[0]];
  const exportRows = XLSX.utils.sheet_to_json(filteredSheet, { header: 1, defval: '' });
  assert.deepEqual(filteredSheet['!merges'], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }]);
  assert.deepEqual(exportRows[0], ['المنطقة: Area Notes East', '', '', '']);
  assert.deepEqual(exportRows[1], ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات']);
  assert.deepEqual(exportRows[2], ['AREA-NOTES-01', 'ماكينة ملاحظات المنطقة', 'Area Notes Machine', 'الملاحظة الأحدث']);
  assert.equal(exportRows[3][0], 'AREA-NOTES-02');
  assert.equal((await request('/api/maintenance/area-notes/export.xlsx?area=%20')).response.status, 400);

  const cleared = await request(`/api/maintenance/machines/${machine.id}/maintenance-note`, { method: 'DELETE' });
  assert.equal(cleared.response.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.clearedCount, noteFixtures.length);
  assert.deepEqual(db.prepare('SELECT notes FROM maintenance_cards WHERE machine_id = ? ORDER BY id').all(machine.id)
    .map((card) => card.notes), noteFixtures.map(() => ''));
  const clearAudit = db.prepare(`
    SELECT actor_id, action, entity_type, entity_id, old_values_json, new_values_json
    FROM audit_log WHERE action = 'clear_notes' AND entity_type = 'maintenance_card'
      AND entity_id IN (${cards.map(() => '?').join(', ')}) ORDER BY entity_id
  `).all(...cards.map((card) => card.cardId));
  assert.equal(clearAudit.length, noteFixtures.length);
  assert.ok(clearAudit.every((entry) => entry.actor_id !== null && entry.new_values_json === JSON.stringify({ notes: '' })));
  assert.deepEqual(clearAudit.map((entry) => entry.old_values_json).sort(), noteFixtures.map((fixture) => JSON.stringify({ notes: fixture.notes })).sort());
  assert.equal((await request('/api/maintenance/machines/999999/maintenance-note', { method: 'DELETE' })).response.status, 404);
});
