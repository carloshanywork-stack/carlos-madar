import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-attendance-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'attendance.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_REP_APK_PATH = join(temporaryDirectory, 'madar-rep.apk');
process.env.STORAGE_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [{ app }, { db }, {
  initializeDatabase,
  migrateUserEmployeeLinks,
  migrateUserEmployeeProfileSync,
}, { calculateShiftHours }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/employees/attendance.js'),
]);

initializeDatabase({ initialAdminPassword: '' });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function cookieValue(setCookie) {
  return (setCookie?.split(';', 1)[0] ?? '').trim();
}

async function request(path, options = {}, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  const body = await response.json();
  return { response, body, cookie: cookieValue(response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '') };
}

function jsonOptions(method, body) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test('4-character passwords, new user employee sync, and first-admin employee sync', async () => {
  const setup = await request('/api/auth/setup', jsonOptions('POST', {
    username: 'root', fullName: 'Root Administrator', password: '1234',
  }));
  assert.equal(setup.response.status, 201, JSON.stringify(setup.body));
  const adminCookie = setup.cookie;
  const adminEmployee = db.prepare('SELECT * FROM employees WHERE user_id = ?').get(setup.body.user.id);
  assert.ok(adminEmployee);
  assert.equal(adminEmployee.name, 'Root Administrator');
  assert.equal(adminEmployee.department, 'Administration');
  assert.equal(adminEmployee.can_login, 1);
  assert.equal(adminEmployee.active, 1);
  const attendanceColumns = new Set(db.pragma('table_info(employee_daily_attendance)').map((column) => column.name));
  for (const column of [
    'clock_in_time', 'clock_in_source', 'clock_in_lat', 'clock_in_lng', 'clock_out_time',
    'clock_out_source', 'total_hours', 'regular_hours', 'overtime_status', 'overtime_approved_by',
  ]) assert.ok(attendanceColumns.has(column), `missing attendance migration column ${column}`);

  const tooShort = await request('/api/users', jsonOptions('POST', {
    username: 'rep-short', full_name: 'Short Password Rep', role: 'rep', password: '123',
  }), adminCookie);
  assert.equal(tooShort.response.status, 400);

  const rep = await request('/api/users', jsonOptions('POST', {
    username: 'rep-omar', full_name: 'Omar Representative', role: 'rep', password: '1234',
  }), adminCookie);
  assert.equal(rep.response.status, 201, JSON.stringify(rep.body));
  const repEmployee = db.prepare('SELECT * FROM employees WHERE user_id = ?').get(rep.body.id);
  assert.ok(repEmployee);
  assert.equal(repEmployee.name, 'Omar Representative');
  assert.equal(repEmployee.department, 'Maintenance');
  assert.equal(repEmployee.can_login, 1);
  assert.equal(repEmployee.active, 1);

  const sales = await request('/api/users', jsonOptions('POST', {
    username: 'sales-user', full_name: 'Sales User', role: 'sales', password: '4321',
  }), adminCookie);
  assert.equal(sales.response.status, 201, JSON.stringify(sales.body));
  const salesEmployee = db.prepare('SELECT department, department_label, can_login FROM employees WHERE user_id = ?').get(sales.body.id);
  assert.deepEqual(salesEmployee, { department: 'Finance', department_label: 'Sales', can_login: 1 });
  const passwordChange = await request(`/api/users/${sales.body.id}`, jsonOptions('PATCH', { password: '5678' }), adminCookie);
  assert.equal(passwordChange.response.status, 200);
  const passwordLogin = await request('/api/auth/login', jsonOptions('POST', { username: 'sales-user', password: '5678' }));
  assert.equal(passwordLogin.response.status, 200);

  const secondAdmin = await request('/api/users', jsonOptions('POST', {
    username: 'second-admin', full_name: 'Second Admin', role: 'admin', password: 'admin4',
  }), adminCookie);
  assert.equal(secondAdmin.response.status, 201, JSON.stringify(secondAdmin.body));
  assert.equal(db.prepare('SELECT department FROM employees WHERE user_id = ?').get(secondAdmin.body.id).department, 'Administration');

  const operations = await request('/api/users', jsonOptions('POST', {
    username: 'operations-user', full_name: 'Operations User', role: 'operations', password: 'ops4',
  }), adminCookie);
  assert.equal(operations.response.status, 201, JSON.stringify(operations.body));
  assert.equal(db.prepare('SELECT department FROM employees WHERE user_id = ?').get(operations.body.id).department, 'Maintenance');

  const purchasing = await request('/api/users', jsonOptions('POST', {
    username: 'purchasing-user', full_name: 'Purchasing User', role: 'purchasing', password: 'buy4',
  }), adminCookie);
  assert.equal(purchasing.response.status, 201, JSON.stringify(purchasing.body));
  assert.equal(db.prepare('SELECT department FROM employees WHERE user_id = ?').get(purchasing.body.id).department, 'Warehouse');

  const inactive = await request(`/api/users/${rep.body.id}`, jsonOptions('PATCH', { isActive: 0 }), adminCookie);
  assert.equal(inactive.response.status, 200);
  assert.equal(db.prepare('SELECT active FROM employees WHERE user_id = ?').get(rep.body.id).active, 0);
  const reactivated = await request(`/api/users/${rep.body.id}`, jsonOptions('PATCH', { isActive: 1 }), adminCookie);
  assert.equal(reactivated.response.status, 200);
  assert.equal(db.prepare('SELECT active FROM employees WHERE user_id = ?').get(rep.body.id).active, 1);

  const renamed = await request(`/api/users/${rep.body.id}`, jsonOptions('PATCH', { full_name: 'Omar A.' }), adminCookie);
  assert.equal(renamed.response.status, 200);
  assert.equal(db.prepare('SELECT name FROM employees WHERE user_id = ?').get(rep.body.id).name, 'Omar A.');
});

