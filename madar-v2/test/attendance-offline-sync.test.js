import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, beforeEach } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'madar-offline-age-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  STORAGE_MOUNT_PATH: '',
  MADAR_V2_DATABASE_PATH: join(root, 'attendance.sqlite'),
  MADAR_V2_DATA_DIR: join(root, 'data'),
  MADAR_V2_STORAGE_ROOT: join(root, 'storage'),
  REP_ATTENDANCE_MAX_OFFLINE_AGE_HOURS: '0.5',
});

const { db } = await import('../server/database/connection.js');
const { initializeDatabase } = await import('../server/database/init.js');
const { env } = await import('../server/config/env.js');
const { syncRepAttendanceAction, clockInForEmployee } = await import('../server/modules/employees/attendance.js');
initializeDatabase({ initialAdminPassword: '' });

after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const now = Date.parse('2026-11-11T12:00:00.000Z');
const windowMs = 30 * 60 * 1000;
beforeEach((t) => t.mock.method(Date, 'now', () => now));

function representative() {
  const name = randomUUID();
  const id = Number(db.prepare(`INSERT INTO users (username, password_hash, full_name, role)
    VALUES (?, 'unused-test-password', ?, 'rep')`).run(name, name).lastInsertRowid);
  const employeeId = Number(db.prepare(`INSERT INTO employees (name, department, user_id)
    VALUES (?, 'Maintenance', ?)`).run(name, id).lastInsertRowid);
  return { id, employeeId };
}

function punch(action, timestamp) {
  const occurredAt = new Date(timestamp).toISOString();
  return { actionUuid: randomUUID(), action, occurredAt, biometricVerified: true,
    location: { latitude: 30.0444, longitude: 31.2357, accuracy: 10, updatedAt: occurredAt } };
}

function effects() {
  return Object.fromEntries(['employee_daily_attendance', 'rep_attendance_sync_actions',
    'audit_log', 'treasury_entries', 'payroll_runs'].map((table) => [table,
    db.prepare(`SELECT * FROM ${table}`).all()]));
}

function assertReviewRequired(callback) {
  assert.throws(callback, (error) => error.status === 409
    && error.apiCode === 'ATTENDANCE_REVIEW_REQUIRED'
    && /0.5-hour window/.test(error.message));
}

test('configured half-hour policy accepts recent offline clock-in and clock-out', () => {
  assert.equal(env.repAttendanceMaxOfflineAgeHours, 0.5);
  const rep = representative();
  const start = syncRepAttendanceAction(rep.id, punch('in', now - 20 * 60 * 1000));
  const end = syncRepAttendanceAction(rep.id, punch('out', now - 15 * 60 * 1000));
  assert.equal(start.attendance.id, end.attendance.id);
  assert.equal(end.attendance.total_hours, 0.08);
  assert.equal(end.idempotent, false);
});

test('exact configured age is accepted but one millisecond older cannot write clock-in', () => {
  const rep = representative();
  const before = effects();
  assertReviewRequired(() => syncRepAttendanceAction(rep.id, punch('in', now - windowMs - 1)));
  assert.deepEqual(effects(), before);
  assert.equal(syncRepAttendanceAction(rep.id, punch('in', now - windowMs)).success, true);
});

test('expired clock-out preserves an open attendance record and all payroll effects', (t) => {
  const rep = representative();
  t.mock.method(Date, 'now', () => now - windowMs);
  syncRepAttendanceAction(rep.id, punch('in', now - windowMs - 60 * 1000));
  t.mock.method(Date, 'now', () => now);
  const before = effects();
  assertReviewRequired(() => syncRepAttendanceAction(rep.id, punch('out', now - windowMs - 1)));
  assert.deepEqual(effects(), before);
});

test('arbitrarily old punches in an unfinalized month never create attendance', () => {
  const rep = representative();
  const before = effects();
  assertReviewRequired(() => syncRepAttendanceAction(rep.id, punch('in', Date.parse('2001-01-15T09:00:00Z'))));
  assertReviewRequired(() => syncRepAttendanceAction(rep.id, punch('out', Date.parse('2001-01-15T18:00:00Z'))));
  assert.deepEqual(effects(), before);
});

test('identical accepted clock-in and clock-out replays remain safe after expiry', (t) => {
  const rep = representative();
  const start = punch('in', now - 20 * 60 * 1000);
  const end = punch('out', now - 15 * 60 * 1000);
  syncRepAttendanceAction(rep.id, start);
  const accepted = syncRepAttendanceAction(rep.id, end);
  const before = effects();
  t.mock.method(Date, 'now', () => now + 2 * windowMs);
  for (const action of [start, end]) {
    const replay = syncRepAttendanceAction(rep.id, action);
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.attendance, accepted.attendance);
  }
  assert.deepEqual(effects(), before);
});

test('expired UUID replay with changed data or a different owner remains a conflict', (t) => {
  const rep = representative();
  const other = representative();
  const action = punch('in', now - 10 * 60 * 1000);
  syncRepAttendanceAction(rep.id, action);
  const before = effects();
  t.mock.method(Date, 'now', () => now + 2 * windowMs);
  for (const run of [
    () => syncRepAttendanceAction(rep.id, { ...action, location: { ...action.location, accuracy: 11 } }),
    () => syncRepAttendanceAction(other.id, action),
  ]) assert.throws(run, (error) => error.status === 409 && !error.apiCode);
  assert.deepEqual(effects(), before);
});

test('future allowance includes exactly five minutes and rejects the next millisecond', () => {
  const rep = representative();
  const before = effects();
  assert.throws(() => syncRepAttendanceAction(rep.id, punch('in', now + 5 * 60 * 1000 + 1)),
    (error) => error.status === 400 && /five minutes in the future/.test(error.message));
  assert.deepEqual(effects(), before);
  assert.equal(syncRepAttendanceAction(rep.id, punch('in', now + 5 * 60 * 1000)).success, true);
});

test('administrator attendance reconciliation is not restricted by the rep offline window', () => {
  const rep = representative();
  const timestamp = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const attendance = clockInForEmployee(rep.employeeId, null, db, { now: timestamp });
  assert.equal(attendance.clock_in_source, 'admin');
  assert.equal(attendance.clock_in_time, timestamp.toISOString());
});
