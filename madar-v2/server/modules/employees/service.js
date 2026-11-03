import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { assertCashAvailable, insertTreasuryEntry } from '../finance/treasury.service.js';
import {
  allowOnlyKeys,
  HttpError,
  isoDate,
  nonNegativeInteger,
  optionalText,
  positiveId,
  requireObject,
  requireText,
} from '../http.js';

const DEPARTMENTS = ['Maintenance', 'Workshop', 'Warehouse', 'Finance', 'Administration', 'Management', 'Sales'];
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave'];

function departmentStorageValue(value) {
  if (!DEPARTMENTS.includes(value)) throw new HttpError(400, `department must be one of: ${DEPARTMENTS.join(', ')}.`);
  if (value === 'Management') return { department: 'Administration', departmentLabel: value };
  if (value === 'Sales') return { department: 'Finance', departmentLabel: value };
  return { department: value, departmentLabel: null };
}

function mapEmployee(row) {
  return {
    ...row,
    department: row.department_label || row.department,
    monthly_salary_cents: row.base_salary_cents,
  };
}

function employeeInput(input, { partial = false } = {}) {
  const body = requireObject(input);
  const aliases = {
    monthlySalaryCents: 'monthly_salary_cents',
    dailyRateCents: 'daily_rate_cents',
    jobTitle: 'job_title',
  };
  const normalized = { ...body };
  for (const [camel, snake] of Object.entries(aliases)) {
    if (normalized[camel] !== undefined) {
      if (normalized[snake] !== undefined) throw new HttpError(400, `Provide only one of ${camel} or ${snake}.`);
      normalized[snake] = normalized[camel];
      delete normalized[camel];
    }
  }
  allowOnlyKeys(normalized, ['name', 'department', 'job_title', 'phone', 'monthly_salary_cents', 'daily_rate_cents', 'active']);
  const result = {};
  if (!partial || normalized.name !== undefined) result.name = requireText(normalized.name, 'name', { maxLength: 160 });
  if (!partial || normalized.department !== undefined) {
    result.department = departmentStorageValue(requireText(normalized.department, 'department', { maxLength: 80 }));
  }
  for (const field of ['job_title', 'phone']) {
    if (!partial || normalized[field] !== undefined) result[field] = optionalText(normalized[field], field, { maxLength: field === 'phone' ? 80 : 120 });
  }
  if (!partial || normalized.monthly_salary_cents !== undefined) {
    result.monthly_salary_cents = normalized.monthly_salary_cents === undefined ? 0 : nonNegativeInteger(normalized.monthly_salary_cents, 'monthly_salary_cents');
  }
  if (!partial || normalized.daily_rate_cents !== undefined) {
    result.daily_rate_cents = normalized.daily_rate_cents === undefined ? 0 : nonNegativeInteger(normalized.daily_rate_cents, 'daily_rate_cents');
  }
  if (normalized.active !== undefined) {
    if (typeof normalized.active !== 'boolean') throw new HttpError(400, 'active must be a boolean.');
    result.active = normalized.active ? 1 : 0;
  }
  return result;
}

export function listEmployees(department, database = db, { includeInactive = false, includeLoginUsers = false } = {}) {
  const parameters = [];
  const filters = ['deleted_at IS NULL'];
  if (!includeInactive) filters.push('active = 1');
  // Account-linked profiles remain part of attendance/payroll, but should not
  // appear as ordinary staff choices on custody, sales, and order selectors.
  if (!includeLoginUsers) filters.push('can_login = 0');
  if (department !== undefined && department !== '') {
    const normalized = requireText(department, 'department', { maxLength: 80 });
    if (!DEPARTMENTS.includes(normalized)) throw new HttpError(400, `department must be one of: ${DEPARTMENTS.join(', ')}.`);
    filters.push('(department = ? OR department_label = ?)');
    const storedDepartment = normalized === 'Management' ? 'Administration' : normalized === 'Sales' ? 'Finance' : normalized;
    parameters.push(storedDepartment, ['Management', 'Sales'].includes(normalized) ? normalized : null);
  }
  return database.prepare(`
    SELECT id, name, department, department_label, job_title, phone, base_salary_cents,
      daily_rate_cents, active, created_at, deleted_at
    FROM employees WHERE ${filters.join(' AND ')}
    ORDER BY department_label, department, name COLLATE NOCASE, id
  `).all(...parameters).map(mapEmployee);
}

