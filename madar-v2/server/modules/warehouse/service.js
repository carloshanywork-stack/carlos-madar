import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import {
  allowOnlyKeys,
  HttpError,
  integerIdArray,
  nonNegativeInteger,
  optionalText,
  positiveId,
  requireObject,
  requireText,
} from '../http.js';

const SCRAP_SALE_CATEGORY = 'إيرادات بيع خردة ومخلفات تشغيل';
const SCRAP_SALE_REFERENCE = 'بيع خردة بواقي ورشة';
const MAX_QUANTITY = 1_000_000_000_000;

function quantity(value, label, { allowZero = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > MAX_QUANTITY
      || (allowZero ? value < 0 : value <= 0)) {
    throw new HttpError(400, `${label} must be a ${allowZero ? 'non-negative' : 'positive'} finite quantity.`);
  }
  return value;
}

function materialCode(value) {
  const code = requireText(value, 'code', { maxLength: 64 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code)) {
    throw new HttpError(400, 'code may contain only letters, numbers, dots, underscores, and hyphens.');
  }
  return code;
}

function activeMaterial(materialId, database) {
  const material = database.prepare(`
    SELECT id, code, name, specification, unit, stock, min_stock, unit_cost_cents
    FROM materials WHERE id = ? AND active = 1 AND deleted_at IS NULL
  `).get(materialId);
  if (!material) throw new HttpError(404, 'Active material was not found.');
  return material;
}

function activeWorkshopOrder(orderId, database) {
  const order = database.prepare(`
    SELECT id, order_code, status FROM workshop_orders
    WHERE id = ? AND deleted_at IS NULL
  `).get(orderId);
  if (!order) throw new HttpError(404, 'Workshop order was not found.');
  if (order.status !== 'in_production') {
    throw new HttpError(409, 'Materials can only be issued to a workshop order in production.');
  }
  return order;
}

