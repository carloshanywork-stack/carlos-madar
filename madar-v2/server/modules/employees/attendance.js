import { recordAttendanceDuty } from '../rep/tracking-ledger.js';
import { createHash } from 'node:crypto';
import { db } from '../../database/connection.js';
import { env } from '../../config/env.js';
import { recordAudit } from '../audit.js';
import { HttpError, allowOnlyKeys, positiveId, requireObject, requireText } from '../http.js';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';
const hourMs = 60 * 60 * 1000;

function getTimeZone(database) {
  const configured = database.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()?.value;
  if (typeof configured === 'string' && configured.trim()) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());
      return configured;
    } catch {
      // Ignore a damaged preference and use the established MADAR business-zone default.
    }
  }
  return DEFAULT_TIME_ZONE;
}

function formatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function localParts(timestamp, timeZone) {
  return Object.fromEntries(formatter(timeZone).formatToParts(new Date(timestamp))
    .filter((part) => part.type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nextCalendarDate({ year, month, day }) {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function zonedLocalEpoch({ year, month, day }, hour, timeZone, minute = 0, second = 0) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desired;
  const dateFormatter = formatter(timeZone);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(guess))
      .filter((part) => part.type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const correction = desired - represented;
    guess += correction;
    if (correction === 0) break;
  }
  return guess;
}

function roundHours(milliseconds) {
  return Math.round(milliseconds / hourMs * 100) / 100;
}

/** Calculates Cairo shift overlap and classifies all outside-shift work by weekday. */
export function calculateShiftHours(clockInTime, clockOutTime, timeZone = DEFAULT_TIME_ZONE) {
  const start = Date.parse(clockInTime);
  const end = Date.parse(clockOutTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpError(400, 'Clock-out must be later than clock-in.');
  }
  if (end - start > 366 * 24 * hourMs) {
    throw new HttpError(409, 'This attendance record spans more than one year and requires administrative correction.');
  }

  const totalMilliseconds = end - start;
  let regularMilliseconds = 0;
  let normalOvertimeMilliseconds = 0;
  let holidayOvertimeMilliseconds = 0;
  const firstDay = localParts(start, timeZone);
  const finalDay = localParts(Math.max(start, end - 1), timeZone);
  let day = { year: firstDay.year, month: firstDay.month, day: firstDay.day };
  const lastKey = dateKey(finalDay);

  // Attendance is day-based. The loop also handles a clock-out just after midnight.
  for (let count = 0; count < 366; count += 1) {
    const key = dateKey(day);
    const nextDay = nextCalendarDate(day);
    const dayStart = zonedLocalEpoch(day, 0, timeZone);
    const dayEnd = zonedLocalEpoch(nextDay, 0, timeZone);
    const overlapStart = Math.max(start, dayStart);
    const overlapEnd = Math.min(end, dayEnd);
    const overlap = Math.max(0, overlapEnd - overlapStart);
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();

    if (weekday === 5) {
      holidayOvertimeMilliseconds += overlap;
    } else {
      const shiftStart = zonedLocalEpoch(day, 9, timeZone);
      const shiftEnd = zonedLocalEpoch(day, 18, timeZone);
      const regular = Math.max(0, Math.min(overlapEnd, shiftEnd) - Math.max(overlapStart, shiftStart));
      regularMilliseconds += regular;
      normalOvertimeMilliseconds += Math.max(0, overlap - regular);
    }

    if (key === lastKey) break;
    day = nextDay;
  }

  const normalOvertimeHours = roundHours(normalOvertimeMilliseconds);
  const holidayOvertimeHours = roundHours(holidayOvertimeMilliseconds);
  return {
    totalHours: roundHours(totalMilliseconds),
    regularHours: roundHours(regularMilliseconds),
    overtimeHours: roundHours(normalOvertimeMilliseconds + holidayOvertimeMilliseconds),
    normalOvertimeHours,
    holidayOvertimeHours,
  };
}

function localDate(now, timeZone) {
  return dateKey(localParts(now.valueOf(), timeZone));
}

function parseBusinessLocalDateTime(value, timeZone) {
  const input = requireText(value, 'clockOutLocal', { maxLength: 19 });
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (!match) throw new HttpError(400, 'clockOutLocal must use YYYY-MM-DDTHH:mm format.');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00'] = match;
  const parts = {
    year: Number(yearText), month: Number(monthText), day: Number(dayText),
    hour: Number(hourText), minute: Number(minuteText), second: Number(secondText),
  };
  const calendarCheck = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (calendarCheck.getUTCFullYear() !== parts.year || calendarCheck.getUTCMonth() + 1 !== parts.month
      || calendarCheck.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    throw new HttpError(400, 'clockOutLocal is not a valid local date and time.');
  }
  const epoch = zonedLocalEpoch(parts, parts.hour, timeZone, parts.minute, parts.second);
  const resolved = localParts(epoch, timeZone);
  if (resolved.year !== parts.year || resolved.month !== parts.month || resolved.day !== parts.day
      || resolved.hour !== parts.hour || resolved.minute !== parts.minute || resolved.second !== parts.second) {
    throw new HttpError(400, 'clockOutLocal does not exist in the configured business time zone.');
  }
  return new Date(epoch);
}

export function getAttendanceBusinessDate(database = db, now = new Date()) {
  return localDate(now, getAttendanceBusinessTimeZone(database));
}

export function getAttendanceBusinessTimeZone(database = db) {
  return getTimeZone(database);
}

export function cancelDailyAttendance(employeeIdValue, workDateValue, actorId = null, database = db) {
  const employeeId = positiveId(employeeIdValue, 'employeeId');
  const workDate = requireText(workDateValue, 'workDate', { maxLength: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(Date.parse(`${workDate}T00:00:00Z`))) {
    throw new HttpError(400, 'workDate must be a valid YYYY-MM-DD date.');
  }
  return database.transaction(() => {
    const current = database.prepare(`SELECT * FROM employee_daily_attendance
      WHERE employee_id = ? AND work_date = ?`).get(employeeId, workDate);
    if (!current) throw new HttpError(404, 'Attendance record was not found.');
    if (current.status === 'cancelled') return current;
    const overtimeRequest = latestOvertimeRequest(employeeId, workDate, database);
    if (overtimeRequest && ['pending', 'approved', 'used'].includes(overtimeRequest.status)) {
      database.prepare(`UPDATE attendance_overtime_requests
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(overtimeRequest.id);
    }
    const overtimeSession = overtimeSessionForDate(employeeId, workDate, database);
    if (overtimeSession) {
      database.prepare(`UPDATE attendance_overtime_sessions
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(overtimeSession.id);
    }
    database.prepare(`UPDATE employee_daily_attendance SET status = 'cancelled',
      clock_in_time = NULL, clock_out_time = NULL, total_hours = 0, regular_hours = 0,
      overtime_hours = 0, normal_overtime_hours = 0, holiday_overtime_hours = 0,
      overtime_status = 'none', overtime_approved_by = NULL,
      notes = CASE WHEN COALESCE(notes, '') = ''
        THEN 'تم إلغاء الحضور بواسطة الإدارة'
        ELSE notes || ' | تم إلغاء الحضور بواسطة الإدارة' END
      WHERE employee_id = ? AND work_date = ?`)
      .run(employeeId, workDate);
    const updated = database.prepare(`SELECT * FROM employee_daily_attendance
      WHERE employee_id = ? AND work_date = ?`).get(employeeId, workDate);
    recordAudit({ database, actorId, action: 'cancel_attendance', entityType: 'employee_daily_attendance',
      entityId: updated.id, oldValues: current, newValues: updated });
    return updated;
  }).immediate();
}

export function getOverdueAttendance(database = db, now = new Date()) {
  const timeZone = getAttendanceBusinessTimeZone(database);
  const records = database.prepare(`SELECT attendance.id, attendance.employee_id, attendance.work_date,
      attendance.clock_in_time, employee.name,
      COALESCE(employee.department_label, employee.department) AS department
    FROM employee_daily_attendance attendance
    JOIN employees employee ON employee.id = attendance.employee_id
    WHERE attendance.clock_in_time IS NOT NULL AND attendance.clock_out_time IS NULL
      AND employee.active = 1 AND employee.deleted_at IS NULL
    ORDER BY attendance.work_date, employee.name COLLATE NOCASE`).all();
  return records.flatMap((record) => {
    const [year, month, dayOfMonth] = record.work_date.split('-').map(Number);
    const day = { year, month, day: dayOfMonth };
    const endOfShift = zonedLocalEpoch(day, 18, timeZone);
    const overdueMilliseconds = now.valueOf() - endOfShift;
    return overdueMilliseconds > 0 ? [{
      id: record.id,
      employee_id: record.employee_id,
      name: record.name,
      department: record.department,
      work_date: record.work_date,
      clock_in_time: record.clock_in_time,
      overdue_hours: roundHours(overdueMilliseconds),
      overdue_minutes: Math.floor(overdueMilliseconds / 60_000),
    }] : [];
  });
}

function assertAttendanceMonthOpen(date, database) {
  const status = database.prepare('SELECT status FROM payroll_runs WHERE month_year = ?')
    .get(date.slice(0, 7))?.status;
  if (status === 'finalized') {
    throw new HttpError(409, `Attendance for ${date.slice(0, 7)} is locked because payroll has been finalized.`);
  }
}

function activeEmployee(employeeId, database) {
  const employee = database.prepare(`SELECT id, name, user_id FROM employees
    WHERE id = ? AND active = 1 AND deleted_at IS NULL`).get(employeeId);
  if (!employee) throw new HttpError(404, 'Active employee was not found.');
  return employee;
}

function employeeForRep(userId, database) {
  const employee = database.prepare(`SELECT id, name FROM employees
    WHERE user_id = ? AND active = 1 AND deleted_at IS NULL`).get(userId);
  if (!employee) throw new HttpError(409, 'This representative does not have an active employee profile.');
  return employee;
}

function normalizeLocation(input) {
  const body = requireObject(input, 'location');
  allowOnlyKeys(body, ['latitude', 'longitude', 'accuracy', 'updatedAt']);
  const latitude = body.latitude;
  const longitude = body.longitude;
  const accuracy = body.accuracy;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 250) {
    throw new HttpError(400, 'location must contain valid coordinates and GPS accuracy of 250 meters or better.');
  }
  const updatedAt = requireText(body.updatedAt, 'location.updatedAt', { maxLength: 64 });
  if (!Number.isFinite(Date.parse(updatedAt))) throw new HttpError(400, 'location.updatedAt must be a valid date and time.');
  return { latitude, longitude, accuracy, updatedAt };
}

function getAttendanceRecord(employeeId, date, database) {
  return database.prepare(`SELECT attendance.*, employee.name,
      COALESCE(employee.department_label, employee.department) AS department,
      user.role AS user_role,
      overtime_session.id AS overtime_session_id,
      overtime_session.status AS overtime_session_status,
      overtime_session.clock_in_time AS overtime_clock_in_time,
      overtime_session.clock_out_time AS overtime_clock_out_time,
      overtime_session.clock_in_source AS overtime_clock_in_source,
      overtime_session.clock_out_source AS overtime_clock_out_source,
      overtime_session.clock_in_lat AS overtime_clock_in_lat,
      overtime_session.clock_in_lng AS overtime_clock_in_lng,
      overtime_session.clock_in_accuracy AS overtime_clock_in_accuracy,
      overtime_session.clock_out_lat AS overtime_clock_out_lat,
      overtime_session.clock_out_lng AS overtime_clock_out_lng,
      overtime_session.clock_out_accuracy AS overtime_clock_out_accuracy,
      overtime_session.clock_out_admin_note AS overtime_clock_out_admin_note,
      overtime_session.total_hours AS overtime_total_hours,
      overtime_session.overtime_hours AS overtime_session_hours,
      overtime_session.normal_overtime_hours AS overtime_normal_hours,
      overtime_session.holiday_overtime_hours AS overtime_holiday_hours,
      overtime_session.clock_in_biometric_verified AS overtime_clock_in_biometric_verified,
      overtime_session.clock_out_biometric_verified AS overtime_clock_out_biometric_verified,
      overtime_request.id AS overtime_request_id,
      overtime_request.status AS overtime_request_status,
      overtime_request.reason AS overtime_request_reason,
      overtime_request.created_at AS overtime_requested_at
    FROM employee_daily_attendance attendance
    JOIN employees employee ON employee.id = attendance.employee_id
    LEFT JOIN users user ON user.id = employee.user_id
    LEFT JOIN attendance_overtime_sessions overtime_session
      ON overtime_session.employee_id = attendance.employee_id
      AND overtime_session.work_date = attendance.work_date
      AND overtime_session.status != 'cancelled'
    LEFT JOIN attendance_overtime_requests overtime_request
      ON overtime_request.id = (
        SELECT request.id FROM attendance_overtime_requests request
        WHERE request.employee_id = attendance.employee_id
          AND request.work_date = attendance.work_date
        ORDER BY request.id DESC LIMIT 1
      )
    WHERE attendance.employee_id = ? AND attendance.work_date = ?`).get(employeeId, date);
}

function latestOvertimeRequest(employeeId, date, database) {
  return database.prepare(`SELECT * FROM attendance_overtime_requests
    WHERE employee_id = ? AND work_date = ? ORDER BY id DESC LIMIT 1`).get(employeeId, date);
}

function overtimeSessionForDate(employeeId, date, database) {
  return database.prepare(`SELECT * FROM attendance_overtime_sessions
    WHERE employee_id = ? AND work_date = ? AND status != 'cancelled'
    ORDER BY id DESC LIMIT 1`).get(employeeId, date);
}

function openOvertimeSession(employeeId, database) {
  return database.prepare(`SELECT session.*, request.status AS request_status
    FROM attendance_overtime_sessions session
    JOIN attendance_overtime_requests request ON request.id = session.request_id
    WHERE session.employee_id = ? AND session.status = 'open'
    ORDER BY session.id DESC LIMIT 1`).get(employeeId);
}

/** Every approved second-session hour is overtime; Friday hours use the holiday rate. */
function calculateOvertimeSessionHours(clockInTime, clockOutTime, timeZone = DEFAULT_TIME_ZONE) {
  const start = Date.parse(clockInTime);
  const end = Date.parse(clockOutTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpError(400, 'Clock-out must be later than clock-in.');
  }
  if (end - start > 366 * 24 * hourMs) {
    throw new HttpError(409, 'This overtime session spans more than one year and requires administrative correction.');
  }

  const firstDay = localParts(start, timeZone);
  const finalDay = localParts(Math.max(start, end - 1), timeZone);
  let day = { year: firstDay.year, month: firstDay.month, day: firstDay.day };
  const lastKey = dateKey(finalDay);
  let normalMilliseconds = 0;
  let holidayMilliseconds = 0;

  for (let count = 0; count < 366; count += 1) {
    const nextDay = nextCalendarDate(day);
    const dayStart = zonedLocalEpoch(day, 0, timeZone);
    const dayEnd = zonedLocalEpoch(nextDay, 0, timeZone);
    const overlap = Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (weekday === 5) holidayMilliseconds += overlap;
    else normalMilliseconds += overlap;
    if (dateKey(day) === lastKey) break;
    day = nextDay;
  }

  const normalOvertimeHours = roundHours(normalMilliseconds);
  const holidayOvertimeHours = roundHours(holidayMilliseconds);
  return {
    totalHours: roundHours(end - start),
    regularHours: 0,
    overtimeHours: roundHours(normalMilliseconds + holidayMilliseconds),
    normalOvertimeHours,
    holidayOvertimeHours,
  };
}

function openAttendance(employeeId, database) {
  return database.prepare(`SELECT * FROM employee_daily_attendance
    WHERE employee_id = ? AND clock_in_time IS NOT NULL AND clock_out_time IS NULL
    ORDER BY work_date DESC, id DESC LIMIT 1`).get(employeeId);
}

function clockInOvertime(employeeId, attendance, request, source, location, actorId, database,
  { now, biometricVerified = false, offlineSync = false, actionUuid = null } = {}) {
  const clockInTime = now.toISOString();
  const run = database.transaction(() => {
    const claimed = database.prepare(`UPDATE attendance_overtime_requests
      SET status = 'used', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'approved'`).run(request.id);
    if (!claimed.changes) throw new HttpError(409, 'This overtime request is no longer approved.');
    database.prepare(`INSERT INTO attendance_overtime_sessions
        (request_id, employee_id, work_date, status, clock_in_time, clock_in_source,
         clock_in_lat, clock_in_lng, clock_in_accuracy, clock_in_location_at, clock_in_biometric_verified)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`)
      .run(request.id, employeeId, attendance.work_date, clockInTime, source,
        location?.latitude ?? null, location?.longitude ?? null, location?.accuracy ?? null,
        location?.updatedAt ?? null, biometricVerified ? 1 : 0);
    const current = getAttendanceRecord(employeeId, attendance.work_date, database);
    recordAudit({ database, actorId, action: 'overtime_clock_in', entityType: 'employee_attendance',
      entityId: attendance.id,
      oldValues: { overtime_request_status: request.status, overtime_clock_in_time: null },
      newValues: {
        overtime_request_id: request.id,
        overtime_clock_in_time: clockInTime,
        overtime_clock_in_source: source,
        overtime_clock_in_lat: location?.latitude ?? null,
        overtime_clock_in_lng: location?.longitude ?? null,
        overtime_clock_in_accuracy: location?.accuracy ?? null,
        overtime_clock_in_location_at: location?.updatedAt ?? null,
        overtime_clock_in_biometric_verified: Boolean(biometricVerified),
        offline_sync: Boolean(offlineSync),
        ...(actionUuid ? { client_action_uuid: actionUuid } : {}),
      } });
    return current;
  });
  return run.immediate();
}

function clockIn(employeeIdValue, source, location, actorId, database = db,
  { now = new Date(), markOnTime = false, biometricVerified = false, offlineSync = false, actionUuid = null } = {}) {
  const employeeId = positiveId(employeeIdValue, 'employeeId');
  const employee = activeEmployee(employeeId, database);
  const timeZone = getTimeZone(database);
  if (source === 'app' && now.valueOf() > Date.now() + 5 * 60 * 1000) {
    throw new HttpError(400, 'Clock-in time cannot be more than five minutes in the future.');
  }
  const date = localDate(now, timeZone);
  const clockInTime = now.toISOString();
  assertAttendanceMonthOpen(date, database);
  if (openAttendance(employeeId, database)) throw new HttpError(409, 'This employee already has an open attendance record.');
  if (openOvertimeSession(employeeId, database)) throw new HttpError(409, 'This employee already has an open overtime attendance session.');

  const previous = getAttendanceRecord(employeeId, date, database);
  if (previous?.clock_in_time) {
    const overtimeRequest = latestOvertimeRequest(employeeId, date, database);
    const overtimeSession = overtimeSessionForDate(employeeId, date, database);
    if (overtimeRequest?.status !== 'approved' || overtimeSession) {
      if (overtimeSession) {
        throw new HttpError(409, 'Attendance has already been clocked in for today and the additional overtime session has already been used.');
      }
      throw new HttpError(409, overtimeRequest?.status === 'rejected'
        ? 'The overtime request for today was rejected. Request overtime again before a second clock-in.'
        : 'Attendance has already been clocked in for today. Request and receive overtime approval before a second clock-in.');
    }
    return clockInOvertime(employee.id, previous, overtimeRequest, source, location, actorId, database, {
      now, biometricVerified, offlineSync, actionUuid,
    });
  }
  const local = localParts(now.valueOf(), timeZone);
  const weekday = new Date(Date.UTC(
    local.year,
    local.month - 1,
    local.day,
  )).getUTCDay();
  const status = markOnTime || weekday === 5 || local.hour < 9 || (local.hour === 9 && local.minute === 0)
    ? 'present'
    : 'late';
  const run = database.transaction(() => {
    database.prepare(`INSERT INTO employee_daily_attendance
        (employee_id, work_date, status, overtime_hours, notes, clock_in_time, clock_in_source,
         clock_in_lat, clock_in_lng, clock_in_accuracy, clock_in_location_at,
         clock_out_time, clock_out_source, total_hours, regular_hours,
         overtime_status, overtime_approved_by, clock_in_biometric_verified, clock_out_biometric_verified)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 'none', NULL, ?, 0)
      ON CONFLICT(employee_id, work_date) DO UPDATE SET
        status = excluded.status, overtime_hours = 0, normal_overtime_hours = 0, holiday_overtime_hours = 0,
        clock_in_time = excluded.clock_in_time,
        clock_in_source = excluded.clock_in_source, clock_in_lat = excluded.clock_in_lat,
        clock_in_lng = excluded.clock_in_lng, clock_in_accuracy = excluded.clock_in_accuracy,
        clock_in_biometric_verified = excluded.clock_in_biometric_verified,
        clock_in_location_at = excluded.clock_in_location_at, clock_out_time = NULL, clock_out_source = NULL,
        clock_out_lat = NULL, clock_out_lng = NULL, clock_out_accuracy = NULL, clock_out_location_at = NULL,
        clock_out_biometric_verified = 0,
        total_hours = 0, regular_hours = 0, overtime_status = 'none', overtime_approved_by = NULL`)
      .run(employee.id, date, status, previous?.notes ?? null, clockInTime, source,
        location?.latitude ?? null, location?.longitude ?? null, location?.accuracy ?? null, location?.updatedAt ?? null,
        biometricVerified ? 1 : 0);
    const current = getAttendanceRecord(employee.id, date, database);
    recordAudit({ database, actorId, action: 'clock_in', entityType: 'employee_attendance', entityId: current.id,
      oldValues: previous ? {
        status: previous.status,
        overtime_hours: previous.overtime_hours,
        clock_in_time: previous.clock_in_time,
      } : null,
      newValues: {
        employee_id: employee.id,
        date,
        clock_in_time: clockInTime,
        clock_in_source: source,
        clock_in_lat: location?.latitude ?? null,
        clock_in_lng: location?.longitude ?? null,
        clock_in_accuracy: location?.accuracy ?? null,
        clock_in_location_at: location?.updatedAt ?? null,
        clock_in_biometric_verified: Boolean(biometricVerified),
        offline_sync: Boolean(offlineSync),
        ...(actionUuid ? { client_action_uuid: actionUuid } : {}),
        status,
      } });
    return current;
  });
  return run.immediate();
}

function clockOutOvertime(employeeId, session, source, location, actorId, database,
  { now = new Date(), adminNote = null, customTime = false, biometricVerified = false, offlineSync = false, actionUuid = null } = {}) {
  assertAttendanceMonthOpen(session.work_date, database);
  const clockOutTime = now.toISOString();
  if (source === 'app' && now.valueOf() > Date.now() + 5 * 60 * 1000) {
    throw new HttpError(400, 'Clock-out time cannot be more than five minutes in the future.');
  }
  const timeZone = getTimeZone(database);
  if (customTime && localDate(now, timeZone).slice(0, 7) !== session.work_date.slice(0, 7)) {
    throw new HttpError(409, 'Clock-out must remain in the same payroll month as the open overtime session.');
  }
  if (source === 'admin' && now.valueOf() > Date.now()) {
    throw new HttpError(400, 'Administrative clock-out time cannot be in the future.');
  }
  const daily = database.prepare(`SELECT id FROM employee_daily_attendance
    WHERE employee_id = ? AND work_date = ?`).get(employeeId, session.work_date);
  if (!daily) throw new HttpError(409, 'The original attendance record for this overtime session is missing.');
  const hours = calculateOvertimeSessionHours(session.clock_in_time, clockOutTime, timeZone);
  const run = database.transaction(() => {
    const result = database.prepare(`UPDATE attendance_overtime_sessions
      SET clock_out_time = ?, clock_out_source = ?, clock_out_lat = ?, clock_out_lng = ?,
        clock_out_accuracy = ?, clock_out_location_at = ?, clock_out_biometric_verified = ?,
        clock_out_admin_note = ?, total_hours = ?, overtime_hours = ?,
        normal_overtime_hours = ?, holiday_overtime_hours = ?, status = 'closed',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open' AND clock_out_time IS NULL`)
      .run(clockOutTime, source, location?.latitude ?? null, location?.longitude ?? null,
        location?.accuracy ?? null, location?.updatedAt ?? null, biometricVerified ? 1 : 0,
        source === 'admin' ? adminNote : null, hours.totalHours, hours.overtimeHours,
        hours.normalOvertimeHours, hours.holidayOvertimeHours, session.id);
    if (!result.changes) throw new HttpError(409, 'This overtime session has already been clocked out.');
    database.prepare(`UPDATE employee_daily_attendance SET
        total_hours = ROUND(COALESCE(total_hours, 0) + ?, 2),
        overtime_hours = ROUND(COALESCE(overtime_hours, 0) + ?, 2),
        normal_overtime_hours = ROUND(COALESCE(normal_overtime_hours, 0) + ?, 2),
        holiday_overtime_hours = ROUND(COALESCE(holiday_overtime_hours, 0) + ?, 2),
        overtime_status = CASE WHEN ROUND(COALESCE(overtime_hours, 0) + ?, 2) > 0 THEN 'pending' ELSE 'none' END,
        overtime_approved_by = NULL
      WHERE id = ?`)
      .run(hours.totalHours, hours.overtimeHours, hours.normalOvertimeHours,
        hours.holidayOvertimeHours, hours.overtimeHours, daily.id);
    const updated = getAttendanceRecord(employeeId, session.work_date, database);
    updated.last_clock_out_kind = 'overtime';
    updated.last_clock_out_time = clockOutTime;
    recordAudit({ database, actorId, action: source === 'admin' ? 'admin_overtime_clock_out' : 'overtime_clock_out',
      entityType: 'employee_attendance', entityId: daily.id,
      oldValues: { overtime_clock_out_time: null, overtime_status: 'open' },
      newValues: {
        overtime_session_id: session.id,
        overtime_clock_out_time: clockOutTime,
        overtime_clock_out_source: source,
        overtime_clock_out_lat: location?.latitude ?? null,
        overtime_clock_out_lng: location?.longitude ?? null,
        overtime_clock_out_accuracy: location?.accuracy ?? null,
        overtime_clock_out_location_at: location?.updatedAt ?? null,
        overtime_clock_out_biometric_verified: Boolean(biometricVerified),
        overtime_clock_out_admin_note: source === 'admin' ? adminNote : null,
        overtime_status: 'pending',
        offline_sync: Boolean(offlineSync),
        ...(actionUuid ? { client_action_uuid: actionUuid } : {}),
        ...hours,
      } });
    return updated;
  });
  return run.immediate();
}

function clockOut(employeeIdValue, source, location, actorId, database = db,
  { now = new Date(), adminNote = null, customTime = false, biometricVerified = false, offlineSync = false, actionUuid = null } = {}) {
  const employeeId = positiveId(employeeIdValue, 'employeeId');
  const employee = activeEmployee(employeeId, database);
  const overtime = openOvertimeSession(employee.id, database);
  if (overtime) {
    return clockOutOvertime(employee.id, overtime, source, location, actorId, database, {
      now, adminNote, customTime, biometricVerified, offlineSync, actionUuid,
    });
  }
  const current = openAttendance(employee.id, database);
  if (!current) throw new HttpError(409, 'There is no open attendance record for this employee.');
  assertAttendanceMonthOpen(current.work_date, database);
  const clockOutTime = now.toISOString();
  if (source === 'app' && now.valueOf() > Date.now() + 5 * 60 * 1000) {
    throw new HttpError(400, 'Clock-out time cannot be more than five minutes in the future.');
  }
  const timeZone = getTimeZone(database);
  if (customTime && localDate(now, timeZone).slice(0, 7) !== current.work_date.slice(0, 7)) {
    throw new HttpError(409, 'Clock-out must remain in the same payroll month as the open attendance record.');
  }
  if (source === 'admin' && now.valueOf() > Date.now()) {
    throw new HttpError(400, 'Administrative clock-out time cannot be in the future.');
  }
  const hours = calculateShiftHours(current.clock_in_time, clockOutTime, timeZone);
  const overtimeStatus = hours.overtimeHours > 0 ? 'pending' : 'none';
  const run = database.transaction(() => {
    const result = database.prepare(`UPDATE employee_daily_attendance
      SET clock_out_time = ?, clock_out_source = ?, clock_out_lat = ?, clock_out_lng = ?,
        clock_out_accuracy = ?, clock_out_location_at = ?, clock_out_biometric_verified = ?, total_hours = ?, regular_hours = ?,
        overtime_hours = ?, normal_overtime_hours = ?, holiday_overtime_hours = ?, clock_out_admin_note = ?,
        overtime_status = ?, overtime_approved_by = NULL
      WHERE id = ? AND clock_out_time IS NULL`)
      .run(clockOutTime, source, location?.latitude ?? null, location?.longitude ?? null,
        location?.accuracy ?? null, location?.updatedAt ?? null, biometricVerified ? 1 : 0,
        hours.totalHours, hours.regularHours, hours.overtimeHours,
        hours.normalOvertimeHours, hours.holidayOvertimeHours, source === 'admin' ? adminNote : null,
        overtimeStatus, current.id);
    if (!result.changes) throw new HttpError(409, 'This attendance record has already been clocked out.');
    const updated = getAttendanceRecord(employee.id, current.work_date, database);
    recordAudit({ database, actorId, action: source === 'admin' ? 'admin_clock_out' : 'clock_out',
      entityType: 'employee_attendance', entityId: current.id,
      oldValues: { clock_out_time: null, clock_out_lat: current.clock_out_lat ?? null,
        clock_out_lng: current.clock_out_lng ?? null, clock_out_admin_note: current.clock_out_admin_note ?? null,
        overtime_hours: current.overtime_hours, overtime_status: current.overtime_status },
      newValues: {
        clock_out_time: clockOutTime,
        clock_out_source: source,
        clock_out_lat: location?.latitude ?? null,
        clock_out_lng: location?.longitude ?? null,
        clock_out_accuracy: location?.accuracy ?? null,
        clock_out_location_at: location?.updatedAt ?? null,
        clock_out_biometric_verified: Boolean(biometricVerified),
        offline_sync: Boolean(offlineSync),
        ...(actionUuid ? { client_action_uuid: actionUuid } : {}),
        clock_out_admin_note: source === 'admin' ? adminNote : null,
        ...hours,
        overtime_status: overtimeStatus,
      } });
    return updated;
  });
  return run.immediate();
}

export function clockInForEmployee(employeeId, actorId, database = db, options = {}) {
  return clockIn(employeeId, 'admin', null, actorId, database, { ...options, markOnTime: true });
}

export function clockOutForEmployee(employeeId, actorId, database = db, options = {}) {
  const timeZone = getAttendanceBusinessTimeZone(database);
  const customTime = options.clockOutLocal !== undefined;
  const now = !customTime
    ? options.now ?? new Date()
    : parseBusinessLocalDateTime(options.clockOutLocal, timeZone);
  const adminNote = customTime || options.adminNote !== undefined
    ? requireText(options.adminNote, 'adminNote', { maxLength: 1000 })
    : 'تسجيل انصراف يدوي من الإدارة.';
  return clockOut(employeeId, 'admin', null, actorId, database, {
    now, adminNote, customTime,
  });
}

export function clockInForRep(userId, input, database = db, options = {}) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['location', 'biometricVerified']);
  if (body.biometricVerified !== true) {
    throw new HttpError(400, 'يجب تأكيد المصادقة الحيوية قبل تسجيل الحضور.');
  }
  const location = normalizeLocation(body.location);
  const employee = employeeForRep(positiveId(userId, 'userId'), database);
  return database.transaction(() => {
    const attendance = clockIn(employee.id, 'app', location, userId, database, { ...options, biometricVerified: true });
    recordAttendanceDuty(database, userId, 'in',
      attendance.overtime_session_status === 'open' ? attendance.overtime_clock_in_time : attendance.clock_in_time,
      location);
    return attendance;
  })();
}

export function clockOutForRep(userId, input, database = db, options = {}) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['location', 'biometricVerified']);
  if (body.biometricVerified !== true) {
    throw new HttpError(400, 'يجب تأكيد المصادقة الحيوية قبل تسجيل الانصراف.');
  }
  const location = body.location === undefined || body.location === null ? null : normalizeLocation(body.location);
  const employee = employeeForRep(positiveId(userId, 'userId'), database);
  return database.transaction(() => {
    const attendance = clockOut(employee.id, 'app', location, userId, database, { ...options, biometricVerified: true });
    recordAttendanceDuty(database, userId, 'out', attendance.last_clock_out_time ?? attendance.clock_out_time, location);
    return attendance;
  })();
}

