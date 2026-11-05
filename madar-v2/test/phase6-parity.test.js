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

const [{ app }, { db }, { initializeDatabase }, { classifyMachinePhotos, matchMachineFolder, matchMachineFolderGroups, normalizeMachineFolderName }, { renameAreaSourceDirectory }, { compareMachineCodes, compareMachineNames, compareMaintenanceAreas, normalizeArabicSortKey }, { buildAreaMaintenanceNotesWorkbook }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/maintenance/trip-folder.js'),
  import('../server/modules/maintenance/service.js'),
  import('../server/modules/maintenance/sorting.js'),
  import('../server/modules/maintenance/area-notes.js'),
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

function pptxTextValues(xml) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map((match) => match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'"));
}

async function writePptxPhotoFixture(relativePath, background = '#d94841', { width = 60, height = 120 } = {}) {
  const absolutePath = join(storageRoot, ...relativePath.split('/'));
  mkdirSync(join(storageRoot, ...relativePath.split('/').slice(0, -1)), { recursive: true });
  const buffer = await sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
  writeFileSync(absolutePath, buffer);
  return { path: relativePath, buffer };
}

test('empty maintenance archive returns the localized no-photo export error', async () => {
  const result = await request('/api/maintenance/export/pptx', json('POST', { orderIds: [] }));
  assert.equal(result.response.status, 404);
  assert.equal(result.body.error, 'لا توجد بطاقات صيانة تحتوي على صور للأوامر والفلاتر المحددة.');
});

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
  assert.equal(normalizeMachineFolderName('بنزينة ٢'), normalizeMachineFolderName('بنزينه 2'));
  const numericMatcherMachines = [{ id: 847, code: '847', name_ar: 'شركة بنزينة دمياط 2', name_en: 'Damietta Branch 2' }];
  assert.equal(matchMachineFolder('ATM ماكينة شركه بنزينه دمياط2 ٠٨٤٧', numericMatcherMachines)?.id, 847);
  const dunesMachines = [
    { id: 1, code: '1', name_ar: 'فرع القطامية ديونز', name_en: 'Kattamya Dunes BR' },
    { id: 1045, code: '1045', name_ar: 'كومباوند القطامية ديونز', name_en: 'Kattamya Dunes Compound' },
  ];
  for (const folder of ['وطنية 1', 'سنتر 1', 'فرع الرحاب 1', 'فرع طيبه 1', 'فرع ميديكير 1', 'موبيل التجمع الاول 1', 'موبيل النرجس 1', 'مول الطبي 1', 'ارابيلا 1', 'الجامعة 1', 'اولا 1 اخر التجمع 1', 'مول o1']) {
    assert.equal(matchMachineFolder(folder, dunesMachines), null, `${folder} must not match short code 1`);
  }
  assert.equal(matchMachineFolder('1', dunesMachines)?.id, 1);
  assert.equal(matchMachineFolder('ATM 1', dunesMachines)?.id, 1);
  assert.equal(matchMachineFolder('Code 1', dunesMachines)?.id, 1);
  assert.equal(matchMachineFolder('فرع ديونز', dunesMachines)?.id, 1);
  assert.equal(matchMachineFolder('كومباوند القطامية ديونز', dunesMachines)?.id, 1045);
  assert.equal(matchMachineFolder('1', [
    { id: 11, code: '1', name_ar: 'فرع أول', name_en: '' },
    { id: 12, code: '01', name_ar: 'فرع ثاني', name_en: '' },
  ]), null, 'ambiguous short numeric codes must be rejected instead of choosing an arbitrary machine');
  const duplicateNameMatches = matchMachineFolderGroups(['PARITY-02', 'ماكينة الاختبار الثانية'], matcherMachines);
  assert.equal(duplicateNameMatches[0].machine?.id, 4);
  assert.equal(duplicateNameMatches[0].duplicate, false);
  assert.equal(duplicateNameMatches[1].machine, null);
  assert.equal(duplicateNameMatches[1].duplicate, true);
  assert.equal(duplicateNameMatches[1].duplicateOfFolder, 'PARITY-02');

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
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(join(sourceDirectory, `before-${index}.png`), sourcePhoto);
  }
  const folderImport = await request(`/api/maintenance/orders/${order.body.id}/import-server-folder`, json('POST', { folderPath: 'Incoming/Cairo' }));
  assert.equal(folderImport.response.status, 200, JSON.stringify(folderImport.body));
  assert.equal(folderImport.body.attachedBefore, 5);
  const refreshedOrder = await request(`/api/maintenance/orders/${order.body.id}`);
  const photoCard = refreshedOrder.body.cards.find((item) => item.machine_code === 'PARITY-01');
  assert.equal(photoCard.before_photos.length, 5);
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

  const multiReasonUpdate = await request(`/api/maintenance/orders/${order.body.id}/cards/${card.id}`, json('PATCH', {
    reasonIds: [reasonList.body[0].id, reasonList.body[1].id],
  }));
  assert.equal(multiReasonUpdate.response.status, 200);
  assert.equal(multiReasonUpdate.body.reason_id, reasonList.body[0].id);
  assert.deepEqual(multiReasonUpdate.body.reason_ids, [reasonList.body[0].id, reasonList.body[1].id]);
  assert.equal(multiReasonUpdate.body.reason_names.length, 2);
  assert.match(multiReasonUpdate.body.reason_name, new RegExp(reasonList.body[0].name));
  assert.match(multiReasonUpdate.body.reason_name, new RegExp(reasonList.body[1].name));

  const persistentFieldsUpdate = await request(`/api/maintenance/orders/${order.body.id}/cards/${card.id}`, json('PATCH', {
    reasonIds: [reasonList.body[0].id, reasonList.body[1].id],
    notes: 'ملاحظة تُحفظ قبل إعادة التحميل',
  }));
  assert.equal(persistentFieldsUpdate.response.status, 200);
  const reloadedCard = await request(`/api/maintenance/orders/${order.body.id}`);
  const persistedCard = reloadedCard.body.cards.find((item) => item.id === card.id);
  assert.deepEqual(persistedCard.reason_ids, [reasonList.body[0].id, reasonList.body[1].id]);
  assert.equal(persistedCard.notes, 'ملاحظة تُحفظ قبل إعادة التحميل');

  // Reset back to single reason for downstream PPTX filter tests
  await request(`/api/maintenance/orders/${order.body.id}/cards/${card.id}`, json('PATCH', { reasonId: reasonList.body[0].id }));

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
    ...Array.from({ length: 101 }, (_, index) => [
      `Weekend Trip/Mystery Terminal/Before/extra-${index}.png`, sourcePhoto,
    ]),
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
  assert.equal(arabicNameCard.before_photos.length, 8);
  assert.equal(arabicNameCard.after_photos.length, 1);
  const numberedReasonsUpdate = await request(`/api/maintenance/orders/${order.body.id}/cards/${arabicNameCard.id}`, json('PATCH', {
    reasonIds: [reasonList.body[0].id, reasonList.body[1].id],
  }));
  assert.equal(numberedReasonsUpdate.response.status, 200);
  const multipleReasonsPptx = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [order.body.id], reasonId: reasonList.body[0].id,
  }));
  assert.equal(multipleReasonsPptx.response.status, 200, JSON.stringify(multipleReasonsPptx.body));
  const multipleReasonsSlides = zipEntryNames(multipleReasonsPptx.body)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const multipleReasonsSlide = (await Promise.all(multipleReasonsSlides.map((name) => readZipEntry(multipleReasonsPptx.body, name))))
    .map((contents) => contents.toString('utf8'))
    .find((slide) => slide.includes(reasonList.body[0].name) && slide.includes(reasonList.body[1].name));
  assert.ok(multipleReasonsSlide, 'the machine slide should include both reasons');
  assert.ok(multipleReasonsSlide.includes(`1. ${reasonList.body[0].name}`));
  assert.ok(multipleReasonsSlide.includes(`2. ${reasonList.body[1].name}`));
  assert.match(multipleReasonsSlide, /<a:pPr[^>]*rtl="1"/);
  assert.match(multipleReasonsSlide, /sz="1250"/);
  const restoreSingleReason = await request(`/api/maintenance/orders/${order.body.id}/cards/${arabicNameCard.id}`, json('PATCH', {
    reasonId: reasonList.body[0].id,
  }));
  assert.equal(restoreSingleReason.response.status, 200);
  const matchedSourcePhoto = await request(arabicNameCard.before_photo_urls[0]);
  assert.equal(matchedSourcePhoto.response.status, 200);
  assert.deepEqual(matchedSourcePhoto.body, sourcePhoto);
  const unmatchedReview = processedTrip.body.order.unmatched_folders[0];
  assert.equal(unmatchedReview.folder_name, 'Mystery Terminal');
  assert.equal(unmatchedReview.photo_count, 103);
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
  assert.equal(boundCard.before_photos.length, 102);
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

  const clientLinkedMachine = await request('/api/maintenance/machines', json('POST', {
    code: 'LINKED-07', name_ar: 'ماكينة عميل في منطقة أخرى', name_en: 'Client Linked Other Area', area: 'Alexandria',
  }));
  assert.equal(clientLinkedMachine.response.status, 201, JSON.stringify(clientLinkedMachine.body));
  db.prepare('INSERT OR IGNORE INTO client_machines (client_id, machine_id, site_area) VALUES (?, ?, ?)')
    .run(clientId, clientLinkedMachine.body.id, 'Cairo');
  const clientLinkedOrder = await request('/api/maintenance/orders', json('POST', {
    clientId, area: 'Cairo', employeeIds: [], autoPopulateAreaMachines: false,
  }));
  assert.equal(clientLinkedOrder.response.status, 201, JSON.stringify(clientLinkedOrder.body));
  const linkedMachineFolder = join(storageRoot, 'Areas', 'Client Linked', 'LINKED-07');
  mkdirSync(join(linkedMachineFolder, 'Before'), { recursive: true });
  mkdirSync(join(linkedMachineFolder, 'After'), { recursive: true });
  writeFileSync(join(linkedMachineFolder, 'Before', 'before.png'), sourcePhoto);
  writeFileSync(join(linkedMachineFolder, 'After', 'after.png'), sourcePhoto);
  const linkedMachineTrip = await request(`/api/maintenance/orders/${clientLinkedOrder.body.id}/process-folder`, json('POST', {
    folderPath: 'Areas/Client Linked',
  }));
  assert.equal(linkedMachineTrip.response.status, 200, JSON.stringify(linkedMachineTrip.body));
  assert.equal(linkedMachineTrip.body.matchedMachineCount, 0, 'machines outside the order areas must not be candidates, even when linked to the client');
  assert.equal(linkedMachineTrip.body.unmatchedFolderCount, 1);
  assert.ok(!linkedMachineTrip.body.order.cards.some((item) => item.machine_code === 'LINKED-07'));
  assert.ok(linkedMachineTrip.body.order.unmatched_folders.some((item) => item.folder_name === 'LINKED-07'));

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

  const pendingMachine = await request('/api/maintenance/machines', json('POST', {
    code: 'PARITY-PENDING', name_ar: 'ماكينة معلقة بدون صور', name_en: 'Pending Photo Machine', area: 'Cairo',
  }));
  assert.equal(pendingMachine.response.status, 201);
  const pendingCard = await request(`/api/maintenance/orders/${order.body.id}/cards`, json('POST', {
    machineId: pendingMachine.body.id,
  }));
  assert.equal(pendingCard.response.status, 201);
  assert.equal(pendingCard.body.status, 'pending');
  assert.equal(pendingCard.body.before_photos.length + pendingCard.body.after_photos.length, 0);

  const noCardOrder = await request('/api/maintenance/orders', json('POST', {
    clientId, area: 'Cairo', employeeIds: [], autoPopulateAreaMachines: false,
  }));
  assert.equal(noCardOrder.response.status, 201);
  const noCompletedPptx = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [noCardOrder.body.id],
  }));
  assert.equal(noCompletedPptx.response.status, 404);
  assert.equal(noCompletedPptx.body.error, 'لا توجد بطاقات صيانة تحتوي على صور للأوامر والفلاتر المحددة.');

  const pptx = await request(`/api/maintenance/orders/${order.body.id}/export.pptx`);
  assert.equal(pptx.response.status, 200);
  assert.match(pptx.response.headers.get('content-type'), /presentationml\.presentation/);
  assert.match(pptx.response.headers.get('content-disposition'), /filename\*=UTF-8''MN-1001_Cairo_Report\.pptx/);
  assert.equal(pptx.body.subarray(0, 2).toString(), 'PK');
  const singlePptxEntries = zipEntryNames(pptx.body);
  const latestOrder = await request(`/api/maintenance/orders/${order.body.id}`);
  const completedCardCount = latestOrder.body.cards.filter((item) => item.status === 'completed').length;
  assert.equal(singlePptxEntries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, completedCardCount + 3,
    'the per-order deck should include a cover, index, mandatory area divider, and one slide per completed card only');
  const coverSlide = (await readZipEntry(pptx.body, 'ppt/slides/slide1.xml')).toString('utf8');
  assert.match(coverSlide, new RegExp(`إجمالي الماكينات المشمولة: ${completedCardCount} ماكينة ATM`));
  assert.doesNotMatch(coverSlide, /PARITY-PENDING|ماكينة معلقة بدون صور/);
  const perOrderDivider = (await readZipEntry(pptx.body, 'ppt/slides/slide2.xml')).toString('utf8');
  assert.match(perOrderDivider, /Cairo/);
  const perOrderIndex = (await readZipEntry(pptx.body, 'ppt/slides/slide3.xml')).toString('utf8');
  assert.match(perOrderIndex, /فهرس الماكينات/);
  assert.match(perOrderIndex, /Cairo/);
  assert.match(perOrderIndex, /hlinkClick/, 'machine index numbers and slide numbers should be clickable');
  assert.doesNotMatch(perOrderIndex, /PARITY-PENDING|ماكينة معلقة بدون صور/);
  assert.doesNotMatch(perOrderIndex, /سبب الصيانة/);
  const presentationSlides = singlePptxEntries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  for (const slideName of presentationSlides) {
    const slide = (await readZipEntry(pptx.body, slideName)).toString('utf8');
    assert.doesNotMatch(slide, /PARITY-PENDING|ماكينة معلقة بدون صور/);
    assert.doesNotMatch(slide, /سبب الصيانة/);
  }
  const noReasonMachineSlide = (await readZipEntry(pptx.body, 'ppt/slides/slide4.xml')).toString('utf8');
  assert.match(noReasonMachineSlide, /After/);
  assert.match(noReasonMachineSlide, /Before/);
  assert.doesNotMatch(noReasonMachineSlide, /سبب الصيانة|الفنيون|ملاحظات فنية|ملاحظات الزيارة|رقم الأمر|MADAR|منجز|مكتمل/);
  assert.match(noReasonMachineSlide, /صفحة 4 من/);
  const floatingBadgeShape = noReasonMachineSlide.split('<p:sp>')
    .find((shape) => shape.includes('<a:off x="10012680" y="6345936"/>'));
  assert.ok(floatingBadgeShape, 'machine slide should include the page-number badge at the specified bottom-right position');
  assert.match(floatingBadgeShape, /<a:prstGeom prst="roundRect"/);
  assert.match(floatingBadgeShape, /outerShdw/, 'the badge card should render with an elevated drop shadow');
  const pageCounterShape = noReasonMachineSlide.split('<p:sp>').find((shape) => shape.includes('صفحة 4 من'));
  assert.match(pageCounterShape, /sz="1050"/, 'badge page text should use the larger 10.5 pt font');
  assert.match(pageCounterShape, /b="1"/, 'badge page text should be bold');
  const bulkPptx = await request('/api/maintenance/export/pptx', {
    ...json('POST', {
      orderIds: [order.body.id], reasonId: reasonList.body[0].id, area: 'cairo', groupBy: 'area', showReasonFooter: true,
    }),
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
  });
  assert.equal(bulkPptx.response.status, 200, JSON.stringify(bulkPptx.body));
  assert.equal(bulkPptx.response.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.match(bulkPptx.response.headers.get('access-control-expose-headers') ?? '', /Content-Disposition/i);
  assert.match(bulkPptx.response.headers.get('content-type'), /presentationml\.presentation/);
  assert.match(bulkPptx.response.headers.get('content-disposition'), /filename\*=UTF-8''Madar_Report_/);
  assert.equal(bulkPptx.body.subarray(0, 2).toString(), 'PK');
  const bulkPptxEntries = zipEntryNames(bulkPptx.body);
  assert.equal(bulkPptxEntries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 4,
    'a filtered, area-grouped deck should contain its cover, index, one divider, and one matching machine slide');
  const machineSlide = (await readZipEntry(bulkPptx.body, 'ppt/slides/slide4.xml')).toString('utf8');
  assert.match(machineSlide, /1\./);
  assert.ok(machineSlide.includes(reasonList.body[0].name), 'the filtered machine slide should show its maintenance reason under the machine name');
  const coverSlideXml = (await readZipEntry(bulkPptx.body, 'ppt/slides/slide1.xml')).toString('utf8');
  assert.match(coverSlideXml, /hlinkClick/, 'area page number on the cover should be clickable');
  const indexSlideXml = (await readZipEntry(bulkPptx.body, 'ppt/slides/slide3.xml')).toString('utf8');
  assert.match(indexSlideXml, /hlinkClick/, 'machine number and page number should link to the machine slide');
  const exportedMedia = await Promise.all(bulkPptxEntries
    .filter((name) => name.startsWith('ppt/media/') && name.toLowerCase().endsWith('.jpeg'))
    .map(async (name) => {
      const buffer = await readZipEntry(bulkPptx.body, name);
      return { buffer, metadata: await sharp(buffer).metadata() };
    }));
  assert.ok(exportedMedia.some(({ metadata }) => metadata.width === 60 && metadata.height === 120),
    'PPTX should contain a derived JPEG photo with the expected portrait orientation');
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
  const docxXml = (await readZipEntry(docx.body, 'word/document.xml')).toString('utf8');
  assert.match(docxXml, /تقرير الصيانة الميدانية الشامل للرحلة/);
  assert.match(docxXml, /بطاقات الماكينات المكتملة الفحص والتوثيق/);
  assert.match(docxXml, /ماكينات غير مشمولة في المجلد \/ لم يتم فحصها بالرحلة/);
  assert.match(docxXml, /مجلدات الرحلة غير المطابقة \(تحتاج مراجعة\)/);
  assert.match(docxXml, /PARITY-PENDING/);
  assert.match(docxXml, /Mystery Side/);
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
  const unauthenticatedSystemHealth = await fetch(`${baseUrl}/api/system/health`);
  assert.equal(unauthenticatedSystemHealth.status, 401);
  const systemHealth = await request('/api/system/health');
  assert.equal(systemHealth.response.status, 200, JSON.stringify(systemHealth.body));
  assert.equal(systemHealth.body.database.status, 'ok');
  assert.ok(systemHealth.body.uptimeSeconds >= 0);
  assert.ok(systemHealth.body.storage.totalBytes > 0);
  assert.ok(systemHealth.body.storage.availableBytes >= 0);
  assert.ok(Number.isFinite(systemHealth.body.storage.freePercent));
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
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM machines WHERE code LIKE \'PARITY-%\'').get().count, 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payroll_runs WHERE month_year = \'2026-01\' AND status = \'finalized\'').get().count, 1);

  const postRestoreIndexLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  assert.equal(postRestoreIndexLogin.status, 200);
  cookie = (postRestoreIndexLogin.headers.getSetCookie?.()[0] ?? postRestoreIndexLogin.headers.get('set-cookie'))?.split(';', 1)[0];
  const indexClient = await request('/api/clients', json('POST', { name: 'Index Pagination Client' }));
  assert.equal(indexClient.response.status, 201, JSON.stringify(indexClient.body));
  const indexOrder = await request('/api/maintenance/orders', json('POST', {
    clientId: indexClient.body.id, area: 'الإسكندرية', employeeIds: [], autoPopulateAreaMachines: false,
  }));
  assert.equal(indexOrder.response.status, 201);
  const indexBetaOrder = await request('/api/maintenance/orders', json('POST', {
    clientId: indexClient.body.id, area: 'القاهرة الكبرى', employeeIds: [], autoPopulateAreaMachines: false,
  }));
  assert.equal(indexBetaOrder.response.status, 201);
  const indexPhoto = await writePptxPhotoFixture('Maintenance/Export Fixtures/index-photo.jpg');
  const indexFixtureCards = [];
  for (const [area, count, prefix] of [['الإسكندرية', 16, 'INDEX-ALEX'], ['القاهرة الكبرى', 1, 'INDEX-CAIRO']]) {
    const areaOrder = area === 'الإسكندرية' ? indexOrder : indexBetaOrder;
    for (let index = 1; index <= count; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const machine = await request('/api/maintenance/machines', json('POST', {
        code: `${prefix}-${suffix}`, name_ar: `ماكينة فهرس ${area} ${index}`, name_en: `${area} Machine ${index}`, area,
      }));
      assert.equal(machine.response.status, 201, JSON.stringify(machine.body));
      const card = await request(`/api/maintenance/orders/${areaOrder.body.id}/cards`, json('POST', { machineId: machine.body.id }));
      assert.equal(card.response.status, 201, JSON.stringify(card.body));
      db.prepare("UPDATE maintenance_cards SET status = 'completed', before_photos_json = ? WHERE id = ?")
        .run(JSON.stringify([indexPhoto.path]), card.body.id);
      indexFixtureCards.push(card.body.id);
    }
  }
  const areaPaginatedPptx = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [indexOrder.body.id, indexBetaOrder.body.id], groupBy: 'area',
  }));
  assert.equal(areaPaginatedPptx.response.status, 200, JSON.stringify(areaPaginatedPptx.body));
  const areaPaginatedNames = zipEntryNames(areaPaginatedPptx.body);
  const areaPaginatedSlideNames = areaPaginatedNames.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(areaPaginatedSlideNames.length, 23, 'each region should contain a divider, its own index pages, and its machine slides');
  const alexandriaDivider = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/slide2.xml')).toString('utf8');
  assert.match(alexandriaDivider, /الإسكندرية/);
  assert.match(alexandriaDivider, /16 ماكينة ATM/);
  assert.match(alexandriaDivider, /صفحة 2 من 23/);
  const alexandriaIndexFirst = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/slide3.xml')).toString('utf8');
  const alexandriaIndexSecond = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/slide4.xml')).toString('utf8');
  assert.match(alexandriaIndexFirst, /الإسكندرية/);
  assert.match(alexandriaIndexFirst, /صفحة 1 من 2/);
  assert.doesNotMatch(alexandriaIndexFirst, /INDEX-CAIRO/);
  assert.match(alexandriaIndexSecond, /الإسكندرية/);
  assert.match(alexandriaIndexSecond, /صفحة 2 من 2/);
  assert.doesNotMatch(alexandriaIndexSecond, /INDEX-CAIRO/);
  const alexandriaIndexRels = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/_rels/slide3.xml.rels')).toString('utf8');
  assert.match(alexandriaIndexRels, /slide5\.xml/, 'machine index hyperlinks target machine slides after the region index');
  const areaCoverLinks = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/_rels/slide1.xml.rels')).toString('utf8');
  assert.match(areaCoverLinks, /slide2\.xml/, 'cover navigation should target the first geographic area divider');
  const cairoDivider = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/slide21.xml')).toString('utf8');
  assert.match(cairoDivider, /القاهرة الكبرى/);
  assert.match(cairoDivider, /1 ماكينة ATM/);
  assert.match(cairoDivider, /صفحة 21 من 23/);
  const cairoIndex = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/slide22.xml')).toString('utf8');
  assert.match(cairoIndex, /القاهرة الكبرى/);
  assert.match(cairoIndex, /صفحة 1 من 1/);
  assert.doesNotMatch(cairoIndex, /INDEX-ALEX/);
  const lastAlexandriaMachine = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/slide20.xml')).toString('utf8');
  assert.match(lastAlexandriaMachine, /صفحة 20 من 23/);
  const cairoMachine = (await readZipEntry(areaPaginatedPptx.body, 'ppt/slides/slide23.xml')).toString('utf8');
  assert.match(cairoMachine, /صفحة 23 من 23/);
  assert.equal(indexFixtureCards.length, 17);
});

