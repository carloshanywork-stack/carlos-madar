import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import {
  allowOnlyKeys,
  HttpError,
  nonNegativeInteger,
  optionalText,
  positiveId,
  requireObject,
  requireText,
} from '../http.js';

const STAGE_NAMES = [
  'design_cam',
  'cnc_laser',
  'bending_assembly',
  'wiring_led',
  'finishing',
  'qa_inspection',
  'site_installation',
];

const STAGE_ACTIONS = ['start', 'pause', 'complete'];

function resolveTechnicianEmployee(user, database) {
  if (!user || !user.id) throw new HttpError(401, 'Authentication required.');
  const employee = database.prepare(`
    SELECT id, name, department, job_title, base_salary_cents
    FROM employees
    WHERE user_id = ? AND active = 1 AND deleted_at IS NULL
  `).get(user.id);
  if (employee) return employee;

  // Fallback for admin or operations testing without an explicit user_id on an employee row:
  if (user.role === 'admin' || user.role === 'operations') {
    const adminEmployee = database.prepare(`
      SELECT id, name, department, job_title, base_salary_cents
      FROM employees
      WHERE department = 'Workshop' AND active = 1 AND deleted_at IS NULL
      LIMIT 1
    `).get();
    if (adminEmployee) return adminEmployee;
  }

  throw new HttpError(403, 'User is not registered as an active workshop employee.');
}

export function listTechnicianJobs(user, database = db) {
  if (!user || !user.id) throw new HttpError(401, 'Authentication required.');
  let employeeId = null;
  const isManager = user.role === 'admin' || user.role === 'operations';

  const employee = database.prepare(`
    SELECT id, name FROM employees WHERE user_id = ? AND active = 1 AND deleted_at IS NULL
  `).get(user.id);

  if (employee) {
    employeeId = employee.id;
  } else if (!isManager) {
    throw new HttpError(403, 'User is not registered as a workshop employee.');
  }

  const query = employeeId && !isManager ? `
    SELECT o.id, o.order_code, o.product_name, o.description, o.machine_type,
      o.status, o.target_delivery_date, o.created_at,
      c.name AS client_name, c.code AS client_code
    FROM workshop_orders o
    JOIN clients c ON c.id = o.client_id
    JOIN workshop_order_technicians ot ON ot.order_id = o.id
    WHERE ot.employee_id = ? AND o.deleted_at IS NULL AND o.status != 'delivered_archived'
    ORDER BY o.target_delivery_date ASC, o.id DESC
  ` : `
    SELECT o.id, o.order_code, o.product_name, o.description, o.machine_type,
      o.status, o.target_delivery_date, o.created_at,
      c.name AS client_name, c.code AS client_code
    FROM workshop_orders o
    JOIN clients c ON c.id = o.client_id
    WHERE o.deleted_at IS NULL AND o.status != 'delivered_archived'
    ORDER BY o.target_delivery_date ASC, o.id DESC
  `;

  const orders = employeeId && !isManager
    ? database.prepare(query).all(employeeId)
    : database.prepare(query).all();

  return orders.map((order) => {
    const designs = database.prepare(`
      SELECT id, original_name, extension, byte_size, created_at
      FROM workshop_design_files WHERE order_id = ? ORDER BY id ASC
    `).all(order.id).map((file) => ({
      ...file,
      download_url: `/api/workshop/designs/${file.id}/download`,
    }));

    const stages = database.prepare(`
      SELECT s.*, e.name AS employee_name
      FROM workshop_stage_logs s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.order_id = ?
      ORDER BY s.id DESC
    `).all(order.id);

    const materials = database.prepare(`
      SELECT im.id, im.quantity, im.warehouse, im.created_at,
        COALESCE(m.name, ofc.name) AS material_name,
        COALESCE(m.unit, ofc.unit) AS unit
      FROM inventory_movements im
      LEFT JOIN materials m ON m.id = im.material_id
      LEFT JOIN secondary_warehouse_offcuts ofc ON ofc.id = im.offcut_id
      WHERE im.source_type = 'workshop_order' AND im.source_id = ? AND im.kind = 'issue'
      ORDER BY im.id ASC
    `).all(order.id);

    const inspections = database.prepare(`
      SELECT i.*, u.full_name AS inspector_name
      FROM workshop_quality_inspections i
      JOIN users u ON u.id = i.inspector_user_id
      WHERE i.order_id = ?
      ORDER BY i.id DESC
    `).all(order.id);

    return {
      ...order,
      designs,
      stages,
      materials,
      inspections,
      currentActiveStage: stages.find((s) => s.action === 'start') ?? null,
    };
  });
}

