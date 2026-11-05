import bcrypt from 'bcryptjs';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { syncEmployeeForUser } from './user-sync.js';
import { HttpError, allowOnlyKeys, isoDate, nonNegativeInteger, optionalText, positiveId, requireObject, requireText } from '../http.js';

const DEPARTMENTS = ['Maintenance', 'Workshop', 'Warehouse', 'Finance', 'Administration', 'Management', 'Sales'];
const SYSTEM_ROLES = ['admin', 'operations', 'sales', 'purchasing'];

function normalizeUsername(value) {
  const username = requireText(value, 'username', { minLength: 3, maxLength: 64 });
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(username)) {
    throw new HttpError(400, 'username contains unsupported characters.');
  }
  return username;
}

function normalizeRegions(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new HttpError(400, 'assignedRegions must be an array with no more than 100 regions.');
  }
  const values = [];
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const region = requireText(item, `assignedRegions[${index}]`, { maxLength: 160 });
    const key = region.normalize('NFKC').toLocaleLowerCase('ar');
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(region);
  }
  return values;
}

function profileInput(input, { partial = false } = {}) {
  const body = requireObject(input);
  const aliases = {
    fullName: 'name', jobTitle: 'job_title', nationalId: 'national_id', hireDate: 'hire_date',
    monthlySalaryCents: 'monthly_salary_cents', dailyRateCents: 'daily_rate_cents',
  };
  const normalized = { ...body };
  for (const [camel, snake] of Object.entries(aliases)) {
    if (normalized[camel] === undefined) continue;
    if (normalized[snake] !== undefined) throw new HttpError(400, `Provide only one of ${camel} or ${snake}.`);
    normalized[snake] = normalized[camel];
    delete normalized[camel];
  }
  const allowed = ['classification', 'name', 'department', 'job_title', 'phone', 'national_id', 'hire_date',
    'monthly_salary_cents', 'daily_rate_cents', 'active', 'enableLogin', 'username', 'password', 'role', 'assignedRegions'];
  allowOnlyKeys(normalized, allowed);
  const result = {};
  if (!partial || normalized.name !== undefined) result.name = requireText(normalized.name, 'name', { minLength: 2, maxLength: 160 });
  if (!partial || normalized.department !== undefined) {
    const department = requireText(normalized.department, 'department', { maxLength: 80 });
    if (!DEPARTMENTS.includes(department)) throw new HttpError(400, `department must be one of: ${DEPARTMENTS.join(', ')}.`);
    result.department = department;
  }
  for (const field of ['job_title', 'phone', 'national_id']) {
    if (!partial || normalized[field] !== undefined) {
      result[field] = optionalText(normalized[field], field, { maxLength: field === 'phone' ? 80 : field === 'national_id' ? 80 : 120 });
    }
  }
  if (!partial || normalized.hire_date !== undefined) result.hire_date = isoDate(normalized.hire_date, 'hire_date');
  if (!partial || normalized.monthly_salary_cents !== undefined) {
    result.monthly_salary_cents = nonNegativeInteger(normalized.monthly_salary_cents ?? 0, 'monthly_salary_cents');
  }
  if (!partial || normalized.daily_rate_cents !== undefined) {
    result.daily_rate_cents = nonNegativeInteger(normalized.daily_rate_cents ?? 0, 'daily_rate_cents');
  }
  if (normalized.active !== undefined) {
    if (typeof normalized.active !== 'boolean') throw new HttpError(400, 'active must be a boolean.');
    result.active = normalized.active ? 1 : 0;
  }
  if (normalized.classification !== undefined) result.classification = normalized.classification;
  if (normalized.enableLogin !== undefined) {
    if (typeof normalized.enableLogin !== 'boolean') throw new HttpError(400, 'enableLogin must be a boolean.');
    result.enableLogin = normalized.enableLogin;
  }
  if (normalized.username !== undefined) result.username = normalizeUsername(normalized.username);
  if (normalized.password !== undefined) {
    if (typeof normalized.password !== 'string' || normalized.password.length < 4 || Buffer.byteLength(normalized.password, 'utf8') > 72) {
      throw new HttpError(400, 'يجب أن تتكون كلمة المرور من 4 خانات على الأقل وألا تتجاوز 72 بايتاً.');
    }
    result.password = normalized.password;
  }
  if (normalized.role !== undefined) result.role = normalized.role;
  if (normalized.assignedRegions !== undefined) result.assignedRegions = normalizeRegions(normalized.assignedRegions);
  return result;
}