test('asynchronous maintenance PPTX exports return 202 and expose the completed report for download', async () => {
  const area = 'منطقة التصدير غير المتزامن';
  let machineId = null;
  let orderId = null;
  try {
    const client = await request('/api/clients', json('POST', { name: 'Async PPTX Test Client' }));
    assert.equal(client.response.status, 201, JSON.stringify(client.body));
    const machine = await request('/api/maintenance/machines', json('POST', {
      code: 'ASYNC-PPTX-01',
      name_ar: 'ماكينة التصدير غير المتزامن',
      name_en: 'Async Export Machine',
      area,
    }));
    assert.equal(machine.response.status, 201, JSON.stringify(machine.body));
    machineId = machine.body.id;
    const order = await request('/api/maintenance/orders', json('POST', {
      clientId: client.body.id,
      areas: [area],
      employeeIds: [],
      autoPopulateAreaMachines: true,
    }));
    assert.equal(order.response.status, 201, JSON.stringify(order.body));
    orderId = order.body.id;
    const card = order.body.cards.find((entry) => entry.machine_id === machineId);
    assert.ok(card);
    const photo = await writePptxPhotoFixture('Maintenance/Export Fixtures/async-export.jpg', '#3a86ff');
    db.prepare(`UPDATE maintenance_cards
      SET status = 'completed', before_photos_json = ?, after_photos_json = '[]' WHERE id = ?`)
      .run(JSON.stringify([photo.path]), card.id);
    db.prepare(`UPDATE maintenance_orders
      SET status = 'archived', archived_at = '2031-04-07 12:00:00', updated_at = '2031-04-07 12:00:00'
      WHERE id = ?`).run(orderId);

    const exportId = 'phase6-async-pptx-export';
    const accepted = await request('/api/maintenance/export/pptx', json('POST', {
      orderIds: [orderId], mode: 'async', exportId,
    }));
    assert.equal(accepted.response.status, 202, JSON.stringify(accepted.body));
    assert.deepEqual(accepted.body, { ok: true, status: 'processing', exportId });

    const deadline = Date.now() + 15_000;
    let progress = null;
    while (Date.now() < deadline) {
      const result = await request(`/api/maintenance/export/pptx/progress?exportId=${encodeURIComponent(exportId)}`);
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      progress = result.body;
      if (progress?.ready || progress?.error) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(progress?.ready, progress?.error || 'the async PPTX report should reach ready state');
    assert.equal(progress.active, false);
    assert.equal(progress.percent, 100);
    assert.equal(progress.total, 1);
    assert.equal(progress.current, 1);
    assert.equal(progress.downloadUrl, `/api/maintenance/export/pptx/download/${encodeURIComponent(exportId)}`);

    const downloaded = await request(progress.downloadUrl);
    assert.equal(downloaded.response.status, 200);
    assert.match(downloaded.response.headers.get('content-type'), /presentationml\.presentation/);
    assert.match(downloaded.response.headers.get('content-disposition'), /filename\*=UTF-8''Madar_Report_/);
    assert.equal(downloaded.body.subarray(0, 2).toString(), 'PK');

    const expiredOrMissing = await request('/api/maintenance/export/pptx/download/not-a-real-export');
    assert.equal(expiredOrMissing.response.status, 404);
    const reusedId = await request('/api/maintenance/export/pptx', json('POST', {
      orderIds: [orderId], mode: 'async', exportId,
    }));
    assert.equal(reusedId.response.status, 409);

    const missingId = await request('/api/maintenance/export/pptx', json('POST', {
      orderIds: [orderId], mode: 'async',
    }));
    assert.equal(missingId.response.status, 400);
    const failedExportId = 'phase6-async-pptx-error';
    const failedExportAccepted = await request('/api/maintenance/export/pptx', json('POST', {
      orderIds: [orderId], groupBy: 'invalid', mode: 'async', exportId: failedExportId,
    }));
    assert.equal(failedExportAccepted.response.status, 202);
    let failureProgress = null;
    const failureDeadline = Date.now() + 5_000;
    while (Date.now() < failureDeadline) {
      const result = await request(`/api/maintenance/export/pptx/progress?exportId=${encodeURIComponent(failedExportId)}`);
      failureProgress = result.body;
      if (failureProgress?.error) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(failureProgress?.error, 'groupBy must be reason, area, or none.');
    assert.equal(failureProgress.active, false);
  } finally {
    if (orderId) db.prepare('UPDATE maintenance_orders SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(orderId);
    if (machineId) db.prepare('UPDATE machines SET active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(machineId);
    rmSync(join(storageRoot, 'Areas', area), { recursive: true, force: true });
  }
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
  const analysisPhoto = await writePptxPhotoFixture('Maintenance/Export Fixtures/analysis-photo.jpg', '#1f77b4');
  db.prepare("UPDATE maintenance_cards SET before_photos_json = ? WHERE id = ?")
    .run(JSON.stringify([analysisPhoto.path]), completedCard.id);
  db.prepare("UPDATE maintenance_orders SET status = 'archived', archived_at = '2026-02-14 12:00:00' WHERE id = ?").run(order.body.id);
  db.prepare("UPDATE maintenance_cards SET status = 'completed' WHERE id = ?").run(completedCard.id);

  const allArchivedPptx = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [], reasonId, area: 'مدينة التحليل', groupBy: 'reason',
  }));
  assert.equal(allArchivedPptx.response.status, 200, JSON.stringify(allArchivedPptx.body));
  assert.match(allArchivedPptx.response.headers.get('content-disposition'), /Madar_Report_/);
  assert.equal(zipEntryNames(allArchivedPptx.body).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 5,
    'an empty orderIds list should include the matching archived card, index, area divider, and reason divider');

  const queryPptx = await request(`/api/maintenance/export/pptx?orderIds=${order.body.id}&reasonId=${reasonId}&groupBy=reason&showReasonFooter=true`);
  assert.equal(queryPptx.response.status, 200, JSON.stringify(queryPptx.body));
  assert.equal(zipEntryNames(queryPptx.body).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 5,
    'GET query parameters should support an explicit order and optional reason filter with mandatory area divider');
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
  const areaDividerSlide = (await readZipEntry(queryPptx.body, 'ppt/slides/slide2.xml')).toString('utf8');
  assert.match(areaDividerSlide, /مدينة التحليل/);
  assert.match(areaDividerSlide, /صفحة 2 من 5/);
  const indexSlide = (await readZipEntry(queryPptx.body, 'ppt/slides/slide3.xml')).toString('utf8');
  assert.match(indexSlide, /فهرس الماكينات/);
  assert.match(indexSlide, /ANALYSIS-01/);
  assert.match(indexSlide, /صفحة/);
  assert.doesNotMatch(indexSlide, /سبب الصيانة/);
  const reasonDividerSlide = (await readZipEntry(queryPptx.body, 'ppt/slides/slide4.xml')).toString('utf8');
  assert.match(reasonDividerSlide, /الأسباب/);
  assert.match(reasonDividerSlide, /صفحة 4 من 5/);
  const indexedMachineSlide = (await readZipEntry(queryPptx.body, 'ppt/slides/slide5.xml')).toString('utf8');
  assert.ok(indexedMachineSlide.includes('1. سبب تحليل معدّل'));
  assert.match(indexedMachineSlide, /sz="1550"/);
  assert.match(indexedMachineSlide, /<a:pPr[^>]*rtl="1"/);
  assert.match(indexedMachineSlide, /<a:off x="1645920" y="146304"\/><a:ext cx="6035040" cy="777240"\/>/);
  assert.match(indexedMachineSlide, /<a:off x="7863840" y="164592"\/><a:ext cx="3931920" cy="685800"\/>/);
  assert.match(indexedMachineSlide, /<a:off x="6071616" y="1234440"\/><a:ext cx="36576" cy="5166360"\/>/);
  assert.match(indexedMachineSlide, /algn="ctr"/);
  assert.doesNotMatch(indexedMachineSlide, /سبب الصيانة/);
  assert.match(indexedMachineSlide, /After/);
  assert.match(indexedMachineSlide, /Before/);
  assert.doesNotMatch(indexedMachineSlide, /MADAR|رقم الأمر|ماكينة التحليل|الفنيون|ملاحظات فنية|ملاحظات الزيارة/);
  assert.match(indexedMachineSlide, /صفحة 5 من 5/);

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
  const machine = await createMachine('AREA-NOTES-01', 'ياسمين', 'Area Notes Machine');
  const emptyMachine = await createMachine('AREA-NOTES-02', 'اسبانيا مول');
  await createMachine('AREA-NOTES-04', 'بالم هيلز');
  await createMachine('AREA-NOTES-05', 'الخليجية');
  await createMachine('AREA-NOTES-06', 'الشرق');
  await createMachine('AREA-NOTES-07', '2 كونكت ستور');
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
  assert.deepEqual(group.machines.map((item) => item.name_ar), [
    'اسبانيا مول', 'الخليجية', 'الشرق', 'بالم هيلز', '2 كونكت ستور', 'ياسمين',
  ]);
  assert.deepEqual(group.machines.map((item) => item.code), [
    'AREA-NOTES-02', 'AREA-NOTES-05', 'AREA-NOTES-06', 'AREA-NOTES-04', 'AREA-NOTES-07', 'AREA-NOTES-01',
  ],
    'area machine lists should use Arabic name order instead of machine-code order');
  assert.equal(group.machines.at(-1).notes, 'الملاحظة الأحدث', 'archived_at wins over a later updated_at, and deleted/blank-note orders are excluded');
  assert.equal(group.machines[0].notes, '');
  assert.ok(compareMachineNames('ماكينة 2', 'ماكينة 10') < 0, 'Arabic machine names should use natural numeric comparison');
  assert.ok(compareMachineNames('اسكندرية', 'البوادي') < 0);
  assert.ok(compareMachineNames('البوادي', 'الزامل') < 0);
  assert.ok(compareMachineNames('الزامل', 'السلطان') < 0);
  assert.ok(compareMachineNames('السلطان', 'بالم') < 0, 'all visible alif/article names should sort before Ba names');
  assert.ok(compareMachineNames('بالم', 'بيت الجملة') < 0);
  assert.ok(compareMachineNames('بيت الجملة', 'بيرلا') < 0);
  assert.ok(compareMachineNames('بيرلا', 'بيم') < 0);
  assert.ok(compareMachineNames('الشرق', '2 كونكت ستور') < 0, 'leading digits should not move a name ahead of its Arabic letter');
  assert.ok(compareMachineNames('2 كونكت ستور', 'ياسمين') < 0);
  assert.ok(compareMachineNames('English Machine', 'ياسمين') > 0, 'Arabic machine names should sort before Latin names');
  assert.ok(compareMachineNames('', 'English Machine') > 0, 'empty names should sort last');
  assert.equal(normalizeArabicSortKey('أسبانيا'), normalizeArabicSortKey('إِسْبَانْيَا'));
  assert.equal(normalizeArabicSortKey('آسبانيا'), normalizeArabicSortKey('اسبانيا'));
  assert.equal(normalizeArabicSortKey('ٱلْخَلِيجِيَّة'), normalizeArabicSortKey('الخليجية'),
    'diacritics and alef variants should normalize without stripping the visible article');
  assert.equal(normalizeArabicSortKey('البوادي'), 'البوادي', 'the visible alif-lam prefix must remain in the sort key');
  assert.ok(compareMaintenanceAreas('أكتوبر', 'بالم هيلز') < 0);
  assert.ok(compareMaintenanceAreas('الخليجية', 'بالم هيلز') < 0);
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
  assert.match(styleXml, /<sz val="15"\s*\/>/, 'area banner font should be enlarged');
  assert.match(styleXml, /<sz val="13"\s*\/>/, 'column header font should be enlarged');
  assert.match(styleXml, /<sz val="12"\s*\/>/, 'machine and note fonts should be readable');
  assert.match(styleXml, /readingOrder="2"/, 'cell styles should force right-to-left reading order');
  assert.match(sheetXml, /mergeCell ref="A\d+:D\d+"/);
  assert.match(sheetXml, /<sheetView\b[^>]*\brightToLeft="1"/, 'the worksheet view should open right-to-left');
  assert.match(sheetXml, /r="A1" s="\d+"/, 'the merged area banner cell should have a style');

  const filteredExport = await request(`/api/maintenance/area-notes/export.xlsx?area=${encodeURIComponent('Area Notes East')}`);
  assert.equal(filteredExport.response.status, 200);
  const filteredWorkbook = XLSX.read(filteredExport.body, { type: 'buffer' });
  const filteredSheet = filteredWorkbook.Sheets[filteredWorkbook.SheetNames[0]];
  const exportRows = XLSX.utils.sheet_to_json(filteredSheet, { header: 1, defval: '' });
  assert.deepEqual(filteredSheet['!merges'], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }]);
  assert.deepEqual(exportRows[0], ['المنطقة: Area Notes East', '', '', '']);
  assert.deepEqual(exportRows[1], ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات']);
  assert.deepEqual(exportRows[2], ['AREA-NOTES-02', 'اسبانيا مول', '', '']);
  assert.deepEqual(exportRows.slice(3, 5).map((row) => row[1]), ['الخليجية', 'الشرق']);
  assert.deepEqual(exportRows.slice(5, 7).map((row) => row[1]), ['بالم هيلز', '2 كونكت ستور']);
  assert.deepEqual(exportRows[7], ['AREA-NOTES-01', 'ياسمين', 'Area Notes Machine', 'الملاحظة الأحدث']);
  const filteredSheetXml = (await readZipEntry(filteredExport.body, 'xl/worksheets/sheet1.xml')).toString('utf8');
  assert.match(filteredSheetXml, /<autoFilter ref="A2:D24"\/>/, 'the worksheet should enable an Excel AutoFilter through its padded A4 page rows');
  assert.match(filteredSheetXml, /<pageSetup[^>]*paperSize="9"[^>]*orientation="portrait"/,
    'the async export route should return an A4 portrait workbook');
  assert.match(filteredSheetXml, /<pageMargins[^>]*left="0.5"[^>]*right="0.5"/);
  for (let row = 9; row <= 24; row += 1) {
    for (const column of ['A', 'B', 'C', 'D']) {
      assert.match(filteredSheetXml, new RegExp(`<c\\b[^>]*\\br="${column}${row}"[^>]*\\bs="\\d+"`),
        `padded A4 cell ${column}${row} should retain its table border style`);
    }
  }
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

test('area maintenance workbook paginates A4 pages and repeats banners and headers on overflow', async () => {
  const machines = [];
  for (let index = 1; index <= 23; index += 1) {
    machines.push({
      id: index,
      code: `A4-OVERFLOW-${String(index).padStart(2, '0')}`,
      name_ar: `ماكينة ${index}`,
      name_en: '',
      area: 'A4 Pagination A',
      notes: '',
    });
  }
  machines.push({
    id: 24,
    code: 'A4-NEXT-01',
    name_ar: 'ماكينة المنطقة التالية',
    name_en: '',
    area: 'A4 Pagination B',
    notes: '',
  });
  const workbookBuffer = await buildAreaMaintenanceNotesWorkbook({}, {
    prepare: () => ({ all: () => machines }),
  });
  const workbook = XLSX.read(workbookBuffer, { type: 'buffer' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const headers = ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات'];

  assert.equal(rows[0][0], 'المنطقة: A4 Pagination A');
  assert.deepEqual(rows[1], headers);
  assert.equal(rows.slice(2, 24).filter((row) => row[0]).length, 22, 'the first A4 page should contain exactly 22 machines');
  assert.equal(rows[24][0], 'المنطقة: A4 Pagination A (تابع)');
  assert.deepEqual(rows[25], headers, 'the overflow page should repeat the four column headers');
  assert.equal(rows[26][0], 'A4-OVERFLOW-23');
  assert.ok(rows.slice(27, 48).every((row) => row.every((cell) => cell === '')),
    'the remainder of the continuation page should be padded before the next area');
  assert.equal(rows[48][0], 'المنطقة: A4 Pagination B', 'the next area should start after a complete 24-row page block');
  assert.deepEqual(rows[49], headers);

  const worksheetXml = (await readZipEntry(workbookBuffer, 'xl/worksheets/sheet1.xml')).toString('utf8');
  assert.match(worksheetXml, /<pageSetup[^>]*paperSize="9"[^>]*orientation="portrait"/,
    'the exported worksheet should be configured for A4 portrait paper');
  assert.match(worksheetXml, /fitToWidth="1"/);
  assert.match(worksheetXml, /fitToHeight="0"/);
  assert.match(worksheetXml, /<sheetView\b[^>]*\brightToLeft="1"/, 'every exported worksheet should open right-to-left');
  assert.match(worksheetXml, /<rowBreaks count="2" manualBreakCount="2"><brk id="24" max="16383" man="1"\/><brk id="48" max="16383" man="1"\/><\/rowBreaks>/,
    'each 24-row page block should have an explicit manual page break');
  assert.match(worksheetXml, /<autoFilter ref="A2:D72"\/>/);
  for (let row = 28; row <= 48; row += 1) {
    for (const column of ['A', 'B', 'C', 'D']) {
      assert.match(worksheetXml, new RegExp(`<c\\b[^>]*\\br="${column}${row}"[^>]*\\bs="\\d+"`),
        `overflow-page padding cell ${column}${row} should retain its table border style`);
    }
  }
});

test('maintenance PPTX and Excel exports sort Arabic areas and machine codes naturally', async () => {
  assert.deepEqual(['1', '10', '2', '1045', '3'].sort(compareMachineCodes), ['1', '2', '3', '10', '1045']);
  const geographicRoute = [
    'الإسكندرية', 'الساحل الشمالي', 'مطروح', 'مدينة السادات',
    'المنصورة', 'بورسعيد', 'دمياط', 'رأس البر', 'العاشر من رمضان', 'الإسماعيلية', 'السويس', 'العين السخنة',
    'شبرا', 'مدينة نصر', 'التجمع الخامس', 'الدقي', 'الشيخ زايد',
    'دهب', 'الغردقة', 'شمال الصعيد', 'جنوب الصعيد', 'مكان متفرق',
  ];
  assert.deepEqual([...geographicRoute].reverse().sort(compareMaintenanceAreas), geographicRoute,
    'recognized service areas should follow the Egypt north-to-south route and unknown locations should come last');

  const expectedAreas = ['إسكندرية', 'سويس', 'تجمع'];
  const sortedCodes = ['SORT-1', 'SORT-2', 'SORT-3', 'SORT-10', 'SORT-1045'];
  const machineFixtures = [
    { code: 'SORT-10', area: 'سويس' },
    { code: 'ALEX-1', area: 'إسكندرية' },
    { code: 'SORT-3', area: 'سويس' },
    { code: 'TAJAMO-1', area: 'تجمع' },
    { code: 'SORT-1045', area: 'سويس' },
    { code: 'SORT-1', area: 'سويس' },
    { code: 'SORT-2', area: 'سويس' },
  ];
  const client = await request('/api/clients', json('POST', { name: 'Export Sorting Test Client' }));
  assert.equal(client.response.status, 201, JSON.stringify(client.body));

  const machineIdsByCode = new Map();
  for (const fixture of machineFixtures) {
    const created = await request('/api/maintenance/machines', json('POST', {
      code: fixture.code,
      name_ar: `ماكينة ${fixture.code}`,
      name_en: `Sorter ${fixture.code}`,
      area: fixture.area,
    }));
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    machineIdsByCode.set(fixture.code, created.body.id);
  }

  const order = await request('/api/maintenance/orders', json('POST', {
    clientId: client.body.id,
    areas: ['سويس', 'تجمع', 'إسكندرية'],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(order.response.status, 201, JSON.stringify(order.body));
  const sortingPhoto = await writePptxPhotoFixture('Maintenance/Export Fixtures/sorting-photo.jpg', '#2ca02c');
  db.prepare("UPDATE maintenance_cards SET status = 'completed', before_photos_json = ? WHERE order_id = ?")
    .run(JSON.stringify([sortingPhoto.path]), order.body.id);
  db.prepare(`UPDATE maintenance_orders
    SET status = 'archived', archived_at = '2031-04-05 12:00:00', updated_at = '2031-04-05 12:00:00'
    WHERE id = ?`).run(order.body.id);

  const listing = await request('/api/maintenance/area-notes');
  assert.equal(listing.response.status, 200, JSON.stringify(listing.body));
  const listedAreas = listing.body.map((group) => group.area).filter((area) => expectedAreas.includes(area));
  assert.deepEqual(listedAreas, expectedAreas);
  const switzerlandArea = listing.body.find((group) => group.area === 'سويس');
  assert.deepEqual(switzerlandArea.machines.filter((machine) => sortedCodes.includes(machine.code)).map((machine) => machine.code), sortedCodes);

  const areaNotesResponse = await request('/api/maintenance/area-notes/export.xlsx');
  assert.equal(areaNotesResponse.response.status, 200, JSON.stringify(areaNotesResponse.body));
  const notesWorkbook = XLSX.read(areaNotesResponse.body, { type: 'buffer' });
  const notesRows = XLSX.utils.sheet_to_json(notesWorkbook.Sheets[notesWorkbook.SheetNames[0]], { header: 1, defval: '' });
  const noteBanners = notesRows.map((row) => row[0]).filter((value) => typeof value === 'string' && value.startsWith('المنطقة: '));
  assert.deepEqual(noteBanners.filter((banner) => expectedAreas.some((area) => banner === `المنطقة: ${area}`)), expectedAreas.map((area) => `المنطقة: ${area}`));
  const suezBannerIndex = notesRows.findIndex((row) => row[0] === 'المنطقة: سويس');
  const nextBannerIndex = notesRows.findIndex((row, index) => index > suezBannerIndex && String(row[0]).startsWith('المنطقة: '));
  const suezCodesInWorkbook = notesRows.slice(suezBannerIndex + 2, nextBannerIndex < 0 ? notesRows.length : nextBannerIndex)
    .map((row) => row[0]).filter((code) => sortedCodes.includes(code));
  assert.deepEqual(suezCodesInWorkbook, sortedCodes);

  const analysisResponse = await request('/api/maintenance/analysis/export.xlsx?from=2031-04-05&to=2031-04-05');
  assert.equal(analysisResponse.response.status, 200, JSON.stringify(analysisResponse.body));
  const analysisWorkbook = XLSX.read(analysisResponse.body, { type: 'buffer' });
  const analysisRows = XLSX.utils.sheet_to_json(analysisWorkbook.Sheets[analysisWorkbook.SheetNames[0]], { header: 1, defval: '' });
  const fixtureAnalysisRows = analysisRows.slice(1).filter((row) => machineFixtures.some((fixture) => fixture.code === row[1]));
  assert.deepEqual(fixtureAnalysisRows.map((row) => [row[0], row[1]]), [
    ['إسكندرية', 'ALEX-1'],
    ...sortedCodes.map((code) => ['سويس', code]),
    ['تجمع', 'TAJAMO-1'],
  ]);

  const pptxResponse = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [order.body.id],
    groupBy: 'area',
  }));
  assert.equal(pptxResponse.response.status, 200, JSON.stringify(pptxResponse.body));
  const slideNames = zipEntryNames(pptxResponse.body)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((left, right) => Number(left.match(/slide(\d+)/u)[1]) - Number(right.match(/slide(\d+)/u)[1]));
  const singleMonthCover = (await readZipEntry(pptxResponse.body, 'ppt/slides/slide1.xml')).toString('utf8');
  assert.match(singleMonthCover, /فترة التقرير: أبريل 2031/);
  const indexPages = [];
  for (const slideName of slideNames) {
    const slideXml = (await readZipEntry(pptxResponse.body, slideName)).toString('utf8');
    const texts = pptxTextValues(slideXml);
    const title = texts.find((value) => value.startsWith('فهرس الماكينات · '));
    if (title) indexPages.push({ area: title.slice('فهرس الماكينات · '.length), texts });
  }
  assert.deepEqual(indexPages.map((page) => page.area), expectedAreas);
  const suezIndex = indexPages.find((page) => page.area === 'سويس').texts;
  assert.deepEqual(suezIndex.filter((value) => value === 'سويس'), Array(5).fill('سويس'));
  const indexCodeOrder = sortedCodes.map((code) => suezIndex.indexOf(code));
  assert.ok(indexCodeOrder.every((position) => position >= 0));
  assert.deepEqual([...indexCodeOrder].sort((left, right) => left - right), indexCodeOrder,
    'PPTX index rows within the Arabic area group should use natural machine-code order');

  const pptxMachineCodes = [];
  for (const slideName of slideNames) {
    const slideXml = (await readZipEntry(pptxResponse.body, slideName)).toString('utf8');
    const title = pptxTextValues(slideXml).find((value) => value.startsWith('Sorter '));
    const match = title?.match(/^Sorter (.+) • /u);
    if (match) pptxMachineCodes.push(match[1]);
  }
  assert.deepEqual(pptxMachineCodes, ['ALEX-1', ...sortedCodes, 'TAJAMO-1']);
  assert.deepEqual([...machineIdsByCode.keys()].sort(compareMachineCodes).filter((code) => sortedCodes.includes(code)), sortedCodes);

  const mayOrder = await request('/api/maintenance/orders', json('POST', {
    clientId: client.body.id,
    areas: ['تجمع'],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(mayOrder.response.status, 201, JSON.stringify(mayOrder.body));
  const mayCard = mayOrder.body.cards.find((card) => card.machine_id === machineIdsByCode.get('TAJAMO-1'));
  assert.ok(mayCard, 'the second selected order should include its Cairo-area machine');
  db.prepare("UPDATE maintenance_cards SET status = 'completed', before_photos_json = ? WHERE id = ?")
    .run(JSON.stringify([sortingPhoto.path]), mayCard.id);
  db.prepare(`UPDATE maintenance_orders
    SET status = 'archived', archived_at = '2031-05-02 12:00:00', updated_at = '2031-05-02 12:00:00'
    WHERE id = ?`).run(mayOrder.body.id);
  const multiMonthPptx = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [order.body.id, mayOrder.body.id],
    groupBy: 'area',
  }));
  assert.equal(multiMonthPptx.response.status, 200, JSON.stringify(multiMonthPptx.body));
  const multiMonthCover = (await readZipEntry(multiMonthPptx.body, 'ppt/slides/slide1.xml')).toString('utf8');
  assert.match(multiMonthCover, /فترة التقرير: أبريل 2031 – مايو 2031/,
    'the cover should show the actual distinct selected-order months as a range');
});

test('maintenance PowerPoint export exposes live machine progress and a final completion state', async () => {
  const client = await request('/api/clients', json('POST', { name: 'PPTX Progress Test Client' }));
  assert.equal(client.response.status, 201, JSON.stringify(client.body));
  const machineCount = 557;
  for (let index = 1; index <= machineCount; index += 1) {
    const created = await request('/api/maintenance/machines', json('POST', {
      code: `PROGRESS-${index}`,
      name_ar: `ماكينة تقدم ${index}`,
      name_en: `Progress Machine ${index}`,
      area: 'منطقة التقدم',
    }));
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
  }

  const order = await request('/api/maintenance/orders', json('POST', {
    clientId: client.body.id,
    areas: ['منطقة التقدم'],
    employeeIds: [],
    autoPopulateAreaMachines: true,
  }));
  assert.equal(order.response.status, 201, JSON.stringify(order.body));
  const orderCardCount = db.prepare('SELECT COUNT(*) AS count FROM maintenance_cards WHERE order_id = ?').get(order.body.id).count;
  assert.equal(orderCardCount, machineCount);
  const progressPhoto = await writePptxPhotoFixture('Maintenance/Export Fixtures/progress-photo.jpg', '#9467bd', { width: 2400, height: 1600 });
  db.prepare(`UPDATE maintenance_cards
    SET status = 'completed', before_photos_json = ?, after_photos_json = ? WHERE order_id = ?`)
    .run(JSON.stringify([progressPhoto.path]), JSON.stringify([progressPhoto.path]), order.body.id);
  db.prepare(`UPDATE maintenance_orders
    SET status = 'archived', archived_at = '2031-04-06 12:00:00', updated_at = '2031-04-06 12:00:00'
    WHERE id = ?`).run(order.body.id);

  const exportId = 'phase6-progress-557-machine-export';
  let exportFinished = false;
  const exportTask = request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [order.body.id],
    exportId,
  })).then((result) => {
    exportFinished = true;
    return result;
  });
  const observedProgress = [];
  const deadline = Date.now() + 120_000;
  while (!exportFinished && Date.now() < deadline) {
    const progressResult = await request(`/api/maintenance/export/pptx/progress?exportId=${encodeURIComponent(exportId)}`);
    assert.equal(progressResult.response.status, 200, JSON.stringify(progressResult.body));
    if (progressResult.body?.active) observedProgress.push(progressResult.body);
    if (!exportFinished) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(exportFinished, true, 'the PPTX export should finish before the progress-test timeout');
  const exported = await exportTask;
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.subarray(0, 2).toString(), 'PK');
  const exportedMediaName = zipEntryNames(exported.body).find((name) => name.startsWith('ppt/media/') && name.toLowerCase().endsWith('.jpeg'));
  assert.ok(exportedMediaName, 'large maintenance photos should be converted to JPEG for PPTX');
  const exportedMedia = await readZipEntry(exported.body, exportedMediaName);
  const exportedMediaMetadata = await sharp(exportedMedia).metadata();
  assert.equal(exportedMediaMetadata.format, 'jpeg');
  assert.ok(exportedMediaMetadata.width <= 680 && exportedMediaMetadata.height <= 680,
    'PPTX media should be resized to fit within 680x680 pixels');
  assert.deepEqual(readFileSync(join(storageRoot, ...progressPhoto.path.split('/'))), progressPhoto.buffer,
    'PPTX optimization must not rewrite the archived source image');
  assert.ok(observedProgress.some((progress) => (
    progress.total === machineCount
    && progress.current >= 1
    && progress.current <= machineCount
    && progress.machineNameAr
    && progress.machineNameEn
    && progress.machineCode
    && typeof progress.percent === 'number'
  )), 'active progress should include machine identity, count, and percent');
  assert.ok(observedProgress.some((progress) => progress.current > 0 && progress.current < machineCount),
    'the progress endpoint should remain responsive during the 557-card image export');

  const finalProgress = await request(`/api/maintenance/export/pptx/progress?exportId=${encodeURIComponent(exportId)}`);
  assert.equal(finalProgress.response.status, 200);
  assert.deepEqual({
    active: finalProgress.body.active,
    total: finalProgress.body.total,
    current: finalProgress.body.current,
    percent: finalProgress.body.percent,
  }, { active: false, total: machineCount, current: machineCount, percent: 100 });
  assert.equal((await request('/api/maintenance/export/pptx/progress?exportId=missing-progress-id')).body, null);
});

test('maintenance PPTX exports the latest edited card snapshot and never falls back to stale photos', async () => {
  const client = await request('/api/clients', json('POST', { name: 'PPTX Latest Card Test Client' }));
  assert.equal(client.response.status, 201, JSON.stringify(client.body));
  const area = 'منطقة أحدث بطاقة';
  const machine = await request('/api/maintenance/machines', json('POST', {
    code: 'SNAPSHOT-01',
    name_ar: 'ماكينة لقطة البطاقة',
    name_en: 'Latest Snapshot Machine',
    area,
  }));
  assert.equal(machine.response.status, 201, JSON.stringify(machine.body));

  async function createArchivedOrder(archivedAt) {
    const created = await request('/api/maintenance/orders', json('POST', {
      clientId: client.body.id,
      areas: [area],
      employeeIds: [],
      autoPopulateAreaMachines: true,
    }));
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const card = created.body.cards.find((entry) => entry.machine_id === machine.body.id);
    assert.ok(card);
    db.prepare(`UPDATE maintenance_orders
      SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`)
      .run(archivedAt, archivedAt, created.body.id);
    return { order: created.body, card };
  }

  const oldSnapshot = await createArchivedOrder('2031-04-01 12:00:00');
  const latestSnapshot = await createArchivedOrder('2031-04-02 12:00:00');
  const oldPhoto = await writePptxPhotoFixture('Maintenance/Export Fixtures/snapshot-old.jpg', '#d94841');
  const editedPhoto = await writePptxPhotoFixture('Maintenance/Export Fixtures/snapshot-edited.jpg', '#1f77b4');
  db.prepare(`UPDATE maintenance_cards SET status = 'completed', before_photos_json = ?, after_photos_json = '[]', updated_at = ? WHERE id = ?`)
    .run(JSON.stringify([oldPhoto.path]), '2031-04-01 12:00:00', oldSnapshot.card.id);
  db.prepare(`UPDATE maintenance_cards SET status = 'pending', before_photos_json = ?, after_photos_json = '[]', updated_at = ? WHERE id = ?`)
    .run(JSON.stringify([editedPhoto.path]), '2031-04-03 12:00:00', latestSnapshot.card.id);

  const exported = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [oldSnapshot.order.id, latestSnapshot.order.id],
    groupBy: 'none',
  }));
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  const slideNames = zipEntryNames(exported.body).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const machineSlides = [];
  let areaDivider = '';
  for (const name of slideNames) {
    const slide = (await readZipEntry(exported.body, name)).toString('utf8');
    const texts = pptxTextValues(slide);
    if (texts.some((text) => text.includes('Latest Snapshot Machine'))
      && texts.includes('After') && texts.includes('Before')) machineSlides.push({ name, slide, texts });
    if (texts.some((text) => text.includes(area)) && texts.some((text) => text.includes('أوامر التشغيل'))) areaDivider = slide;
  }
  assert.equal(machineSlides.length, 1, 'one machine should appear once after cross-order de-duplication');
  assert.match(machineSlides[0].slide, /صفحة 4 من 4/);
  assert.equal((machineSlides[0].slide.match(/<p:pic>/g) ?? []).length, 2,
    'machine slide should show both the fixed company logo and the selected card photo');
  assert.ok(areaDivider, 'groupBy none must still include the required area divider');
  assert.match(areaDivider, /1 ماكينة ATM/);
  assert.ok(areaDivider.includes(latestSnapshot.order.order_code), 'area divider should list the latest order code');

  const mediaNames = zipEntryNames(exported.body).filter((name) => (
    name.startsWith('ppt/media/') && name.toLowerCase().endsWith('.jpeg')
  ));
  const media = await Promise.all(mediaNames.map(async (name) => {
    const buffer = await readZipEntry(exported.body, name);
    return { name, buffer, metadata: await sharp(buffer).metadata() };
  }));
  const logoMedia = media.find(({ metadata }) => metadata.format === 'jpeg' && metadata.width > 120);
  assert.ok(logoMedia, 'the fixed corporate logo should be included as a JPEG image');
  const logoMetadata = logoMedia.metadata;
  assert.equal(logoMetadata.format, 'jpeg');
  assert.ok(logoMetadata.width > 0 && logoMetadata.height > 0
    && logoMetadata.width <= 680 && logoMetadata.height <= 680,
  'the fitted logo should retain valid dimensions within the PPTX image limit');
  const deriveExportPhoto = async (photo) => {
    return sharp(photo.buffer, { failOn: 'none', fastShrinkOnLoad: true })
      .rotate()
      .resize({ width: 680, height: 680, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  };
  const exportedPhotos = media.map(({ buffer }) => buffer);
  const expectedEditedPhoto = await deriveExportPhoto(editedPhoto);
  const expectedOldPhoto = await deriveExportPhoto(oldPhoto);
  assert.ok(exportedPhotos.some((photo) => photo.equals(expectedEditedPhoto)), 'export should contain the edited latest card photo');
  assert.ok(!exportedPhotos.some((photo) => photo.equals(expectedOldPhoto)), 'export should not contain the older archived card photo');

  const coverLogoEnabled = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [oldSnapshot.order.id, latestSnapshot.order.id],
    groupBy: 'none',
    useFixedLogoOnCover: true,
  }));
  assert.equal(coverLogoEnabled.response.status, 200, JSON.stringify(coverLogoEnabled.body));
  const coverWithFixedLogo = (await readZipEntry(coverLogoEnabled.body, 'ppt/slides/slide1.xml')).toString('utf8');
  assert.match(coverWithFixedLogo, /<p:pic>/, 'enabling the cover option should render the fixed company logo on the cover');

  db.prepare("UPDATE maintenance_cards SET before_photos_json = '[]', after_photos_json = '[]', updated_at = ? WHERE id = ?")
    .run('2031-04-04 12:00:00', latestSnapshot.card.id);
  const noStaleFallback = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [oldSnapshot.order.id, latestSnapshot.order.id],
    groupBy: 'none',
  }));
  assert.equal(noStaleFallback.response.status, 404, 'a newer edited card with deleted photos must not reveal an older card’s photos');

  db.prepare("UPDATE maintenance_cards SET status = 'excluded', updated_at = ? WHERE id = ?")
    .run('2031-04-05 12:00:00', latestSnapshot.card.id);
  const excludedLatestCard = await request('/api/maintenance/export/pptx', json('POST', {
    orderIds: [oldSnapshot.order.id, latestSnapshot.order.id],
    groupBy: 'none',
  }));
  assert.equal(excludedLatestCard.response.status, 404, 'an excluded latest card must not fall back to an older snapshot');
});
