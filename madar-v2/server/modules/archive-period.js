import { db } from '../database/connection.js';
import { HttpError, allowOnlyKeys, positiveId, requireObject } from './http.js';
import { recordAudit } from './audit.js';

export function archiveMonth(value, { filter = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (filter && value === 'unassigned') return value;
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, 'archiveMonth must use YYYY-MM with a valid year and month.');
  }
  return value;
}

export function addArchiveMonthFilter(conditions, parameters, value, column = 'order_record.archive_month') {
  const month = archiveMonth(value, { filter: true });
  if (month === 'unassigned') conditions.push(`${column} IS NULL`);
  else if (month) { conditions.push(`${column} = ?`); parameters.push(month); }
}

export function setOrderArchiveMonth(kind, idValue, input, actorId, database = db) {
  const id = positiveId(idValue, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['archiveMonth']);
  if (!Object.hasOwn(body, 'archiveMonth')) throw new HttpError(400, 'archiveMonth is required; use null to clear it.');
  const month = archiveMonth(body.archiveMonth);
  const table = kind === 'maintenance' ? 'maintenance_orders' : kind === 'workshop' ? 'workshop_orders' : null;
  if (!table) throw new HttpError(400, 'Unsupported archive order type.');
  return database.transaction(() => {
    const actor = database.prepare('SELECT role FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(actorId);
    if (actor?.role !== 'admin') throw new HttpError(403, 'Administrator access is required to change archive months.');
    const order = database.prepare(`SELECT id, status, archive_month FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!order) throw new HttpError(404, 'Archived order was not found.');
    if (order.status !== (kind === 'maintenance' ? 'archived' : 'delivered_archived')) throw new HttpError(409, 'Only archived orders can be assigned an archive month.');
    if (order.archive_month !== month) {
      database.prepare(`UPDATE ${table} SET archive_month = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(month, id);
      recordAudit({ database, actorId, action: 'set_archive_month', entityType: `${kind}_order`, entityId: id,
        oldValues: { archive_month: order.archive_month }, newValues: { archive_month: month } });
    }
    return { success: true, id, archive_month: month };
  }).immediate();
}