export function logStageAction(orderId, user, input, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['stageName', 'action', 'durationMinutes', 'notes']);
  const stageName = body.stageName;
  if (!STAGE_NAMES.includes(stageName)) {
    throw new HttpError(400, `stageName must be one of: ${STAGE_NAMES.join(', ')}.`);
  }
  const action = body.action;
  if (!STAGE_ACTIONS.includes(action)) {
    throw new HttpError(400, `action must be one of: ${STAGE_ACTIONS.join(', ')}.`);
  }
  const durationMinutes = body.durationMinutes !== undefined
    ? nonNegativeInteger(body.durationMinutes, 'durationMinutes')
    : 0;
  const notes = optionalText(body.notes, 'notes', { maxLength: 1000 });

  const employee = resolveTechnicianEmployee(user, database);

  // Hourly wage derivation: base salary / (26 days * 8 hours) = salary / 208 hours
  const hourlyRateCents = employee.base_salary_cents > 0
    ? Math.round(employee.base_salary_cents / 208)
    : 10000; // 100 EGP / hr fallback

  return database.transaction(() => {
    const order = database.prepare('SELECT id, status FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!order) throw new HttpError(404, 'Workshop order was not found.');

    const result = database.prepare(`
      INSERT INTO workshop_stage_logs
        (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, employee.id, stageName, action, durationMinutes, hourlyRateCents, notes);

    const logId = Number(result.lastInsertRowid);
    recordAudit({
      database,
      actorId: user.id,
      action: 'log_workshop_stage',
      entityType: 'workshop_order',
      entityId: id,
      newValues: { stage_log_id: logId, stage_name: stageName, action, duration_minutes: durationMinutes },
    });

    return database.prepare(`
      SELECT s.*, e.name AS employee_name
      FROM workshop_stage_logs s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.id = ?
    `).get(logId);
  }).immediate();
}

export function submitOrderQualityInspection(orderId, user, input = {}, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['decision', 'defectCategory', 'notes', 'photoPaths']);
  const decision = body.decision;
  if (!['approved', 'rework_required'].includes(decision)) {
    throw new HttpError(400, 'decision must be approved or rework_required.');
  }
  const defectCategory = optionalText(body.defectCategory, 'defectCategory', { maxLength: 100 });
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  const photoPaths = Array.isArray(body.photoPaths) ? body.photoPaths : [];

  return database.transaction(() => {
    const order = database.prepare('SELECT id, order_code, status FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!order) throw new HttpError(404, 'Workshop order was not found.');

    const result = database.prepare(`
      INSERT INTO workshop_quality_inspections
        (order_id, inspector_user_id, decision, defect_category, notes, photo_paths_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, user.id, decision, defectCategory, notes, JSON.stringify(photoPaths));
    const inspectionId = Number(result.lastInsertRowid);

    if (decision === 'approved') {
      database.prepare("UPDATE workshop_orders SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    } else {
      database.prepare("UPDATE workshop_orders SET status = 'in_production', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    }

    recordAudit({
      database,
      actorId: user.id,
      action: 'quality_inspection',
      entityType: 'workshop_order',
      entityId: id,
      newValues: { inspection_id: inspectionId, decision, defect_category: defectCategory },
    });

    return database.prepare(`
      SELECT i.*, u.full_name AS inspector_name
      FROM workshop_quality_inspections i
      JOIN users u ON u.id = i.inspector_user_id
      WHERE i.id = ?
    `).get(inspectionId);
  }).immediate();
}
