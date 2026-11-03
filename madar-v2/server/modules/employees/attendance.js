import { db } from '../../database/connection.js';
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

function zonedLocalEpoch({ year, month, day }, hour, timeZone) {
  const desired = Date.UTC(year, month - 1, day, hour);
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

/** Calculates actual duration and the overlap with the configured local shift. */
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
  let overtimeMilliseconds = 0;
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
      overtimeMilliseconds += overlap;
    } else {
      const shiftStart = zonedLocalEpoch(day, 9, timeZone);
      const shiftEnd = zonedLocalEpoch(day, 18, timeZone);
      regularMilliseconds += Math.max(0, Math.min(end, shiftEnd) - Math.max(start, shiftStart));
      overtimeMilliseconds += Math.max(0, Math.min(end, dayEnd) - Math.max(start, shiftEnd));
    }

    if (key === lastKey) break;
    day = nextDay;
  }

  return {
    totalHours: roundHours(totalMilliseconds),
    regularHours: roundHours(regularMilliseconds),
    overtimeHours: roundHours(overtimeMilliseconds),
  };
}

function localDate(now, timeZone) {
  return dateKey(localParts(now.valueOf(), timeZone));
}

export function getAttendanceBusinessDate(database = db, now = new Date()) {
  return localDate(now, getTimeZone(database));
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
      || typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000) {
    throw new HttpError(400, 'location must contain valid latitude, longitude, and accuracy values.');
  }
  const updatedAt = requireText(body.updatedAt, 'location.updatedAt', { maxLength: 64 });
  if (!Number.isFinite(Date.parse(updatedAt))) throw new HttpError(400, 'location.updatedAt must be a valid date and time.');
  return { latitude, longitude, accuracy, updatedAt };
}

function getAttendanceRecord(employeeId, date, database) {
  return database.prepare(`SELECT attendance.*, employee.name,
      COALESCE(employee.department_label, employee.department) AS department,
      user.role AS user_role
    FROM employee_daily_attendance attendance
    JOIN employees employee ON employee.id = attendance.employee_id
    LEFT JOIN users user ON user.id = employee.user_id
    WHERE attendance.employee_id = ? AND attendance.work_date = ?`).get(employeeId, date);
}

function openAttendance(employeeId, database) {
  return database.prepare(`SELECT * FROM employee_daily_attendance
    WHERE employee_id = ? AND clock_in_time IS NOT NULL AND clock_out_time IS NULL
    ORDER BY work_date DESC, id DESC LIMIT 1`).get(employeeId);
}

function clockIn(employeeIdValue, source, location, actorId, database = db, { now = new Date(), markOnTime = false } = {}) {
  const employeeId = positiveId(employeeIdValue, 'employeeId');
  const employee = activeEmployee(employeeId, database);
  const timeZone = getTimeZone(database);
  const date = localDate(now, timeZone);
  const clockInTime = now.toISOString();
  assertAttendanceMonthOpen(date, database);
  if (openAttendance(employeeId, database)) throw new HttpError(409, 'This employee already has an open attendance record.');

  const previous = getAttendanceRecord(employeeId, date, database);
  if (previous?.clock_in_time) throw new HttpError(409, 'Attendance has already been clocked in for today.');
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
         clock_in_lat, clock_in_lng, clock_out_time, clock_out_source, total_hours, regular_hours,
         overtime_status, overtime_approved_by)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 'none', NULL)
      ON CONFLICT(employee_id, work_date) DO UPDATE SET
        status = excluded.status, overtime_hours = 0, clock_in_time = excluded.clock_in_time,
        clock_in_source = excluded.clock_in_source, clock_in_lat = excluded.clock_in_lat,
        clock_in_lng = excluded.clock_in_lng, clock_out_time = NULL, clock_out_source = NULL,
        total_hours = 0, regular_hours = 0, overtime_status = 'none', overtime_approved_by = NULL`)
      .run(employee.id, date, status, previous?.notes ?? null, clockInTime, source,
        location?.latitude ?? null, location?.longitude ?? null);
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
        status,
      } });
    return current;
  });
  return run.immediate();
}

function clockOut(employeeIdValue, source, location, actorId, database = db, { now = new Date() } = {}) {
  const employeeId = positiveId(employeeIdValue, 'employeeId');
  const employee = activeEmployee(employeeId, database);
  const current = openAttendance(employee.id, database);
  if (!current) throw new HttpError(409, 'There is no open attendance record for this employee.');
  assertAttendanceMonthOpen(current.work_date, database);
  const clockOutTime = now.toISOString();
  const timeZone = getTimeZone(database);
  const hours = calculateShiftHours(current.clock_in_time, clockOutTime, timeZone);
  const overtimeStatus = hours.overtimeHours > 0 ? 'pending' : 'none';
  const run = database.transaction(() => {
    const result = database.prepare(`UPDATE employee_daily_attendance
      SET clock_out_time = ?, clock_out_source = ?, total_hours = ?, regular_hours = ?,
        overtime_hours = ?, overtime_status = ?, overtime_approved_by = NULL
      WHERE id = ? AND clock_out_time IS NULL`)
      .run(clockOutTime, source, hours.totalHours, hours.regularHours, hours.overtimeHours, overtimeStatus, current.id);
    if (!result.changes) throw new HttpError(409, 'This attendance record has already been clocked out.');
    const updated = getAttendanceRecord(employee.id, current.work_date, database);
    recordAudit({ database, actorId, action: 'clock_out', entityType: 'employee_attendance', entityId: current.id,
      oldValues: { clock_out_time: null, overtime_hours: current.overtime_hours, overtime_status: current.overtime_status },
      newValues: {
        clock_out_time: clockOutTime,
        clock_out_source: source,
        location: location ?? null,
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
  return clockOut(employeeId, 'admin', null, actorId, database, options);
}

export function clockInForRep(userId, input, database = db, options = {}) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['location']);
  const location = normalizeLocation(body.location);
  const employee = employeeForRep(positiveId(userId, 'userId'), database);
  return clockIn(employee.id, 'app', location, userId, database, options);
}

export function clockOutForRep(userId, input, database = db, options = {}) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['location']);
  const location = body.location === undefined || body.location === null ? null : normalizeLocation(body.location);
  const employee = employeeForRep(positiveId(userId, 'userId'), database);
  return clockOut(employee.id, 'app', location, userId, database, options);
}

export function getTodayAttendanceForRep(userId, database = db, now = new Date()) {
  const employee = employeeForRep(positiveId(userId, 'userId'), database);
  const date = localDate(now, getTimeZone(database));
  return { date, attendance: getAttendanceRecord(employee.id, date, database) ?? null };
}

export function listPendingOvertime(database = db) {
  return database.prepare(`SELECT attendance.id, attendance.employee_id, employee.name,
      COALESCE(employee.department_label, employee.department) AS department,
      attendance.work_date, attendance.clock_in_time, attendance.clock_out_time,
      attendance.total_hours, attendance.regular_hours, attendance.overtime_hours,
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
