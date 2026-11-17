import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { schemaPath } from '../server/config/paths.js';
import { initializeDatabase } from '../server/database/init.js';
import { getSupervisorRadar } from '../server/modules/supervisor/service.js';
import { syncRepAttendanceAction } from '../server/modules/employees/attendance.js';
import { syncRepLocationPing } from '../server/modules/rep/service.js';

function createTestDatabase() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  initializeDatabase({ database });
  return database;
}

test('representative attendance clock-in immediately opens duty session, sets online presence, and shows active on supervisor radar', () => {
  const db = createTestDatabase();
  const startTime = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
  const dateIso = startTime.toISOString();

  // Create employee and rep user
  db.prepare(`
    INSERT INTO users (id, username, full_name, role, active, is_online, password_hash)
    VALUES (101, 'rep-radar-test', 'مندوب الرادار', 'rep', 1, 0, 'hash')
  `).run();
  db.prepare(`
    INSERT INTO employees (id, user_id, name, department, phone)
    VALUES (201, 101, 'مندوب الرادار', 'Maintenance', '+201000000000')
  `).run();

  // Initial radar check: rep must be offline and not on duty
  let radar = getSupervisorRadar(db, startTime);
  let rep = radar.representatives.find((r) => r.id === 101);
  assert.ok(rep, 'Rep should exist on radar');
  assert.equal(rep.onDuty, false, 'Initial state: rep must not be on duty');
  assert.equal(rep.status, 'offline', 'Initial state: rep must be offline');
  assert.equal(rep.lastLocation, null, 'Initial state: rep has no location');

  // Rep clocks in via attendance sync action
  const clockInLocation = {
    latitude: 30.0444,
    longitude: 31.2357,
    accuracy: 12,
    speed: 0,
    updatedAt: dateIso,
  };
  const actionUuidIn = '11111111-2222-4333-8444-555555555555';
  const clockInResult = syncRepAttendanceAction(101, {
    actionUuid: actionUuidIn,
    action: 'in',
    occurredAt: dateIso,
    location: clockInLocation,
    biometricVerified: true,
  }, db);
  assert.equal(clockInResult.success, true);

  // Verify database state: users.is_online = 1, last_location_json set, and rep_duty_sessions active
  const userRow = db.prepare('SELECT is_online, last_location_json FROM users WHERE id = 101').get();
  assert.equal(userRow.is_online, 1, 'users.is_online must be 1 after clock-in');
  assert.ok(userRow.last_location_json, 'users.last_location_json must be populated');

  const dutySession = db.prepare('SELECT id, started_at, ended_at FROM rep_duty_sessions WHERE rep_user_id = 101 AND ended_at IS NULL').get();
  assert.ok(dutySession, 'rep_duty_sessions must have an active open session');
  assert.equal(dutySession.ended_at, null);

  // Verify Supervisor Radar immediately sees rep as on duty, online, and active
  radar = getSupervisorRadar(db, startTime);
  rep = radar.representatives.find((r) => r.id === 101);
  assert.equal(rep.onDuty, true, 'Rep must be onDuty on supervisor radar after clock-in');
  assert.equal(rep.status, 'active', 'Rep status must be active on supervisor radar after clock-in');
  assert.ok(rep.lastLocation, 'Rep must have lastLocation on radar');
  assert.equal(rep.lastLocation.latitude, 30.0444);
  assert.equal(rep.lastLocation.longitude, 31.2357);
  assert.ok(rep.lastSignal, 'Rep must have lastSignal timestamp');

  // Now test location ping while on duty: updates location and keeps rep active
  const pingTime = new Date(startTime.getTime() + 60000);
  const movingLocation = {
    latitude: 30.0480,
    longitude: 31.2390,
    accuracy: 8,
    speed: 4.5,
    updatedAt: pingTime.toISOString(),
  };
  const pingResult = syncRepLocationPing({ id: 101, role: 'rep' }, {
    onDuty: true,
    location: movingLocation,
    trail: [],
  }, db);
  assert.equal(pingResult.onDuty, true);

  radar = getSupervisorRadar(db, pingTime);
  rep = radar.representatives.find((r) => r.id === 101);
  assert.equal(rep.status, 'active');
  assert.equal(rep.lastLocation.latitude, 30.0480);
  assert.equal(rep.lastLocation.longitude, 31.2390);

  // Rep clocks out via attendance sync action
  const clockOutTime = new Date().toISOString();
  const actionUuidOut = '22222222-3333-4444-8555-666666666666';
  const clockOutResult = syncRepAttendanceAction(101, {
    actionUuid: actionUuidOut,
    action: 'out',
    occurredAt: clockOutTime,
    location: movingLocation,
    biometricVerified: true,
  }, db);
  assert.equal(clockOutResult.success, true);

  // Verify duty session is closed and user is offline
  const closedSession = db.prepare('SELECT ended_at FROM rep_duty_sessions WHERE rep_user_id = 101 AND ended_at IS NOT NULL').get();
  assert.ok(closedSession, 'Duty session must have ended_at populated');

  const userAfterOut = db.prepare('SELECT is_online FROM users WHERE id = 101').get();
  assert.equal(userAfterOut.is_online, 0, 'users.is_online must be 0 after clock-out');

  radar = getSupervisorRadar(db, new Date());
  rep = radar.representatives.find((r) => r.id === 101);
  assert.equal(rep.onDuty, false, 'Rep must not be onDuty after clock-out');
  assert.equal(rep.status, 'offline', 'Rep status must be offline after clock-out');
});