export function syncRepAttendanceAction(userIdValue, input, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['actionUuid', 'action', 'occurredAt', 'location', 'biometricVerified']);
  const userId = positiveId(userIdValue, 'userId');
  const actionUuid = requireText(body.actionUuid, 'actionUuid', { maxLength: 36 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionUuid)) {
    throw new HttpError(400, 'actionUuid must be a valid UUID.');
  }
  if (!['in', 'out'].includes(body.action)) throw new HttpError(400, 'action must be in or out.');
  if (body.biometricVerified !== true) throw new HttpError(400, 'يجب تأكيد المصادقة قبل مزامنة الحضور.');
  const occurredAtText = requireText(body.occurredAt, 'occurredAt', { maxLength: 64 });
  const occurredAtMilliseconds = Date.parse(occurredAtText);
  if (!Number.isFinite(occurredAtMilliseconds)) throw new HttpError(400, 'occurredAt must be a valid date and time.');
  if (occurredAtMilliseconds > Date.now() + 5 * 60 * 1000) {
    throw new HttpError(400, 'Attendance time cannot be more than five minutes in the future.');
  }
  const occurredAt = new Date(occurredAtMilliseconds);
  const location = body.location === undefined || body.location === null ? null : normalizeLocation(body.location);
  if (body.action === 'in' && !location) throw new HttpError(400, 'Clock-in requires a GPS fix.');
  const employee = employeeForRep(userId, database);
  const payloadHash = createHash('sha256').update(JSON.stringify({
    userId,
    action: body.action,
    occurredAt: occurredAt.toISOString(),
    location,
    biometricVerified: true,
  })).digest('hex');

  return database.transaction(() => {
    const existing = database.prepare(`
      SELECT action_uuid, rep_user_id, attendance_id, action, payload_sha256
      FROM rep_attendance_sync_actions WHERE action_uuid = ?
    `).get(actionUuid);
    if (existing) {
      if (Number(existing.rep_user_id) !== userId || existing.action !== body.action || existing.payload_sha256 !== payloadHash) {
        throw new HttpError(409, 'This attendance action UUID was already used with different data.');
      }
      const record = database.prepare('SELECT employee_id, work_date FROM employee_daily_attendance WHERE id = ?')
        .get(existing.attendance_id);
      if (!record || Number(record.employee_id) !== Number(employee.id)) {
        throw new HttpError(409, 'The original attendance record for this action is no longer available.');
      }
      return {
        success: true,
        idempotent: true,
        actionUuid,
        attendance: getAttendanceRecord(employee.id, record.work_date, database),
      };
    }

    const maximumOfflineAgeMs = env.repAttendanceMaxOfflineAgeHours * 60 * 60 * 1000;
    if (Date.now() - occurredAtMilliseconds > maximumOfflineAgeMs) {
      throw new HttpError(409,
        `Offline attendance is older than the allowed ${env.repAttendanceMaxOfflineAgeHours}-hour window and requires administrator review.`,
        { apiCode: 'ATTENDANCE_REVIEW_REQUIRED' });
    }

    const attendance = body.action === 'in'
      ? clockIn(employee.id, 'app', location, userId, database, {
        now: occurredAt, biometricVerified: true, offlineSync: true, actionUuid,
      })
      : clockOut(employee.id, 'app', location, userId, database, {
        now: occurredAt, biometricVerified: true, offlineSync: true, actionUuid,
      });
    recordAttendanceDuty(database, userId, body.action, occurredAt.toISOString(), location);
    database.prepare(`
      INSERT INTO rep_attendance_sync_actions
        (action_uuid, rep_user_id, attendance_id, action, payload_sha256, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(actionUuid, userId, attendance.id, body.action, payloadHash, occurredAt.toISOString());
    return { success: true, idempotent: false, actionUuid, attendance };
  }).immediate();
}

export function recordRepMockLocationAttempt(userIdValue, input, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['action', 'detectedAt', 'is_mock', 'mock_flag']);
  const userId = positiveId(userIdValue, 'userId');
  employeeForRep(userId, database);
  const action = requireText(body.action, 'action', { maxLength: 32 });
  if (!['in', 'out', 'tracking', 'visit'].includes(action)) throw new HttpError(400, 'Unsupported GPS action.');
  const isMock = body.is_mock ?? body.mock_flag;
  if (isMock !== true) throw new HttpError(400, 'A confirmed mock-location flag is required.');
  const detectedAtText = body.detectedAt === undefined ? new Date().toISOString()
    : requireText(body.detectedAt, 'detectedAt', { maxLength: 64 });
  const detectedAt = Date.parse(detectedAtText);
  if (!Number.isFinite(detectedAt) || detectedAt > Date.now() + 5 * 60 * 1000) {
    throw new HttpError(400, 'detectedAt must be a valid date and time.');
  }
  recordAudit({
    database,
    actorId: userId,
    action: 'mock_location_attempt',
    entityType: 'rep_attendance_security',
    entityId: userId,
    newValues: { action, is_mock: 1, detected_at: new Date(detectedAt).toISOString() },
  });
  return { success: true, audited: true };
}

export function getTodayAttendanceForRep(userId, database = db, now = new Date()) {
  const employee = employeeForRep(positiveId(userId, 'userId'), database);
  const date = localDate(now, getTimeZone(database));
  return {
    date,
    attendance: getAttendanceRecord(employee.id, date, database) ?? null,
    overtimeRequest: latestOvertimeRequest(employee.id, date, database) ?? null,
  };
}

export function requestOvertimeForRep(userIdValue, input = {}, database = db, { now = new Date() } = {}) {
  const userId = positiveId(userIdValue, 'userId');
  const body = requireObject(input ?? {});
  allowOnlyKeys(body, ['reason']);
  const reason = body.reason === undefined || body.reason === null || String(body.reason).trim() === ''
    ? null
    : requireText(body.reason, 'reason', { maxLength: 500 });
  const employee = employeeForRep(userId, database);
  const date = localDate(now, getTimeZone(database));
  assertAttendanceMonthOpen(date, database);
  const attendance = getAttendanceRecord(employee.id, date, database);
  if (!attendance?.clock_in_time || !attendance.clock_out_time || attendance.status === 'cancelled') {
    throw new HttpError(409, 'Clock out from the regular attendance session before requesting overtime.');
  }
  const existing = latestOvertimeRequest(employee.id, date, database);
  if (existing?.status === 'pending') {
    throw new HttpError(409, 'An overtime request for today is already waiting for supervisor approval.');
  }
  if (existing?.status === 'approved') {
    throw new HttpError(409, 'An overtime request for today is already approved and ready for the second clock-in.');
  }
  if (existing && ['used'].includes(existing.status)) {
    throw new HttpError(409, 'The overtime session for today has already been used.');
  }
  if (overtimeSessionForDate(employee.id, date, database)) {
    throw new HttpError(409, 'An overtime session has already been recorded for today.');
  }

  return database.transaction(() => {
    const result = database.prepare(`INSERT INTO attendance_overtime_requests
        (employee_id, work_date, requested_by, reason, status)
      VALUES (?, ?, ?, ?, 'pending')`).run(employee.id, date, userId, reason);
    const request = database.prepare('SELECT * FROM attendance_overtime_requests WHERE id = ?')
      .get(result.lastInsertRowid);
    recordAudit({ database, actorId: userId, action: 'overtime_requested',
      entityType: 'employee_attendance', entityId: attendance.id,
      oldValues: { overtime_request_status: existing?.status ?? null },
      newValues: { overtime_request_id: request.id, work_date: date, reason, status: 'pending' } });
    return request;
  }).immediate();
}

export function cancelOvertimeRequestForRep(userIdValue, database = db, { now = new Date() } = {}) {
  const userId = positiveId(userIdValue, 'userId');
  const employee = employeeForRep(userId, database);
  const date = localDate(now, getTimeZone(database));
  const current = latestOvertimeRequest(employee.id, date, database);
  if (!current) throw new HttpError(404, 'No overtime request was found for today.');
  if (current.status !== 'pending') {
    throw new HttpError(409, 'Only an overtime request still waiting for supervisor approval can be cancelled.');
  }
  const attendance = getAttendanceRecord(employee.id, date, database);
  return database.transaction(() => {
    const update = database.prepare(`UPDATE attendance_overtime_requests
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`).run(current.id);
    if (!update.changes) throw new HttpError(409, 'This overtime request has already been reviewed.');
    recordAudit({ database, actorId: userId, action: 'overtime_request_cancelled',
      entityType: 'employee_attendance', entityId: attendance?.id ?? employee.id,
      oldValues: { overtime_request_id: current.id, status: 'pending' },
      newValues: { overtime_request_id: current.id, status: 'cancelled' } });
    return database.prepare('SELECT * FROM attendance_overtime_requests WHERE id = ?').get(current.id);
  }).immediate();
}

export function listOvertimeRequests(status = 'pending', database = db) {
  const allowed = ['pending', 'approved', 'rejected', 'cancelled', 'used', 'all'];
  if (!allowed.includes(status)) throw new HttpError(400, 'Unsupported overtime request status filter.');
  return database.prepare(`SELECT request.id, request.employee_id, employee.name AS employee_name,
      COALESCE(employee.department_label, employee.department) AS department,
      request.work_date, request.reason, request.status, request.requested_by,
      requester.full_name AS requested_by_name, request.supervisor_id,
      supervisor.full_name AS supervisor_name, request.supervisor_note,
      request.decided_at, request.created_at, request.updated_at,
      attendance.id AS attendance_id, attendance.clock_in_time, attendance.clock_out_time,
      attendance.total_hours, attendance.regular_hours, attendance.overtime_hours,
      session.id AS overtime_session_id, session.clock_in_time AS overtime_clock_in_time,
      session.clock_out_time AS overtime_clock_out_time
    FROM attendance_overtime_requests request
    JOIN employees employee ON employee.id = request.employee_id
    LEFT JOIN employee_daily_attendance attendance
      ON attendance.employee_id = request.employee_id AND attendance.work_date = request.work_date
    LEFT JOIN users requester ON requester.id = request.requested_by
    LEFT JOIN users supervisor ON supervisor.id = request.supervisor_id
    LEFT JOIN attendance_overtime_sessions session
      ON session.request_id = request.id AND session.status != 'cancelled'
    WHERE (? = 'all' OR request.status = ?)
    ORDER BY request.work_date DESC, request.created_at, request.id`).all(status, status);
}

export function reviewOvertimeRequest(requestIdValue, decision, actorId, database = db, { note = null } = {}) {
  const requestId = positiveId(requestIdValue, 'requestId');
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'Unsupported overtime request decision.');
  const supervisorNote = note === undefined || note === null || String(note).trim() === ''
    ? null
    : requireText(note, 'note', { maxLength: 500 });
  const current = database.prepare(`SELECT request.*, employee.name AS employee_name
    FROM attendance_overtime_requests request
    JOIN employees employee ON employee.id = request.employee_id
    WHERE request.id = ?`).get(requestId);
  if (!current) throw new HttpError(404, 'Overtime request was not found.');
  if (current.status !== 'pending') throw new HttpError(409, 'Only a pending overtime request can be approved or rejected.');
  assertAttendanceMonthOpen(current.work_date, database);
  const attendance = database.prepare(`SELECT id FROM employee_daily_attendance
    WHERE employee_id = ? AND work_date = ?`).get(current.employee_id, current.work_date);

  return database.transaction(() => {
    const update = database.prepare(`UPDATE attendance_overtime_requests
      SET status = ?, supervisor_id = ?, supervisor_note = ?, decided_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`)
      .run(decision, actorId ?? null, supervisorNote, requestId);
    if (!update.changes) throw new HttpError(409, 'This overtime request has already been reviewed.');
    recordAudit({ database, actorId, action: `overtime_request_${decision}`,
      entityType: 'employee_attendance', entityId: attendance?.id ?? current.employee_id,
      oldValues: { overtime_request_id: requestId, status: 'pending' },
      newValues: { overtime_request_id: requestId, status: decision, supervisor_note: supervisorNote } });
    return database.prepare(`SELECT request.*, employee.name AS employee_name,
        COALESCE(employee.department_label, employee.department) AS department,
        supervisor.full_name AS supervisor_name
      FROM attendance_overtime_requests request
      JOIN employees employee ON employee.id = request.employee_id
      LEFT JOIN users supervisor ON supervisor.id = request.supervisor_id
      WHERE request.id = ?`).get(requestId);
  }).immediate();
}

export function listPendingOvertime(database = db) {
  return database.prepare(`SELECT attendance.id, attendance.employee_id, employee.name,
      COALESCE(employee.department_label, employee.department) AS department,
      attendance.work_date, attendance.clock_in_time, attendance.clock_out_time,
      attendance.total_hours, attendance.regular_hours, attendance.overtime_hours,
      COALESCE(attendance.normal_overtime_hours, 0) AS normal_overtime_hours,
      COALESCE(attendance.holiday_overtime_hours, 0) AS holiday_overtime_hours,
      attendance.overtime_status
    FROM employee_daily_attendance attendance
    JOIN employees employee ON employee.id = attendance.employee_id
    WHERE attendance.overtime_status = 'pending'
    ORDER BY attendance.work_date, employee.name COLLATE NOCASE, attendance.id`).all();
}

export function reviewOvertime(attendanceIdValue, decision, actorId, database = db) {
  const attendanceId = positiveId(attendanceIdValue, 'attendanceId');
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'Unsupported overtime decision.');
  const current = database.prepare('SELECT * FROM employee_daily_attendance WHERE id = ?').get(attendanceId);
  if (!current) throw new HttpError(404, 'Attendance record was not found.');
  if (current.overtime_status !== 'pending' || !(current.overtime_hours > 0)) {
    throw new HttpError(409, 'Only pending overtime can be approved or rejected.');
  }
  assertAttendanceMonthOpen(current.work_date, database);
  const run = database.transaction(() => {
    const update = database.prepare(`UPDATE employee_daily_attendance
      SET overtime_status = ?, overtime_approved_by = ? WHERE id = ? AND overtime_status = 'pending'`)
      .run(decision, decision === 'approved' ? actorId : null, attendanceId);
    if (!update.changes) throw new HttpError(409, 'This overtime decision has already been recorded.');
    recordAudit({ database, actorId, action: `overtime_${decision}`, entityType: 'employee_attendance',
      entityId: attendanceId,
      oldValues: { overtime_hours: current.overtime_hours, overtime_status: current.overtime_status,
        overtime_approved_by: current.overtime_approved_by },
      newValues: { overtime_hours: current.overtime_hours, overtime_status: decision,
        overtime_approved_by: decision === 'approved' ? actorId : null } });
    return database.prepare(`SELECT attendance.*, employee.name,
        COALESCE(employee.department_label, employee.department) AS department
      FROM employee_daily_attendance attendance JOIN employees employee ON employee.id = attendance.employee_id
      WHERE attendance.id = ?`).get(attendanceId);
  });
  return run.immediate();
}