export function createEmployee(input, actorId = null, database = db) {
  const employee = employeeInput(input);
  const stored = employee.department;
  const result = database.transaction(() => {
    const insert = database.prepare(`
      INSERT INTO employees (name, department, department_label, job_title, phone, base_salary_cents, daily_rate_cents, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(employee.name, stored.department, stored.departmentLabel, employee.job_title, employee.phone,
      employee.monthly_salary_cents, employee.daily_rate_cents, employee.active ?? 1);
    const id = Number(insert.lastInsertRowid);
    recordAudit({ database, actorId, action: 'create', entityType: 'employee', entityId: id,
      newValues: { ...employee, department: stored.departmentLabel ?? stored.department } });
    return id;
  }).immediate();
  return listEmployees(undefined, database, { includeInactive: true, includeLoginUsers: true })
    .find((employeeRow) => employeeRow.id === result);
}

function revokeLinkedLogin(employee, actorId, database) {
  if (!employee.user_id) return;
  const user = database.prepare('SELECT id, active, deleted_at FROM users WHERE id = ?').get(employee.user_id);
  if (!user) return;
  if (!user.deleted_at && user.active !== 0) {
    database.prepare('UPDATE users SET active = 0, is_online = 0 WHERE id = ?').run(user.id);
  }
  const revokedSessions = database.prepare(`
    UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL
  `).run(user.id).changes;
  if (user.active !== 0 || revokedSessions > 0) {
    recordAudit({ database, actorId, action: 'employee_login_revoked',
      entityType: 'user', entityId: user.id,
      oldValues: { active: user.active, open_sessions: revokedSessions },
      newValues: { active: 0, revoked_sessions: revokedSessions } });
  }
}

export function updateEmployee(employeeId, input, actorId = null, database = db) {
  const id = positiveId(employeeId, 'employeeId');
  const changes = employeeInput(input, { partial: true });
  if (!Object.keys(changes).length) throw new HttpError(400, 'At least one employee field must be provided.');
  const current = database.prepare('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!current) throw new HttpError(404, 'Employee was not found.');
  const next = {
    name: changes.name ?? current.name,
    department: changes.department?.department ?? current.department,
    department_label: changes.department ? changes.department.departmentLabel : current.department_label,
    job_title: changes.job_title === undefined ? current.job_title : changes.job_title,
    phone: changes.phone === undefined ? current.phone : changes.phone,
    base_salary_cents: changes.monthly_salary_cents ?? current.base_salary_cents,
    daily_rate_cents: changes.daily_rate_cents ?? current.daily_rate_cents,
    active: changes.active ?? current.active,
  };
  database.transaction(() => {
    database.prepare(`UPDATE employees SET name = ?, department = ?, department_label = ?, job_title = ?, phone = ?,
      base_salary_cents = ?, daily_rate_cents = ?, active = ? WHERE id = ?`)
      .run(next.name, next.department, next.department_label, next.job_title, next.phone,
        next.base_salary_cents, next.daily_rate_cents, next.active, id);
    if (changes.active === 0) revokeLinkedLogin(current, actorId, database);
    recordAudit({ database, actorId, action: 'update', entityType: 'employee', entityId: id,
      oldValues: { name: current.name, department: current.department_label ?? current.department, job_title: current.job_title,
        phone: current.phone, monthly_salary_cents: current.base_salary_cents, daily_rate_cents: current.daily_rate_cents, active: current.active },
      newValues: { name: next.name, department: next.department_label ?? next.department, job_title: next.job_title,
        phone: next.phone, monthly_salary_cents: next.base_salary_cents, daily_rate_cents: next.daily_rate_cents, active: next.active } });
  }).immediate();
  return listEmployees(undefined, database, { includeInactive: true, includeLoginUsers: true })
    .find((employee) => employee.id === id);
}

export function deactivateEmployee(employeeId, actorId = null, database = db) {
  const id = positiveId(employeeId, 'employeeId');
  const current = database.prepare('SELECT id, name, department, department_label, active, user_id FROM employees WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!current) throw new HttpError(404, 'Employee was not found.');
  database.transaction(() => {
    database.prepare('UPDATE employees SET active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    revokeLinkedLogin(current, actorId, database);
    recordAudit({ database, actorId, action: 'deactivate', entityType: 'employee', entityId: id,
      oldValues: { ...current }, newValues: { active: 0, deleted_at: 'CURRENT_TIMESTAMP' } });
  }).immediate();
  return { id, active: 0 };
}

export function getAttendance(dateValue, database = db) {
  const date = isoDate(dateValue, 'date');
  if (!date) throw new HttpError(400, 'date is required.');
  const employees = database.prepare(`
    SELECT employee.id AS employee_id, employee.name, COALESCE(employee.department_label, employee.department) AS department,
      employee.user_id, user.role AS user_role, attendance.id, attendance.status,
      COALESCE(attendance.overtime_hours, 0) AS overtime_hours, attendance.notes, attendance.work_date,
      attendance.clock_in_time, attendance.clock_in_source, attendance.clock_in_lat, attendance.clock_in_lng,
      attendance.clock_out_time, attendance.clock_out_source, COALESCE(attendance.total_hours, 0) AS total_hours,
      COALESCE(attendance.regular_hours, 0) AS regular_hours, COALESCE(attendance.overtime_status, 'none') AS overtime_status,
      attendance.overtime_approved_by
    FROM employees employee
    LEFT JOIN employee_daily_attendance attendance ON attendance.employee_id = employee.id AND attendance.work_date = ?
    LEFT JOIN users user ON user.id = employee.user_id
    WHERE employee.active = 1 AND employee.deleted_at IS NULL
    ORDER BY department, employee.name COLLATE NOCASE, employee.id
  `).all(date);
  return { date, employees };
}

export function saveAttendance(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['date', 'records']);
  const date = isoDate(body.date, 'date');
  if (!date) throw new HttpError(400, 'date is required.');
  assertAttendanceMonthOpen(date.slice(0, 7), database);
  if (!Array.isArray(body.records) || body.records.length > 1000) throw new HttpError(400, 'records must be an array of at most 1,000 attendance records.');
  const records = body.records.map((record, index) => {
    const item = requireObject(record, `records[${index}]`);
    allowOnlyKeys(item, ['employeeId', 'status', 'overtimeHours', 'notes']);
    const employeeId = positiveId(item.employeeId, `records[${index}].employeeId`);
    if (!ATTENDANCE_STATUSES.includes(item.status)) throw new HttpError(400, `records[${index}].status is not valid.`);
    const overtimeHours = item.overtimeHours === undefined ? 0 : item.overtimeHours;
    if (typeof overtimeHours !== 'number' || !Number.isFinite(overtimeHours) || overtimeHours < 0 || overtimeHours > 24) {
      throw new HttpError(400, `records[${index}].overtimeHours must be between 0 and 24.`);
    }
    return { employeeId, status: item.status, overtimeHours, notes: optionalText(item.notes, `records[${index}].notes`, { maxLength: 1000 }) };
  });
  if (new Set(records.map((record) => record.employeeId)).size !== records.length) throw new HttpError(400, 'Each employee may appear only once in an attendance submission.');
  const upsert = database.prepare(`
    INSERT INTO employee_daily_attendance (employee_id, work_date, status, overtime_hours, notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, work_date) DO UPDATE SET status = excluded.status,
      overtime_hours = CASE
        WHEN employee_daily_attendance.clock_in_time IS NOT NULL OR employee_daily_attendance.clock_out_time IS NOT NULL
          THEN employee_daily_attendance.overtime_hours
        ELSE excluded.overtime_hours
      END, notes = excluded.notes
  `);
  database.transaction(() => {
    for (const record of records) {
      const employee = database.prepare('SELECT name FROM employees WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(record.employeeId);
      if (!employee) throw new HttpError(404, `Active employee ${record.employeeId} was not found.`);
      const old = database.prepare(`SELECT status, overtime_hours, notes, clock_in_time, clock_out_time
        FROM employee_daily_attendance WHERE employee_id = ? AND work_date = ?`).get(record.employeeId, date) ?? null;
      upsert.run(record.employeeId, date, record.status, record.overtimeHours, record.notes);
      recordAudit({ database, actorId, action: old ? 'update_attendance' : 'record_attendance', entityType: 'employee_attendance',
        entityId: record.employeeId, oldValues: old, newValues: { date, ...record,
          overtimeHours: old?.clock_in_time || old?.clock_out_time ? old.overtime_hours : record.overtimeHours } });
    }
  }).immediate();
  return getAttendance(date, database);
}

function activeEmployee(employeeId, database) {
  const id = positiveId(employeeId, 'employeeId');
  const employee = database.prepare('SELECT id, name FROM employees WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(id);
  if (!employee) throw new HttpError(404, 'Active employee was not found.');
  return employee;
}

export function listEmployeeTools(employeeId, database = db) {
  const employee = activeEmployee(employeeId, database);
  return database.prepare(`SELECT id, employee_id, tool_name, serial_number, issued_at, returned_at, notes
    FROM employee_tool_custody WHERE employee_id = ? ORDER BY issued_at DESC, id DESC`).all(employee.id);
}

export function issueEmployeeTool(employeeId, input, actorId = null, database = db) {
  const employee = activeEmployee(employeeId, database);
  const body = requireObject(input);
  allowOnlyKeys(body, ['tool_name', 'serial_number', 'notes', 'toolName', 'serialNumber']);
  const toolName = requireText(body.tool_name ?? body.toolName, 'tool_name', { maxLength: 160 });
  const serialNumber = optionalText(body.serial_number ?? body.serialNumber, 'serial_number', { maxLength: 120 });
  const notes = optionalText(body.notes, 'notes', { maxLength: 1000 });
  const result = database.transaction(() => {
    const created = database.prepare(`INSERT INTO employee_tool_custody (employee_id, tool_name, serial_number, notes)
      VALUES (?, ?, ?, ?)`).run(employee.id, toolName, serialNumber, notes);
    const id = Number(created.lastInsertRowid);
    recordAudit({ database, actorId, action: 'issue_tool', entityType: 'employee_tool_custody', entityId: id,
      newValues: { employee_id: employee.id, tool_name: toolName, serial_number: serialNumber, notes } });
    return id;
  }).immediate();
  return database.prepare('SELECT * FROM employee_tool_custody WHERE id = ?').get(result);
}

export function returnEmployeeTool(toolId, actorId = null, database = db) {
  const id = positiveId(toolId, 'toolId');
  const tool = database.prepare('SELECT * FROM employee_tool_custody WHERE id = ?').get(id);
  if (!tool) throw new HttpError(404, 'Tool custody record was not found.');
  if (tool.returned_at) throw new HttpError(409, 'This tool has already been returned.');
  database.transaction(() => {
    database.prepare('UPDATE employee_tool_custody SET returned_at = CURRENT_TIMESTAMP WHERE id = ? AND returned_at IS NULL').run(id);
    recordAudit({ database, actorId, action: 'return_tool', entityType: 'employee_tool_custody', entityId: id,
      oldValues: { returned_at: null }, newValues: { returned_at: 'CURRENT_TIMESTAMP' } });
  }).immediate();
  return database.prepare('SELECT * FROM employee_tool_custody WHERE id = ?').get(id);
}

function parseMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new HttpError(400, 'month must use YYYY-MM format.');
  const [year, month] = value.split('-').map(Number);
  const start = `${value}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { month: value, start, end };
}

function assertAttendanceMonthOpen(month, database) {
  const payrollRun = database.prepare('SELECT status FROM payroll_runs WHERE month_year = ?').get(month);
  if (payrollRun?.status === 'finalized') {
    throw new HttpError(409, `Attendance for ${month} is locked because payroll has been finalized.`);
  }
}

function attendanceRecord(record, index, { includeDate = false } = {}) {
  const item = requireObject(record, `records[${index}]`);
  allowOnlyKeys(item, ['employeeId', 'status', 'overtimeHours', 'notes', ...(includeDate ? ['date'] : [])]);
  const employeeId = positiveId(item.employeeId, `records[${index}].employeeId`);
  if (!ATTENDANCE_STATUSES.includes(item.status)) throw new HttpError(400, `records[${index}].status is not valid.`);
  const overtimeHours = item.overtimeHours === undefined ? 0 : item.overtimeHours;
  if (typeof overtimeHours !== 'number' || !Number.isFinite(overtimeHours) || overtimeHours < 0 || overtimeHours > 24) {
    throw new HttpError(400, `records[${index}].overtimeHours must be between 0 and 24.`);
  }
  const normalized = {
    employeeId,
    status: item.status,
    overtimeHours,
    notes: optionalText(item.notes, `records[${index}].notes`, { maxLength: 1000 }),
  };
  if (includeDate) {
    normalized.date = isoDate(item.date, `records[${index}].date`);
    if (!normalized.date) throw new HttpError(400, `records[${index}].date is required.`);
  }
  return normalized;
}

export function getMonthlyAttendance(monthValue, database = db) {
  const { month, start, end } = parseMonth(monthValue);
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const employees = database.prepare(`
    SELECT id AS employee_id, name, COALESCE(department_label, department) AS department
    FROM employees
    WHERE active = 1 AND deleted_at IS NULL
    ORDER BY COALESCE(department_label, department) COLLATE NOCASE, name COLLATE NOCASE, id
  `).all();
  const records = database.prepare(`
    SELECT attendance.employee_id, attendance.work_date AS date, attendance.status,
      attendance.overtime_hours, attendance.notes, attendance.clock_in_time, attendance.clock_out_time,
      attendance.total_hours, attendance.regular_hours, attendance.overtime_status
    FROM employee_daily_attendance attendance
    JOIN employees employee ON employee.id = attendance.employee_id
    WHERE work_date >= ? AND work_date < ?
      AND employee.active = 1 AND employee.deleted_at IS NULL
    ORDER BY attendance.work_date, attendance.employee_id
  `).all(start, end);
  return { month, daysInMonth, employees, records };
}

export function markAllPresent(dateValue, actorId = null, database = db) {
  const date = isoDate(dateValue, 'date');
  if (!date) throw new HttpError(400, 'date is required.');
  const month = date.slice(0, 7);
  assertAttendanceMonthOpen(month, database);
  const employees = database.prepare(`
    SELECT id FROM employees WHERE active = 1 AND deleted_at IS NULL ORDER BY id
  `).all();
  const existingAttendance = database.prepare(`
    SELECT status, overtime_hours, notes FROM employee_daily_attendance
    WHERE employee_id = ? AND work_date = ?
  `);
  const upsert = database.prepare(`
    INSERT INTO employee_daily_attendance (employee_id, work_date, status, overtime_hours)
    VALUES (?, ?, 'present', 0)
    ON CONFLICT(employee_id, work_date) DO UPDATE SET status = 'present'
  `);
  database.transaction(() => {
    for (const employee of employees) {
      const old = existingAttendance.get(employee.id, date) ?? null;
      upsert.run(employee.id, date);
      recordAudit({ database, actorId, action: old ? 'update_attendance' : 'record_attendance',
        entityType: 'employee_attendance', entityId: employee.id, oldValues: old,
        newValues: { date, employeeId: employee.id, status: 'present',
          overtimeHours: old?.overtime_hours ?? 0, notes: old?.notes ?? null } });
    }
  }).immediate();
  return { success: true, count: employees.length, date };
}

export function saveMonthlyAttendance(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['month', 'records']);
  const { month, start, end } = parseMonth(body.month);
  if (!Array.isArray(body.records) || body.records.length > 31_000) {
    throw new HttpError(400, 'records must be an array of at most 31,000 attendance records.');
  }
  const records = body.records.map((record, index) => attendanceRecord(record, index, { includeDate: true }));
  if (records.some((record) => record.date < start || record.date >= end)) {
    throw new HttpError(400, 'Every attendance date must fall within the selected month.');
  }
  const keys = records.map((record) => `${record.employeeId}:${record.date}`);
  if (new Set(keys).size !== records.length) throw new HttpError(400, 'Each employee may appear only once per date.');
  assertAttendanceMonthOpen(month, database);
  const upsert = database.prepare(`
    INSERT INTO employee_daily_attendance (employee_id, work_date, status, overtime_hours, notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, work_date) DO UPDATE SET status = excluded.status,
      overtime_hours = CASE
        WHEN employee_daily_attendance.clock_in_time IS NOT NULL OR employee_daily_attendance.clock_out_time IS NOT NULL
          THEN employee_daily_attendance.overtime_hours
        ELSE excluded.overtime_hours
      END, notes = excluded.notes
  `);
  database.transaction(() => {
    for (const record of records) {
      const employee = database.prepare('SELECT name FROM employees WHERE id = ? AND active = 1 AND deleted_at IS NULL')
        .get(record.employeeId);
      if (!employee) throw new HttpError(404, `Active employee ${record.employeeId} was not found.`);
      const old = database.prepare(`SELECT status, overtime_hours, notes, clock_in_time, clock_out_time FROM employee_daily_attendance
        WHERE employee_id = ? AND work_date = ?`).get(record.employeeId, record.date) ?? null;
      upsert.run(record.employeeId, record.date, record.status, record.overtimeHours, record.notes);
      recordAudit({ database, actorId, action: old ? 'update_attendance' : 'record_attendance',
        entityType: 'employee_attendance', entityId: record.employeeId, oldValues: old,
        newValues: { date: record.date, ...record,
          overtimeHours: old?.clock_in_time || old?.clock_out_time ? old.overtime_hours : record.overtimeHours } });
    }
  }).immediate();
  return getMonthlyAttendance(month, database);
}

function calculateDraftPayroll(monthValue, database) {
  const { month, start, end } = parseMonth(monthValue);
  const existingRun = database.prepare('SELECT * FROM payroll_runs WHERE month_year = ?').get(month);
  if (existingRun?.status === 'finalized') {
    const lines = database.prepare(`SELECT line.*, employee.name, COALESCE(employee.department_label, employee.department) AS department
      FROM payroll_lines line JOIN employees employee ON employee.id = line.employee_id WHERE line.run_id = ? ORDER BY employee.name COLLATE NOCASE, employee.id`).all(existingRun.id);
    return {
      run: existingRun,
      month,
      lines,
      totals: {
        total_base_cents: existingRun.total_base_cents,
        total_overtime_cents: existingRun.total_overtime_cents,
        total_deductions_cents: existingRun.total_deductions_cents,
        net_total_cents: existingRun.net_total_cents,
      },
      pending_overtime_count: 0,
      finalized: true,
    };
  }
  const employees = database.prepare(`
    SELECT id, name, COALESCE(department_label, department) AS department, base_salary_cents AS monthly_salary_cents,
      daily_rate_cents, phone, job_title
    FROM employees WHERE active = 1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE, id
  `).all();
  const attendance = database.prepare(`
    SELECT employee_id, SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS present_days,
      SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
      COALESCE(SUM(CASE
        WHEN clock_in_time IS NULL AND clock_out_time IS NULL THEN overtime_hours
        WHEN overtime_status = 'approved' THEN overtime_hours
        ELSE 0
      END), 0) AS overtime_hours
    FROM employee_daily_attendance WHERE work_date >= ? AND work_date < ? GROUP BY employee_id
  `).all(start, end);
  const pendingOvertimeCount = database.prepare(`SELECT COUNT(*) AS count FROM employee_daily_attendance
    WHERE work_date >= ? AND work_date < ? AND overtime_status = 'pending'`).get(start, end).count;
  const byEmployee = new Map(attendance.map((row) => [row.employee_id, row]));
  const lines = employees.map((employee) => {
    const record = byEmployee.get(employee.id) ?? { present_days: 0, absent_days: 0, overtime_hours: 0 };
    const baseSalaryCents = employee.monthly_salary_cents;
    const dailyRateCents = Math.round(baseSalaryCents / 26);
    const overtimeAmountCents = Math.round(record.overtime_hours * dailyRateCents / 9 * 1.5);
    const deductionsCents = Math.min(baseSalaryCents, Math.round(record.absent_days * dailyRateCents));
    const netSalaryCents = baseSalaryCents + overtimeAmountCents - deductionsCents;
    if (![baseSalaryCents, overtimeAmountCents, deductionsCents, netSalaryCents].every(Number.isSafeInteger)) {
      throw new HttpError(400, `Payroll for ${employee.name} exceeds the safe cents range.`);
    }
    return { employee_id: employee.id, name: employee.name, department: employee.department, base_salary_cents: baseSalaryCents,
      present_days: Number(record.present_days), absent_days: Number(record.absent_days), overtime_hours: Number(record.overtime_hours),
      overtime_amount_cents: overtimeAmountCents, deductions_cents: deductionsCents, net_salary_cents: netSalaryCents };
  });
  const sum = (key) => lines.reduce((total, line) => total + BigInt(line[key]), 0n);
  const totals = { total_base_cents: sum('base_salary_cents'), total_overtime_cents: sum('overtime_amount_cents'),
    total_deductions_cents: sum('deductions_cents'), net_total_cents: sum('net_salary_cents') };
  for (const [key, value] of Object.entries(totals)) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(400, `Payroll ${key} exceeds the safe cents range.`);
    totals[key] = Number(value);
  }
  return { run: existingRun ?? null, month, lines, totals, pending_overtime_count: Number(pendingOvertimeCount), finalized: false };
}

export function getPayroll(monthValue, database = db) {
  return calculateDraftPayroll(monthValue, database);
}

export function finalizePayroll(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['month']);
  const draft = calculateDraftPayroll(body.month, database);
  if (draft.finalized) throw new HttpError(409, `Payroll for ${draft.month} has already been finalized.`);
  if (draft.pending_overtime_count > 0) {
    throw new HttpError(409, `Review ${draft.pending_overtime_count} pending overtime record(s) before finalizing payroll for ${draft.month}.`);
  }
  const { start, end } = parseMonth(draft.month);
  const runId = database.transaction(() => {
    if (draft.run?.status === 'finalized') throw new HttpError(409, `Payroll for ${draft.month} has already been finalized.`);
    const pendingOvertime = database.prepare(`SELECT COUNT(*) AS count FROM employee_daily_attendance
      WHERE work_date >= ? AND work_date < ? AND overtime_status = 'pending'`).get(start, end).count;
    if (pendingOvertime > 0) {
      throw new HttpError(409, `Review ${pendingOvertime} pending overtime record(s) before finalizing payroll for ${draft.month}.`);
    }
    const existing = draft.run?.id;
    let id;
    if (existing) {
      database.prepare(`UPDATE payroll_runs SET total_base_cents = ?, total_overtime_cents = ?, total_deductions_cents = ?, net_total_cents = ? WHERE id = ?`)
        .run(draft.totals.total_base_cents, draft.totals.total_overtime_cents, draft.totals.total_deductions_cents, draft.totals.net_total_cents, existing);
      database.prepare('DELETE FROM payroll_lines WHERE run_id = ?').run(existing);
      id = existing;
    } else {
      const result = database.prepare(`INSERT INTO payroll_runs (month_year, total_base_cents, total_overtime_cents, total_deductions_cents, net_total_cents)
        VALUES (?, ?, ?, ?, ?)`).run(draft.month, draft.totals.total_base_cents, draft.totals.total_overtime_cents,
        draft.totals.total_deductions_cents, draft.totals.net_total_cents);
      id = Number(result.lastInsertRowid);
    }
    assertCashAvailable(draft.totals.net_total_cents, database);
    const insertLine = database.prepare(`INSERT INTO payroll_lines (run_id, employee_id, base_salary_cents, present_days, absent_days,
      overtime_hours, overtime_amount_cents, deductions_cents, net_salary_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const line of draft.lines) {
      insertLine.run(id, line.employee_id, line.base_salary_cents, line.present_days, line.absent_days, line.overtime_hours,
        line.overtime_amount_cents, line.deductions_cents, line.net_salary_cents);
      if (line.net_salary_cents > 0) {
        insertTreasuryEntry({ database, kind: 'expense', category: 'رواتب وأجور', amountCents: line.net_salary_cents,
          employeeId: line.employee_id, reference: `Payroll ${draft.month}`, notes: `Monthly salary disbursement ${draft.month}`, actorId });
      }
    }
    database.prepare(`UPDATE payroll_runs SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    recordAudit({ database, actorId, action: 'finalize_payroll', entityType: 'payroll_run', entityId: id,
      newValues: { month: draft.month, ...draft.totals, employee_count: draft.lines.length } });
    return id;
  }).immediate();
  return calculateDraftPayroll(draft.month, database);
}
