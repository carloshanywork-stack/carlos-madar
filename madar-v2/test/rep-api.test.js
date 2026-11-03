import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-rep-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'rep.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_REP_APK_PATH = join(temporaryDirectory, 'madar-rep.apk');
process.env.STORAGE_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [
  { app },
  { createConnection, db },
  {
    initializeDatabase,
    migrateMachineGeofenceAndBreadcrumbs,
    migrateRepSupervisorRadar,
    migrateRepUserProfiles,
    migrateRepVisitMachineCondition,
  },
  { default: sharp },
  { ensureStorageDirectory, resolveStorageFile, storageDirectory, writeStorageFile },
  { recoverRepVisitUploads },
] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('sharp'),
  import('../server/modules/storage.js'),
  import('../server/modules/rep/service.js'),
]);

initializeDatabase({ initialAdminPassword: '' });
writeFileSync(process.env.MADAR_REP_APK_PATH, Buffer.from('synthetic-debug-apk'));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let legacyDatabase;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  if (legacyDatabase?.open) legacyDatabase.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function cookieValue(setCookie) {
  return (setCookie.split(';', 1)[0] ?? '').trim();
}

async function request(path, options = {}, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return {
    response,
    body: await response.json(),
    cookie: cookieValue(response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? ''),
  };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('rep role migration preserves users and their existing foreign-key references', () => {
  legacyDatabase = createConnection(join(temporaryDirectory, 'legacy-users.sqlite'));
  legacyDatabase.exec(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'sales', 'operations', 'purchasing')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT
    );
    CREATE TABLE employee_login_links (
      id INTEGER PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id)
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL
    );
    INSERT INTO users (id, username, password_hash, full_name, role)
      VALUES (17, 'existing-admin', 'preserved-hash', 'Existing Admin', 'admin');
    INSERT INTO users (id, username, password_hash, full_name, role, active, deleted_at)
      VALUES (29, 'disabled-operations', 'other-hash', 'Old Operator', 'operations', 0, '2026-01-01');
    INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('existing-session-hash', 17, '2030-01-01T00:00:00.000Z');
    INSERT INTO employee_login_links (id, user_id) VALUES (5, 29);
    INSERT INTO audit_log (id, actor_id, action) VALUES (7, 17, 'legacy-action');
  `);

  migrateRepUserProfiles(legacyDatabase);
  migrateRepUserProfiles(legacyDatabase);

  assert.equal(legacyDatabase.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(legacyDatabase.pragma('foreign_key_check'), []);
  assert.deepEqual(legacyDatabase.prepare('SELECT id, username, password_hash, full_name, role, active, deleted_at FROM users ORDER BY id').all(), [
    { id: 17, username: 'existing-admin', password_hash: 'preserved-hash', full_name: 'Existing Admin', role: 'admin', active: 1, deleted_at: null },
    { id: 29, username: 'disabled-operations', password_hash: 'other-hash', full_name: 'Old Operator', role: 'operations', active: 0, deleted_at: '2026-01-01' },
  ]);
  assert.equal(legacyDatabase.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get('existing-session-hash').user_id, 17);
  assert.equal(legacyDatabase.prepare('SELECT user_id FROM employee_login_links WHERE id = 5').get().user_id, 29);
  assert.equal(legacyDatabase.prepare('SELECT actor_id FROM audit_log WHERE id = 7').get().actor_id, 17);
  assert.equal(legacyDatabase.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261102-rep-user-profile'").get().count, 1);
  const newRep = legacyDatabase.prepare(`
    INSERT INTO users (username, password_hash, full_name, role) VALUES ('new-rep', 'hash', 'New Rep', 'rep')
  `).run();
  assert.equal(legacyDatabase.prepare('SELECT assigned_regions_json, is_online, last_location_json FROM users WHERE id = ?').get(Number(newRep.lastInsertRowid)).assigned_regions_json, '[]');
  legacyDatabase.exec('CREATE TABLE rep_visits (id INTEGER PRIMARY KEY, visit_uuid TEXT NOT NULL UNIQUE)');
  migrateRepSupervisorRadar(legacyDatabase);
  migrateRepSupervisorRadar(legacyDatabase);
  migrateRepVisitMachineCondition(legacyDatabase);
  migrateRepVisitMachineCondition(legacyDatabase);
  assert.deepEqual(new Set(legacyDatabase.pragma('table_info(rep_visits)').map((column) => column.name)),
    new Set(['id', 'visit_uuid', 'before_captured_at', 'after_captured_at', 'machine_condition']));
  assert.ok(legacyDatabase.prepare("SELECT 1 FROM schema_migrations WHERE version = '20261102-rep-supervisor-radar-qa'").get());
  assert.equal(legacyDatabase.pragma('foreign_key_check').length, 0);
});

test('geofence and breadcrumb migrations are additive and idempotent', () => {
  migrateMachineGeofenceAndBreadcrumbs(db);
  const machineColumns = new Set(db.pragma('table_info(machines)').map((column) => column.name));
  for (const column of ['latitude', 'longitude', 'is_location_locked', 'geofence_radius_meters', 'area_name']) {
    assert.ok(machineColumns.has(column), `missing machines.${column}`);
  }
  const breadcrumbColumns = new Set(db.pragma('table_info(rep_location_breadcrumbs)').map((column) => column.name));
  for (const column of [
    'user_id', 'work_date', 'latitude', 'longitude', 'accuracy', 'speed', 'recorded_at',
    'is_stop', 'stop_duration_minutes', 'stop_name', 'stop_arrived_at', 'stop_departed_at',
  ]) assert.ok(breadcrumbColumns.has(column), `missing rep_location_breadcrumbs.${column}`);
  assert.ok(db.prepare(`SELECT 1 FROM schema_migrations WHERE version = '20261103-machine-geofence-route-stops'`).get());
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('rep login, assigned-region route sync, active fault reasons, and strict API isolation', async () => {
  const anonymousApk = await request('/download/apk');
  assert.equal(anonymousApk.response.status, 401);

  const setup = await request('/api/auth/setup', jsonOptions('POST', {
    username: 'root-admin',
    fullName: 'Root Administrator',
    password: 'Root-Administrator-Password-2026!',
  }));
  assert.equal(setup.response.status, 201);
  const adminCookie = setup.cookie;
  assert.ok(adminCookie.startsWith('madar_token='));
  const adminApkDownload = await fetch(`${baseUrl}/download/apk`, { headers: { cookie: adminCookie } });
  assert.equal(adminApkDownload.status, 200);
  assert.match(adminApkDownload.headers.get('content-type'), /application\/vnd\.android\.package-archive/);
  assert.match(adminApkDownload.headers.get('content-disposition'), /madar-rep\.apk/);
  assert.equal(Buffer.from(await adminApkDownload.arrayBuffer()).toString(), 'synthetic-debug-apk');

  const createRep = await request('/api/users', jsonOptions('POST', {
    username: 'rep-nour',
    full_name: 'Nour Field Rep',
    role: 'rep',
    assignedRegions: ['التجمع', 'التجمع'],
    password: 'Rep-Nour-Password-2026!',
  }), adminCookie);
  assert.equal(createRep.response.status, 201);
  assert.equal(createRep.body.active, 1);
  assert.equal(createRep.body.isActive, 1, 'new rep accounts default to active');
  assert.deepEqual(createRep.body.assignedRegions, ['التجمع']);
  assert.equal(createRep.body.isOnline, false);
  assert.equal(createRep.body.lastLocation, null);

  const invalidAssignments = await request('/api/auth/users', jsonOptions('POST', {
    username: 'bad-rep',
    full_name: 'Bad Region Assignment',
    role: 'rep',
    assignedRegions: 'التجمع',
    password: 'Rep-Bad-Password-2026!',
  }), adminCookie);
  assert.equal(invalidAssignments.response.status, 400);

  const repId = createRep.body.id;
  db.prepare('UPDATE users SET last_location_json = ? WHERE id = ?')
    .run(JSON.stringify({ latitude: 24.8, longitude: 46.7, accuracy: 12, updatedAt: '2026-11-02T08:30:00.000Z' }), repId);

  const clientId = Number(db.prepare(`
    INSERT INTO clients (code, name, address) VALUES ('REP-CLIENT', 'Rep Route Client', 'شارع التسعين')
  `).run().lastInsertRowid);
  const orderId = Number(db.prepare(`
    INSERT INTO maintenance_orders (order_code, client_id, area, status)
    VALUES ('REP-ROUTE-1', ?, 'التجمع، الرياض', 'in_progress')
  `).run(clientId).lastInsertRowid);
  db.prepare('INSERT INTO maintenance_order_reps (order_id, user_id) VALUES (?, ?)').run(orderId, repId);

  function addMachineCard(code, area, beforePhotos, afterPhotos) {
    const machineId = Number(db.prepare(`
      INSERT INTO machines (code, name_ar, area) VALUES (?, ?, ?)
    `).run(code, `ماكينة ${code}`, area).lastInsertRowid);
    const cardId = Number(db.prepare(`
      INSERT INTO maintenance_cards (order_id, machine_id, before_photos_json, after_photos_json)
      VALUES (?, ?, ?, ?)
    `).run(orderId, machineId, JSON.stringify(beforePhotos), JSON.stringify(afterPhotos)).lastInsertRowid);
    return cardId;
  }

  const completedCardId = addMachineCard('1433', 'التجمع', ['before-1433.jpg'], ['after-1433.jpg']);
  const missingAfterCardId = addMachineCard('1434', 'التجمع', ['before-1434.jpg'], []);
  const yesterdayCardId = addMachineCard('1435', 'التجمع', ['before-1435.jpg'], ['after-1435.jpg']);
  const otherRegionCardId = addMachineCard('2400', 'الرياض', ['before-2400.jpg'], ['after-2400.jpg']);
  const duplicateOrderId = Number(db.prepare(`
    INSERT INTO maintenance_orders (order_code, client_id, area, status)
    VALUES ('REP-ROUTE-2', ?, 'التجمع', 'in_progress')
  `).run(clientId).lastInsertRowid);
  const repeatedMachineId = db.prepare('SELECT id FROM machines WHERE code = ?').get('1433').id;
  const duplicateCardId = Number(db.prepare(`
    INSERT INTO maintenance_cards (order_id, machine_id, before_photos_json, after_photos_json)
    VALUES (?, ?, ?, ?)
  `).run(duplicateOrderId, repeatedMachineId, JSON.stringify(['before-1433-2.jpg']), JSON.stringify(['after-1433-2.jpg'])).lastInsertRowid);
  const insertPhotoAudit = db.prepare(`
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_values_json, created_at)
    VALUES (?, 'photo_upload', 'maintenance_card', ?, ?, datetime('now'))
  `);
  insertPhotoAudit.run(repId, completedCardId, JSON.stringify({ before: ['before-1433.jpg'] }));
  insertPhotoAudit.run(repId, duplicateCardId, JSON.stringify({ after: ['after-1433-2.jpg'] }));
  insertPhotoAudit.run(repId, missingAfterCardId, JSON.stringify({ before: ['before-1434.jpg'] }));
  insertPhotoAudit.run(repId, otherRegionCardId, JSON.stringify({ after: ['after-2400.jpg'] }));
  db.prepare(`
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, new_values_json, created_at)
    VALUES (?, 'photo_upload', 'maintenance_card', ?, ?, datetime('now', '-1 day'))
  `).run(repId, yesterdayCardId, JSON.stringify({ after: ['after-1435.jpg'] }));

  const adminCannotUseRepData = await request('/api/rep/fault-reasons', {}, adminCookie);
  assert.equal(adminCannotUseRepData.response.status, 403);
  const anonymousCannotUseRepData = await request('/api/rep/fault-reasons');
  assert.equal(anonymousCannotUseRepData.response.status, 401);

  const wrongLogin = await request('/api/rep/login', jsonOptions('POST', {
    username: 'root-admin',
    password: 'Root-Administrator-Password-2026!',
  }));
  assert.equal(wrongLogin.response.status, 401);
  const regularLogin = await request('/api/auth/login', jsonOptions('POST', {
    username: 'rep-nour',
    password: 'Rep-Nour-Password-2026!',
  }));
  assert.equal(regularLogin.response.status, 401);

  const login = await request('/api/rep/login', jsonOptions('POST', {
    username: 'rep-nour',
    password: 'Rep-Nour-Password-2026!',
  }));
  assert.equal(login.response.status, 200);
  assert.equal(login.body.success, true);
  assert.equal(login.body.rep.role, 'rep');
  assert.deepEqual(login.body.rep.assignedRegions, ['التجمع']);
  assert.equal(login.body.rep.isOnline, true);
  assert.equal(login.body.token, undefined, 'rep sessions are delivered only through the HttpOnly cookie');
  assert.deepEqual(login.body.rep.lastLocation, {
    latitude: 24.8,
    longitude: 46.7,
    accuracy: 12,
    updatedAt: '2026-11-02T08:30:00.000Z',
  });
  assert.ok(login.cookie.startsWith('madar_token='));
  const repApkDownload = await fetch(`${baseUrl}/download/apk`, { headers: { cookie: login.cookie } });
  assert.equal(repApkDownload.status, 200);
  assert.equal(Buffer.from(await repApkDownload.arrayBuffer()).toString(), 'synthetic-debug-apk');
  db.prepare(`UPDATE employees SET phone = '+966500000001' WHERE user_id = ?`)
    .run(repId);

  const route = await request('/api/rep/today-route?username=rep-nour', {}, login.cookie);
  assert.equal(route.response.status, 200);
  assert.deepEqual(route.body.summary, { totalMachines: 3, completed: 1, pending: 2, pendingReview: 0, progress: 33 });
  assert.equal(route.body.regions.length, 1);
  assert.equal(route.body.regions[0].regionName, 'التجمع');
  assert.deepEqual(route.body.regions[0].machines.map((machine) => machine.machineCode), ['1433', '1434', '1435']);
  assert.equal(route.body.regions[0].machines[0].arabicName, 'ماكينة 1433');
  assert.equal(route.body.regions[0].machines[0].address, 'شارع التسعين');
  assert.equal(route.body.regions[0].machines[0].isCompleted, true);
  assert.equal(route.body.regions[0].machines[1].isCompleted, false);
  assert.equal(route.body.regions[0].machines[2].isCompleted, false);

  const otherRepRoute = await request('/api/rep/today-route?username=someone-else', {}, login.cookie);
  assert.equal(otherRepRoute.response.status, 403);
  const repCannotReadERPOrders = await request('/api/maintenance/orders?status=in_progress', {}, login.cookie);
  assert.equal(repCannotReadERPOrders.response.status, 403);
  const repCannotReadAdminUsers = await request('/api/auth/users', {}, login.cookie);
  assert.equal(repCannotReadAdminUsers.response.status, 403);
  const repCannotReadSupervisorRadar = await request('/api/supervisor/radar', {}, login.cookie);
  assert.equal(repCannotReadSupervisorRadar.response.status, 403);
  const repCannotReadSupervisorEvents = await request('/api/supervisor/events', {}, login.cookie);
  assert.equal(repCannotReadSupervisorEvents.response.status, 403);

  const faultReasons = await request('/api/rep/fault-reasons', {}, login.cookie);
  assert.equal(faultReasons.response.status, 200);
  assert.equal(faultReasons.body.success, true);
  assert.ok(faultReasons.body.reasons.some((reason) => reason.name === 'إصلاح إضاءة الليد والإنارة'));
  assert.ok(faultReasons.body.reasons.every((reason) => !('active' in reason)));

  const beforeBuffer = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#b7c4ce' } }).jpeg().toBuffer();
  const afterBuffer = await sharp({ create: { width: 70, height: 60, channels: 3, background: '#87b99d' } }).jpeg().toBuffer();
  const visitUuid = randomUUID();
  const currentTime = Date.now();
  const visitPayload = {
    visitUuid,
    cardId: missingAfterCardId,
    machineCode: '1434',
    regionName: 'التجمع',
    machineCondition: 'faulty',
    reasonIds: [faultReasons.body.reasons[0].id],
    notes: 'تم تنظيف الواجهة وفحص الإضاءة',
    capturedAt: new Date(currentTime).toISOString(),
    beforeCapturedAt: new Date(currentTime - 8 * 60 * 1000).toISOString(),
    afterCapturedAt: new Date(currentTime - 3 * 60 * 1000).toISOString(),
    location: { latitude: 24.8123, longitude: 46.7012, accuracy: 9, updatedAt: new Date(currentTime).toISOString() },
  };
  const buildVisitForm = (payload) => {
    const form = new FormData();
    form.append('visit', JSON.stringify(payload));
    form.append('beforePhoto', new Blob([beforeBuffer], { type: 'image/jpeg' }), 'before.jpg');
    form.append('afterPhoto', new Blob([afterBuffer], { type: 'image/jpeg' }), 'after.jpg');
    return form;
  };
  const visitSync = await request('/api/rep/sync-visit', {
    method: 'POST',
    body: buildVisitForm(visitPayload),
  }, login.cookie);
  assert.equal(visitSync.response.status, 200);
  assert.equal(visitSync.body.success, true);
  assert.equal(visitSync.body.status, 'pending_review');
  assert.equal(visitSync.body.visitUuid, visitUuid);
  const savedCard = db.prepare('SELECT before_photos_json, after_photos_json, reason_ids_json, notes, status FROM maintenance_cards WHERE id = ?')
    .get(missingAfterCardId);
  assert.equal(savedCard.status, 'pending', 'uploaded evidence must not mutate the maintenance card before supervisor approval');
  assert.equal(JSON.parse(savedCard.before_photos_json).length, 1);
  assert.equal(JSON.parse(savedCard.after_photos_json).length, 0);
  assert.deepEqual(JSON.parse(savedCard.reason_ids_json), []);
  assert.equal(savedCard.notes, null);
  const storedVisit = db.prepare('SELECT * FROM rep_visits WHERE visit_uuid = ?').get(visitUuid);
  assert.equal(storedVisit.status, 'completed');
  assert.equal(storedVisit.machine_condition, 'faulty');
  assert.equal(storedVisit.rep_user_id, repId);
  const beforePath = await resolveStorageFile(storedVisit.before_path);
  const afterPath = await resolveStorageFile(storedVisit.after_path);
  assert.ok(existsSync(beforePath));
  assert.ok(existsSync(afterPath));
  assert.ok(readFileSync(beforePath).length > 0);
  assert.ok(readFileSync(afterPath).length > 0);
  const pinnedMachine = db.prepare(`SELECT latitude, longitude, is_location_locked, geofence_radius_meters, area_name
    FROM machines WHERE id = ?`).get(storedVisit.machine_id);
  assert.deepEqual(pinnedMachine, {
    latitude: visitPayload.location.latitude,
    longitude: visitPayload.location.longitude,
    is_location_locked: 1,
    geofence_radius_meters: 50,
    area_name: 'التجمع',
  });
  assert.match(storedVisit.before_path, /^Areas\/التجمع\/1434_.*\/\d{4}-\d{2}-\d{2}_REP-ROUTE-1\/[0-9a-f-]{36}\/before\//i);

  const outsideFence = await request('/api/rep/sync-visit', {
    method: 'POST',
    body: buildVisitForm({
      ...visitPayload,
      visitUuid: randomUUID(),
      capturedAt: new Date().toISOString(),
      location: {
        latitude: visitPayload.location.latitude + 0.001,
        longitude: visitPayload.location.longitude,
        accuracy: 5,
        updatedAt: new Date().toISOString(),
      },
    }),
  }, login.cookie);
  assert.equal(outsideFence.response.status, 403);
  assert.match(outsideFence.body.error, /خارج نطاق الماكينة/);
  db.prepare("UPDATE rep_visits SET created_at = datetime('now', '-1 day') WHERE visit_uuid = ?").run(visitUuid);

  const pendingRoute = await request('/api/rep/today-route?username=rep-nour', {}, login.cookie);
  const pendingMachine = pendingRoute.body.regions.flatMap((region) => region.machines)
    .find((machine) => machine.cardId === missingAfterCardId);
  assert.equal(pendingMachine.isCompleted, false);
  assert.equal(pendingMachine.isSubmitted, true);
  assert.equal(pendingMachine.canVisit, false);

  const firstQa = await request('/api/supervisor/qa/queue', {}, adminCookie);
  assert.equal(firstQa.response.status, 200);
  assert.equal(firstQa.body.visits.length, 1);
  assert.equal(firstQa.body.visits[0].machineCode, '1434');
  assert.equal(firstQa.body.visits[0].machineCondition, 'faulty');
  assert.equal(firstQa.body.visits[0].siteDurationSeconds, 300);
  const beforePhotoResponse = await fetch(`${baseUrl}${firstQa.body.visits[0].beforePhotoUrl}`, { headers: { cookie: adminCookie } });
  assert.equal(beforePhotoResponse.status, 200);
  assert.match(beforePhotoResponse.headers.get('content-type'), /image\/jpeg/);
  const firstVisitId = db.prepare('SELECT id FROM rep_visits WHERE visit_uuid = ?').get(visitUuid).id;
  const reshoot = await request(`/api/supervisor/visits/${firstVisitId}/review`, jsonOptions('POST', {
    action: 'reshoot', note: 'الصورة مظلمة؛ أعد التصوير بإضاءة أوضح.',
  }), adminCookie);
  assert.equal(reshoot.response.status, 200);
  assert.equal(reshoot.body.status, 'reshoot_requested');
  const reshootRoute = await request('/api/rep/today-route?username=rep-nour', {}, login.cookie);
  const reshootMachine = reshootRoute.body.regions.flatMap((region) => region.machines)
    .find((machine) => machine.cardId === missingAfterCardId);
  assert.equal(reshootMachine.reviewStatus, 'reshoot');
  assert.equal(reshootMachine.reviewNote, 'الصورة مظلمة؛ أعد التصوير بإضاءة أوضح.');
  assert.equal(reshootMachine.canVisit, true);

  const retryAfterReshoot = await request('/api/rep/sync-visit', {
    method: 'POST',
    body: buildVisitForm(visitPayload),
  }, login.cookie);
  assert.equal(retryAfterReshoot.response.status, 200);
  assert.equal(retryAfterReshoot.body.idempotent, true);
  assert.equal(retryAfterReshoot.body.status, 'reshoot_requested');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_visits WHERE visit_uuid = ?').get(visitUuid).count, 1);

  const changedPayloadRetry = await request('/api/rep/sync-visit', {
    method: 'POST',
    body: buildVisitForm({ ...visitPayload, notes: 'محتوى مختلف بنفس UUID' }),
  }, login.cookie);
  assert.equal(changedPayloadRetry.response.status, 409);
  const invalidVisit = await request('/api/rep/sync-visit', {
    method: 'POST',
    body: buildVisitForm({ ...visitPayload, visitUuid: 'not-a-uuid' }),
  }, login.cookie);
  assert.equal(invalidVisit.response.status, 400);
  const adminCannotIngestRepVisit = await request('/api/rep/sync-visit', { method: 'POST' }, adminCookie);
  assert.equal(adminCannotIngestRepVisit.response.status, 403);

  const replacementPayload = {
    ...visitPayload,
    visitUuid: randomUUID(),
    notes: 'إعادة تصوير واضحة بعد ملاحظة المشرف',
    capturedAt: new Date().toISOString(),
    beforeCapturedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    afterCapturedAt: new Date(Date.now() - 60 * 1000).toISOString(),
  };
  const replacementSync = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm(replacementPayload),
  }, login.cookie);
  assert.equal(replacementSync.response.status, 200);
  assert.equal(replacementSync.body.status, 'pending_review');
  const replacementId = db.prepare('SELECT id FROM rep_visits WHERE visit_uuid = ?').get(replacementPayload.visitUuid).id;
  const approval = await request(`/api/supervisor/visits/${replacementId}/review`, jsonOptions('POST', { action: 'approve' }), adminCookie);
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.status, 'approved');
  const approvedCard = db.prepare('SELECT before_photos_json, after_photos_json, reason_ids_json, notes, status FROM maintenance_cards WHERE id = ?')
    .get(missingAfterCardId);
  assert.equal(approvedCard.status, 'completed');
  assert.equal(JSON.parse(approvedCard.before_photos_json).length, 2);
  assert.equal(JSON.parse(approvedCard.after_photos_json).length, 1);
  assert.ok(JSON.parse(approvedCard.reason_ids_json).includes(faultReasons.body.reasons[0].id));
  assert.match(approvedCard.notes, /إعادة تصوير واضحة/);

  const completedRoute = await request('/api/rep/today-route?username=rep-nour', {}, login.cookie);
  const completedMachine = completedRoute.body.regions.flatMap((region) => region.machines)
    .find((machine) => machine.cardId === missingAfterCardId);
  assert.equal(completedMachine.isCompleted, true, 'the route becomes complete only after supervisor approval');

  const idempotentRetry = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm(replacementPayload),
  }, login.cookie);
  assert.equal(idempotentRetry.response.status, 200);
  assert.equal(idempotentRetry.body.idempotent, true);
  assert.equal(idempotentRetry.body.status, 'approved');

  const now = Date.now();
  const trackPoints = [
    { latitude: 24.8000, longitude: 46.7000, accuracy: 10, updatedAt: new Date(now - 20000).toISOString() },
    { latitude: 24.8010, longitude: 46.7010, accuracy: 10, updatedAt: new Date(now - 10000).toISOString() },
  ];
  const eventController = new AbortController();
  const eventResponse = await fetch(`${baseUrl}/api/supervisor/events`, {
    headers: { cookie: adminCookie },
    signal: eventController.signal,
  });
  assert.equal(eventResponse.status, 200);
  assert.match(eventResponse.headers.get('content-type'), /text\/event-stream/);
  const eventReader = eventResponse.body.getReader();
  const trackingEventPromise = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await eventReader.read();
      if (done) throw new Error('Operations event stream closed before tracking event arrived.');
      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes('\n\n')) {
        const separator = buffer.indexOf('\n\n');
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.slice(6));
        if (event.type === 'rep.tracking.updated') return event;
      }
    }
  })();
  const tracking = await request('/api/rep/track-location', jsonOptions('POST', {
    onDuty: true, location: { ...trackPoints[1], updatedAt: new Date(now).toISOString() }, trail: trackPoints,
  }), login.cookie);
  assert.equal(tracking.response.status, 200);
  assert.equal(tracking.body.onDuty, true);
  let timeoutId;
  let trackingEvent;
  try {
    trackingEvent = await Promise.race([
      trackingEventPromise,
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Timed out waiting for live tracking event.')), 2000); }),
    ]);
  } finally {
    clearTimeout(timeoutId);
    eventController.abort();
  }
  assert.equal(trackingEvent.userId, repId);
  assert.equal(trackingEvent.acceptedPoints, 3);
  const duplicateTracking = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: true, location: { ...trackPoints[1], updatedAt: new Date(now).toISOString() }, trail: trackPoints,
  }), login.cookie);
  assert.equal(duplicateTracking.response.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_points WHERE rep_user_id = ?').get(repId).count, 3);
  const stopBase = Date.now();
  const stopTrail = [-7, -5, -3, -1].map((minutes) => ({
    latitude: 24.8020,
    longitude: 46.7020,
    accuracy: 8,
    speed: 0,
    updatedAt: new Date(stopBase + minutes * 60 * 1000).toISOString(),
  }));
  const locationPing = await request('/api/rep/location-ping', jsonOptions('POST', {
    trail: stopTrail,
  }), login.cookie);
  assert.equal(locationPing.response.status, 200, JSON.stringify(locationPing.body));
  assert.equal(locationPing.body.acceptedPoints, 4);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM rep_location_breadcrumbs
    WHERE user_id = ? AND is_stop = 1`).get(repId).count, 4);
  const stopRow = db.prepare(`SELECT stop_duration_minutes, stop_arrived_at, stop_departed_at
    FROM rep_location_breadcrumbs WHERE user_id = ? AND is_stop = 1 ORDER BY recorded_at LIMIT 1`).get(repId);
  assert.equal(stopRow.stop_duration_minutes, 6);
  assert.ok(stopRow.stop_arrived_at);
  assert.ok(stopRow.stop_departed_at);
  const fakeGps = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: true,
    location: { latitude: 24.8, longitude: 46.7, accuracy: 5, updatedAt: new Date().toISOString(), is_mock: true },
  }), login.cookie);
  assert.equal(fakeGps.response.status, 400);
  const adminRadar = await request('/api/supervisor/radar', {}, adminCookie);
  assert.equal(adminRadar.response.status, 200);
  const nourOnRadar = adminRadar.body.representatives.find((rep) => rep.id === repId);
  assert.equal(nourOnRadar.status, 'active');
  assert.equal(nourOnRadar.completedToday, 1);
  assert.equal(nourOnRadar.phone, '+966500000001');
  assert.ok(nourOnRadar.distanceKm > 0);
  const localDate = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  const routeDate = `${localDate.year}-${localDate.month}-${localDate.day}`;
  const repRoute = await request(`/api/supervisor/reps/${repId}/route?date=${routeDate}`, {}, adminCookie);
  assert.equal(repRoute.response.status, 200, JSON.stringify(repRoute.body));
  assert.equal(repRoute.body.date, routeDate);
  assert.ok(repRoute.body.polyline.length >= 7);
  assert.equal(repRoute.body.stops.length, 1);
  assert.equal(repRoute.body.stops[0].durationMinutes, 6);

  const activeSession = db.prepare('SELECT id FROM rep_duty_sessions WHERE rep_user_id = ? AND ended_at IS NULL').get(repId);
  const finalTrailPoint = {
    latitude: 24.8020, longitude: 46.7020, accuracy: 8,
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  const stopTracking = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: false, location: null, trail: [finalTrailPoint],
  }), login.cookie);
  assert.equal(stopTracking.response.status, 200);
  assert.equal(stopTracking.body.onDuty, false);
  assert.equal(stopTracking.body.acceptedPoints, 1);
  assert.ok(db.prepare('SELECT ended_at FROM rep_duty_sessions WHERE id = ?').get(activeSession.id).ended_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_points WHERE duty_session_id = ?').get(activeSession.id).count, 8);

  const approvedWorkbook = await fetch(`${baseUrl}/api/supervisor/reports/approved-visits.xlsx`, { headers: { cookie: adminCookie } });
  assert.equal(approvedWorkbook.status, 200);
  assert.match(approvedWorkbook.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.equal(Buffer.from(await approvedWorkbook.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const maintenancePptx = await fetch(`${baseUrl}/api/maintenance/orders/${orderId}/export.pptx?useFixedLogoOnCover=true`, { headers: { cookie: adminCookie } });
  assert.equal(maintenancePptx.status, 200);
  assert.match(maintenancePptx.headers.get('content-type'), /presentationml\.presentation/);
  assert.equal(Buffer.from(await maintenancePptx.arrayBuffer()).subarray(0, 2).toString(), 'PK');

  const interruptedUuid = randomUUID();
  const interruptedStage = storageDirectory('.madar-recovery', 'rep-visits', interruptedUuid);
  const interruptedFinal = storageDirectory('clients', 'REP-CLIENT', 'maintenance', 'REP-ROUTE-1', '1434', 'visits', interruptedUuid);
  await ensureStorageDirectory('.madar-recovery', 'rep-visits', interruptedUuid);
  await ensureStorageDirectory('clients', 'REP-CLIENT', 'maintenance', 'REP-ROUTE-1', '1434', 'visits', interruptedUuid);
  await writeStorageFile(storageDirectory(interruptedStage, 'partial.jpg'), beforeBuffer);
  await writeStorageFile(storageDirectory(interruptedFinal, 'partial.jpg'), afterBuffer);
  db.prepare(`
    INSERT INTO rep_visits (
      visit_uuid, rep_user_id, order_id, card_id, machine_id, order_code, machine_code,
      region_name, payload_sha256, status, captured_at, staging_path, final_path
    ) VALUES (?, ?, ?, ?, ?, 'REP-ROUTE-1', '1434', 'التجمع', ?, 'receiving', ?, ?, ?)
  `).run(interruptedUuid, repId, orderId, missingAfterCardId,
    db.prepare('SELECT id FROM machines WHERE code = ?').get('1434').id,
    'a'.repeat(64), new Date().toISOString(), interruptedStage, interruptedFinal);
  const recovered = await recoverRepVisitUploads();
  assert.equal(recovered.recoveredCount, 1);
  assert.equal(db.prepare('SELECT status FROM rep_visits WHERE visit_uuid = ?').get(interruptedUuid).status, 'failed');
  assert.equal(existsSync(join(temporaryDirectory, 'storage', ...interruptedStage.split('/'))), false);
  assert.equal(existsSync(join(temporaryDirectory, 'storage', ...interruptedFinal.split('/'))), false);

  const disabledRep = await request(`/api/users/${repId}`, jsonOptions('PUT', { isActive: 0 }), adminCookie);
  assert.equal(disabledRep.response.status, 200);
  assert.equal(disabledRep.body.isActive, 0);
  assert.equal(disabledRep.body.active, 0);
  assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE user_id = ?').get(repId).revoked_at,
    'disabling a rep revokes existing sessions immediately');

  const disabledRepCalls = await Promise.all([
    request('/api/rep/today-route?username=rep-nour', {}, login.cookie),
    request('/api/rep/fault-reasons', {}, login.cookie),
    request('/api/rep/tracking', jsonOptions('POST', { onDuty: false, location: null, trail: [] }), login.cookie),
    request('/api/rep/sync-visit', { method: 'POST' }, login.cookie),
  ]);
  for (const result of disabledRepCalls) {
    assert.equal(result.response.status, 403);
    assert.deepEqual(result.body, { success: false, message: 'تم تعطيل حسابك من قبل الإدارة' });
  }
  const disabledRepLogin = await request('/api/rep/login', jsonOptions('POST', {
    username: 'rep-nour', password: 'Rep-Nour-Password-2026!',
  }));
  assert.equal(disabledRepLogin.response.status, 403);
  assert.deepEqual(disabledRepLogin.body, { success: false, message: 'تم تعطيل حسابك من قبل الإدارة' });
  const disabledStatus = await request('/api/auth/status', {}, login.cookie);
  assert.equal(disabledStatus.body.authenticated, false);
  assert.equal(disabledStatus.body.message, 'تم تعطيل حسابك من قبل الإدارة');

  const logout = await request('/api/auth/logout', { method: 'POST' }, login.cookie);
  assert.equal(logout.response.status, 200);
  assert.equal(db.prepare('SELECT is_online FROM users WHERE id = ?').get(repId).is_online, 0);
  assert.ok(db.prepare('SELECT ended_at FROM rep_duty_sessions WHERE rep_user_id = ?').get(repId).ended_at);
});