function regionsFor(row) {
  try {
    const parsed = JSON.parse(row.assigned_regions_json ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((region) => typeof region === 'string') : [];
  } catch { return []; }
}

function mapStaff(row) {
  const role = row.user_role ?? null;
  return {
    id: Number(row.id),
    name: row.name,
    department: row.department_label || row.department,
    department_label: row.department_label,
    job_title: row.job_title,
    phone: row.phone,
    national_id: row.national_id,
    hire_date: row.hire_date,
    monthly_salary_cents: row.base_salary_cents,
    daily_rate_cents: row.daily_rate_cents,
    active: Number(row.active),
    can_login: Number(row.can_login),
    user_id: row.user_id === null ? null : Number(row.user_id),
    classification: Number(row.can_login) !== 1 ? 'worker' : role === 'rep' ? 'representative' : 'system',
    username: row.username ?? null,
    role,
    login_active: row.login_active === null ? null : Number(row.login_active),
    assignedRegions: regionsFor(row),
    created_at: row.created_at,
  };
}

const STAFF_SELECT = `SELECT employee.*, user.username, user.role AS user_role,
  user.active AS login_active, user.assigned_regions_json
  FROM employees employee LEFT JOIN users user ON user.id = employee.user_id`;

export function listStaff(category, database = db, { includeInactive = true } = {}) {
  const filters = ['employee.deleted_at IS NULL'];
  const parameters = [];
  if (!includeInactive) filters.push('employee.active = 1');
  if (category && category !== 'all') {
    if (category === 'representatives') filters.push("employee.user_id IS NOT NULL AND user.role = 'rep'");
    else if (category === 'workers') filters.push('employee.can_login = 0');
    else if (category === 'administration') filters.push("employee.user_id IS NOT NULL AND user.role != 'rep'");
    else throw new HttpError(400, 'category must be all, representatives, workers, or administration.');
  }
  return database.prepare(`${STAFF_SELECT} WHERE ${filters.join(' AND ')}
    ORDER BY employee.active DESC, employee.department_label, employee.department, employee.name COLLATE NOCASE, employee.id`)
    .all(...parameters).map(mapStaff);
}

function staffById(id, database) {
  const row = database.prepare(`${STAFF_SELECT} WHERE employee.id = ? AND employee.deleted_at IS NULL`).get(id);
  if (!row) throw new HttpError(404, 'Staff member was not found.');
  return mapStaff(row);
}

function cleanDepartment(value) {
  if (['Management', 'Sales'].includes(value)) return { department: value === 'Management' ? 'Administration' : 'Finance', department_label: value };
  return { department: value, department_label: null };
}

export async function createStaffMember(input, actorId = null, database = db) {
  const value = profileInput(input);
  if (!['representative', 'worker', 'system'].includes(value.classification)) {
    throw new HttpError(400, 'classification must be representative, worker, or system.');
  }
  const withLogin = value.classification !== 'worker';
  if (!withLogin && (value.username !== undefined || value.password !== undefined || value.role !== undefined || value.assignedRegions !== undefined)) {
    throw new HttpError(400, 'Workers do not have login credentials or assigned user roles.');
  }
  if (withLogin && (!value.username || !value.password)) throw new HttpError(400, 'Login staff require a username and a password of at least 4 characters.');
  const role = value.classification === 'representative' ? 'rep' : value.role;
  if (value.classification === 'system' && !SYSTEM_ROLES.includes(role)) {
    throw new HttpError(400, `System role must be one of: ${SYSTEM_ROLES.join(', ')}.`);
  }
  let regions = value.assignedRegions ?? [];
  if (role !== 'rep' && regions.length) throw new HttpError(400, 'Assigned regions are only valid for representatives.');
  if (role === 'rep' && !regions.length) regions = ['*'];
  const active = value.active ?? 1;
  const passwordHash = withLogin ? await bcrypt.hash(value.password, 12) : null;
  try {
    const employeeId = database.transaction(() => {
      let userId = null;
      if (withLogin) {
        const createdUser = database.prepare(`INSERT INTO users
          (username, password_hash, full_name, role, active, assigned_regions_json)
          VALUES (?, ?, ?, ?, ?, ?)`).run(value.username, passwordHash, value.name, role, active, JSON.stringify(regions));
        userId = Number(createdUser.lastInsertRowid);
      }
      const department = withLogin ? cleanDepartment(value.department) : cleanDepartment(value.department);
      const createdEmployee = database.prepare(`INSERT INTO employees
        (name, department, department_label, job_title, phone, national_id, hire_date, base_salary_cents,
         daily_rate_cents, can_login, user_id, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(value.name, department.department, department.department_label, value.job_title, value.phone,
          value.national_id, value.hire_date, value.monthly_salary_cents, value.daily_rate_cents,
          withLogin ? 1 : 0, userId, active);
      const id = Number(createdEmployee.lastInsertRowid);
      if (userId) {
        // Keep the standard role-to-employee reconciliation contract for future account edits.
        syncEmployeeForUser(database, database.prepare(`SELECT id, full_name, role, active, deleted_at, created_at
          FROM users WHERE id = ?`).get(userId), { actorId, audit: true });
        database.prepare(`UPDATE employees SET name = ?, department = ?, department_label = ?, job_title = ?,
          phone = ?, national_id = ?, hire_date = ?, base_salary_cents = ?, daily_rate_cents = ?, active = ?
          WHERE id = ?`).run(value.name, department.department, department.department_label, value.job_title,
          value.phone, value.national_id, value.hire_date, value.monthly_salary_cents,
          value.daily_rate_cents, active, id);
        recordAudit({ database, actorId, action: 'create', entityType: 'user', entityId: userId,
          newValues: { username: value.username, full_name: value.name, role, active, assigned_regions: regions } });
      }
      recordAudit({ database, actorId, action: 'create', entityType: 'employee', entityId: id,
        newValues: { ...value, password: undefined, can_login: withLogin ? 1 : 0, user_id: userId, active } });
      return id;
    }).immediate();
    return staffById(employeeId, database);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That username is already in use.');
    throw error;
  }
}

function revokeUser(userId, actorId, database, { softDelete = false } = {}) {
  const user = database.prepare('SELECT id, role, active FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
  if (!user) return;
  if (user.role === 'admin' && Number(user.active) === 1) {
    if (Number(actorId) === Number(userId)) {
      throw new HttpError(409, 'You cannot disable your own administrator account.');
    }
    const otherAdmins = database.prepare(`SELECT COUNT(*) AS count FROM users
      WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?`).get(userId).count;
    if (!otherAdmins) throw new HttpError(409, 'At least one active administrator must remain.');
  }
  database.prepare(`UPDATE users SET active = 0, is_online = 0,
    deleted_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE deleted_at END WHERE id = ?`).run(softDelete ? 1 : 0, userId);
  const sessions = database.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(userId).changes;
  database.prepare(`UPDATE rep_duty_sessions SET ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE rep_user_id = ? AND ended_at IS NULL`).run(userId);
  recordAudit({ database, actorId, action: 'staff_login_revoked', entityType: 'user', entityId: userId,
    oldValues: { active: user.active }, newValues: { active: 0, revoked_sessions: sessions, soft_deleted: softDelete } });
}

export async function updateStaffMember(employeeIdValue, input, actorId = null, database = db) {
  const employeeId = positiveId(employeeIdValue, 'staffId');
  const changes = profileInput(input, { partial: true });
  if (!Object.keys(changes).length) throw new HttpError(400, 'At least one staff field must be provided.');
  const current = database.prepare(`SELECT employee.*, user.username, user.role AS user_role, user.active AS login_active,
      user.is_online AS login_online,
      user.deleted_at AS login_deleted_at, user.assigned_regions_json
    FROM employees employee LEFT JOIN users user ON user.id = employee.user_id
    WHERE employee.id = ? AND employee.deleted_at IS NULL`).get(employeeId);
  if (!current) throw new HttpError(404, 'Staff member was not found.');
  const currentRole = current.user_role ?? null;
  let requestedRole = changes.role ?? currentRole;
  const disablingLogin = changes.enableLogin === false && current.user_id !== null && Number(current.can_login) === 1;
  const enablingLogin = changes.enableLogin === true && Number(current.can_login) !== 1;
  if (enablingLogin) {
    if (!changes.username || !changes.password) throw new HttpError(400, 'Enabling login requires a username and a password of at least 4 characters.');
    requestedRole = changes.classification === 'representative' ? 'rep' : requestedRole;
    if (!requestedRole) requestedRole = changes.classification === 'representative' ? 'rep' : 'operations';
  }
  if (changes.classification !== undefined && !['representative', 'worker', 'system'].includes(changes.classification)) {
    throw new HttpError(400, 'classification must be representative, worker, or system.');
  }
  if (changes.classification === 'worker' && current.user_id !== null && changes.enableLogin !== false) {
    throw new HttpError(400, 'Disable login before changing this person to a worker profile.');
  }
  if (changes.classification === 'representative') requestedRole = 'rep';
  if (changes.classification === 'system' && requestedRole === 'rep') requestedRole = 'operations';
  if (requestedRole !== null && !['rep', ...SYSTEM_ROLES].includes(requestedRole)) throw new HttpError(400, 'role is not supported.');
  let regions = changes.assignedRegions ?? regionsFor(current);
  if (requestedRole !== 'rep') regions = [];
  else if (!regions.length) regions = ['*'];
  const passwordHash = changes.password === undefined ? null : await bcrypt.hash(changes.password, 12);
  const next = {
    name: changes.name ?? current.name,
    department: changes.department ?? (requestedRole === 'rep' ? 'Maintenance' : current.department_label || current.department),
    job_title: changes.job_title === undefined ? current.job_title : changes.job_title,
    phone: changes.phone === undefined ? current.phone : changes.phone,
    national_id: changes.national_id === undefined ? current.national_id : changes.national_id,
    hire_date: changes.hire_date === undefined ? current.hire_date : changes.hire_date,
    monthly_salary_cents: changes.monthly_salary_cents ?? current.base_salary_cents,
    daily_rate_cents: changes.daily_rate_cents ?? current.daily_rate_cents,
    active: changes.active ?? current.active,
  };
  const storedDepartment = cleanDepartment(next.department);
  try {
    database.transaction(() => {
      let userId = current.user_id;
      if (disablingLogin) {
        // Deactivate the login and revoke sessions, but retain the unique user row and
        // employee link so this profile can safely regain access without a duplicate account.
        revokeUser(userId, actorId, database);
      } else if (enablingLogin) {
        if (!requestedRole) throw new HttpError(400, 'Choose a system role to enable login.');
        if (!changes.username || !passwordHash) {
          throw new HttpError(400, 'Enabling login requires a username and a password of at least 4 characters.');
        }
        if (userId !== null) {
          const beforeUser = database.prepare('SELECT username, full_name, role, active FROM users WHERE id = ?').get(userId);
          database.prepare(`UPDATE users SET username = ?, password_hash = ?, full_name = ?, role = ?, active = ?,
            is_online = 0, deleted_at = NULL, assigned_regions_json = ? WHERE id = ?`)
            .run(changes.username, passwordHash, next.name, requestedRole, next.active, JSON.stringify(regions), userId);
          database.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(userId);
          recordAudit({ database, actorId, action: 'staff_login_reenabled', entityType: 'user', entityId: userId,
            oldValues: beforeUser,
            newValues: { username: changes.username, full_name: next.name, role: requestedRole, active: next.active, assigned_regions: regions } });
        } else {
          const result = database.prepare(`INSERT INTO users
            (username, password_hash, full_name, role, active, assigned_regions_json)
            VALUES (?, ?, ?, ?, ?, ?)`).run(changes.username, passwordHash, next.name, requestedRole,
            next.active, JSON.stringify(regions));
          userId = Number(result.lastInsertRowid);
          recordAudit({ database, actorId, action: 'create_from_staff', entityType: 'user', entityId: userId,
            newValues: { username: changes.username, full_name: next.name, role: requestedRole, active: next.active, assigned_regions: regions } });
        }
      } else if (current.user_id !== null && Number(current.can_login) === 1) {
        const nextUsername = changes.username ?? current.username;
        const identityChanged = nextUsername !== current.username || requestedRole !== currentRole || Boolean(passwordHash);
        const nextUserActive = next.active;
        if (currentRole === 'admin' && current.login_active === 1 && nextUserActive === 0) {
          const otherAdmins = database.prepare(`SELECT COUNT(*) AS count FROM users
            WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?`).get(current.user_id).count;
          if (!otherAdmins) throw new HttpError(409, 'At least one active administrator must remain.');
        }
        if (Number(actorId) === Number(current.user_id) && (nextUserActive === 0 || requestedRole !== 'admin')) {
          throw new HttpError(409, 'You cannot deactivate or demote your own administrator account.');
        }
        database.prepare(`UPDATE users SET username = ?, full_name = ?, role = ?, active = ?, is_online = ?,
          password_hash = COALESCE(?, password_hash), assigned_regions_json = ? WHERE id = ?`)
          .run(nextUsername, next.name, requestedRole, nextUserActive,
            requestedRole === 'rep' && nextUserActive === 1 && !identityChanged ? current.login_online : 0,
            passwordHash, JSON.stringify(regions), current.user_id);
        if (next.active === 0 || identityChanged) {
          database.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(current.user_id);
        }
        if (next.active === 0) database.prepare(`UPDATE rep_duty_sessions SET ended_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP WHERE rep_user_id = ? AND ended_at IS NULL`).run(current.user_id);
        recordAudit({ database, actorId, action: 'update', entityType: 'user', entityId: current.user_id,
          oldValues: { username: current.username, full_name: current.name, role: currentRole, active: current.login_active },
          newValues: { username: nextUsername, full_name: next.name, role: requestedRole, active: nextUserActive,
            assigned_regions: regions, password_changed: Boolean(passwordHash) } });
      } else if (current.user_id !== null) {
        database.prepare('UPDATE users SET full_name = ?, active = 0, is_online = 0 WHERE id = ?')
          .run(next.name, current.user_id);
      }
      if (userId !== null) {
        database.prepare(`UPDATE employees SET name = ?, department = ?, department_label = ?, job_title = ?, phone = ?,
          national_id = ?, hire_date = ?, base_salary_cents = ?, daily_rate_cents = ?, can_login = ?, user_id = ?, active = ?
          WHERE id = ?`).run(next.name, storedDepartment.department, storedDepartment.department_label,
          next.job_title, next.phone, next.national_id, next.hire_date, next.monthly_salary_cents,
          next.daily_rate_cents, !disablingLogin && (enablingLogin || Number(current.can_login) === 1) ? 1 : 0,
          userId, next.active, employeeId);
      } else {
        database.prepare(`UPDATE employees SET name = ?, department = ?, department_label = ?, job_title = ?, phone = ?,
          national_id = ?, hire_date = ?, base_salary_cents = ?, daily_rate_cents = ?, can_login = 0, user_id = NULL, active = ?
          WHERE id = ?`).run(next.name, storedDepartment.department, storedDepartment.department_label,
          next.job_title, next.phone, next.national_id, next.hire_date, next.monthly_salary_cents,
          next.daily_rate_cents, next.active, employeeId);
      }
      recordAudit({ database, actorId, action: 'update', entityType: 'employee', entityId: employeeId,
        oldValues: { name: current.name, department: current.department_label ?? current.department,
          job_title: current.job_title, phone: current.phone, national_id: current.national_id,
          hire_date: current.hire_date, monthly_salary_cents: current.base_salary_cents,
          active: current.active, can_login: current.can_login, user_id: current.user_id },
        newValues: { ...next, department: next.department,
          can_login: userId !== null && !disablingLogin && (enablingLogin || Number(current.can_login) === 1) ? 1 : 0,
          user_id: userId } });
    }).immediate();
    return staffById(employeeId, database);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That username is already in use.');
    throw error;
  }
}
