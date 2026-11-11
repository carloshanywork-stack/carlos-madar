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
  migrateStaffPayrollRules,
  migrateUserEmployeeLinks,
  migrateUserEmployeeProfileSync,
}, { calculateShiftHours, getAttendanceBusinessDate, getOverdueAttendance }] = await Promise.all([
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
    'clock_in_time', 'clock_in_source', 'clock_in_lat', 'clock_in_lng', 'clock_in_accuracy',
    'clock_in_location_at', 'clock_out_time', 'clock_out_lat', 'clock_out_lng',
    'clock_out_accuracy', 'clock_out_location_at',
    'clock_out_source', 'clock_out_admin_note', 'total_hours', 'regular_hours', 'overtime_status', 'overtime_approved_by',
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

test('shift engine classifies outside-shift work at 1.5x and all Friday work at 2x', () => {
  assert.deepEqual(calculateShiftHours('2026-02-05T06:00:00.000Z', '2026-02-05T16:30:00.000Z', 'Africa/Cairo'), {
    totalHours: 10.5,
    regularHours: 9,
    overtimeHours: 1.5,
    normalOvertimeHours: 1.5,
    holidayOvertimeHours: 0,
  });
  assert.deepEqual(calculateShiftHours('2026-02-06T06:00:00.000Z', '2026-02-06T14:30:00.000Z', 'Africa/Cairo'), {
    totalHours: 8.5,
    regularHours: 0,
    overtimeHours: 8.5,
    normalOvertimeHours: 0,
    holidayOvertimeHours: 8.5,
  });
  assert.deepEqual(calculateShiftHours('2026-02-05T05:00:00.000Z', '2026-02-05T15:00:00.000Z', 'Africa/Cairo'), {
    totalHours: 10,
    regularHours: 8,
    overtimeHours: 2,
    normalOvertimeHours: 2,
    holidayOvertimeHours: 0,
  });
  assert.deepEqual(calculateShiftHours('2026-07-30T06:00:00.000Z', '2026-07-30T16:00:00.000Z', 'Africa/Cairo'), {
    totalHours: 10,
    regularHours: 9,
    overtimeHours: 1,
    normalOvertimeHours: 1,
    holidayOvertimeHours: 0,
  });
});

test('unified staff directory, salary advances, adjustments, Friday pay, treasury settlement, and 4-character credentials', async () => {
  const adminLogin = await request('/api/auth/login', jsonOptions('POST', { username: 'root', password: '1234' }));
  assert.equal(adminLogin.response.status, 200);
  const adminCookie = adminLogin.cookie;

  const worker = await request('/api/staff', jsonOptions('POST', {
    classification: 'worker', name: 'Payroll Worker', department: 'Workshop', job_title: 'Technician',
    national_id: 'TEST-ID-104', hire_date: '2025-01-10', monthly_salary_cents: 234000,
  }), adminCookie);
  assert.equal(worker.response.status, 201, JSON.stringify(worker.body));
  assert.equal(worker.body.can_login, 0);
  assert.equal(worker.body.user_id, null);
  assert.equal(worker.body.national_id, 'TEST-ID-104');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE username = 'worker-no-account'").get().count, 0);

  const forbiddenWorkerCredentials = await request('/api/staff', jsonOptions('POST', {
    classification: 'worker', name: 'Worker with Credentials', department: 'Workshop',
    username: 'worker-no-account', password: 'worker4',
  }), adminCookie);
  assert.equal(forbiddenWorkerCredentials.response.status, 400);
  const shortStaffPassword = await request('/api/staff', jsonOptions('POST', {
    classification: 'representative', name: 'Short Staff Password', department: 'Maintenance',
    username: 'rep-short-staff', password: '123', assignedRegions: ['التجمع'],
  }), adminCookie);
  assert.equal(shortStaffPassword.response.status, 400);

  const representative = await request('/api/staff', jsonOptions('POST', {
    classification: 'representative', name: 'Unified Representative', department: 'Maintenance',
    username: 'unified-rep', password: 'rep4', assignedRegions: ['التجمع'],
  }), adminCookie);
  assert.equal(representative.response.status, 201, JSON.stringify(representative.body));
  assert.equal(representative.body.role, 'rep');
  assert.equal(representative.body.can_login, 1);
  const universalRepresentative = await request('/api/staff', jsonOptions('POST', {
    classification: 'representative', name: 'Universal Region Representative', department: 'Maintenance',
    username: 'universal-staff-rep', password: 'rep4',
  }), adminCookie);
  assert.equal(universalRepresentative.response.status, 201, JSON.stringify(universalRepresentative.body));
  assert.deepEqual(universalRepresentative.body.assignedRegions, ['*'], 'a new representative without a region list defaults to universal access');
  const resetUniversalRegions = await request(`/api/staff/${universalRepresentative.body.id}`, jsonOptions('PATCH', {
    assignedRegions: [],
  }), adminCookie);
  assert.equal(resetUniversalRegions.response.status, 200, JSON.stringify(resetUniversalRegions.body));
  assert.deepEqual(resetUniversalRegions.body.assignedRegions, ['*'], 'clearing a representative region list restores universal access');
  const repLogin = await request('/api/rep/login', jsonOptions('POST', { username: 'unified-rep', password: 'rep4' }));
  assert.equal(repLogin.response.status, 200);
  const repDenied = await request('/api/staff', {}, repLogin.cookie);
  assert.equal(repDenied.response.status, 403);
  const disabledLogin = await request(`/api/staff/${representative.body.id}`, jsonOptions('PATCH', {
    classification: 'worker', enableLogin: false,
  }), adminCookie);
  assert.equal(disabledLogin.response.status, 200, JSON.stringify(disabledLogin.body));
  assert.equal(disabledLogin.body.can_login, 0);
  assert.equal(disabledLogin.body.user_id, representative.body.user_id, 'disabling login preserves the existing identity link');
  assert.equal(db.prepare('SELECT active, deleted_at FROM users WHERE id = ?').get(representative.body.user_id).active, 0);
  const revokedRepSession = await request('/api/rep/today-route', {}, repLogin.cookie);
  assert.ok([401, 403].includes(revokedRepSession.response.status), 'existing sessions are revoked when staff login is disabled');
  const reenabledLogin = await request(`/api/staff/${representative.body.id}`, jsonOptions('PATCH', {
    classification: 'representative', enableLogin: true, username: 'unified-rep', password: 'rep5',
    assignedRegions: ['التجمع'],
  }), adminCookie);
  assert.equal(reenabledLogin.response.status, 200, JSON.stringify(reenabledLogin.body));
  assert.equal(reenabledLogin.body.can_login, 1);
  assert.equal(reenabledLogin.body.user_id, representative.body.user_id, 'reenabling login restores the same user rather than duplicating it');
  const reenabledRepLogin = await request('/api/rep/login', jsonOptions('POST', { username: 'unified-rep', password: 'rep5' }));
  assert.equal(reenabledRepLogin.response.status, 200);
  const inactiveStaff = await request(`/api/staff/${representative.body.id}`, jsonOptions('PATCH', { active: false }), adminCookie);
  assert.equal(inactiveStaff.response.status, 200, JSON.stringify(inactiveStaff.body));
  assert.equal(inactiveStaff.body.login_active, 0);
  const inactiveSession = await request('/api/rep/today-route', {}, reenabledRepLogin.cookie);
  assert.ok([401, 403].includes(inactiveSession.response.status), 'setting staff inactive revokes the current login session immediately');
  const activeStaff = await request(`/api/staff/${representative.body.id}`, jsonOptions('PATCH', { active: true }), adminCookie);
  assert.equal(activeStaff.response.status, 200, JSON.stringify(activeStaff.body));
  const activeRepLogin = await request('/api/rep/login', jsonOptions('POST', { username: 'unified-rep', password: 'rep5' }));
  assert.equal(activeRepLogin.response.status, 200, 'reactivating the profile restores login without creating a new user');

  const deposit = await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income', category: 'Payroll test funding', amountCents: 2000000,
  }), adminCookie);
  assert.equal(deposit.response.status, 201, JSON.stringify(deposit.body));
  const attendance = await request('/api/employees/attendance/monthly', jsonOptions('POST', {
    month: '2026-04', records: [
      { employeeId: worker.body.id, date: '2026-04-03', status: 'present', overtimeHours: 2 },
      { employeeId: worker.body.id, date: '2026-04-04', status: 'present', overtimeHours: 2 },
      { employeeId: worker.body.id, date: '2026-04-05', status: 'absent', overtimeHours: 0 },
    ],
  }), adminCookie);
  assert.equal(attendance.response.status, 200, JSON.stringify(attendance.body));
  const advance = await request(`/api/employees/${worker.body.id}/advances`, jsonOptions('POST', {
    month: '2026-04', amountCents: 5000, notes: 'Transport advance',
  }), adminCookie);
  assert.equal(advance.response.status, 201, JSON.stringify(advance.body));
  const bonus = await request(`/api/employees/${worker.body.id}/payroll-adjustments`, jsonOptions('POST', {
    month: '2026-04', kind: 'bonus', amountCents: 7000, description: 'Monthly quality award',
  }), adminCookie);
  assert.equal(bonus.response.status, 201, JSON.stringify(bonus.body));
  const deduction = await request(`/api/employees/${worker.body.id}/payroll-adjustments`, jsonOptions('POST', {
    month: '2026-04', kind: 'deduction', amountCents: 2500, description: 'Approved equipment deduction',
  }), adminCookie);
  assert.equal(deduction.response.status, 201, JSON.stringify(deduction.body));

  const payroll = await request('/api/employees/payroll?month=2026-04', {}, adminCookie);
  assert.equal(payroll.response.status, 200, JSON.stringify(payroll.body));
  const workerLine = payroll.body.lines.find((line) => line.employee_id === worker.body.id);
  assert.equal(workerLine.normal_overtime_hours, 2);
  assert.equal(workerLine.holiday_overtime_hours, 2);
  assert.equal(workerLine.normal_overtime_amount_cents, 3000);
  assert.equal(workerLine.holiday_overtime_amount_cents, 4000);
  assert.equal(workerLine.absence_deduction_cents, 9000);
  assert.equal(workerLine.other_deductions_cents, 2500);
  assert.equal(workerLine.advances_cents, 5000);
  assert.equal(workerLine.bonus_cents, 7000);
  assert.equal(workerLine.net_salary_cents, 231500);
  assert.equal(workerLine.adjustments.length, 2);
  assert.equal(workerLine.advance_details.length, 1);

  const settled = await request('/api/employees/payroll/finalize', jsonOptions('POST', { month: '2026-04' }), adminCookie);
  assert.equal(settled.response.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.finalized, true);
  const settledWorker = settled.body.lines.find((line) => line.employee_id === worker.body.id);
  assert.equal(settledWorker.net_salary_cents, 231500);
  assert.equal(settledWorker.adjustments.length, 2);
  const employeeTreasury = db.prepare(`SELECT category, amount_cents FROM treasury_entries
    WHERE employee_id = ? ORDER BY id`).all(worker.body.id);
  assert.deepEqual(employeeTreasury.map((entry) => entry.category), ['سلفة راتب', 'رواتب وأجور']);
  assert.deepEqual(employeeTreasury.map((entry) => entry.amount_cents), [5000, 231500]);

  const lateAdjustment = await request(`/api/employees/${worker.body.id}/payroll-adjustments`, jsonOptions('POST', {
    month: '2026-04', kind: 'bonus', amountCents: 100, description: 'Too late',
  }), adminCookie);
  assert.equal(lateAdjustment.response.status, 409);
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
  const unverifiedClockIn = await request('/api/rep/attendance/clock-in', jsonOptions('POST', { location }), repCookie);
  assert.equal(unverifiedClockIn.response.status, 400);
  assert.match(unverifiedClockIn.body.error, /المصادقة الحيوية/);
  const clockIn = await request('/api/rep/attendance/clock-in', jsonOptions('POST', { location, biometricVerified: true }), repCookie);
  assert.equal(clockIn.response.status, 201, JSON.stringify(clockIn.body));
  assert.equal(clockIn.body.attendance.clock_in_source, 'app');
  assert.equal(clockIn.body.attendance.clock_in_lat, location.latitude);
  assert.equal(clockIn.body.attendance.clock_in_lng, location.longitude);
  assert.equal(clockIn.body.attendance.clock_in_accuracy, location.accuracy);
  assert.equal(clockIn.body.attendance.clock_in_location_at, location.updatedAt);
  assert.equal(clockIn.body.attendance.clock_in_biometric_verified, 1);
  assert.equal(clockIn.body.attendance.clock_out_time, null);
  const duplicateClockIn = await request('/api/rep/attendance/clock-in', jsonOptions('POST', { location, biometricVerified: true }), repCookie);
  assert.equal(duplicateClockIn.response.status, 409);
  const unverifiedClockOut = await request('/api/rep/attendance/clock-out', jsonOptions('POST', { location }), repCookie);
  assert.equal(unverifiedClockOut.response.status, 400);
  const clockOut = await request('/api/rep/attendance/clock-out', jsonOptions('POST', { location, biometricVerified: true }), repCookie);
  assert.equal(clockOut.response.status, 200, JSON.stringify(clockOut.body));
  assert.equal(clockOut.body.attendance.clock_out_source, 'app');
  assert.equal(clockOut.body.attendance.clock_out_lat, location.latitude);
  assert.equal(clockOut.body.attendance.clock_out_lng, location.longitude);
  assert.equal(clockOut.body.attendance.clock_out_accuracy, location.accuracy);
  assert.equal(clockOut.body.attendance.clock_out_location_at, location.updatedAt);
  assert.equal(clockOut.body.attendance.clock_out_biometric_verified, 1);
  assert.ok(Number.isFinite(clockOut.body.attendance.total_hours));
  const duplicateClockOut = await request('/api/rep/attendance/clock-out', jsonOptions('POST', { biometricVerified: true }), repCookie);
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
  const cancelledDate = getAttendanceBusinessDate(db);
  const cancellation = await request('/api/attendance/cancel', jsonOptions('POST', {
    employeeId: repEmployeeId, workDate: cancelledDate,
  }), adminCookie);
  assert.equal(cancellation.response.status, 200, JSON.stringify(cancellation.body));
  assert.equal(cancellation.body.attendance.status, 'cancelled');
  assert.equal(cancellation.body.attendance.clock_in_time, null);
  assert.equal(cancellation.body.attendance.clock_out_time, null);
  assert.equal(cancellation.body.attendance.total_hours, 0);
  assert.match(cancellation.body.attendance.notes, /تم إلغاء الحضور بواسطة الإدارة/);
  const cancellationEvent = db.prepare(`SELECT payload_json FROM operations_events
    WHERE event_type = 'attendance.changed' ORDER BY event_id DESC LIMIT 1`).get();
  assert.equal(JSON.parse(cancellationEvent.payload_json).action, 'cancelled');
  assert.equal(JSON.parse(cancellationEvent.payload_json).userId, Number(employeeId));
  const cancellationAudit = db.prepare(`SELECT action FROM audit_log
    WHERE entity_type = 'employee_daily_attendance' AND entity_id = ? ORDER BY id DESC LIMIT 1`).get(String(cancellation.body.attendance.id));
  assert.equal(cancellationAudit.action, 'cancel_attendance');
  const adminUserId = adminLogin.body.user.id;
  db.prepare('UPDATE employees SET base_salary_cents = 234000 WHERE id = ?').run(repEmployeeId);
  const openAttendanceId = Number(db.prepare(`INSERT INTO employee_daily_attendance
    (employee_id, work_date, status, overtime_hours, clock_in_time, clock_in_source, total_hours,
     regular_hours, overtime_status)
    VALUES (?, '2026-02-01', 'present', 0, '2026-02-01T07:00:00.000Z', 'app', 0, 0, 'none')`)
    .run(repEmployeeId).lastInsertRowid);
  const overdue = getOverdueAttendance(db, new Date('2026-02-01T17:00:00.000Z'));
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].employee_id, repEmployeeId);
  assert.equal(overdue[0].overdue_hours, 1);
  const invalidManualTime = await request('/api/attendance/clock-out', jsonOptions('POST', {
    employeeId: repEmployeeId, clockOutLocal: '2026-02-31T19:30', adminNote: 'Invalid date',
  }), adminCookie);
  assert.equal(invalidManualTime.response.status, 400);
  const missingManualNote = await request('/api/attendance/clock-out', jsonOptions('POST', {
    employeeId: repEmployeeId, clockOutLocal: '2026-02-01T19:30',
  }), adminCookie);
  assert.equal(missingManualNote.response.status, 400);
  const crossMonthClockOut = await request('/api/attendance/clock-out', jsonOptions('POST', {
    employeeId: repEmployeeId, clockOutLocal: '2026-03-01T19:30', adminNote: 'Wrong payroll month',
  }), adminCookie);
  assert.equal(crossMonthClockOut.response.status, 409);
  const customClockOut = await request('/api/attendance/clock-out', jsonOptions('POST', {
    employeeId: repEmployeeId, clockOutLocal: '2026-02-01T19:30', adminNote: 'تم التأكيد مع المشرف',
  }), adminCookie);
  assert.equal(customClockOut.response.status, 200, JSON.stringify(customClockOut.body));
  assert.equal(customClockOut.body.attendance.id, openAttendanceId);
  assert.equal(customClockOut.body.attendance.clock_out_time, '2026-02-01T17:30:00.000Z');
  assert.equal(customClockOut.body.attendance.clock_out_admin_note, 'تم التأكيد مع المشرف');
  assert.equal(customClockOut.body.attendance.regular_hours, 9);
  assert.equal(customClockOut.body.attendance.normal_overtime_hours, 1.5);
  const clockOutAudit = db.prepare(`SELECT actor_id, action, new_values_json FROM audit_log
    WHERE entity_type = 'employee_attendance' AND entity_id = ? ORDER BY id DESC LIMIT 1`).get(String(openAttendanceId));
  assert.equal(clockOutAudit.actor_id, adminUserId);
  assert.equal(clockOutAudit.action, 'admin_clock_out');
  assert.equal(JSON.parse(clockOutAudit.new_values_json).clock_out_admin_note, 'تم التأكيد مع المشرف');

  const futureTime = new Date(Date.now() + 10 * 60_000);
  const timeZone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get().value;
  const futureParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(futureTime).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  const futureWorkDate = getAttendanceBusinessDate(db, futureTime);
  const futureEmployeeId = Number(db.prepare("INSERT INTO employees (name, department) VALUES ('Future Clockout Fixture', 'Maintenance')")
    .run().lastInsertRowid);
  const futureOpenId = Number(db.prepare(`INSERT INTO employee_daily_attendance
    (employee_id, work_date, status, overtime_hours, clock_in_time, clock_in_source, total_hours,
     regular_hours, overtime_status)
    VALUES (?, ?, 'present', 0, ?, 'app', 0, 0, 'none')`)
    .run(futureEmployeeId, futureWorkDate, new Date(Date.now() - 8 * 60 * 60_000).toISOString()).lastInsertRowid);
  const futureManualClockOut = await request('/api/attendance/clock-out', jsonOptions('POST', {
    employeeId: futureEmployeeId,
    clockOutLocal: `${futureParts.year}-${futureParts.month}-${futureParts.day}T${futureParts.hour}:${futureParts.minute}`,
    adminNote: 'Future time must be rejected',
  }), adminCookie);
  assert.equal(futureManualClockOut.response.status, 400);
  assert.equal(db.prepare('SELECT clock_out_time FROM employee_daily_attendance WHERE id = ?').get(futureOpenId).clock_out_time, null);
  db.prepare('DELETE FROM employee_daily_attendance WHERE id = ?').run(futureOpenId);

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

