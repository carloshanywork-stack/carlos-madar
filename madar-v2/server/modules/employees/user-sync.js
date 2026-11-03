import { recordAudit } from '../audit.js';

const ROLE_DEPARTMENTS = Object.freeze({
  admin: { department: 'Administration', departmentLabel: null },
  operations: { department: 'Maintenance', departmentLabel: null },
  rep: { department: 'Maintenance', departmentLabel: null },
  sales: { department: 'Finance', departmentLabel: 'Sales' },
  purchasing: { department: 'Warehouse', departmentLabel: null },
});

/** Keep one HR row linked to each login account without overwriting salary/job details. */
export function syncEmployeeForUser(database, user, { actorId = null, audit = false } = {}) {
  const userId = Number(user.id);
  const profile = ROLE_DEPARTMENTS[user.role];
  if (!Number.isSafeInteger(userId) || userId < 1 || !profile) {
    throw new Error('A valid MADAR user is required to synchronize an employee profile.');
  }

  const name = String(user.full_name ?? '').trim();
  if (!name) throw new Error(`User ${userId} has no full name for its employee profile.`);
  const active = Number(user.active) === 1 && !user.deleted_at ? 1 : 0;
  const existing = database.prepare('SELECT * FROM employees WHERE user_id = ?').get(userId);

  if (existing) {
    const changed = existing.name !== name
      || existing.department !== profile.department
      || (existing.department_label ?? null) !== profile.departmentLabel
      || Number(existing.can_login) !== 1
      || Number(existing.active) !== active;
    if (!changed) return Number(existing.id);

    database.prepare(`UPDATE employees
      SET name = ?, department = ?, department_label = ?, can_login = 1, active = ?
      WHERE id = ?`).run(name, profile.department, profile.departmentLabel, active, existing.id);
    if (audit) {
      recordAudit({
        database,
        actorId,
        action: 'sync_user_employee',
        entityType: 'employee',
        entityId: existing.id,
        oldValues: {
          name: existing.name,
          department: existing.department_label ?? existing.department,
          can_login: existing.can_login,
          active: existing.active,
        },
        newValues: {
          user_id: userId,
          name,
          department: profile.departmentLabel ?? profile.department,
          can_login: 1,
          active,
        },
      });
    }
    return Number(existing.id);
  }

  const created = database.prepare(`INSERT INTO employees
    (name, department, department_label, can_login, user_id, active, created_at)
    VALUES (?, ?, ?, 1, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`)
    .run(name, profile.department, profile.departmentLabel, userId, active, user.created_at ?? null);
  const employeeId = Number(created.lastInsertRowid);
  if (audit) {
    recordAudit({
      database,
      actorId,
      action: 'create_from_user',
      entityType: 'employee',
      entityId: employeeId,
      newValues: {
        user_id: userId,
        name,
        department: profile.departmentLabel ?? profile.department,
        can_login: 1,
        active,
      },
    });
  }
  return employeeId;
}