test('shift engine counts regular windows and the whole Friday shift as overtime', () => {
  assert.deepEqual(calculateShiftHours('2026-02-05T06:00:00.000Z', '2026-02-05T16:30:00.000Z', 'Asia/Riyadh'), {
    totalHours: 10.5,
    regularHours: 9,
    overtimeHours: 1.5,
  });
  assert.deepEqual(calculateShiftHours('2026-02-06T06:00:00.000Z', '2026-02-06T14:30:00.000Z', 'Asia/Riyadh'), {
    totalHours: 8.5,
    regularHours: 0,
    overtimeHours: 8.5,
  });
  assert.deepEqual(calculateShiftHours('2026-02-05T05:00:00.000Z', '2026-02-05T15:00:00.000Z', 'Asia/Riyadh'), {
    totalHours: 10,
    regularHours: 9,
    overtimeHours: 0,
  });
});

test('rep and admin clock actions persist source/GPS, guard duplicate punches, and review overtime', async () => {
  const adminLogin = await request('/api/auth/login', jsonOptions('POST', { username: 'root', password: '1234' }));
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = adminLogin.cookie;

  const repCreated = await request('/api/users', jsonOptions('POST', {
    username: 'attendance-rep', full_name: 'Attendance Rep', role: 'rep', password: 'rep4',
  }), adminCookie);
  assert.equal(repCreated.response.status, 201, JSON.stringify(repCreated.body));
  const repLogin = await request('/api/rep/login', jsonOptions('POST', { username: 'attendance-rep', password: 'rep4' }));
  assert.equal(repLogin.response.status, 200, JSON.stringify(repLogin.body));
  const repCookie = repLogin.cookie;
  const today = await request('/api/rep/attendance/today', {}, repCookie);
  assert.equal(today.response.status, 200);
  assert.equal(today.body.attendance, null);

  const location = { latitude: 30.0444, longitude: 31.2357, accuracy: 12, updatedAt: new Date().toISOString() };
  const clockIn = await request('/api/rep/attendance/clock-in', jsonOptions('POST', { location }), repCookie);
  assert.equal(clockIn.response.status, 201, JSON.stringify(clockIn.body));
  assert.equal(clockIn.body.attendance.clock_in_source, 'app');
  assert.equal(clockIn.body.attendance.clock_in_lat, location.latitude);
  assert.equal(clockIn.body.attendance.clock_in_lng, location.longitude);
  assert.equal(clockIn.body.attendance.clock_out_time, null);
  const duplicateClockIn = await request('/api/rep/attendance/clock-in', jsonOptions('POST', { location }), repCookie);
  assert.equal(duplicateClockIn.response.status, 409);
  const clockOut = await request('/api/rep/attendance/clock-out', jsonOptions('POST', { location }), repCookie);
  assert.equal(clockOut.response.status, 200, JSON.stringify(clockOut.body));
  assert.equal(clockOut.body.attendance.clock_out_source, 'app');
  assert.ok(Number.isFinite(clockOut.body.attendance.total_hours));
  const duplicateClockOut = await request('/api/rep/attendance/clock-out', jsonOptions('POST', {}), repCookie);
  assert.equal(duplicateClockOut.response.status, 409);

  const adminEmployeeId = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(adminLogin.body.user.id).id;
  const adminMark = await request('/api/attendance/mark', jsonOptions('POST', { employeeId: adminEmployeeId }), adminCookie);
  assert.equal(adminMark.response.status, 201, JSON.stringify(adminMark.body));
  assert.equal(adminMark.body.attendance.clock_in_source, 'admin');
  const adminClockOut = await request('/api/attendance/clock-out', jsonOptions('POST', { employeeId: adminEmployeeId }), adminCookie);
  assert.equal(adminClockOut.response.status, 200, JSON.stringify(adminClockOut.body));
  assert.equal(adminClockOut.body.attendance.clock_out_source, 'admin');

  const employeeId = repCreated.body.id;
  const repEmployeeId = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(employeeId).id;
  db.prepare('UPDATE employees SET base_salary_cents = 234000 WHERE id = ?').run(repEmployeeId);
  const pendingId = Number(db.prepare(`INSERT INTO employee_daily_attendance
    (employee_id, work_date, status, overtime_hours, clock_in_time, clock_out_time, total_hours,
     regular_hours, overtime_status)
    VALUES (?, '2026-01-05', 'present', 2, '2026-01-05T06:00:00.000Z', '2026-01-05T16:00:00.000Z', 10, 8, 'pending')`)
    .run(repEmployeeId).lastInsertRowid);
  const pending = await request('/api/attendance/pending-overtime', {}, adminCookie);
  assert.ok(pending.body.records.some((record) => record.id === pendingId));
  const pendingPayroll = await request('/api/employees/payroll?month=2026-01', {}, adminCookie);
  assert.equal(pendingPayroll.body.lines.find((line) => line.employee_id === repEmployeeId).overtime_hours, 0,
    'native overtime stays out of payroll while it awaits approval');
  assert.equal(pendingPayroll.body.pending_overtime_count, 1);
  const blockedPayroll = await request('/api/employees/payroll/finalize', jsonOptions('POST', { month: '2026-01' }), adminCookie);
  assert.equal(blockedPayroll.response.status, 409, 'payroll cannot be finalized while overtime decisions are pending');

  const forbiddenReview = await request(`/api/attendance/${pendingId}/approve-overtime`, jsonOptions('POST', {}), repCookie);
  assert.equal(forbiddenReview.response.status, 403);
  const approved = await request(`/api/attendance/${pendingId}/approve-overtime`, jsonOptions('POST', {}), adminCookie);
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.attendance.overtime_status, 'approved');
  assert.equal(approved.body.attendance.overtime_approved_by, adminLogin.body.user.id);
  const approvedPayroll = await request('/api/employees/payroll?month=2026-01', {}, adminCookie);
  assert.equal(approvedPayroll.body.lines.find((line) => line.employee_id === repEmployeeId).overtime_hours, 2);

  const rejectedId = Number(db.prepare(`INSERT INTO employee_daily_attendance
    (employee_id, work_date, status, overtime_hours, clock_in_time, clock_out_time, total_hours,
     regular_hours, overtime_status)
    VALUES (?, '2026-01-06', 'present', 1, '2026-01-06T06:00:00.000Z', '2026-01-06T16:00:00.000Z', 10, 9, 'pending')`)
    .run(repEmployeeId).lastInsertRowid);
  const rejected = await request(`/api/attendance/${rejectedId}/reject-overtime`, jsonOptions('POST', {}), adminCookie);
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.attendance.overtime_status, 'rejected');
  assert.equal(rejected.body.attendance.overtime_approved_by, null);
});

