import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'madar-maint-route-test-'));
process.env.MADAR_V2_DATABASE_PATH = join(root, 'test.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(root, 'storage');
process.env.MADAR_V2_DATA_DIR = join(root, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.MADAR_V2_JWT_SECRET = 'test-secret-at-least-32-bytes-long-for-madar-routes';

const { app } = await import('../server/app.js');
const { db } = await import('../server/database/connection.js');
const { initializeDatabase } = await import('../server/database/init.js');
initializeDatabase({ initialAdminPassword: 'Maint-Route-Admin-2026!' });

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function request(path, cookie, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'X-App-Version-Code': '25',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

const adminLogin = await request('/api/auth/login', null, { username: 'admin', password: 'Maint-Route-Admin-2026!' });
assert.equal(adminLogin.status, 200);
const adminCookie = adminLogin.cookie;

async function createOperationsUser(username) {
  const password = 'Ops-Route-Pass-2026!';
  const created = await request('/api/users', adminCookie, {
    username,
    password,
    full_name: `Operations ${username}`,
    role: 'operations',
  });
  assert.equal(created.status, 201);
  const login = await request('/api/auth/login', null, { username, password });
  assert.equal(login.status, 200);
  return { id: created.body.id, username, cookie: login.cookie };
}

async function createRepUser(username, region = 'Cairo') {
  const password = 'Rep-Route-Pass-2026!';
  const created = await request('/api/users', adminCookie, {
    username,
    password,
    full_name: `Rep ${username}`,
    role: 'rep',
    assignedRegions: [region],
  });
  assert.equal(created.status, 201);
  const login = await request('/api/rep/login', null, { username, password });
  assert.equal(login.status, 200);
  return { id: created.body.id, username, cookie: login.cookie };
}

test('GET /api/maintenance/machines/:id/route - 404 for nonexistent machine', async () => {
  const res = await request('/api/maintenance/machines/999999/route', adminCookie);
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
});

test('GET /api/maintenance/machines/:id/route - returns machine coordinates with hasRoute=false when no breadcrumbs', async () => {
  const machineCode = `M-EMPTY-${Date.now()}`;
  const machineRes = db.prepare(`
    INSERT INTO machines (code, name_ar, area, latitude, longitude, is_location_locked)
    VALUES (?, 'ماكينة بدون زيارات', 'Cairo', 30.0444, 31.2357, 1)
  `).run(machineCode);
  const machineId = machineRes.lastInsertRowid;

  const res = await request(`/api/maintenance/machines/${machineId}/route`, adminCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.machine.id, machineId);
  assert.equal(res.body.machine.code, machineCode);
  assert.equal(res.body.machine.latitude, 30.0444);
  assert.equal(res.body.machine.longitude, 31.2357);
  assert.equal(Boolean(res.body.machine.is_location_locked), true);
  assert.equal(res.body.summary.hasRoute, false);
  assert.equal(res.body.summary.pointCount, 0);
  assert.deepEqual(res.body.segments, []);
});

test('GET /api/maintenance/machines/:id/route - full route with segments, distance, speed, and jitter suppression', async () => {
  const rep = await createRepUser(`rep-route-${randomUUID().slice(0, 6)}`);
  const clientRes = db.prepare("INSERT INTO clients (code, name) VALUES ('CLI-RT', 'عميل المسارات')").run();
  const orderRes = db.prepare(`
    INSERT INTO maintenance_orders (order_code, client_id, area, status)
    VALUES ('ORD-RT-1', ?, 'Cairo', 'in_progress')
  `).run(clientRes.lastInsertRowid);
  const orderId = orderRes.lastInsertRowid;

  db.prepare('INSERT INTO maintenance_order_reps (order_id, user_id) VALUES (?, ?)').run(orderId, rep.id);

  const machineRes = db.prepare(`
    INSERT INTO machines (code, name_ar, area, latitude, longitude, is_location_locked)
    VALUES ('M-RT-1', 'ماكينة مسار مكتمل', 'Cairo', 30.0500, 31.2400, 1)
  `).run();
  const machineId = machineRes.lastInsertRowid;

  const cardRes = db.prepare(`
    INSERT INTO maintenance_cards (order_id, machine_id, status)
    VALUES (?, ?, 'completed')
  `).run(orderId, machineId);
  const cardId = cardRes.lastInsertRowid;

  const t0 = new Date('2026-11-21T09:00:00Z').getTime();

  // Create duty session
  const dutySessionRes = db.prepare(`
    INSERT INTO rep_duty_sessions (rep_user_id, started_at, ended_at)
    VALUES (?, ?, ?)
  `).run(rep.id, new Date(t0).toISOString(), new Date(t0 + 4 * 3600 * 1000).toISOString());
  const dutySessionId = dutySessionRes.lastInsertRowid;

  // Create completed visit record
  db.prepare(`
    INSERT INTO rep_visits (
      visit_uuid, rep_user_id, order_id, card_id, machine_id,
      order_code, machine_code, region_name, payload_sha256,
      status, staging_path, final_path, captured_at, location_json
    ) VALUES (
      ?, ?, ?, ?, ?,
      'ORD-RT-1', 'M-RT-1', 'Cairo', ?,
      'completed', '/staging/v1', '/final/v1', ?, ?
    )
  `).run(
    randomUUID(), rep.id, orderId, cardId, machineId,
    'a'.repeat(64),
    new Date(t0 + 15 * 60 * 1000).toISOString(),
    JSON.stringify({ latitude: 30.0500, longitude: 31.2400, accuracy: 8.5 })
  );

  // Insert breadcrumbs:
  // Points 1 & 2: Normal movement ~110 meters apart
  // Point 3: Stationary jitter (<12m from point 2) -> should be suppressed
  // Point 4: Movement toward target machine
  // Point 5 & 6: Gap of 35 minutes -> triggers new segment!
  const insertBreadcrumb = db.prepare(`
    INSERT INTO rep_location_breadcrumbs (user_id, duty_session_id, work_date, latitude, longitude, accuracy, speed, recorded_at)
    VALUES (?, ?, '2026-11-21', ?, ?, ?, ?, ?)
  `);

  // Segment 1, Point 1
  insertBreadcrumb.run(rep.id, dutySessionId, 30.0400, 31.2300, 10.0, 5.0, new Date(t0).toISOString());
  // Segment 1, Point 2: ~110m away, 1 min later
  insertBreadcrumb.run(rep.id, dutySessionId, 30.0410, 31.2300, 8.0, 6.0, new Date(t0 + 60 * 1000).toISOString());
  // Segment 1, Point 3: stationary jitter ~5m away from point 2
  insertBreadcrumb.run(rep.id, dutySessionId, 30.04104, 31.23002, 7.0, 0.5, new Date(t0 + 120 * 1000).toISOString());
  // Segment 1, Point 4: movement to target machine location
  insertBreadcrumb.run(rep.id, dutySessionId, 30.0498, 31.2398, 5.0, 8.0, new Date(t0 + 10 * 60 * 1000).toISOString());

  // Time gap: +35 minutes later -> Segment 2
  const tGap = t0 + 45 * 60 * 1000;
  insertBreadcrumb.run(rep.id, dutySessionId, 30.0550, 31.2450, 12.0, 7.0, new Date(tGap).toISOString());
  insertBreadcrumb.run(rep.id, dutySessionId, 30.0600, 31.2500, 10.0, 6.5, new Date(tGap + 3 * 60 * 1000).toISOString());

  const res = await request(`/api/maintenance/machines/${machineId}/route`, adminCookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.machine.id, machineId);
  assert.equal(res.body.summary.hasRoute, true);
  assert.ok(res.body.summary.pointCount >= 5);
  assert.ok(res.body.summary.totalDistanceKm > 0);
  assert.ok(res.body.summary.averageSpeedKmh >= 0);
  assert.equal(res.body.summary.segmentCount, 2, 'Must split into 2 segments due to >30m time gap');

  // Verify Card-specific route endpoint
  const cardResCheck = await request(`/api/maintenance/orders/${orderId}/cards/${cardId}/route`, adminCookie);
  assert.equal(cardResCheck.status, 200);
  assert.equal(cardResCheck.body.context.cardId, cardId);
  assert.equal(cardResCheck.body.summary.hasRoute, true);
});

test('Role-based access control: Admin and Operations allowed, Rep accounts rejected on management routes', async () => {
  const operationsUser = await createOperationsUser(`ops-route-${randomUUID().slice(0, 6)}`);
  const rep = await createRepUser(`rep-access-${randomUUID().slice(0, 6)}`, 'Alex');

  const machineRes = db.prepare(`
    INSERT INTO machines (code, name_ar, area, latitude, longitude, is_location_locked)
    VALUES ('M-ROLE-1', 'ماكينة الصلاحيات', 'Alex', 31.2000, 29.9000, 1)
  `).run();
  const machineId = machineRes.lastInsertRowid;

  // 1. Admin can access
  const adminAccess = await request(`/api/maintenance/machines/${machineId}/route`, adminCookie);
  assert.equal(adminAccess.status, 200);

  // 2. Operations can access
  const opsAccess = await request(`/api/maintenance/machines/${machineId}/route`, operationsUser.cookie);
  assert.equal(opsAccess.status, 200);

  // 3. Field Representative account is rejected on /api/maintenance by architectural boundary (403)
  const repAccess = await request(`/api/maintenance/machines/${machineId}/route`, rep.cookie);
  assert.equal(repAccess.status, 403);
  assert.match(repAccess.body.error, /Field representative accounts may only access \/api\/rep/);
});
