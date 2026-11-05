import { db } from '../../database/connection.js';

function forbid(res, message) {
  res.status(403).json({ error: message });
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication is required.' });
    return;
  }
  if (req.user.role !== 'admin') {
    forbid(res, 'Administrator access is required.');
    return;
  }
  next();
}

export function isFinanceOrAdmin(req) {
  if (!req.user) return false;
  const role = req.user.role;
  if (role === 'admin' || role === 'finance' || role === 'accountant') return true;
  if (role === 'sales') return false;
  let department = req.user.department;
  let departmentLabel = req.user.departmentLabel;
  if (!department && req.user.id) {
    try {
      const employee = db.prepare(`
        SELECT department, department_label
        FROM employees
        WHERE user_id = ? AND active = 1 AND deleted_at IS NULL
        LIMIT 1
      `).get(req.user.id);
      department = employee?.department;
      departmentLabel = employee?.department_label;
    } catch (error) {
      throw error;
    }
  }
  return department === 'Finance' && departmentLabel !== 'Sales';
}

export function requireFinanceOrAdmin(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication is required.' });
    return;
  }
  try {
    if (isFinanceOrAdmin(req)) {
      next();
      return;
    }
    forbid(res, 'صلاحيات الإدارة المالية أو مدير النظام مطلوبة للوصول إلى هذا القسم.');
  } catch (error) {
    next(error);
  }
}

/** Purchasing users are the designated warehouse staff; operations and Admin also manage stock. */
export function requireWarehouseMutationAccess(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication is required.' });
    return;
  }
  if (!['admin', 'operations', 'purchasing'].includes(req.user.role)) {
    forbid(res, 'صلاحية المشتريات أو العمليات أو مدير النظام مطلوبة لتعديل المخزون.');
    return;
  }
  next();
}

export function requireWorkshopMutationAccess(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication is required.' });
    return;
  }
  if (!['admin', 'operations'].includes(req.user.role)) {
    forbid(res, 'صلاحية العمليات أو مدير النظام مطلوبة لتعديل أوامر الورشة.');
    return;
  }
  next();
}
