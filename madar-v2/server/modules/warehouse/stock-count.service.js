import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import {
  allowOnlyKeys,
  HttpError,
  optionalText,
  positiveId,
  requireObject,
} from '../http.js';
const MAX_QUANTITY = 1_000_000_000_000;

function countedQuantity(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) {
    throw new HttpError(400, `${label} must be a non-negative finite quantity.`);
  }
  return value;
}

function findSession(sessionId, database) {
  const id = positiveId(sessionId, 'stockCountId');
  const session = database.prepare('SELECT * FROM stock_count_sessions WHERE id = ?').get(id);
  if (!session) throw new HttpError(404, 'Stock-count session was not found.');
  return session;
}

function readSession(sessionId, database) {
  const session = findSession(sessionId, database);
  const main = database.prepare(`
    SELECT line.id AS line_id, line.material_id, material.code AS material_code,
      material.name AS material_name, material.unit, line.snapshot_quantity,
      line.system_quantity_at_reconcile, line.counted_quantity, line.variance_quantity
    FROM stock_count_lines line
    JOIN materials material ON material.id = line.material_id
    WHERE line.session_id = ? AND line.item_type = 'main'
    ORDER BY material.code COLLATE NOCASE, material.id
  `).all(session.id);
  const offcuts = database.prepare(`
    SELECT line.id AS line_id, line.offcut_id, offcut.material_id,
      material.code AS material_code, offcut.name, offcut.dimensions, offcut.unit,
      offcut.origin_workshop_order_id, order_record.order_code AS origin_workshop_order_code,
      line.snapshot_quantity, line.system_quantity_at_reconcile,
      line.counted_quantity, line.variance_quantity
    FROM stock_count_lines line
    JOIN secondary_warehouse_offcuts offcut ON offcut.id = line.offcut_id
    LEFT JOIN materials material ON material.id = offcut.material_id
    LEFT JOIN workshop_orders order_record ON order_record.id = offcut.origin_workshop_order_id
    WHERE line.session_id = ? AND line.item_type = 'offcut'
    ORDER BY offcut.id
  `).all(session.id);
  return { ...session, lines: { main, offcuts } };
}

export function startStockCount(input = {}, actorId = null, database = db) {
  const body = requireObject(input ?? {});
  allowOnlyKeys(body, ['notes']);
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  const sessionId = database.transaction(() => {
    const result = database.prepare(`
      INSERT INTO stock_count_sessions (notes, started_by) VALUES (?, ?)
    `).run(notes, actorId);
    const id = Number(result.lastInsertRowid);
    const addMain = database.prepare(`
      INSERT INTO stock_count_lines (session_id, item_type, material_id, snapshot_quantity)
      SELECT ?, 'main', id, stock FROM materials WHERE active = 1 AND deleted_at IS NULL
    `);
    addMain.run(id);
    const addOffcuts = database.prepare(`
      INSERT INTO stock_count_lines (session_id, item_type, offcut_id, snapshot_quantity)
      SELECT ?, 'offcut', id, quantity FROM secondary_warehouse_offcuts WHERE status = 'available'
    `);
    addOffcuts.run(id);
    recordAudit({
      database,
      actorId,
      action: 'start',
      entityType: 'stock_count',
      entityId: id,
      newValues: {
        status: 'open',
        material_count: database.prepare("SELECT COUNT(*) AS count FROM stock_count_lines WHERE session_id = ? AND item_type = 'main'").get(id).count,
        offcut_count: database.prepare("SELECT COUNT(*) AS count FROM stock_count_lines WHERE session_id = ? AND item_type = 'offcut'").get(id).count,
      },
    });
    return id;
  }).immediate();
  return readSession(sessionId, database);
}

function normalizeCountArray(items, idKey, label) {
  if (!Array.isArray(items)) throw new HttpError(400, `${label} must be an array.`);
  const seen = new Set();
  return items.map((item, index) => {
    const row = requireObject(item, `${label}[${index}]`);
    allowOnlyKeys(row, [idKey, 'countedQuantity']);
    const id = positiveId(row[idKey], `${label}[${index}].${idKey}`);
    if (seen.has(id)) throw new HttpError(400, `${label} cannot contain duplicate IDs.`);
    seen.add(id);
    return {
      id,
      countedQuantity: countedQuantity(row.countedQuantity, `${label}[${index}].countedQuantity`),
    };
  });
}

function assertCompleteCount(inputRows, sessionRows, label) {
  const expected = new Set(sessionRows.map((row) => row.item_id));
  for (const row of inputRows) {
    if (!expected.has(row.id)) throw new HttpError(400, `${label} contains an item not included in this stock count.`);
  }
  if (inputRows.length !== expected.size) {
    throw new HttpError(400, `${label} must include every item captured when the stock count started.`);
  }
  return new Map(inputRows.map((row) => [row.id, row.countedQuantity]));
}