test('staff payroll migration backfills legacy Friday rates and finalized payroll identity snapshots idempotently', () => {
  const employeeId = Number(db.prepare(`INSERT INTO employees
    (name, department, job_title, base_salary_cents, active)
    VALUES ('Snapshot Legacy', 'Workshop', 'Technician', 120000, 1)`).run().lastInsertRowid);
  const runId = Number(db.prepare(`INSERT INTO payroll_runs (month_year, status, finalized_at)
    VALUES ('2026-03', 'finalized', '2026-04-01T00:00:00.000Z')`).run().lastInsertRowid);
  const lineId = Number(db.prepare(`INSERT INTO payroll_lines
    (run_id, employee_id, base_salary_cents, net_salary_cents)
    VALUES (?, ?, 120000, 120000)`).run(runId, employeeId).lastInsertRowid);
  const attendanceId = Number(db.prepare(`INSERT INTO employee_daily_attendance
    (employee_id, work_date, status, overtime_hours)
    VALUES (?, '2026-03-06', 'present', 2.5)`).run(employeeId).lastInsertRowid);

  db.prepare("DELETE FROM schema_migrations WHERE version = '20261103-staff-payroll-shift-and-settlement'").run();
  migrateStaffPayrollRules(db);
  migrateStaffPayrollRules(db);

  assert.deepEqual(db.prepare(`SELECT normal_overtime_hours, holiday_overtime_hours
    FROM employee_daily_attendance WHERE id = ?`).get(attendanceId), { normal_overtime_hours: 0, holiday_overtime_hours: 2.5 });
  assert.deepEqual(db.prepare('SELECT employee_name, department FROM payroll_lines WHERE id = ?').get(lineId), {
    employee_name: 'Snapshot Legacy', department: 'Workshop',
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261103-staff-payroll-shift-and-settlement'").get().count, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