test('user-to-employee migration backfills unlinked active and inactive accounts idempotently', () => {
  const createdUser = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, active)
    VALUES ('legacy-unlinked', 'test-hash', 'Legacy Unlinked', 'operations', 1)`).run();
  const createdInactive = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, active, deleted_at)
    VALUES ('legacy-inactive', 'test-hash', 'Legacy Inactive', 'rep', 0, '2025-01-01')`).run();
  db.prepare("DELETE FROM schema_migrations WHERE version = '20261103-user-employee-links'").run();

  migrateUserEmployeeLinks(db);
  migrateUserEmployeeLinks(db);

  const activeId = Number(createdUser.lastInsertRowid);
  const inactiveId = Number(createdInactive.lastInsertRowid);
  const activeEmployee = db.prepare('SELECT name, department, can_login, active FROM employees WHERE user_id = ?').get(activeId);
  assert.deepEqual(activeEmployee, { name: 'Legacy Unlinked', department: 'Maintenance', can_login: 1, active: 1 });
  const inactiveEmployee = db.prepare('SELECT name, department, can_login, active FROM employees WHERE user_id = ?').get(inactiveId);
  assert.deepEqual(inactiveEmployee, { name: 'Legacy Inactive', department: 'Maintenance', can_login: 1, active: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM employees WHERE user_id = ?').get(activeId).count, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('profile reconciliation repairs existing account links without losing payroll details', () => {
  const createdUser = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, active, deleted_at)
    VALUES ('legacy-linked-operations', 'test-hash', 'Operations Profile', 'operations', 0, '2026-01-01')`).run();
  const userId = Number(createdUser.lastInsertRowid);
  const employeeId = Number(db.prepare(`INSERT INTO employees
    (name, department, job_title, base_salary_cents, can_login, user_id, active)
    VALUES ('Old Employee Name', 'Administration', 'Field Operations', 87500, 0, ?, 1)`)
    .run(userId).lastInsertRowid);

  db.prepare("DELETE FROM schema_migrations WHERE version = '20261103-user-employee-profile-reconciliation'").run();
  migrateUserEmployeeProfileSync(db);
  migrateUserEmployeeProfileSync(db);

  const employee = db.prepare(`SELECT name, department, job_title, base_salary_cents, can_login, active
    FROM employees WHERE id = ?`).get(employeeId);
  assert.deepEqual(employee, {
    name: 'Operations Profile',
    department: 'Maintenance',
    job_title: 'Field Operations',
    base_salary_cents: 87500,
    can_login: 1,
    active: 0,
  });
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