function logMovement(database, movement) {
  const result = database.prepare(`
    INSERT INTO inventory_movements
      (material_id, offcut_id, kind, quantity, warehouse, reference,
       source_type, source_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movement.materialId ?? null,
    movement.offcutId ?? null,
    movement.kind,
    movement.quantity,
    movement.warehouse,
    movement.reference ?? null,
    movement.sourceType ?? null,
    movement.sourceId ?? null,
    movement.notes ?? null,
    movement.actorId ?? null,
  );
  return Number(result.lastInsertRowid);
}

function recordStockAudit(database, actorId, entityType, entityId, action, oldValues, newValues) {
  recordAudit({ database, actorId, entityType, entityId, action, oldValues, newValues });
}

export function listMaterials(database = db) {
  return database.prepare(`
    SELECT id, code, name, specification, unit, stock, min_stock,
      unit_cost_cents, active, created_at
    FROM materials
    WHERE active = 1 AND deleted_at IS NULL
    ORDER BY name COLLATE NOCASE, code COLLATE NOCASE, id
  `).all().map((material) => ({
    ...material,
    is_low_stock: material.stock <= material.min_stock,
  }));
}

export function createMaterial(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['code', 'name', 'specification', 'unit', 'minStock', 'unitCostCents', 'initialStock']);
  const code = materialCode(body.code);
  const name = requireText(body.name, 'name', { maxLength: 200 });
  const specification = optionalText(body.specification, 'specification', { maxLength: 1000 });
  const unit = requireText(body.unit, 'unit', { maxLength: 50 });
  const minStock = quantity(body.minStock, 'minStock', { allowZero: true });
  const unitCostCents = nonNegativeInteger(body.unitCostCents, 'unitCostCents');
  const initialStock = body.initialStock === undefined
    ? 0
    : quantity(body.initialStock, 'initialStock', { allowZero: true });

  try {
    const materialId = database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO materials (code, name, specification, unit, stock, min_stock, unit_cost_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(code, name, specification, unit, initialStock, minStock, unitCostCents);
      const id = Number(result.lastInsertRowid);
      let movementId = null;
      if (initialStock > 0) {
        movementId = logMovement(database, {
          materialId: id,
          kind: 'purchase',
          quantity: initialStock,
          warehouse: 'main',
          reference: code,
          sourceType: 'manual',
          sourceId: id,
          notes: 'Initial material stock',
          actorId,
        });
      }
      recordStockAudit(database, actorId, 'material', id, 'create', null, {
        code, name, specification, unit, min_stock: minStock,
        unit_cost_cents: unitCostCents, stock: initialStock, initial_movement_id: movementId,
      });
      return id;
    }).immediate();
    return listMaterials(database).find((material) => material.id === materialId)
      ?? database.prepare('SELECT * FROM materials WHERE id = ?').get(materialId);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'Material code already exists.');
    throw error;
  }
}

export function listMovements(database = db) {
  return database.prepare(`
    SELECT movement.id, movement.material_id, movement.offcut_id,
      material.code AS material_code,
      COALESCE(material.name, offcut.name) AS material_name,
      COALESCE(material.unit, offcut.unit) AS unit,
      movement.kind, movement.quantity, movement.warehouse, movement.reference,
      movement.source_type, movement.source_id, movement.notes, movement.created_by,
      movement.created_at,
      workshop_order.order_code AS workshop_order_code
    FROM inventory_movements movement
    LEFT JOIN materials material ON material.id = movement.material_id
    LEFT JOIN secondary_warehouse_offcuts offcut ON offcut.id = movement.offcut_id
    LEFT JOIN workshop_orders workshop_order
      ON movement.source_type = 'workshop_order' AND workshop_order.id = movement.source_id
    ORDER BY movement.created_at DESC, movement.id DESC
    LIMIT 100
  `).all();
}

export function issueMaterial(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['workshopOrderId', 'sourceWarehouse', 'materialId', 'offcutId', 'quantity', 'notes']);
  const workshopOrderId = positiveId(body.workshopOrderId, 'workshopOrderId');
  const sourceWarehouse = body.sourceWarehouse;
  if (!['main', 'secondary'].includes(sourceWarehouse)) {
    throw new HttpError(400, 'sourceWarehouse must be main or secondary.');
  }
  const requestedQuantity = quantity(body.quantity, 'quantity');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  if (sourceWarehouse === 'main') {
    if (body.materialId === undefined || body.offcutId !== undefined) {
      throw new HttpError(400, 'Main-warehouse issues require materialId and cannot include offcutId.');
    }
  } else if (body.offcutId === undefined || body.materialId !== undefined) {
    throw new HttpError(400, 'Secondary-warehouse issues require offcutId and cannot include materialId.');
  }
  const materialId = sourceWarehouse === 'main' ? positiveId(body.materialId, 'materialId') : null;
  const offcutId = sourceWarehouse === 'secondary' ? positiveId(body.offcutId, 'offcutId') : null;

  const result = database.transaction(() => {
    const order = activeWorkshopOrder(workshopOrderId, database);
    let selectedMaterial = null;
    let selectedOffcut = null;
    if (sourceWarehouse === 'main') {
      selectedMaterial = activeMaterial(materialId, database);
      if (selectedMaterial.stock < requestedQuantity) {
        throw new HttpError(409, 'Insufficient main-warehouse stock.');
      }
      database.prepare('UPDATE materials SET stock = stock - ? WHERE id = ? AND stock >= ?')
        .run(requestedQuantity, materialId, requestedQuantity);
    } else {
      selectedOffcut = database.prepare(`
        SELECT id, material_id, name, dimensions, quantity, unit, unit_cost_cents, status
        FROM secondary_warehouse_offcuts WHERE id = ?
      `).get(offcutId);
      if (!selectedOffcut) throw new HttpError(404, 'Offcut was not found.');
      if (selectedOffcut.status !== 'available') throw new HttpError(409, 'Offcut is not available for reuse.');
      if (selectedOffcut.quantity < requestedQuantity) {
        throw new HttpError(409, 'Insufficient offcut quantity.');
      }
      const remaining = selectedOffcut.quantity - requestedQuantity;
      if (remaining === 0) {
        database.prepare(`
          UPDATE secondary_warehouse_offcuts
          SET status = 'consumed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'available'
        `).run(offcutId);
      } else {
        database.prepare(`
          UPDATE secondary_warehouse_offcuts
          SET quantity = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'available'
        `).run(remaining, offcutId);
      }
    }

    const movementId = logMovement(database, {
      materialId: selectedMaterial?.id ?? selectedOffcut?.material_id ?? null,
      offcutId,
      kind: 'issue',
      quantity: requestedQuantity,
      warehouse: sourceWarehouse,
      reference: order.order_code,
      sourceType: 'workshop_order',
      sourceId: order.id,
      notes,
      actorId,
    });
    recordStockAudit(database, actorId, 'inventory_movement', movementId, 'workshop_issue', null, {
      workshop_order_id: order.id,
      workshop_order_code: order.order_code,
      source_warehouse: sourceWarehouse,
      material_id: selectedMaterial?.id ?? selectedOffcut?.material_id ?? null,
      offcut_id: offcutId,
      quantity: requestedQuantity,
    });
    return {
      movementId,
      material: selectedMaterial ? activeMaterial(materialId, database) : null,
      offcut: selectedOffcut
        ? database.prepare('SELECT * FROM secondary_warehouse_offcuts WHERE id = ?').get(offcutId)
        : null,
      orderCode: order.order_code,
    };
  }).immediate();

  return {
    movement: database.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(result.movementId),
    material: result.material,
    offcut: result.offcut,
    workshop_order_code: result.orderCode,
  };
}

function activeOptionalMaterial(materialId, database) {
  if (materialId === undefined || materialId === null) return null;
  const id = positiveId(materialId, 'materialId');
  activeMaterial(id, database);
  return id;
}

export function listOffcuts(status = 'available', database = db) {
  const allowedStatuses = ['available', 'consumed', 'scrapped_sold', 'variance_lost', 'all'];
  if (!allowedStatuses.includes(status)) {
    throw new HttpError(400, `status must be one of: ${allowedStatuses.join(', ')}.`);
  }
  const where = status === 'all' ? '' : 'WHERE offcut.status = ?';
  const parameters = status === 'all' ? [] : [status];
  return database.prepare(`
    SELECT offcut.id, offcut.material_id, material.code AS material_code,
      offcut.name, offcut.dimensions, offcut.quantity, offcut.unit,
      offcut.unit_cost_cents, offcut.origin_workshop_order_id,
      workshop_order.order_code AS origin_workshop_order_code,
      offcut.status, offcut.notes, offcut.created_at, offcut.updated_at
    FROM secondary_warehouse_offcuts offcut
    LEFT JOIN materials material ON material.id = offcut.material_id
    LEFT JOIN workshop_orders workshop_order ON workshop_order.id = offcut.origin_workshop_order_id
    ${where}
    ORDER BY CASE offcut.status WHEN 'available' THEN 0 ELSE 1 END,
      offcut.created_at DESC, offcut.id DESC
  `).all(...parameters);
}

export function createOffcut(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['name', 'dimensions', 'quantity', 'unit', 'materialId', 'unitCostCents', 'notes']);
  const name = requireText(body.name, 'name', { maxLength: 200 });
  const dimensions = requireText(body.dimensions, 'dimensions', { maxLength: 200 });
  const quantityValue = quantity(body.quantity, 'quantity');
  const unit = requireText(body.unit, 'unit', { maxLength: 50 });
  const materialId = activeOptionalMaterial(body.materialId, database);
  const unitCostCents = body.unitCostCents === undefined ? 0 : nonNegativeInteger(body.unitCostCents, 'unitCostCents');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  const id = database.transaction(() => {
    const result = database.prepare(`
      INSERT INTO secondary_warehouse_offcuts
        (material_id, name, dimensions, quantity, unit, unit_cost_cents, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'available')
    `).run(materialId, name, dimensions, quantityValue, unit, unitCostCents, notes);
    const offcutId = Number(result.lastInsertRowid);
    recordStockAudit(database, actorId, 'warehouse_offcut', offcutId, 'manual_register', null, {
      material_id: materialId,
      name,
      dimensions,
      quantity: quantityValue,
      unit,
      status: 'available',
    });
    return offcutId;
  }).immediate();
  return listOffcuts('all', database).find((offcut) => offcut.id === id);
}

export function sellScrap(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['offcutIds', 'totalSaleAmountCents', 'buyerName']);
  const offcutIds = integerIdArray(body.offcutIds, 'offcutIds');
  if (offcutIds.length === 0) throw new HttpError(400, 'offcutIds must contain at least one offcut.');
  const totalSaleAmountCents = nonNegativeInteger(body.totalSaleAmountCents, 'totalSaleAmountCents');
  if (totalSaleAmountCents < 1) throw new HttpError(400, 'totalSaleAmountCents must be greater than zero.');
  const buyerName = optionalText(body.buyerName, 'buyerName', { maxLength: 200 });

  const treasuryEntryId = database.transaction(() => {
    const placeholders = offcutIds.map(() => '?').join(', ');
    const offcuts = database.prepare(`
      SELECT id, material_id, name, dimensions, quantity, unit, status
      FROM secondary_warehouse_offcuts WHERE id IN (${placeholders})
    `).all(...offcutIds);
    if (offcuts.length !== offcutIds.length) throw new HttpError(404, 'One or more offcuts were not found.');
    if (offcuts.some((offcut) => offcut.status !== 'available')) {
      throw new HttpError(409, 'Only available offcuts can be included in a scrap sale.');
    }
    const treasury = database.prepare(`
      INSERT INTO treasury_entries (kind, category, amount_cents, reference, notes, created_by)
      VALUES ('income', ?, ?, ?, ?, ?)
    `).run(
      SCRAP_SALE_CATEGORY,
      totalSaleAmountCents,
      SCRAP_SALE_REFERENCE,
      buyerName ? `Buyer: ${buyerName}` : null,
      actorId,
    );
    const entryId = Number(treasury.lastInsertRowid);
    for (const offcut of offcuts) {
      database.prepare(`
        UPDATE secondary_warehouse_offcuts
        SET status = 'scrapped_sold', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'available'
      `).run(offcut.id);
      const movementId = logMovement(database, {
        materialId: offcut.material_id,
        offcutId: offcut.id,
        kind: 'scrap_sale',
        quantity: offcut.quantity,
        warehouse: 'secondary',
        reference: SCRAP_SALE_REFERENCE,
        sourceType: 'manual',
        sourceId: entryId,
        notes: buyerName ? `Buyer: ${buyerName}` : null,
        actorId,
      });
      recordStockAudit(database, actorId, 'warehouse_offcut', offcut.id, 'scrap_sale',
        { status: 'available' }, { status: 'scrapped_sold', movement_id: movementId, treasury_entry_id: entryId });
    }
    recordStockAudit(database, actorId, 'treasury_entry', entryId, 'scrap_sale', null, {
      kind: 'income',
      category: SCRAP_SALE_CATEGORY,
      amount_cents: totalSaleAmountCents,
      reference: SCRAP_SALE_REFERENCE,
      offcut_ids: offcutIds,
      buyer_name: buyerName,
    });
    return entryId;
  }).immediate();

  return {
    treasuryEntry: database.prepare('SELECT * FROM treasury_entries WHERE id = ?').get(treasuryEntryId),
    offcuts: offcutIds.map((id) => listOffcuts('all', database).find((offcut) => offcut.id === id)),
  };
}
