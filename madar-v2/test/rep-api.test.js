import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import Database from 'better-sqlite3';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-rep-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'rep.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_OFFLINE_MAP_PATH = join(temporaryDirectory, 'local-map.mbtiles');
process.env.MADAR_REP_APK_PATH = join(temporaryDirectory, 'madar-rep.apk');
process.env.REP_ATTENDANCE_MAX_OFFLINE_AGE_HOURS = '24';
process.env.STORAGE_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [
  { app },
  { createConnection, db },
  {
    initializeDatabase,
    migrateMachineGeofenceAndBreadcrumbs,
    migrateMachineVerificationAndCorrections,
    migrateRepSupervisorRadar,
    migrateRepUserProfiles,
    migrateRepVisitMachineCondition,
  },
  { default: sharp },
  { ensureStorageDirectory, resolveStorageFile, storageDirectory, writeStorageFile },
  { recoverRepVisitUploads },
  { recoverMachineCorrectionRenames },
  { closeOfflineMap },
  { env },
] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('sharp'),
  import('../server/modules/storage.js'),
  import('../server/modules/rep/service.js'),
  import('../server/modules/maintenance/service.js'),
  import('../server/modules/supervisor/offline-tiles.js'),
  import('../server/config/env.js'),
]);

initializeDatabase({ initialAdminPassword: '' });
const tileDatabase = new Database(process.env.MADAR_V2_OFFLINE_MAP_PATH);
tileDatabase.exec(`
  CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB,
    PRIMARY KEY (zoom_level, tile_column, tile_row));
  INSERT INTO metadata (name, value) VALUES ('name', 'MADAR local test map'), ('format', 'png'), ('minzoom', '1'), ('maxzoom', '8');
`);
tileDatabase.prepare('INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (1, 1, 1, ?)')
  .run(Buffer.from('local-raster-tile'));
tileDatabase.prepare('INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (8, 150, 150, ?)')
  .run(Buffer.from('cairo-raster-tile'));
writeFileSync(process.env.MADAR_REP_APK_PATH, Buffer.from('synthetic-debug-apk'));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let legacyDatabase;

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  closeOfflineMap();
  if (tileDatabase.open) tileDatabase.close();
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

async function withFrozenNow(milliseconds, callback) {
  const actualNow = Date.now;
  Date.now = () => milliseconds;
  try {
    return await callback();
  } finally {
    Date.now = actualNow;
  }
}