function writeVarianceMovement(database, { item, kind, quantity, actorId, sessionId, notes }) {
  return Number(database.prepare(`
    INSERT INTO inventory_movements
      (material_id, offcut_id, kind, quantity, warehouse, reference,
       source_type, source_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'stock_count', ?, ?, ?)
  `).run(
    item.materialId ?? null,
    item.offcutId ?? null,
    kind,
    quantity,
    item.warehouse,
    `Stock count #${sessionId}`,
    sessionId,
    notes,
    actorId,
  ).lastInsertRowid);
}

export function reconcileStockCount(sessionId, input, actorId = null, database = db) {
  const id = positiveId(sessionId, 'stockCountId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['main', 'offcuts', 'notes']);
  const mainCounts = normalizeCountArray(body.main, 'materialId', 'main');
  const offcutCounts = normalizeCountArray(body.offcuts, 'offcutId', 'offcuts');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  const result = database.transaction(() => {
    const session = findSession(id, database);
    if (session.status !== 'open') throw new HttpError(409, 'This stock-count session has already been reconciled.');
    const mainLines = database.prepare(`
      SELECT id AS line_id, material_id AS item_id, snapshot_quantity
      FROM stock_count_lines WHERE session_id = ? AND item_type = 'main' ORDER BY id
    `).all(id);
    const offcutLines = database.prepare(`
      SELECT id AS line_id, offcut_id AS item_id, snapshot_quantity
      FROM stock_count_lines WHERE session_id = ? AND item_type = 'offcut' ORDER BY id
    `).all(id);
    const mainById = assertCompleteCount(mainCounts, mainLines, 'main');
    const offcutsById = assertCompleteCount(offcutCounts, offcutLines, 'offcuts');
    const movements = [];
    const variances = [];

    for (const line of mainLines) {
      const material = database.prepare('SELECT id, stock FROM materials WHERE id = ?').get(line.item_id);
      if (!material) throw new HttpError(409, `Material ${line.item_id} no longer exists; count cannot be reconciled.`);
      const counted = mainById.get(line.item_id);
      const current = material.stock;
      const difference = counted - current;
      let movementId = null;
      if (difference !== 0) {
        movementId = writeVarianceMovement(database, {
          item: { materialId: material.id, warehouse: 'main' },
          kind: difference > 0 ? 'variance_gain' : 'variance_loss',
          quantity: Math.abs(difference),
          actorId,
          sessionId: id,
          notes,
        });
        movements.push(movementId);
      }
      database.prepare('UPDATE materials SET stock = ? WHERE id = ?').run(counted, material.id);
      database.prepare(`
        UPDATE stock_count_lines
        SET system_quantity_at_reconcile = ?, counted_quantity = ?, variance_quantity = ?
        WHERE id = ?
      `).run(current, counted, difference, line.line_id);
      variances.push({ item_type: 'main', material_id: material.id, variance_quantity: difference, movement_id: movementId });
    }

    for (const line of offcutLines) {
      const offcut = database.prepare(`
        SELECT id, material_id, quantity, status FROM secondary_warehouse_offcuts WHERE id = ?
      `).get(line.item_id);
      if (!offcut) throw new HttpError(409, `Offcut ${line.item_id} no longer exists; count cannot be reconciled.`);
      const current = offcut.status === 'available' ? offcut.quantity : 0;
      const counted = offcutsById.get(offcut.id);
      const difference = counted - current;
      let movementId = null;
      if (difference !== 0) {
        movementId = writeVarianceMovement(database, {
          item: { materialId: offcut.material_id, offcutId: offcut.id, warehouse: 'secondary' },
          kind: difference > 0 ? 'variance_gain' : 'variance_loss',
          quantity: Math.abs(difference),
          actorId,
          sessionId: id,
          notes,
        });
        movements.push(movementId);
      }
      if (counted > 0) {
        database.prepare(`
          UPDATE secondary_warehouse_offcuts
          SET quantity = ?, status = 'available', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(counted, offcut.id);
      } else if (offcut.status === 'available') {
        database.prepare(`
          UPDATE secondary_warehouse_offcuts
          SET status = 'variance_lost', updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(offcut.id);
      }
      database.prepare(`
        UPDATE stock_count_lines
        SET system_quantity_at_reconcile = ?, counted_quantity = ?, variance_quantity = ?
        WHERE id = ?
      `).run(current, counted, difference, line.line_id);
      variances.push({ item_type: 'offcut', offcut_id: offcut.id, variance_quantity: difference, movement_id: movementId });
    }

    database.prepare(`
      UPDATE stock_count_sessions
      SET status = 'reconciled', closed_by = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'
    `).run(actorId, id);
    recordAudit({
      database,
      actorId,
      action: 'reconcile',
      entityType: 'stock_count',
      entityId: id,
      oldValues: { status: 'open' },
      newValues: {
        status: 'reconciled',
        movement_ids: movements,
        variances,
      },
    });
    return { movementIds: movements, variances };
  }).immediate();

  return { session: readSession(id, database), movements: result.movementIds, variances: result.variances };
}