async function readOperationsEvent(response, expectedType) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Operations stream closed before ${expectedType} arrived.`);
    buffer += decoder.decode(value, { stream: true });
    while (buffer.includes('\n\n')) {
      const separator = buffer.indexOf('\n\n');
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(6));
      if (event.type === expectedType) return event;
    }
  }
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
  migrateMachineVerificationAndCorrections(db);
  migrateMachineVerificationAndCorrections(db);
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
  assert.ok(db.prepare(`SELECT 1 FROM schema_migrations WHERE version = '20261104-machine-verification-corrections'`).get());
  assert.ok(db.prepare(`SELECT 1 FROM schema_migrations WHERE version = '20261104-machine-correction-rename-recovery'`).get());
  for (const table of ['rep_machine_location_verifications', 'machine_correction_requests', 'machine_correction_reviews']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), `missing ${table}`);
  }
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'machine_correction_rename_operations'").get());
  assert.ok(db.pragma('table_info(machine_correction_reviews)').some((column) => column.name === 'approved_code'));
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('rep login, assigned-region route sync, active fault reasons, and strict API isolation', async () => {
  const anonymousApk = await request('/download/apk');
  assert.equal(anonymousApk.response.status, 401);
  const anonymousApkStatus = await request('/download/apk/status');
  assert.equal(anonymousApkStatus.response.status, 401);

  const setup = await request('/api/auth/setup', jsonOptions('POST', {
    username: 'root-admin',
    fullName: 'Root Administrator',
    password: 'Root-Administrator-Password-2026!',
  }));
  assert.equal(setup.response.status, 201);
  const adminCookie = setup.cookie;
  assert.ok(adminCookie.startsWith('madar_token='));
  const adminApkStatus = await request('/download/apk/status', {}, adminCookie);
  assert.equal(adminApkStatus.response.status, 200);
  assert.deepEqual(adminApkStatus.body, {
    available: true,
    artifactType: 'fallback',
    sizeBytes: Buffer.byteLength('synthetic-debug-apk'),
    modifiedAt: adminApkStatus.body.modifiedAt,
  });
  assert.ok(Number.isFinite(Date.parse(adminApkStatus.body.modifiedAt)));
  const mapStatus = await request('/api/supervisor/map/status', {}, adminCookie);
  assert.deepEqual(mapStatus.body, {
    available: true,
    renderable: true,
    format: 'png',
    name: 'MADAR local test map',
    attribution: '',
    minZoom: 1,
    maxZoom: 8,
    bounds: null,
  });
  const localTile = await fetch(`${baseUrl}/api/supervisor/map/tiles/1/1/0`, { headers: { cookie: adminCookie } });
  assert.equal(localTile.status, 200);
  assert.equal(localTile.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await localTile.arrayBuffer()).toString(), 'local-raster-tile');
  const invalidLocalTile = await request('/api/supervisor/map/tiles/1/2/0', {}, adminCookie);
  assert.equal(invalidLocalTile.response.status, 400);
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
  assert.equal(regularLogin.response.status, 200, JSON.stringify(regularLogin.body));
  assert.equal(regularLogin.body.role, 'rep');
  assert.equal(regularLogin.body.user.role, 'rep');
  assert.match(regularLogin.body.token, /^eyJ/, 'the unified login returns a bearer token alongside its session cookie');

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
  const nativeLogin = await request('/api/rep/login', {
    ...jsonOptions('POST', { username: 'rep-nour', password: 'Rep-Nour-Password-2026!' }),
    headers: { 'content-type': 'application/json', 'x-madar-native-client': 'android' },
  });
  assert.equal(nativeLogin.response.status, 200);
  assert.match(nativeLogin.body.token, /^eyJ/);
  const nativeBearerRoute = await request('/api/rep/today-route?username=rep-nour', {
    headers: { authorization: `Bearer ${nativeLogin.body.token}` },
  });
  assert.equal(nativeBearerRoute.response.status, 200, 'native background jobs authenticate with the bearer token returned only to the native client');

  const offlineClockInUuid = randomUUID();
  const clockInAt = new Date(Date.now() - 60_000).toISOString();
  const attendanceLocation = {
    latitude: 30.0123,
    longitude: 31.2345,
    accuracy: 18,
    updatedAt: clockInAt,
  };
  const offlineClockInPayload = {
    actionUuid: offlineClockInUuid,
    action: 'in',
    occurredAt: clockInAt,
    location: attendanceLocation,
    biometricVerified: true,
  };
  const offlineClockIn = await request('/api/rep/attendance/sync', jsonOptions('POST', offlineClockInPayload), login.cookie);
  assert.equal(offlineClockIn.response.status, 200);
  assert.equal(offlineClockIn.body.success, true);
  assert.equal(offlineClockIn.body.idempotent, false);
  assert.equal(offlineClockIn.body.attendance.clock_in_source, 'app');
  assert.equal(offlineClockIn.body.attendance.clock_in_biometric_verified, 1);
  assert.equal(offlineClockIn.body.attendance.clock_in_accuracy, 18);
  const repeatedClockIn = await request('/api/rep/attendance/sync', jsonOptions('POST', offlineClockInPayload), login.cookie);
  assert.equal(repeatedClockIn.response.status, 200);
  assert.equal(repeatedClockIn.body.idempotent, true);
  assert.equal(repeatedClockIn.body.attendance.id, offlineClockIn.body.attendance.id);
  const changedClockInReplay = await request('/api/rep/attendance/sync', jsonOptions('POST', {
    ...offlineClockInPayload,
    location: { ...attendanceLocation, accuracy: 19 },
  }), login.cookie);
  assert.equal(changedClockInReplay.response.status, 409);
  const inaccurateClockIn = await request('/api/rep/attendance/sync', jsonOptions('POST', {
    ...offlineClockInPayload,
    actionUuid: randomUUID(),
    location: { ...attendanceLocation, accuracy: 251 },
  }), login.cookie);
  assert.equal(inaccurateClockIn.response.status, 400);

  const clockOutAt = new Date(Date.now() - 30_000).toISOString();
  const clockOutPayload = {
    actionUuid: randomUUID(),
    action: 'out',
    occurredAt: clockOutAt,
    location: { ...attendanceLocation, updatedAt: clockOutAt },
    biometricVerified: true,
  };
  const offlineClockOut = await request('/api/rep/attendance/sync', jsonOptions('POST', clockOutPayload), login.cookie);
  assert.equal(offlineClockOut.response.status, 200);
  assert.equal(offlineClockOut.body.attendance.clock_out_source, 'app');
  assert.equal(offlineClockOut.body.attendance.clock_out_biometric_verified, 1);
  const repeatedClockOut = await request('/api/rep/attendance/sync', jsonOptions('POST', clockOutPayload), login.cookie);
  assert.equal(repeatedClockOut.response.status, 200);
  assert.equal(repeatedClockOut.body.idempotent, true);

  assert.equal(env.repAttendanceMaxOfflineAgeHours, 24);
  const policyNow = Date.now();
  const maxOfflineAgeMs = 24 * 60 * 60 * 1000;
  const boundaryAction = {
    actionUuid: randomUUID(),
    action: 'in',
    occurredAt: new Date(policyNow - maxOfflineAgeMs).toISOString(),
    location: { ...attendanceLocation, updatedAt: new Date(policyNow - maxOfflineAgeMs).toISOString() },
    biometricVerified: true,
  };
  const exactBoundary = await withFrozenNow(policyNow, () => request('/api/rep/attendance/sync',
    jsonOptions('POST', boundaryAction), login.cookie));
  assert.equal(exactBoundary.response.status, 200, JSON.stringify(exactBoundary.body));
  assert.equal(exactBoundary.body.idempotent, false);
  const attendanceId = exactBoundary.body.attendance.id;
  const boundaryAuditCount = db.prepare(`SELECT COUNT(*) AS count FROM audit_log
    WHERE entity_type = 'employee_attendance' AND entity_id = ?`).get(attendanceId).count;
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_attendance_sync_actions WHERE action_uuid = ?')
    .get(boundaryAction.actionUuid).count, 1);

  const oldClockOut = {
    actionUuid: randomUUID(), action: 'out',
    occurredAt: new Date(policyNow - maxOfflineAgeMs - 1).toISOString(),
    biometricVerified: true,
  };
  const auditCountBeforeOldOut = db.prepare(`SELECT COUNT(*) AS count FROM audit_log
    WHERE entity_type = 'employee_attendance' AND entity_id = ?`).get(attendanceId).count;
  const expiredClockOut = await withFrozenNow(policyNow, () => request('/api/rep/attendance/sync',
    jsonOptions('POST', oldClockOut), login.cookie));
  assert.equal(expiredClockOut.response.status, 409);
  assert.equal(expiredClockOut.body.code, 'ATTENDANCE_REVIEW_REQUIRED');
  assert.match(expiredClockOut.body.error, /24-hour window/);
  const unchangedOpenAttendance = db.prepare('SELECT clock_out_time FROM employee_daily_attendance WHERE id = ?').get(attendanceId);
  assert.equal(unchangedOpenAttendance.clock_out_time, null, 'expired clock-out must not affect payroll-effective attendance');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM audit_log
    WHERE entity_type = 'employee_attendance' AND entity_id = ?`).get(attendanceId).count, auditCountBeforeOldOut);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_attendance_sync_actions WHERE action_uuid = ?')
    .get(oldClockOut.actionUuid).count, 0, 'rejected action UUID is not recorded as accepted');

  const expiredPunches = [
    {
      actionUuid: randomUUID(), action: 'in',
      occurredAt: new Date(policyNow - maxOfflineAgeMs - 1).toISOString(),
      location: { ...attendanceLocation, updatedAt: new Date(policyNow - maxOfflineAgeMs - 1).toISOString() },
      biometricVerified: true,
    },
    {
      actionUuid: randomUUID(), action: 'in', occurredAt: '2001-01-15T12:00:00.000Z',
      location: { ...attendanceLocation, updatedAt: '2001-01-15T12:00:00.000Z' }, biometricVerified: true,
    },
  ];
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payroll_runs WHERE month_year = ?').get('2001-01').count,
    0, 'the arbitrarily old test date is in an unfinalized payroll month');
  for (const expiredPunch of expiredPunches) {
    const beforeRows = db.prepare('SELECT COUNT(*) AS count FROM employee_daily_attendance WHERE employee_id = ?')
      .get(db.prepare('SELECT id FROM employees WHERE user_id = ?').get(repId).id).count;
    const beforeAudit = db.prepare(`SELECT COUNT(*) AS count FROM audit_log
      WHERE actor_id = ? AND entity_type = 'employee_attendance'`).get(repId).count;
    const rejection = await withFrozenNow(policyNow, () => request('/api/rep/attendance/sync',
      jsonOptions('POST', expiredPunch), login.cookie));
    assert.equal(rejection.response.status, 409, JSON.stringify(rejection.body));
    assert.equal(rejection.body.code, 'ATTENDANCE_REVIEW_REQUIRED');
    assert.equal(typeof rejection.body.error, 'string');
    assert.ok(rejection.body.error.length > 0, 'the server returns a reconciliation reason');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM employee_daily_attendance WHERE employee_id = ?')
      .get(db.prepare('SELECT id FROM employees WHERE user_id = ?').get(repId).id).count, beforeRows);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM audit_log
      WHERE actor_id = ? AND entity_type = 'employee_attendance'`).get(repId).count, beforeAudit);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_attendance_sync_actions WHERE action_uuid = ?')
      .get(expiredPunch.actionUuid).count, 0);
  }

  const futurePunch = {
    ...boundaryAction,
    actionUuid: randomUUID(),
    occurredAt: new Date(policyNow + 5 * 60 * 1000 + 1).toISOString(),
  };
  futurePunch.location = { ...attendanceLocation, updatedAt: futurePunch.occurredAt };
  const futureRejected = await withFrozenNow(policyNow, () => request('/api/rep/attendance/sync',
    jsonOptions('POST', futurePunch), login.cookie));
  assert.equal(futureRejected.response.status, 400);
  assert.match(futureRejected.body.error, /five minutes in the future/);

  const acceptedReplay = await withFrozenNow(policyNow + maxOfflineAgeMs + 1, () => request(
    '/api/rep/attendance/sync', jsonOptions('POST', boundaryAction), login.cookie));
  assert.equal(acceptedReplay.response.status, 200, JSON.stringify(acceptedReplay.body));
  assert.equal(acceptedReplay.body.idempotent, true, 'accepted action replay is checked before age policy');
  assert.equal(acceptedReplay.body.attendance.id, attendanceId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_attendance_sync_actions WHERE action_uuid = ?')
    .get(boundaryAction.actionUuid).count, 1, 'accepted replay does not create a duplicate action record');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM audit_log
    WHERE entity_type = 'employee_attendance' AND entity_id = ?`).get(attendanceId).count, boundaryAuditCount,
  'accepted replay does not create a duplicate attendance audit effect');
  const changedExpiredReplay = await withFrozenNow(policyNow + maxOfflineAgeMs + 1, () => request(
    '/api/rep/attendance/sync', jsonOptions('POST', {
      ...boundaryAction,
      location: { ...boundaryAction.location, accuracy: boundaryAction.location.accuracy + 1 },
    }), login.cookie));
  assert.equal(changedExpiredReplay.response.status, 409);
  assert.notEqual(changedExpiredReplay.body.code, 'ATTENDANCE_REVIEW_REQUIRED');

  const unauthenticatedPunch = await request('/api/rep/attendance/sync', jsonOptions('POST', boundaryAction));
  assert.equal(unauthenticatedPunch.response.status, 401);
  const otherRepCreated = await request('/api/users', jsonOptions('POST', {
    username: 'attendance-isolation-rep', full_name: 'Attendance Isolation Rep', role: 'rep',
    assignedRegions: [], password: 'Attendance-Isolation-Password-2026!',
  }), adminCookie);
  assert.equal(otherRepCreated.response.status, 201, JSON.stringify(otherRepCreated.body));
  const otherRepLogin = await request('/api/auth/login', jsonOptions('POST', {
    username: 'attendance-isolation-rep', password: 'Attendance-Isolation-Password-2026!',
  }));
  assert.equal(otherRepLogin.response.status, 200);
  const otherRepReplay = await withFrozenNow(policyNow + maxOfflineAgeMs + 1, () => request(
    '/api/rep/attendance/sync', jsonOptions('POST', boundaryAction), otherRepLogin.cookie));
  assert.equal(otherRepReplay.response.status, 409, 'another representative cannot replay the first representative action UUID');
  assert.notEqual(otherRepReplay.body.code, 'ATTENDANCE_REVIEW_REQUIRED');

  const cleanupClockOut = {
    actionUuid: randomUUID(), action: 'out', occurredAt: new Date(policyNow).toISOString(),
    biometricVerified: true,
  };
  const cleanupResult = await withFrozenNow(policyNow, () => request('/api/rep/attendance/sync',
    jsonOptions('POST', cleanupClockOut), login.cookie));
  assert.equal(cleanupResult.response.status, 200, JSON.stringify(cleanupResult.body));

  const mockAttendanceAudit = await request('/api/rep/attendance/mock-location', jsonOptions('POST', {
    action: 'tracking',
    detectedAt: new Date().toISOString(),
    is_mock: true,
  }), login.cookie);
  assert.equal(mockAttendanceAudit.response.status, 200);
  assert.equal(mockAttendanceAudit.body.audited, true);
  const mockTrackingRejected = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: false,
    is_mock: true,
  }), login.cookie);
  assert.equal(mockTrackingRejected.response.status, 400);
  assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE actor_id = ? AND action = 'mock_location_attempt' LIMIT 1`).get(repId));

  const repApkStatus = await request('/download/apk/status', {}, login.cookie);
  assert.equal(repApkStatus.response.status, 200);
  assert.equal(repApkStatus.body.artifactType, 'fallback');
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
  const unpinnedMachine = route.body.regions[0].machines.find((machine) => machine.machineCode === '1434');
  assert.equal(unpinnedMachine.isLocationLocked, false);
  assert.equal(unpinnedMachine.areaName, 'التجمع');

  const universalRep = await request('/api/users', jsonOptions('POST', {
    username: 'rep-all-regions',
    full_name: 'Universal Field Rep',
    role: 'rep',
    assignedRegions: [],
    password: 'Rep-All-Regions-2026!',
  }), adminCookie);
  assert.equal(universalRep.response.status, 201, JSON.stringify(universalRep.body));
  assert.deepEqual(universalRep.body.assignedRegions, [], 'the user-management blank value remains backward-compatible and means universal access');
  const universalRepId = universalRep.body.id;
  db.prepare('INSERT INTO maintenance_order_reps (order_id, user_id) VALUES (?, ?)').run(orderId, universalRepId);
  const universalLogin = await request('/api/rep/login', jsonOptions('POST', {
    username: 'rep-all-regions', password: 'Rep-All-Regions-2026!',
  }));
  assert.equal(universalLogin.response.status, 200, JSON.stringify(universalLogin.body));
  const universalRoute = await request('/api/rep/today-route?username=rep-all-regions', {}, universalLogin.cookie);
  assert.equal(universalRoute.response.status, 200, JSON.stringify(universalRoute.body));
  assert.equal(universalRoute.body.summary.totalMachines, 4, 'empty region assignments expose all cards on assigned maintenance orders');
  assert.equal(universalRoute.body.regions.find((item) => item.regionName === 'الرياض')?.machines.some((machine) => machine.machineCode === '2400'), true);
  assert.equal(universalRoute.body.regions.find((item) => item.regionName === 'التجمع')?.machines.some((machine) => machine.machineCode === '1434'), true);
  const clearUniversalRepRegions = await request(`/api/users/${universalRepId}`, jsonOptions('PUT', {
    assignedRegions: [],
  }), adminCookie);
  assert.equal(clearUniversalRepRegions.response.status, 200, JSON.stringify(clearUniversalRepRegions.body));
  assert.deepEqual(clearUniversalRepRegions.body.assignedRegions, []);
  const emptyUpdateRoute = await request('/api/rep/today-route?username=rep-all-regions', {}, universalLogin.cookie);
  assert.equal(emptyUpdateRoute.body.summary.totalMachines, 4, 'clearing the optional region field preserves universal access');
  for (const universalRegion of ['*', 'all', 'الكل']) {
    const setUniversalRegion = await request(`/api/users/${universalRepId}`, jsonOptions('PUT', {
      assignedRegions: [universalRegion],
    }), adminCookie);
    assert.equal(setUniversalRegion.response.status, 200, JSON.stringify(setUniversalRegion.body));
    assert.deepEqual(setUniversalRegion.body.assignedRegions, [universalRegion]);
    const wildcardRoute = await request('/api/rep/today-route?username=rep-all-regions', {}, universalLogin.cookie);
    assert.equal(wildcardRoute.response.status, 200);
    assert.equal(wildcardRoute.body.summary.totalMachines, 4, `${universalRegion} is a universal-access marker`);
  }

  const repMapCatalog = await request('/api/rep/map/packs', {}, login.cookie);
  assert.equal(repMapCatalog.response.status, 200);
  assert.equal(repMapCatalog.body.success, true);
  const cairoPack = repMapCatalog.body.packs.find((pack) => pack.id === 'greater-cairo');
  assert.equal(cairoPack.available, true);
  assert.equal(cairoPack.tileCount, 1);
  assert.equal(cairoPack.minZoom, 8);
  const cairoManifest = await request('/api/rep/map/packs/greater-cairo/manifest', {}, login.cookie);
  assert.equal(cairoManifest.response.status, 200);
  assert.deepEqual(cairoManifest.body.pack.tiles, [{ z: 8, x: 150, y: 105, sizeBytes: Buffer.byteLength('cairo-raster-tile') }]);
  const repMapTile = await fetch(`${baseUrl}/api/rep/map/tiles/greater-cairo/8/150/105`, { headers: { cookie: login.cookie } });
  assert.equal(repMapTile.status, 200);
  assert.equal(repMapTile.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await repMapTile.arrayBuffer()).toString(), 'cairo-raster-tile');
  const tileOutsideMapPack = await request('/api/rep/map/tiles/greater-cairo/8/0/0', {}, login.cookie);
  assert.equal(tileOutsideMapPack.response.status, 400);
  const invalidRepMapPack = await request('/api/rep/map/packs/not-a-region/manifest', {}, login.cookie);
  assert.equal(invalidRepMapPack.response.status, 404);

  const otherRepRoute = await request('/api/rep/today-route?username=someone-else', {}, login.cookie);
  assert.equal(otherRepRoute.response.status, 403);
  const repCannotReadERPOrders = await request('/api/maintenance/orders?status=in_progress', {}, login.cookie);
  assert.equal(repCannotReadERPOrders.response.status, 403);
  const repCannotReadTreasury = await request('/api/finance/treasury', {}, login.cookie);
  assert.equal(repCannotReadTreasury.response.status, 403);
  const repCannotReadAdminUsers = await request('/api/auth/users', {}, login.cookie);
  assert.equal(repCannotReadAdminUsers.response.status, 403);
  const repCannotReadSupervisorRadar = await request('/api/supervisor/radar', {}, login.cookie);
  assert.equal(repCannotReadSupervisorRadar.response.status, 403);
  const repCannotReadSupervisorEvents = await request('/api/supervisor/events', {}, login.cookie);
  assert.equal(repCannotReadSupervisorEvents.response.status, 403);
  const adminCannotReadRepEvents = await request('/api/rep/events', {}, adminCookie);
  assert.equal(adminCannotReadRepEvents.response.status, 403);

  const faultReasons = await request('/api/rep/fault-reasons', {}, login.cookie);
  assert.equal(faultReasons.response.status, 200);
  assert.equal(faultReasons.body.success, true);
  assert.ok(faultReasons.body.reasons.some((reason) => reason.name === 'إصلاح إضاءة الليد والإنارة'));
  assert.ok(faultReasons.body.reasons.every((reason) => !('active' in reason)));
  const structuredReasonId = Number(faultReasons.body.reasons[0].id);
  db.prepare(`UPDATE maintenance_reasons SET category = 'electrical_lighting', action_meaning = 'executed_work',
    is_countable = 1, unit = 'piece' WHERE id = ?`).run(structuredReasonId);

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
    reasonIds: [structuredReasonId],
    maintenanceLines: [{ reasonId: structuredReasonId, quantity: 3, unit: 'piece' }],
    notes: 'تم تنظيف الواجهة وفحص الإضاءة',
    capturedAt: new Date(currentTime).toISOString(),
    beforeCapturedAt: [
      new Date(currentTime - 8 * 60 * 1000).toISOString(),
      new Date(currentTime - 7 * 60 * 1000).toISOString(),
      new Date(currentTime - 6 * 60 * 1000).toISOString(),
    ],
    afterCapturedAt: [
      new Date(currentTime - 3 * 60 * 1000).toISOString(),
      new Date(currentTime - 2 * 60 * 1000).toISOString(),
      new Date(currentTime - 1 * 60 * 1000).toISOString(),
    ],
    location: { latitude: 24.8123, longitude: 46.7012, accuracy: 9, updatedAt: new Date(currentTime).toISOString() },
  };
  const buildVisitForm = (payload, beforeCount = 3, afterCount = 3) => {
    const form = new FormData();
    form.append('visit', JSON.stringify(payload));
    for (let index = 0; index < beforeCount; index += 1) form.append('beforePhoto', new Blob([beforeBuffer], { type: 'image/jpeg' }), `before_${index}.jpg`);
    for (let index = 0; index < afterCount; index += 1) form.append('afterPhoto', new Blob([afterBuffer], { type: 'image/jpeg' }), `after_${index}.jpg`);
    return form;
  };
  const legacyCountableVisit = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm({ ...visitPayload, visitUuid: randomUUID(), maintenanceLines: undefined }),
  }, login.cookie);
  assert.equal(legacyCountableVisit.response.status, 426);
  assert.equal(legacyCountableVisit.body.code, 'MAINTENANCE_STRUCTURED_LINES_REQUIRED');
  const tooFewPhotos = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm({ ...visitPayload, visitUuid: randomUUID() }, 2, 3),
  }, login.cookie);
  assert.equal(tooFewPhotos.response.status, 400);
  assert.match(tooFewPhotos.body.error, /exactly three/);

  const unpinnedVisit = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm({ ...visitPayload, visitUuid: randomUUID() }),
  }, login.cookie);
  assert.equal(unpinnedVisit.response.status, 409);
  assert.match(unpinnedVisit.body.error, /تثبيت موقع الماكينة/);
  const targetMachineId = db.prepare('SELECT id FROM machines WHERE code = ?').get('1434').id;
  // Location lifecycle assertions run independently in location-approval.test.js.
  // This broader visit scenario requires two first-location confirmations.
  const otherRegionMachineId = db.prepare('SELECT id FROM machines WHERE code = ?').get('2400').id;
  const universalLocationConfirmation = await request(`/api/rep/machines/${otherRegionMachineId}/confirm-location`, jsonOptions('POST', {
    actionUuid: randomUUID(), cardId: otherRegionCardId, location: visitPayload.location,
  }), universalLogin.cookie);
  assert.equal(universalLocationConfirmation.response.status, 201, JSON.stringify(universalLocationConfirmation.body));
  assert.equal(universalLocationConfirmation.body.status, 'approved');
  const locationConfirmationPayload = {
    actionUuid: randomUUID(),
    cardId: missingAfterCardId,
    location: visitPayload.location,
  };
  const locationConfirmation = await request(`/api/rep/machines/${targetMachineId}/confirm-location`, jsonOptions('POST', locationConfirmationPayload), login.cookie);
  assert.equal(locationConfirmation.response.status, 201, JSON.stringify(locationConfirmation.body));
  assert.equal(locationConfirmation.body.success, true);
  assert.equal(locationConfirmation.body.status, 'approved');
  const representativeCannotSetGeofence = await request(`/api/maintenance/machines/${targetMachineId}/geofence`, jsonOptions('PATCH', {
    latitude: visitPayload.location.latitude,
    longitude: visitPayload.location.longitude,
  }), login.cookie);
  assert.equal(representativeCannotSetGeofence.response.status, 403);
  const setMachineGeofence = await request(`/api/maintenance/machines/${targetMachineId}/geofence`, jsonOptions('PATCH', {
    latitude: visitPayload.location.latitude,
    longitude: visitPayload.location.longitude,
    areaName: 'محافظة القاهرة - الدقي',
  }), adminCookie);
  assert.equal(setMachineGeofence.response.status, 200, JSON.stringify(setMachineGeofence.body));
  assert.equal(setMachineGeofence.body.is_location_locked, 1);
  assert.equal(setMachineGeofence.body.geofence_radius_meters, 50);
  assert.equal(setMachineGeofence.body.area_name, 'محافظة القاهرة - الدقي');
  const machineDirectory = await request(`/api/maintenance/machines?search=1434`, {}, adminCookie);
  assert.equal(machineDirectory.body.machines[0].is_location_locked, 1);
  assert.equal(machineDirectory.body.machines[0].area_name, 'محافظة القاهرة - الدقي');

  const firstWorkClaim = await request(`/api/rep/machines/${missingAfterCardId}/start-work`, jsonOptions('POST', {
    visitUuid, location: visitPayload.location,
  }), login.cookie);
  assert.equal(firstWorkClaim.response.status, 200, JSON.stringify(firstWorkClaim.body));
  assert.equal(firstWorkClaim.body.status, 'in_progress');
  assert.equal(firstWorkClaim.body.idempotent, false);
  const duplicateWorkClaim = await request(`/api/rep/machines/${missingAfterCardId}/start-work`, jsonOptions('POST', {
    visitUuid, location: visitPayload.location,
  }), login.cookie);
  assert.equal(duplicateWorkClaim.response.status, 200);
  assert.equal(duplicateWorkClaim.body.idempotent, true);
  const otherRepInProgress = await request('/api/rep/today-route?username=rep-all-regions', {}, universalLogin.cookie);
  const inProgressCard = otherRepInProgress.body.regions.flatMap((region) => region.machines)
    .find((machine) => machine.cardId === missingAfterCardId);
  assert.equal(inProgressCard.workStatus, 'in_progress');
  assert.equal(inProgressCard.canVisit, false);
  const conflictingWorkClaim = await request(`/api/rep/machines/${missingAfterCardId}/start-work`, jsonOptions('POST', {
    visitUuid: randomUUID(), location: visitPayload.location,
  }), universalLogin.cookie);
  assert.equal(conflictingWorkClaim.response.status, 409);
  const changedVisitClaim = await request(`/api/rep/machines/${missingAfterCardId}/start-work`, jsonOptions('POST', {
    visitUuid: randomUUID(), location: visitPayload.location,
  }), login.cookie);
  assert.equal(changedVisitClaim.response.status, 409);
  const wrongRelease = await request(`/api/rep/machines/${missingAfterCardId}/stop-work`, jsonOptions('POST', {
    visitUuid,
  }), universalLogin.cookie);
  assert.equal(wrongRelease.response.status, 200);
  assert.equal(wrongRelease.body.released, false);
  const ownerRelease = await request(`/api/rep/machines/${missingAfterCardId}/stop-work`, jsonOptions('POST', {
    visitUuid,
  }), login.cookie);
  assert.equal(ownerRelease.response.status, 200);
  assert.equal(ownerRelease.body.released, true);
  const claimAfterClose = await request(`/api/rep/machines/${missingAfterCardId}/start-work`, jsonOptions('POST', {
    visitUuid, location: visitPayload.location,
  }), login.cookie);
  assert.equal(claimAfterClose.response.status, 200);
  assert.equal(claimAfterClose.body.idempotent, false);
  db.prepare('UPDATE rep_machine_work_leases SET expires_at_ms = ? WHERE card_id = ?')
    .run(Date.now() - 1, missingAfterCardId);
  const expiredWorkRoute = await request('/api/rep/today-route?username=rep-all-regions', {}, universalLogin.cookie);
  const availableAgain = expiredWorkRoute.body.regions.flatMap((region) => region.machines)
    .find((machine) => machine.cardId === missingAfterCardId);
  assert.equal(availableAgain.workStatus, 'available');
  assert.equal(availableAgain.canVisit, true);
  const refreshedWorkClaim = await request(`/api/rep/machines/${missingAfterCardId}/start-work`, jsonOptions('POST', {
    visitUuid, location: visitPayload.location,
  }), login.cookie);
  assert.equal(refreshedWorkClaim.response.status, 200);
  assert.equal(refreshedWorkClaim.body.idempotent, false);

  const visitSync = await request('/api/rep/sync-visit', {
    method: 'POST',
    body: buildVisitForm(visitPayload),
  }, login.cookie);
  assert.equal(visitSync.response.status, 200);
  assert.equal(visitSync.body.success, true);
  assert.equal(visitSync.body.status, 'pending_review');
  assert.equal(db.prepare('SELECT 1 FROM rep_machine_work_leases WHERE card_id = ?').get(missingAfterCardId), undefined);
  const otherRepDone = await request('/api/rep/today-route?username=rep-all-regions', {}, universalLogin.cookie);
  const doneCard = otherRepDone.body.regions.flatMap((region) => region.machines)
    .find((machine) => machine.cardId === missingAfterCardId);
  assert.equal(doneCard.workStatus, 'done');
  assert.equal(doneCard.canVisit, false);
  assert.equal(visitSync.body.visitUuid, visitUuid);
  assert.equal(visitSync.body.maintenanceLines[0].quantity, 3);
  assert.equal(visitSync.body.maintenanceLines[0].unit, 'piece');
  assert.equal(db.prepare(`SELECT quantity FROM rep_visit_lines WHERE visit_id =
    (SELECT id FROM rep_visits WHERE visit_uuid = ?)` ).get(visitUuid).quantity, 3);
  // Model a visit queued with the shipped Android payload while offline, then
  // uploaded after reconnect. Retry the same immutable bundle and reload it
  // from the supervisor API; it must be durable and must not duplicate lines.
  const retriedQueuedVisit = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm(visitPayload),
  }, login.cookie);
  assert.equal(retriedQueuedVisit.response.status, 200, JSON.stringify(retriedQueuedVisit.body));
  assert.equal(retriedQueuedVisit.body.idempotent, true);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM rep_visits WHERE visit_uuid = ?`).get(visitUuid).count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM rep_visit_lines WHERE visit_id =
    (SELECT id FROM rep_visits WHERE visit_uuid = ?)` ).get(visitUuid).count, 1);
  const refreshedQueue = await request('/api/supervisor/qa/queue', {}, adminCookie);
  const refreshedVisit = refreshedQueue.body.visits.find((item) => item.visitUuid === visitUuid);
  assert.ok(refreshedVisit, 'uploaded visit remains visible after an authoritative queue reload');
  assert.equal(refreshedVisit.maintenanceLines[0].quantity, 3);
  assert.equal(refreshedVisit.maintenanceLines[0].unit, 'piece');
  const savedCard = db.prepare('SELECT before_photos_json, after_photos_json, reason_ids_json, notes, status FROM maintenance_cards WHERE id = ?')
    .get(missingAfterCardId);
  assert.equal(savedCard.status, 'pending', 'uploaded evidence must not mutate the maintenance card before supervisor approval');
  assert.equal(JSON.parse(savedCard.before_photos_json).length, 1);
  assert.equal(JSON.parse(savedCard.after_photos_json).length, 0);
  assert.deepEqual(JSON.parse(savedCard.reason_ids_json), []);
  assert.equal(savedCard.notes, visitPayload.notes, 'rep comments become the current card note at successful sync');
  const storedVisit = db.prepare('SELECT * FROM rep_visits WHERE visit_uuid = ?').get(visitUuid);
  assert.equal(storedVisit.status, 'completed');
  assert.equal(storedVisit.machine_condition, 'faulty');
  assert.equal(storedVisit.rep_user_id, repId);
  const syncedNoteHistory = db.prepare(`
    SELECT machine_id, card_id, order_id, author_id, author_name, author_role, note
    FROM machine_notes_history WHERE card_id = ? ORDER BY id DESC
  `).all(missingAfterCardId);
  assert.equal(syncedNoteHistory.length, 1);
  assert.deepEqual(syncedNoteHistory[0], {
    machine_id: storedVisit.machine_id,
    card_id: missingAfterCardId,
    order_id: storedVisit.order_id,
    author_id: repId,
    author_name: db.prepare('SELECT full_name FROM users WHERE id = ?').get(repId).full_name,
    author_role: 'rep',
    note: visitPayload.notes,
  });
  const repHistoryApi = await request(`/api/maintenance/machines/${storedVisit.machine_id}/notes-history`, {}, adminCookie);
  assert.equal(repHistoryApi.response.status, 200);
  assert.equal(repHistoryApi.body.length, 1);
  assert.equal(repHistoryApi.body[0].author_role, 'rep');
  assert.equal(repHistoryApi.body[0].order_code, storedVisit.order_code);
  const repCannotWriteAdminNote = await request(`/api/maintenance/machines/${storedVisit.machine_id}/maintenance-note`, jsonOptions('PUT', {
    notes: 'تعليق من حساب المندوب غير مصرح به',
  }), login.cookie);
  assert.equal(repCannotWriteAdminNote.response.status, 403);
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
    area_name: 'محافظة القاهرة - الدقي',
  });
  assert.match(storedVisit.before_path, /^Areas\/.*\/\d{4}\/\d{2}\/1434_.*\/Before\/[0-9a-f-]{8}-[0-9a-f-]{4}-[1-8][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}_0001\.jpg$/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_visit_photos WHERE visit_id = (SELECT id FROM rep_visits WHERE visit_uuid = ?)').get(visitUuid).count, 6);
  const compressedBeforeMetadata = await sharp(readFileSync(beforePath)).metadata();
  assert.equal(compressedBeforeMetadata.format, 'jpeg');
  assert.ok(compressedBeforeMetadata.width <= 1920 && compressedBeforeMetadata.height <= 1080);
  assert.equal(compressedBeforeMetadata.exif, undefined);

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

  const repEventController = new AbortController();
  const repEventCursor = db.prepare('SELECT COALESCE(MAX(event_id), 0) AS cursor FROM operations_events').get().cursor;
  db.prepare('DELETE FROM maintenance_order_reps WHERE order_id = ? AND user_id = ?').run(orderId, repId);
  const repEventResponse = await fetch(`${baseUrl}/api/rep/events`, {
    headers: { cookie: login.cookie, 'Last-Event-ID': String(repEventCursor) },
    signal: repEventController.signal,
  });
  assert.equal(repEventResponse.status, 200);
  const assignmentEventPromise = readOperationsEvent(repEventResponse, 'maintenance.order.assigned');
  const reassigned = await request(`/api/maintenance/orders/${orderId}/representatives`, jsonOptions('PUT', {
    repUserIds: [repId, universalRepId],
  }), adminCookie);
  assert.equal(reassigned.response.status, 200);
  let assignmentEvent;
  let assignmentTimeout;
  try {
    assignmentEvent = await Promise.race([
      assignmentEventPromise,
      new Promise((_, reject) => { assignmentTimeout = setTimeout(() => reject(new Error('Timed out waiting for rep assignment event.')), 2000); }),
    ]);
  } finally {
    clearTimeout(assignmentTimeout);
    repEventController.abort();
  }
  assert.equal(assignmentEvent.orderId, orderId);
  assert.ok(assignmentEvent.recipientUserIds.includes(repId));

  const repReplayController = new AbortController();
  const repReplayResponse = await fetch(`${baseUrl}/api/rep/events`, {
    headers: { cookie: login.cookie, 'Last-Event-ID': String(repEventCursor) },
    signal: repReplayController.signal,
  });
  assert.equal(repReplayResponse.status, 200);
  const replayedAssignment = await readOperationsEvent(repReplayResponse, 'maintenance.order.assigned');
  repReplayController.abort();
  assert.equal(replayedAssignment.id, assignmentEvent.id);

  const firstQa = await request('/api/supervisor/qa/queue', {}, adminCookie);
  assert.equal(firstQa.response.status, 200);
  assert.equal(firstQa.body.visits.length, 1);
  assert.equal(firstQa.body.visits[0].machineCode, '1434');
  assert.equal(firstQa.body.visits[0].machineCondition, 'faulty');
  assert.equal(firstQa.body.visits[0].siteDurationSeconds, 300);
  const beforePhotoResponse = await fetch(`${baseUrl}${firstQa.body.visits[0].beforePhotoUrl}`, { headers: { cookie: adminCookie } });
  assert.equal(beforePhotoResponse.status, 200);
  assert.match(beforePhotoResponse.headers.get('content-type'), /image\/jpeg/);
  const universalVisitTime = Date.now();
  const universalVisitPayload = {
    ...visitPayload,
    visitUuid: randomUUID(),
    cardId: otherRegionCardId,
    machineCode: '2400',
    regionName: 'الرياض',
    capturedAt: new Date(universalVisitTime).toISOString(),
    beforeCapturedAt: Array.from({ length: 3 }, (_, index) => new Date(universalVisitTime - (3 - index) * 60 * 1000).toISOString()),
    afterCapturedAt: [],
    location: { ...visitPayload.location, updatedAt: new Date(universalVisitTime).toISOString() },
  };
  const universalVisit = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm(universalVisitPayload, 3, 0),
  }, universalLogin.cookie);
  assert.equal(universalVisit.response.status, 200, JSON.stringify(universalVisit.body));
  assert.equal(universalVisit.body.status, 'pending_review', 'universal representatives can submit visits for all regions on their assigned orders');
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
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM machine_notes_history WHERE card_id = ?').get(missingAfterCardId).count, 1,
    'an idempotent visit retry must not duplicate the historical note');

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
    beforeCapturedAt: Array.from({ length: 3 }, (_, index) => new Date(Date.now() - (4 - index) * 60 * 1000).toISOString()),
    afterCapturedAt: Array.from({ length: 3 }, (_, index) => new Date(Date.now() - (3 - index) * 30 * 1000).toISOString()),
  };
  const replacementSync = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm(replacementPayload),
  }, login.cookie);
  assert.equal(replacementSync.response.status, 200);
  assert.equal(replacementSync.body.status, 'pending_review');
  assert.equal(db.prepare('SELECT notes FROM maintenance_cards WHERE id = ?').get(missingAfterCardId).notes, replacementPayload.notes);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM machine_notes_history WHERE card_id = ?').get(missingAfterCardId).count, 2);
  const replacementId = db.prepare('SELECT id FROM rep_visits WHERE visit_uuid = ?').get(replacementPayload.visitUuid).id;
  const approval = await request(`/api/supervisor/visits/${replacementId}/review`, jsonOptions('POST', { action: 'approve' }), adminCookie);
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.status, 'approved');
  const approvedCard = db.prepare('SELECT before_photos_json, after_photos_json, reason_ids_json, notes, status FROM maintenance_cards WHERE id = ?')
    .get(missingAfterCardId);
  assert.equal(approvedCard.status, 'completed');
  assert.equal(JSON.parse(approvedCard.before_photos_json).length, 4);
  assert.equal(JSON.parse(approvedCard.after_photos_json).length, 3);
  assert.ok(JSON.parse(approvedCard.reason_ids_json).includes(faultReasons.body.reasons[0].id));
  assert.match(approvedCard.notes, /إعادة تصوير واضحة/);
  assert.equal(approvedCard.notes, replacementPayload.notes, 'approval must not append a duplicate visit note or replace the latest submitted comment');

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
  // Fixture captures must lie inside the existing attendance-created duty interval.
  db.prepare('UPDATE rep_duty_sessions SET started_at=?,ended_at=? WHERE rep_user_id=?').run(new Date(now-7200000).toISOString(),new Date(now-3600000).toISOString(),repId);
  const trackPoints = [
    { clientPointId: 'track-1', latitude: 24.8000, longitude: 46.7000, accuracy: 10, updatedAt: new Date(now - 20000).toISOString() },
    { clientPointId: 'track-2', latitude: 24.8010, longitude: 46.7010, accuracy: 10, updatedAt: new Date(now - 10000).toISOString() },
  ];
  const eventController = new AbortController();
  const supervisorEventCursor = db.prepare('SELECT COALESCE(MAX(event_id), 0) AS cursor FROM operations_events').get().cursor;
  const eventResponse = await fetch(`${baseUrl}/api/supervisor/events`, {
    headers: { cookie: adminCookie, 'Last-Event-ID': String(supervisorEventCursor) },
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
    onDuty: true,
    location: {
      latitude: trackPoints[1].latitude,
      longitude: trackPoints[1].longitude,
      accuracy: trackPoints[1].accuracy,
      updatedAt: new Date(now - 600000).toISOString(),
    },
    trail: trackPoints,
  }), login.cookie);
  assert.equal(tracking.response.status, 200);
  assert.equal(tracking.body.onDuty, true);
  assert.deepEqual(tracking.body.points.map((point) => point.clientPointId), ['track-1', 'track-2', 'location']);
  assert.deepEqual(tracking.body.points.map((point) => point.status), ['accepted', 'accepted', 'accepted'], JSON.stringify(tracking.body));
  assert.equal(tracking.body.rejectedPoints, 0);
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
  const supervisorReplayController = new AbortController();
  const supervisorReplayResponse = await fetch(`${baseUrl}/api/supervisor/events`, {
    headers: { cookie: adminCookie, 'Last-Event-ID': String(supervisorEventCursor) },
    signal: supervisorReplayController.signal,
  });
  assert.equal(supervisorReplayResponse.status, 200);
  const replayedTracking = await readOperationsEvent(supervisorReplayResponse, 'rep.tracking.updated');
  supervisorReplayController.abort();
  assert.equal(replayedTracking.id, trackingEvent.id);
  const offlineBacklogPoint = {
    clientPointId: 'offline-backlog-1',
    latitude: 24.7990,
    longitude: 46.6990,
    accuracy: 12,
    speed: 0,
    updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const historicalSessionId = Number(db.prepare('INSERT INTO rep_duty_sessions(rep_user_id,started_at,ended_at) VALUES (?,?,?)')
    .run(repId,new Date(now-2*24*60*60*1000-3600000).toISOString(),new Date(now-2*24*60*60*1000+3600000).toISOString()).lastInsertRowid);
  const recoveredBacklog = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: true,
    trail: [offlineBacklogPoint],
  }), login.cookie);
  assert.equal(recoveredBacklog.response.status, 200);
  assert.equal(recoveredBacklog.body.acceptedPoints, 1, 'offline breadcrumbs up to the local 90-day retention window should be accepted');
  assert.equal(recoveredBacklog.body.points[0].clientPointId, 'offline-backlog-1');
  assert.equal(recoveredBacklog.body.points[0].status, 'accepted');
  assert.equal(db.prepare('SELECT duty_session_id FROM rep_gps_points WHERE recorded_at=?').get(offlineBacklogPoint.updatedAt).duty_session_id,historicalSessionId);
  const rejectedBacklog = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: true,
    trail: [
      { clientPointId: 'too-old', latitude: 24.7980, longitude: 46.6980, accuracy: 12, updatedAt: new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString() },
      { clientPointId: 'too-new', latitude: 24.7970, longitude: 46.6970, accuracy: 12, updatedAt: new Date(now + 10 * 60 * 1000).toISOString() },
    ],
  }), login.cookie);
  assert.equal(rejectedBacklog.response.status, 200);
  assert.equal(rejectedBacklog.body.acceptedPoints, 0);
  assert.equal(rejectedBacklog.body.rejectedPoints, 2);
  assert.deepEqual(rejectedBacklog.body.points.map((point) => [point.clientPointId, point.status, point.reason]), [
    ['too-old', 'rejected', 'older_than_retention'],
    ['too-new', 'rejected', 'future_timestamp'],
  ]);
  const duplicateTracking = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: true,
    location: {
      latitude: trackPoints[1].latitude,
      longitude: trackPoints[1].longitude,
      accuracy: trackPoints[1].accuracy,
      updatedAt: new Date(now - 600000).toISOString(),
    },
    trail: trackPoints,
  }), login.cookie);
  assert.equal(duplicateTracking.response.status, 200);
  assert.ok(duplicateTracking.body.points.every((point) => point.status === 'duplicate'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_points WHERE rep_user_id = ?').get(repId).count, 4);
  // Keep the full six-minute stationary window inside one Cairo business day;
  // using "now" makes this assertion flaky when the suite runs across midnight.
  const stopBaseDate = new Date();
  stopBaseDate.setUTCHours(12, 0, 0, 0);
  stopBaseDate.setUTCDate(stopBaseDate.getUTCDate() - 1);
  const stopBase = stopBaseDate.getTime();
  const stopSessionId=Number(db.prepare('INSERT INTO rep_duty_sessions(rep_user_id,started_at,ended_at) VALUES (?,?,?)').run(repId,new Date(stopBase-10*60000).toISOString(),new Date(stopBase+10*60000).toISOString()).lastInsertRowid);
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
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  const routeDate = `${localDate.year}-${localDate.month}-${localDate.day}`;
  const repRoute = await request(`/api/supervisor/reps/${repId}/route?date=${routeDate}`, {}, adminCookie);
  assert.equal(repRoute.response.status, 200, JSON.stringify(repRoute.body));
  assert.equal(repRoute.body.date, routeDate);
  assert.ok(repRoute.body.polyline.length >= 3);
  assert.ok(repRoute.body.speedSummary.averageKmh >= 0);
  assert.ok(repRoute.body.visitedMachines.length >= 2);
  assert.equal(repRoute.body.visitedMachines[0].machineCode, '1434');
  const stopWorkDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(stopBaseDate);
  const stopRoute = stopWorkDate === routeDate
    ? repRoute
    : await request(`/api/supervisor/reps/${repId}/route?date=${stopWorkDate}`, {}, adminCookie);
  assert.equal(stopRoute.response.status, 200);
  assert.equal(stopRoute.body.stops.length, 1);
  assert.equal(stopRoute.body.stops[0].durationMinutes, 6);

  const activeSession = db.prepare('SELECT id FROM rep_duty_sessions WHERE rep_user_id = ? AND ended_at IS NULL').get(repId);
  const finalTrailPoint = {
    latitude: 24.8020, longitude: 46.7020, accuracy: 8,
    updatedAt: new Date(Date.now() - 1000).toISOString(),
  };
  const stopTracking = await request('/api/rep/tracking', jsonOptions('POST', {
    onDuty: false, location: null, trail: [finalTrailPoint],
  }), login.cookie);
  assert.equal(stopTracking.response.status, 200);
  assert.equal(stopTracking.body.onDuty, false);
  assert.equal(stopTracking.body.acceptedPoints, 1);
  assert.ok(db.prepare('SELECT ended_at FROM rep_duty_sessions WHERE id = ?').get(activeSession.id).ended_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_points WHERE duty_session_id = ?').get(activeSession.id).count, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_points WHERE duty_session_id=?').get(stopSessionId).count,4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_points WHERE duty_session_id=?').get(historicalSessionId).count,1);

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

  const code1433MachineId = Number(db.prepare('SELECT id FROM machines WHERE code = ?').get('1433').id);
  const correctionPayload = {
    actionUuid: randomUUID(),
    cardId: missingAfterCardId,
    reportedCode: '1433',
    reportedName: 'ماكينة الموقع الصحيح 1433',
    note: 'الكود الموجود على اللوحة يختلف عن سجل المسار.',
    location: { latitude: 24.81231, longitude: 46.70125, accuracy: 8, updatedAt: new Date().toISOString() },
    capturedAt: new Date().toISOString(),
  };
  const correctionForm = new FormData();
  correctionForm.append('correction', JSON.stringify(correctionPayload));
  correctionForm.append('evidence', new Blob([afterBuffer], { type: 'image/jpeg' }), 'machine-proof.jpg');
  const submittedCorrection = await request(`/api/rep/machines/${targetMachineId}/corrections`, {
    method: 'POST', body: correctionForm,
  }, login.cookie);
  assert.equal(submittedCorrection.response.status, 201, JSON.stringify(submittedCorrection.body));
  assert.equal(submittedCorrection.body.status, 'pending');
  assert.equal(submittedCorrection.body.codeConflict, true);
  const correctionId = submittedCorrection.body.correctionId;
  const visitWhileCorrectionPending = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm({ ...visitPayload, visitUuid: randomUUID() }),
  }, login.cookie);
  assert.equal(visitWhileCorrectionPending.response.status, 409);
  assert.match(visitWhileCorrectionPending.body.error, /wrong-machine report is awaiting administrator review/i);
  const repeatedCorrection = await request(`/api/rep/machines/${targetMachineId}/corrections`, {
    method: 'POST', body: correctionForm,
  }, login.cookie);
  assert.equal(repeatedCorrection.response.status, 200);
  assert.equal(repeatedCorrection.body.idempotent, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM machine_correction_requests WHERE id = ?').get(correctionId).count, 1);
  const correctionQueue = await request('/api/maintenance/machine-corrections', {}, adminCookie);
  assert.equal(correctionQueue.response.status, 200);
  assert.equal(correctionQueue.body.corrections.length, 1);
  assert.equal(correctionQueue.body.corrections[0].codeConflict, true);
  assert.ok(correctionQueue.body.corrections[0].duplicateCandidates.some((candidate) => candidate.id === code1433MachineId));
  const duplicateCodeCandidates = await request(`/api/maintenance/machine-corrections/${correctionId}/candidates?code=1433`, {}, adminCookie);
  assert.equal(duplicateCodeCandidates.response.status, 200);
  assert.equal(duplicateCodeCandidates.body.hasConflict, true);
  assert.ok(duplicateCodeCandidates.body.candidates.some((candidate) => candidate.id === code1433MachineId && candidate.matches_code));
  const reportedCodeDirectoryFilter = await request('/api/maintenance/machines?locationStatus=pending_correction&search=1433', {}, adminCookie);
  assert.equal(reportedCodeDirectoryFilter.response.status, 200);
  assert.equal(reportedCodeDirectoryFilter.body.machines.length, 1);
  assert.equal(reportedCodeDirectoryFilter.body.machines[0].id, targetMachineId);
  const correctionMap = await request('/api/maintenance/machines/map?locationStatus=pending_correction', {}, adminCookie);
  assert.equal(correctionMap.response.status, 200);
  assert.equal(correctionMap.body.machines.length, 1);
  assert.equal(correctionMap.body.machines[0].id, targetMachineId);
  assert.equal(correctionMap.body.machines[0].correction_reported_code, '1433');
  assert.equal(correctionMap.body.machines[0].correction_latitude, correctionPayload.location.latitude);
  assert.equal(correctionMap.body.machines[0].pending_correction_count, 1);
  assert.equal(correctionMap.body.machines[0].latest_visit.order_code, 'REP-ROUTE-1');
  assert.equal(correctionMap.body.machines[0].latest_visit.representative_name, 'Nour Field Rep');
  assert.equal(correctionMap.body.machines[0].latest_visit.captured_at, db.prepare(`SELECT captured_at FROM rep_visits
    WHERE machine_id = ? AND status = 'completed' ORDER BY datetime(captured_at) DESC, id DESC LIMIT 1`).get(targetMachineId).captured_at);
  const reportedCodeMapFilter = await request('/api/maintenance/machines/map?locationStatus=pending_correction&search=1433', {}, adminCookie);
  assert.equal(reportedCodeMapFilter.body.machines.length, 1);
  const repCannotReviewCorrections = await request('/api/maintenance/machine-corrections', {}, login.cookie);
  assert.equal(repCannotReviewCorrections.response.status, 403);
  const repCannotCheckCorrectionCandidates = await request(`/api/maintenance/machine-corrections/${correctionId}/candidates?code=1433`, {}, login.cookie);
  assert.equal(repCannotCheckCorrectionCandidates.response.status, 403);
  const repCannotLoadMachineMap = await request('/api/maintenance/machines/map', {}, login.cookie);
  assert.equal(repCannotLoadMachineMap.response.status, 403);
  const repCannotFilterCorrectionQueue = await request('/api/maintenance/machines?locationStatus=pending_correction', {}, login.cookie);
  assert.equal(repCannotFilterCorrectionQueue.response.status, 403);

  const evidenceResponse = await fetch(`${baseUrl}/api/maintenance/machine-corrections/${correctionId}/evidence`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(evidenceResponse.status, 200);
  assert.equal(evidenceResponse.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await evidenceResponse.arrayBuffer()), afterBuffer);
  const approveConflictWithoutChoice = await request(`/api/maintenance/machine-corrections/${correctionId}/review`, jsonOptions('PATCH', {
    action: 'approved', note: 'تأكيد البلاغ',
  }), adminCookie);
  assert.equal(approveConflictWithoutChoice.response.status, 400);
  const originalMachineRows = db.prepare('SELECT id, code, name_ar FROM machines WHERE id IN (?, ?) ORDER BY id')
    .all(targetMachineId, code1433MachineId);
  const resolveCorrection = await request(`/api/maintenance/machine-corrections/${correctionId}/review`, jsonOptions('PATCH', {
    action: 'approved', resolvedMachineId: code1433MachineId, note: 'تم التحقق من اللوحة وربط البلاغ بالسجل القائم دون دمج.',
  }), adminCookie);
  assert.equal(resolveCorrection.response.status, 200, JSON.stringify(resolveCorrection.body));
  assert.equal(resolveCorrection.body.status, 'approved');
  assert.equal(resolveCorrection.body.resolvedMachineId, code1433MachineId);
  assert.deepEqual(db.prepare('SELECT id, code, name_ar FROM machines WHERE id IN (?, ?) ORDER BY id')
    .all(targetMachineId, code1433MachineId), originalMachineRows, 'review must never merge or rewrite machine records');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM machine_correction_reviews WHERE correction_id = ?').get(correctionId).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'machine_correction_request' AND entity_id = ? AND action = 'machine_correction_approved'").get(correctionId).count, 1);
  const resolvedCorrectionQueue = await request('/api/maintenance/machine-corrections?status=approved', {}, adminCookie);
  assert.equal(resolvedCorrectionQueue.body.corrections[0].resolved_machine_id, code1433MachineId);
  const resolvedCorrectionMap = await request('/api/maintenance/machines/map?locationStatus=pending_correction', {}, adminCookie);
  assert.equal(resolvedCorrectionMap.body.machines.length, 0);

  const correctedMachineCode = '1434-CORRECTED';
  const correctedMachineName = 'ماكينة الدقي المصححة';
  const originalVisitBeforeBytes = Buffer.from(readFileSync(await resolveStorageFile(storedVisit.before_path)));
  const originalVisitAfterBytes = Buffer.from(readFileSync(await resolveStorageFile(storedVisit.after_path)));
  await ensureStorageDirectory('Machines', '1434');
  const machineFileBytes = Buffer.from('machine-directory-original-bytes');
  await writeStorageFile(storageDirectory('Machines', '1434', 'catalog.txt'), machineFileBytes);
  const clientPhotoPath = storageDirectory('clients', 'REP-CLIENT', 'maintenance', 'REP-ROUTE-1', '1434', 'before', 'legacy.jpg');
  await ensureStorageDirectory(...clientPhotoPath.split('/').slice(0, -1));
  const clientPhotoBytes = Buffer.from('client-maintenance-photo-original-bytes');
  await writeStorageFile(clientPhotoPath, clientPhotoBytes);
  db.prepare('UPDATE maintenance_cards SET before_photos_json = ? WHERE id = ?')
    .run(JSON.stringify([clientPhotoPath]), missingAfterCardId);
  const archivedPhotoPath = storageDirectory('Clients', 'REP-CLIENT', 'Archived_Orders', 'REP-ROUTE-1', '1434', 'Before', 'archived.jpg');
  await ensureStorageDirectory(...archivedPhotoPath.split('/').slice(0, -1));
  const archivedPhotoBytes = Buffer.from('archived-machine-photo-original-bytes');
  await writeStorageFile(archivedPhotoPath, archivedPhotoBytes);

  const uniqueRenamePayload = {
    actionUuid: randomUUID(),
    cardId: missingAfterCardId,
    reportedCode: correctedMachineCode,
    reportedName: correctedMachineName,
    note: 'تمت مطابقة اللوحة؛ الكود الجديد غير مستخدم.',
    location: correctionPayload.location,
    capturedAt: new Date().toISOString(),
  };
  const uniqueRenameForm = new FormData();
  uniqueRenameForm.append('correction', JSON.stringify(uniqueRenamePayload));
  const uniqueRenameReport = await request(`/api/rep/machines/${targetMachineId}/corrections`, {
    method: 'POST', body: uniqueRenameForm,
  }, login.cookie);
  assert.equal(uniqueRenameReport.response.status, 201, JSON.stringify(uniqueRenameReport.body));
  assert.equal(uniqueRenameReport.body.codeConflict, false);
  const uniqueRenameApproval = await request(`/api/maintenance/machine-corrections/${uniqueRenameReport.body.correctionId}/review`, jsonOptions('PATCH', {
    action: 'approved', approvedCode: correctedMachineCode, note: 'اعتماد إعادة التسمية الفريدة.',
  }), adminCookie);
  assert.equal(uniqueRenameApproval.response.status, 200, JSON.stringify(uniqueRenameApproval.body));
  assert.equal(uniqueRenameApproval.body.renamed, true);
  assert.equal(uniqueRenameApproval.body.resolvedMachineId, targetMachineId);
  assert.deepEqual(db.prepare('SELECT id, code, name_ar FROM machines WHERE id = ?').get(targetMachineId), {
    id: targetMachineId, code: correctedMachineCode, name_ar: correctedMachineName,
  });
  assert.equal(db.prepare('SELECT id FROM maintenance_cards WHERE id = ? AND machine_id = ?')
    .get(missingAfterCardId, targetMachineId).id, missingAfterCardId, 'the machine/card relation stays on the same machine ID');
  assert.equal(db.prepare('SELECT code FROM machines WHERE id = ?').get(code1433MachineId).code, '1433',
    'the existing duplicate-code record is not merged or rewritten');
  assert.equal(db.prepare('SELECT approved_code FROM machine_correction_reviews WHERE correction_id = ?')
    .get(uniqueRenameReport.body.correctionId).approved_code, correctedMachineCode);
  assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE entity_type = 'machine' AND entity_id = ?
    AND action = 'rename_from_machine_correction'`).get(targetMachineId));

  const renamedVisit = db.prepare('SELECT final_path, before_path, after_path FROM rep_visits WHERE visit_uuid = ?').get(visitUuid);
  const storedPathSegments = storedVisit.final_path.split('/');
  const oldAreaMachineFolder = storedPathSegments[4];
  const newAreaMachineFolder = `${correctedMachineCode}_${correctedMachineName.normalize('NFKC').trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '')}`;
  const expectedAreaRoot = [...storedPathSegments.slice(0, 4), newAreaMachineFolder].join('/');
  const expectedVisitFinalPath = [...storedPathSegments.slice(0, 4), newAreaMachineFolder].join('/');
  assert.equal(renamedVisit.final_path, expectedVisitFinalPath);
  assert.equal(renamedVisit.before_path, storedVisit.before_path.replace(`/${oldAreaMachineFolder}/`, `/${newAreaMachineFolder}/`));
  assert.equal(renamedVisit.after_path, storedVisit.after_path.replace(`/${oldAreaMachineFolder}/`, `/${newAreaMachineFolder}/`));
  assert.deepEqual(readFileSync(await resolveStorageFile(renamedVisit.before_path)), originalVisitBeforeBytes,
    'rep visit image bytes are preserved during area-folder rename');
  assert.deepEqual(readFileSync(await resolveStorageFile(renamedVisit.after_path)), originalVisitAfterBytes);
  assert.ok(existsSync(join(temporaryDirectory, 'storage', ...expectedAreaRoot.split('/'))));
  assert.equal(existsSync(join(temporaryDirectory, 'storage', ...storedPathSegments)), false,
    'the old area/year/month machine directory is renamed, not retained');
  assert.deepEqual(readFileSync(await resolveStorageFile(storageDirectory('Machines', correctedMachineCode, 'catalog.txt'))), machineFileBytes);
  assert.equal(existsSync(join(temporaryDirectory, 'storage', 'Machines', '1434')), false);
  const renamedClientPhotoPath = storageDirectory('clients', 'REP-CLIENT', 'maintenance', 'REP-ROUTE-1', correctedMachineCode, 'before', 'legacy.jpg');
  assert.deepEqual(readFileSync(await resolveStorageFile(renamedClientPhotoPath)), clientPhotoBytes);
  assert.deepEqual(JSON.parse(db.prepare('SELECT before_photos_json FROM maintenance_cards WHERE id = ?')
    .get(missingAfterCardId).before_photos_json), [renamedClientPhotoPath]);
  assert.deepEqual(readFileSync(await resolveStorageFile(storageDirectory(
    'Clients', 'REP-CLIENT', 'Archived_Orders', 'REP-ROUTE-1', correctedMachineCode, 'Before', 'archived.jpg',
  ))), archivedPhotoBytes);
  assert.ok(db.prepare('SELECT 1 FROM rep_visit_photos WHERE visit_id = (SELECT id FROM rep_visits WHERE visit_uuid = ?) AND stored_path = ?')
    .get(visitUuid, renamedVisit.before_path));
  const renamedMachineMap = await request(`/api/maintenance/machines/map?search=${correctedMachineCode}`, {}, adminCookie);
  assert.equal(renamedMachineMap.response.status, 200);
  assert.equal(renamedMachineMap.body.machines.length, 1);
  assert.equal(renamedMachineMap.body.machines[0].id, targetMachineId);
  assert.equal(renamedMachineMap.body.machines[0].latest_visit.order_code, 'REP-ROUTE-1');
  assert.equal(renamedMachineMap.body.machines[0].latest_visit.representative_name, 'Nour Field Rep');

  const recoveryPayload = {
    ...uniqueRenamePayload,
    actionUuid: randomUUID(),
    reportedCode: '1434-RECOVERY',
    reportedName: 'ماكينة الاستعادة',
    capturedAt: new Date().toISOString(),
  };
  const recoveryForm = new FormData();
  recoveryForm.append('correction', JSON.stringify(recoveryPayload));
  const recoveryReport = await request(`/api/rep/machines/${targetMachineId}/corrections`, {
    method: 'POST', body: recoveryForm,
  }, login.cookie);
  assert.equal(recoveryReport.response.status, 201, JSON.stringify(recoveryReport.body));
  const recoveryOperationId = randomUUID();
  const recoveryTarget = {
    sourcePath: storageDirectory('Machines', correctedMachineCode),
    destinationPath: storageDirectory('Machines', '1434-RECOVERY'),
  };
  db.prepare(`INSERT INTO machine_correction_rename_operations
    (operation_id, correction_id, machine_id, old_code, old_name_ar, new_code, new_name_ar, targets_json, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared')`).run(
    recoveryOperationId, recoveryReport.body.correctionId, targetMachineId,
    correctedMachineCode, correctedMachineName, '1434-RECOVERY', recoveryPayload.reportedName, JSON.stringify([recoveryTarget]),
  );
  const recoveryStage = await ensureStorageDirectory('.madar-recovery', 'machine-correction-renames', recoveryOperationId);
  renameSync(
    join(temporaryDirectory, 'storage', ...recoveryTarget.sourcePath.split('/')),
    join(recoveryStage, 'item-0'),
  );
  const visitDuringPendingRename = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm(visitPayload),
  }, login.cookie);
  assert.equal(visitDuringPendingRename.response.status, 409);
  assert.match(visitDuringPendingRename.body.error, /machine-folder recovery is pending/i);
  const blockedPhotoForm = new FormData();
  blockedPhotoForm.append('photo', new Blob([beforeBuffer], { type: 'image/jpeg' }), 'blocked-photo.jpg');
  const maintenanceOrderId = db.prepare('SELECT order_id FROM maintenance_cards WHERE id = ?').get(missingAfterCardId).order_id;
  const photoDuringPendingRename = await request(`/api/maintenance/orders/${maintenanceOrderId}/cards/${missingAfterCardId}/photos/before`, {
    method: 'POST', body: blockedPhotoForm,
  }, adminCookie);
  assert.equal(photoDuringPendingRename.response.status, 409);
  assert.match(photoDuringPendingRename.body.error, /maintenance file recovery is pending/i);
  const recoveryResult = await recoverMachineCorrectionRenames();
  assert.equal(recoveryResult.recoveredCount, 1);
  assert.ok(existsSync(join(temporaryDirectory, 'storage', ...recoveryTarget.sourcePath.split('/'))));
  assert.equal(existsSync(join(temporaryDirectory, 'storage', ...recoveryTarget.destinationPath.split('/'))), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM machine_correction_rename_operations WHERE operation_id = ?')
    .get(recoveryOperationId).count, 0);
  const rejectRecoveryReport = await request(`/api/maintenance/machine-corrections/${recoveryReport.body.correctionId}/review`, jsonOptions('PATCH', {
    action: 'rejected', note: 'اختبار الاستعادة للعملية المعدّة دون اعتماد التغيير.',
  }), adminCookie);
  assert.equal(rejectRecoveryReport.response.status, 200, JSON.stringify(rejectRecoveryReport.body));

  const optionalAfterMachineId = Number(db.prepare(`
    INSERT INTO machines (code, name_ar, area, latitude, longitude, is_location_locked, geofence_radius_meters)
    VALUES ('1436', 'ماكينة اختبار بلا صور بعد', 'التجمع', ?, ?, 1, 50)
  `).run(visitPayload.location.latitude, visitPayload.location.longitude).lastInsertRowid);
  const optionalAfterCardId = Number(db.prepare(`
    INSERT INTO maintenance_cards (order_id, machine_id, before_photos_json, after_photos_json)
    VALUES (?, ?, '[]', '[]')
  `).run(orderId, optionalAfterMachineId).lastInsertRowid);
  const noAfterTimestamp = new Date().toISOString();
  const noAfterPayload = {
    ...visitPayload,
    visitUuid: randomUUID(),
    cardId: optionalAfterCardId,
    machineCode: '1436',
    capturedAt: noAfterTimestamp,
    beforeCapturedAt: Array.from({ length: 3 }, (_, index) => new Date(Date.now() - (3 - index) * 60 * 1000).toISOString()),
    afterCapturedAt: [],
    location: { ...visitPayload.location, updatedAt: noAfterTimestamp },
  };
  const noAfterVisit = await request('/api/rep/sync-visit', {
    method: 'POST', body: buildVisitForm(noAfterPayload, 3, 0),
  }, login.cookie);
  assert.equal(noAfterVisit.response.status, 200, JSON.stringify(noAfterVisit.body));
  assert.equal(noAfterVisit.body.status, 'pending_review');
  assert.equal(noAfterVisit.body.beforePhotoCount, 3);
  assert.equal(noAfterVisit.body.afterPhotoCount, 0);
  const noAfterVisitRow = db.prepare('SELECT id, before_path, after_path FROM rep_visits WHERE visit_uuid = ?').get(noAfterPayload.visitUuid);
  assert.ok(noAfterVisitRow.before_path);
  assert.equal(noAfterVisitRow.after_path, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rep_visit_photos WHERE visit_id = ? AND phase = 'before'").get(noAfterVisitRow.id).count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rep_visit_photos WHERE visit_id = ? AND phase = 'after'").get(noAfterVisitRow.id).count, 0);
  const noAfterQueue = await request('/api/supervisor/qa/queue', {}, adminCookie);
  const noAfterReview = noAfterQueue.body.visits.find((visit) => visit.visitUuid === noAfterPayload.visitUuid);
  assert.ok(noAfterReview);
  assert.equal(noAfterReview.beforePhotos.length, 3);
  assert.deepEqual(noAfterReview.afterPhotos, []);
  assert.equal(noAfterReview.afterPhotoUrl, null);
  const missingAfterPhoto = await fetch(`${baseUrl}/api/supervisor/visits/${noAfterVisitRow.id}/photos/after/1`, { headers: { cookie: adminCookie } });
  assert.equal(missingAfterPhoto.status, 404);
  const approveNoAfterVisit = await request(`/api/supervisor/visits/${noAfterVisitRow.id}/review`, jsonOptions('POST', { action: 'approve' }), adminCookie);
  assert.equal(approveNoAfterVisit.response.status, 200, JSON.stringify(approveNoAfterVisit.body));
  assert.equal(approveNoAfterVisit.body.status, 'approved');
  const routeAfterNoAfterApproval = await request('/api/rep/today-route?username=rep-nour', {}, login.cookie);
  const noAfterMachineRoute = routeAfterNoAfterApproval.body.regions.flatMap((region) => region.machines)
    .find((machine) => machine.cardId === optionalAfterCardId);
  assert.equal(noAfterMachineRoute.isCompleted, true, 'an approved visit does not require an After photo to complete the route');

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
