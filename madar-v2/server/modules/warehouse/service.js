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
const MAX_SCRAP_SALE_CENTS = 5_000_000;
const MAX_QUANTITY = 1_000_000_000_000;

export function ensureWarehouseSchema(database = db) {
  try {
    const offcutCols = database.prepare('PRAGMA table_info(secondary_warehouse_offcuts)').all();
    if (!offcutCols.some((c) => c.name === 'is_scrap')) {
      database.prepare('ALTER TABLE secondary_warehouse_offcuts ADD COLUMN is_scrap INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!offcutCols.some((c) => c.name === 'client_id')) {
      database.prepare('ALTER TABLE secondary_warehouse_offcuts ADD COLUMN client_id INTEGER REFERENCES clients(id)').run();
    }
    if (!offcutCols.some((c) => c.name === 'is_customer_owned')) {
      database.prepare('ALTER TABLE secondary_warehouse_offcuts ADD COLUMN is_customer_owned INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!offcutCols.some((c) => c.name === 'location')) {
      database.prepare('ALTER TABLE secondary_warehouse_offcuts ADD COLUMN location TEXT').run();
    }
    if (!offcutCols.some((c) => c.name === 'finish')) {
      database.prepare('ALTER TABLE secondary_warehouse_offcuts ADD COLUMN finish TEXT').run();
    }
  } catch {
    // Ignore schema checks if already altered
  }
  try {
    const matCols = database.prepare('PRAGMA table_info(materials)').all();
    if (!matCols.some((c) => c.name === 'is_customer_owned')) {
      database.prepare('ALTER TABLE materials ADD COLUMN is_customer_owned INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!matCols.some((c) => c.name === 'client_id')) {
      database.prepare('ALTER TABLE materials ADD COLUMN client_id INTEGER REFERENCES clients(id)').run();
    }
    if (!matCols.some((c) => c.name === 'weighted_average_cost_cents')) {
      database.prepare('ALTER TABLE materials ADD COLUMN weighted_average_cost_cents INTEGER NOT NULL DEFAULT 0').run();
      database.exec('UPDATE materials SET weighted_average_cost_cents = unit_cost_cents WHERE unit_cost_cents > 0');
    }
    if (!matCols.some((c) => c.name === 'replacement_cost_cents')) {
      database.prepare('ALTER TABLE materials ADD COLUMN replacement_cost_cents INTEGER NOT NULL DEFAULT 0').run();
      database.exec('UPDATE materials SET replacement_cost_cents = unit_cost_cents WHERE unit_cost_cents > 0');
    }
  } catch {
    // Ignore schema checks if already altered
  }
}

export function parseDimensionsToCm(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    if (value.widthMm !== undefined && value.heightMm !== undefined) {
      return { widthCm: Number(value.widthMm) / 10, heightCm: Number(value.heightMm) / 10 };
    }
    if (value.widthCm !== undefined && value.heightCm !== undefined) {
      return { widthCm: Number(value.widthCm), heightCm: Number(value.heightCm) };
    }
    if (value.widthM !== undefined && value.heightM !== undefined) {
      return { widthCm: Number(value.widthM) * 100, heightCm: Number(value.heightM) * 100 };
    }
    if (value.width !== undefined && value.height !== undefined) {
      const unit = String(value.unit || 'cm').toLowerCase();
      const mult = unit === 'mm' ? 0.1 : (unit === 'm' || unit === 'meter' || unit === 'meters') ? 100 : 1;
      return { widthCm: Number(value.width) * mult, heightCm: Number(value.height) * mult };
    }
  }
  const str = String(value).trim();
  const match = str.match(/([0-9]+(?:\.[0-9]+)?)\s*[*xX×/]\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  let w = parseFloat(match[1]);
  let h = parseFloat(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;

  const lower = str.toLowerCase();
  if (lower.includes('mm')) {
    w /= 10;
    h /= 10;
  } else if ((lower.includes('m') || lower.includes('متر')) && !lower.includes('cm') && !lower.includes('سم')) {
    w *= 100;
    h *= 100;
  }
  return { widthCm: w, heightCm: h };
}

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
  const tableCols = database.prepare('PRAGMA table_info(materials)').all();
  const hasReserved = tableCols.some((c) => c.name === 'reserved_stock');
  const reservedCol = hasReserved ? 'COALESCE(reserved_stock, 0) AS reserved_stock,' : '0 AS reserved_stock,';
  const hasCustOwned = tableCols.some((c) => c.name === 'is_customer_owned');
  const custOwnedCol = hasCustOwned ? 'COALESCE(is_customer_owned, 0) AS is_customer_owned, client_id,' : '0 AS is_customer_owned, NULL AS client_id,';
  const hasWeighted = tableCols.some((c) => c.name === 'weighted_average_cost_cents');
  const weightedCol = hasWeighted ? 'COALESCE(weighted_average_cost_cents, unit_cost_cents, 0) AS weighted_average_cost_cents,' : 'unit_cost_cents AS weighted_average_cost_cents,';
  const hasReplacement = tableCols.some((c) => c.name === 'replacement_cost_cents');
  const replacementCol = hasReplacement ? 'COALESCE(replacement_cost_cents, unit_cost_cents, 0) AS replacement_cost_cents,' : 'unit_cost_cents AS replacement_cost_cents,';
  const material = database.prepare(`
    SELECT id, code, name, specification, unit, stock, ${reservedCol} ${custOwnedCol} ${weightedCol} ${replacementCol} min_stock, unit_cost_cents
    FROM materials WHERE id = ? AND active = 1 AND deleted_at IS NULL
  `).get(materialId);
  if (!material) throw new HttpError(404, 'Active material was not found.');
  return material;
}

function activeWorkshopOrder(orderId, database) {
  const order = database.prepare(`
    SELECT id, order_code, status, client_id FROM workshop_orders
    WHERE id = ? AND deleted_at IS NULL
  `).get(orderId);
  if (!order) throw new HttpError(404, 'Workshop order was not found.');
  if (order.status !== 'in_production') {
    throw new HttpError(409, 'Materials can only be issued to a workshop order in production.');
  }
  return order;
}

function logMovement(database, movement) {
  const hasUnitCost = database.prepare('PRAGMA table_info(inventory_movements)').all().some((c) => c.name === 'unit_cost_cents');
  if (hasUnitCost) {
    const result = database.prepare(`
      INSERT INTO inventory_movements
        (material_id, offcut_id, kind, quantity, warehouse, reference,
         source_type, source_id, notes, unit_cost_cents, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      movement.unitCostCents ?? null,
      movement.actorId ?? null,
    );
    return Number(result.lastInsertRowid);
  }
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
  const tableCols = database.prepare('PRAGMA table_info(materials)').all();
  const hasReserved = tableCols.some((c) => c.name === 'reserved_stock');
  const reservedCol = hasReserved ? 'COALESCE(reserved_stock, 0) AS reserved_stock,' : '0 AS reserved_stock,';
  const hasWeighted = tableCols.some((c) => c.name === 'weighted_average_cost_cents');
  const weightedCol = hasWeighted ? 'COALESCE(weighted_average_cost_cents, unit_cost_cents, 0) AS weighted_average_cost_cents,' : 'unit_cost_cents AS weighted_average_cost_cents,';
  const hasReplacement = tableCols.some((c) => c.name === 'replacement_cost_cents');
  const replacementCol = hasReplacement ? 'COALESCE(replacement_cost_cents, unit_cost_cents, 0) AS replacement_cost_cents,' : 'unit_cost_cents AS replacement_cost_cents,';
  return database.prepare(`
    SELECT id, code, name, specification, unit, stock, ${reservedCol} ${weightedCol} ${replacementCol} min_stock,
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
  allowOnlyKeys(body, [
    'code', 'name', 'specification', 'unit', 'minStock', 'unitCostCents', 'initialStock',
    'isCustomerOwned', 'is_customer_owned', 'clientId', 'client_id',
    'replacementCostCents', 'replacement_cost_cents', 'weightedAverageCostCents', 'weighted_average_cost_cents',
  ]);
  ensureWarehouseSchema(database);
  const code = materialCode(body.code);
  const name = requireText(body.name, 'name', { maxLength: 200 });
  const specification = optionalText(body.specification, 'specification', { maxLength: 1000 });
  const unit = requireText(body.unit, 'unit', { maxLength: 50 });
  const minStock = quantity(body.minStock, 'minStock', { allowZero: true });
  const unitCostCents = nonNegativeInteger(body.unitCostCents, 'unitCostCents');
  const replacementCostCents = body.replacementCostCents !== undefined || body.replacement_cost_cents !== undefined
    ? nonNegativeInteger(body.replacementCostCents ?? body.replacement_cost_cents, 'replacementCostCents')
    : unitCostCents;
  const weightedAverageCostCents = body.weightedAverageCostCents !== undefined || body.weighted_average_cost_cents !== undefined
    ? nonNegativeInteger(body.weightedAverageCostCents ?? body.weighted_average_cost_cents, 'weightedAverageCostCents')
    : unitCostCents;
  const isCustomerOwned = (body.isCustomerOwned === 1 || body.isCustomerOwned === true || body.is_customer_owned === 1) ? 1 : 0;
  const clientId = body.clientId || body.client_id ? positiveId(body.clientId || body.client_id, 'clientId') : null;
  const initialStock = body.initialStock === undefined
    ? 0
    : quantity(body.initialStock, 'initialStock', { allowZero: true });
  if (!Number.isInteger(initialStock)) {
    throw new HttpError(400, 'Initial main-warehouse stock must be a whole-unit quantity.');
  }

  try {
    const materialId = database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO materials (code, name, specification, unit, stock, min_stock, unit_cost_cents, weighted_average_cost_cents, replacement_cost_cents, is_customer_owned, client_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(code, name, specification, unit, initialStock, minStock, unitCostCents, weightedAverageCostCents, replacementCostCents, isCustomerOwned, clientId);
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
        unit_cost_cents: unitCostCents,
        weighted_average_cost_cents: weightedAverageCostCents,
        replacement_cost_cents: replacementCostCents,
        stock: initialStock, initial_movement_id: movementId,
        is_customer_owned: isCustomerOwned, client_id: clientId,
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

export function updateMaterialReplacementCost(materialId, replacementCostCents, actorId = null, database = db) {
  const id = positiveId(materialId, 'materialId');
  const costCents = nonNegativeInteger(replacementCostCents, 'replacementCostCents');
  ensureWarehouseSchema(database);

  return database.transaction(() => {
    const material = database.prepare('SELECT * FROM materials WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(id);
    if (!material) throw new HttpError(404, 'Active material was not found.');

    const oldCost = material.replacement_cost_cents ?? material.unit_cost_cents ?? 0;
    database.prepare(`
      UPDATE materials
      SET replacement_cost_cents = ?
      WHERE id = ?
    `).run(costCents, id);

    recordStockAudit(
      database,
      actorId,
      'material',
      id,
      'update_replacement_cost',
      { replacement_cost_cents: oldCost },
      { replacement_cost_cents: costCents },
    );

    const updated = database.prepare('SELECT * FROM materials WHERE id = ?').get(id);
    return {
      materialId: updated.id,
      id: updated.id,
      code: updated.code,
      name: updated.name,
      stock: updated.stock,
      unit_cost_cents: updated.unit_cost_cents,
      weighted_average_cost_cents: updated.weighted_average_cost_cents ?? updated.unit_cost_cents ?? 0,
      replacement_cost_cents: updated.replacement_cost_cents,
    };
  }).immediate();
}

export function getMaterialCostFigures(materialId, database = db) {
  const id = positiveId(materialId, 'materialId');
  ensureWarehouseSchema(database);
  const material = database.prepare('SELECT * FROM materials WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!material) throw new HttpError(404, 'Material was not found.');

  return {
    materialId: material.id,
    id: material.id,
    code: material.code,
    name: material.name,
    unit: material.unit,
    stock: material.stock,
    unit_cost_cents: material.unit_cost_cents,
    weighted_average_cost_cents: material.weighted_average_cost_cents ?? material.unit_cost_cents ?? 0,
    replacement_cost_cents: material.replacement_cost_cents ?? material.unit_cost_cents ?? 0,
  };
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
  allowOnlyKeys(body, [
    'workshopOrderId', 'sourceWarehouse', 'materialId', 'offcutId', 'quantity', 'notes',
    'mainWithdrawalMode', 'offcutName', 'offcutDimensions', 'requiredDimensions',
    'widthMm', 'heightMm', 'widthCm', 'heightCm',
  ]);
  const workshopOrderId = positiveId(body.workshopOrderId, 'workshopOrderId');
  const sourceWarehouse = body.sourceWarehouse;
  if (!['main', 'secondary'].includes(sourceWarehouse)) {
    throw new HttpError(400, 'sourceWarehouse must be main or secondary.');
  }
  const requestedQuantity = quantity(body.quantity, 'quantity');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  const fractionalMainWithdrawal = sourceWarehouse === 'main' && !Number.isInteger(requestedQuantity);
  if (sourceWarehouse === 'main') {
    if (body.materialId === undefined || body.offcutId !== undefined) {
      throw new HttpError(400, 'Main-warehouse issues require materialId and cannot include offcutId.');
    }
    if (fractionalMainWithdrawal) {
      if (body.mainWithdrawalMode !== 'round_up') {
        throw new HttpError(400, 'Choose a whole-unit main-warehouse withdrawal or issue the fractional quantity from a secondary offcut.');
      }
      requireText(body.offcutName, 'offcutName', { maxLength: 200 });
      requireText(body.offcutDimensions, 'offcutDimensions', { maxLength: 200 });
    } else if (body.mainWithdrawalMode !== undefined || body.offcutName !== undefined || body.offcutDimensions !== undefined) {
      throw new HttpError(400, 'Offcut details are only accepted when a fractional main-warehouse issue rounds up.');
    }
  } else if (body.offcutId === undefined || body.materialId !== undefined) {
    throw new HttpError(400, 'Secondary-warehouse issues require offcutId and cannot include materialId.');
  } else if (body.mainWithdrawalMode !== undefined || body.offcutName !== undefined || body.offcutDimensions !== undefined) {
    throw new HttpError(400, 'Main-warehouse rounding fields cannot be used for a secondary-offcut issue.');
  }
  const materialId = sourceWarehouse === 'main' ? positiveId(body.materialId, 'materialId') : null;
  const offcutId = sourceWarehouse === 'secondary' ? positiveId(body.offcutId, 'offcutId') : null;
  const mainWithdrawalQuantity = sourceWarehouse === 'main' ? Math.ceil(requestedQuantity) : requestedQuantity;
  const remainderQuantity = sourceWarehouse === 'main' ? mainWithdrawalQuantity - requestedQuantity : 0;

  const result = database.transaction(() => {
    ensureWarehouseSchema(database);
    const order = activeWorkshopOrder(workshopOrderId, database);
    let selectedMaterial = null;
    let selectedOffcut = null;
    let fitsChecked = null;

    if (sourceWarehouse === 'main') {
      selectedMaterial = activeMaterial(materialId, database);
      if (selectedMaterial.is_customer_owned === 1) {
        if (!order.client_id || (selectedMaterial.client_id && order.client_id !== selectedMaterial.client_id)) {
          throw new HttpError(409, 'Customer-owned stock is strictly separated and cannot be issued to general or other client jobs.', {
            apiCode: 'CUSTOMER_STOCK_SEPARATION',
          });
        }
      }
      if (!Number.isInteger(selectedMaterial.stock)) {
        throw new HttpError(409, `Main stock for ${selectedMaterial.code} has a fractional legacy balance; reconcile a physical stock count before issuing.`);
      }
      if (selectedMaterial.stock < mainWithdrawalQuantity) {
        throw new HttpError(409, 'Insufficient main-warehouse stock.');
      }
      database.prepare('UPDATE materials SET stock = stock - ? WHERE id = ? AND stock >= ?')
        .run(mainWithdrawalQuantity, materialId, mainWithdrawalQuantity);
      if (remainderQuantity > 0) {
        const insertedOffcut = database.prepare(`
          INSERT INTO secondary_warehouse_offcuts
            (material_id, name, dimensions, quantity, unit, unit_cost_cents, origin_workshop_order_id, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          selectedMaterial.id,
          requireText(body.offcutName, 'offcutName', { maxLength: 200 }),
          requireText(body.offcutDimensions, 'offcutDimensions', { maxLength: 200 }),
          remainderQuantity,
          selectedMaterial.unit,
          selectedMaterial.unit_cost_cents,
          order.id,
          notes ?? `Remainder from ${mainWithdrawalQuantity} whole-unit main-warehouse withdrawal.`,
        );
        const createdOffcutId = Number(insertedOffcut.lastInsertRowid);
        selectedOffcut = database.prepare('SELECT * FROM secondary_warehouse_offcuts WHERE id = ?').get(createdOffcutId);
      }
    } else {
      selectedOffcut = database.prepare(`
        SELECT *
        FROM secondary_warehouse_offcuts WHERE id = ?
      `).get(offcutId);
      if (!selectedOffcut) throw new HttpError(404, 'Offcut was not found.');
      if (selectedOffcut.status !== 'available') throw new HttpError(409, 'Offcut is not available for reuse.');
      if (selectedOffcut.is_scrap === 1 || selectedOffcut.status === 'scrap' || selectedOffcut.status === 'scrapped_sold') {
        throw new HttpError(409, 'Scrap offcuts cannot be issued to production jobs.', {
          apiCode: 'SCRAP_CANNOT_BE_ISSUED',
        });
      }
      if (selectedOffcut.is_customer_owned === 1) {
        if (!order.client_id || (selectedOffcut.client_id && order.client_id !== selectedOffcut.client_id)) {
          throw new HttpError(409, 'Customer-owned stock is strictly separated and cannot be issued to general or other client jobs.', {
            apiCode: 'CUSTOMER_STOCK_SEPARATION',
          });
        }
      }
      if (selectedOffcut.quantity < requestedQuantity) {
        throw new HttpError(409, 'Insufficient offcut quantity.');
      }

      // 2D rectangular fit verification
      const reqDimInput = body.requiredDimensions
        || ((body.widthMm !== undefined && body.heightMm !== undefined) || (body.widthCm !== undefined && body.heightCm !== undefined) ? body : null);
      if (reqDimInput) {
        const reqDim = parseDimensionsToCm(reqDimInput);
        const offcutDim = parseDimensionsToCm(selectedOffcut.dimensions);
        if (reqDim && offcutDim) {
          const offcutW = offcutDim.widthCm;
          const offcutH = offcutDim.heightCm;
          const reqW = reqDim.widthCm;
          const reqH = reqDim.heightCm;
          const fits = (offcutW >= reqW && offcutH >= reqH) || (offcutH >= reqW && offcutW >= reqH);
          fitsChecked = fits;
          if (!fits) {
            throw new HttpError(
              409,
              'Offcut dimensions do not fit the required piece dimensions (same area does not guarantee geometric fit).',
              { apiCode: 'OFFCUT_DIMENSION_MISMATCH' }
            );
          }
        }
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

    const movementUnitCostCents = sourceWarehouse === 'main'
      ? selectedMaterial.unit_cost_cents
      : (selectedOffcut.unit_cost_cents || 0);

    const movementId = logMovement(database, {
      materialId: selectedMaterial?.id ?? selectedOffcut?.material_id ?? null,
      offcutId: sourceWarehouse === 'secondary' ? offcutId : null,
      kind: 'issue',
      quantity: sourceWarehouse === 'main' ? mainWithdrawalQuantity : requestedQuantity,
      warehouse: sourceWarehouse,
      reference: order.order_code,
      sourceType: 'workshop_order',
      sourceId: order.id,
      notes,
      unitCostCents: movementUnitCostCents,
      actorId,
    });
    let offcutMovementId = null;
    if (remainderQuantity > 0 && selectedOffcut) {
      offcutMovementId = logMovement(database, {
        offcutId: selectedOffcut.id,
        kind: 'offcut_return',
        quantity: remainderQuantity,
        warehouse: 'secondary',
        reference: order.order_code,
        sourceType: 'workshop_order',
        sourceId: order.id,
        notes: `Remainder returned from ${mainWithdrawalQuantity} whole-unit main-warehouse withdrawal.`,
        unitCostCents: selectedMaterial.unit_cost_cents,
        actorId,
      });
      recordStockAudit(database, actorId, 'warehouse_offcut', selectedOffcut.id, 'created_from_main_withdrawal', null, {
        material_id: selectedMaterial.id,
        workshop_order_id: order.id,
        quantity: remainderQuantity,
        unit: selectedMaterial.unit,
      });
    }

    // Fulfill active reservations if present
    if (sourceWarehouse === 'main' && selectedMaterial) {
      try {
        const reservation = database.prepare(`
          SELECT id, reserved_quantity FROM inventory_reservations
          WHERE workshop_order_id = ? AND material_id = ? AND status = 'active'
          LIMIT 1
        `).get(order.id, selectedMaterial.id);
        if (reservation) {
          const fulfillQty = Math.min(reservation.reserved_quantity, mainWithdrawalQuantity);
          const remainingReserved = reservation.reserved_quantity - fulfillQty;
          if (remainingReserved <= 0) {
            database.prepare("UPDATE inventory_reservations SET status = 'fulfilled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(reservation.id);
          } else {
            database.prepare("UPDATE inventory_reservations SET reserved_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(remainingReserved, reservation.id);
          }
          database.prepare("UPDATE materials SET reserved_stock = MAX(0, reserved_stock - ?) WHERE id = ?").run(fulfillQty, selectedMaterial.id);
        }
      } catch {
        // Table may not exist yet in legacy tests before migration
      }
    }
    recordStockAudit(database, actorId, 'inventory_movement', movementId, 'workshop_issue', null, {
      workshop_order_id: order.id,
      workshop_order_code: order.order_code,
      source_warehouse: sourceWarehouse,
      material_id: selectedMaterial?.id ?? selectedOffcut?.material_id ?? null,
      requested_quantity: requestedQuantity,
      main_withdrawal_quantity: sourceWarehouse === 'main' ? mainWithdrawalQuantity : null,
      remainder_quantity: remainderQuantity,
      offcut_id: sourceWarehouse === 'secondary' ? offcutId : null,
      returned_offcut_id: remainderQuantity > 0 ? selectedOffcut?.id ?? null : null,
      offcut_movement_id: offcutMovementId,
    });
    return {
      movementId,
      offcutMovementId,
      material: selectedMaterial ? activeMaterial(materialId, database) : null,
      offcut: selectedOffcut
        ? database.prepare('SELECT * FROM secondary_warehouse_offcuts WHERE id = ?').get(selectedOffcut.id)
        : null,
      orderCode: order.order_code,
      requestedQuantity,
      mainWithdrawalQuantity: sourceWarehouse === 'main' ? mainWithdrawalQuantity : null,
      remainderQuantity,
      fits: fitsChecked === null ? true : fitsChecked,
      movementUnitCostCents,
    };
  }).immediate();

  return {
    success: true,
    movementId: result.movementId,
    stampedUnitCostCents: result.movementUnitCostCents,
    fits: result.fits,
    movement: database.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(result.movementId),
    offcutMovement: result.offcutMovementId
      ? database.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(result.offcutMovementId)
      : null,
    material: result.material,
    offcut: result.offcut,
    workshop_order_code: result.orderCode,
    requested_quantity: result.requestedQuantity,
    main_withdrawal_quantity: result.mainWithdrawalQuantity,
    remainder_quantity: result.remainderQuantity,
  };
}

function activeOptionalMaterial(materialId, database) {
  if (materialId === undefined || materialId === null) return null;
  const id = positiveId(materialId, 'materialId');
  activeMaterial(id, database);
  return id;
}

export function listOffcuts(status = 'available', database = db) {
  const allowedStatuses = ['available', 'consumed', 'scrapped_sold', 'scrap', 'variance_lost', 'all'];
  if (!allowedStatuses.includes(status)) {
    throw new HttpError(400, `status must be one of: ${allowedStatuses.join(', ')}.`);
  }
  let where = '';
  const parameters = [];
  if (status === 'available') {
    where = 'WHERE offcut.status = ? AND (offcut.is_scrap IS NULL OR offcut.is_scrap = 0)';
    parameters.push('available');
  } else if (status === 'scrap') {
    where = 'WHERE (offcut.status = ? OR offcut.is_scrap = 1)';
    parameters.push('scrap');
  } else if (status !== 'all') {
    where = 'WHERE offcut.status = ?';
    parameters.push(status);
  }
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
  allowOnlyKeys(body, [
    'name', 'dimensions', 'quantity', 'unit', 'materialId', 'unitCostCents', 'notes',
    'isScrap', 'is_scrap', 'status', 'isCustomerOwned', 'is_customer_owned',
    'clientId', 'client_id', 'location', 'finish',
  ]);
  ensureWarehouseSchema(database);
  const name = requireText(body.name, 'name', { maxLength: 200 });
  const dimensions = requireText(body.dimensions, 'dimensions', { maxLength: 200 });
  const quantityValue = quantity(body.quantity, 'quantity');
  const unit = requireText(body.unit, 'unit', { maxLength: 50 });
  const materialId = activeOptionalMaterial(body.materialId, database);
  const unitCostCents = body.unitCostCents === undefined ? 0 : nonNegativeInteger(body.unitCostCents, 'unitCostCents');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  const isScrap = (body.isScrap === 1 || body.isScrap === true || body.is_scrap === 1 || body.status === 'scrap') ? 1 : 0;
  const isCustomerOwned = (body.isCustomerOwned === 1 || body.isCustomerOwned === true || body.is_customer_owned === 1) ? 1 : 0;
  const clientId = body.clientId || body.client_id ? positiveId(body.clientId || body.client_id, 'clientId') : null;
  const location = optionalText(body.location, 'location', { maxLength: 100 });
  const finish = optionalText(body.finish, 'finish', { maxLength: 100 });
  const initialStatus = isScrap ? 'scrap' : 'available';

  const id = database.transaction(() => {
    let result;
    try {
      result = database.prepare(`
        INSERT INTO secondary_warehouse_offcuts
          (material_id, name, dimensions, quantity, unit, unit_cost_cents, notes, status,
           is_scrap, is_customer_owned, client_id, location, finish)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(materialId, name, dimensions, quantityValue, unit, unitCostCents, notes, initialStatus,
             isScrap, isCustomerOwned, clientId, location, finish);
    } catch (err) {
      if (err.message && err.message.includes('CHECK constraint failed')) {
        result = database.prepare(`
          INSERT INTO secondary_warehouse_offcuts
            (material_id, name, dimensions, quantity, unit, unit_cost_cents, notes, status,
             is_scrap, is_customer_owned, client_id, location, finish)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?)
        `).run(materialId, name, dimensions, quantityValue, unit, unitCostCents, notes,
               isScrap, isCustomerOwned, clientId, location, finish);
      } else {
        throw err;
      }
    }
    const offcutId = Number(result.lastInsertRowid);
    recordStockAudit(database, actorId, 'warehouse_offcut', offcutId, 'manual_register', null, {
      material_id: materialId,
      name,
      dimensions,
      quantity: quantityValue,
      unit,
      status: initialStatus,
      is_scrap: isScrap,
      is_customer_owned: isCustomerOwned,
      client_id: clientId,
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
  if (totalSaleAmountCents > MAX_SCRAP_SALE_CENTS) {
    throw new HttpError(400, 'Scrap-sale transactions may not exceed 50,000 EGP.');
  }
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

export function getLowStockMaterials(database = db) {
  return database.prepare(`
    SELECT id, code, name, specification, unit, stock, min_stock, unit_cost_cents,
      (min_stock - stock) as deficit
    FROM materials
    WHERE active = 1 AND deleted_at IS NULL AND min_stock > 0 AND stock <= min_stock
    ORDER BY (stock / CASE WHEN min_stock = 0 THEN 1 ELSE min_stock END) ASC
  `).all();
}

export function returnMaterial(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, [
    'workshopOrderId', 'targetWarehouse', 'materialId', 'quantity', 'notes',
    'offcutName', 'offcutDimensions', 'unit', 'unitCostCents',
    'finish', 'location', 'warehouseLocation', 'isScrap', 'is_scrap',
    'isCustomerOwned', 'is_customer_owned', 'clientId', 'client_id',
  ]);
  const workshopOrderId = positiveId(body.workshopOrderId, 'workshopOrderId');
  const targetWarehouse = body.targetWarehouse;
  if (!['main', 'secondary'].includes(targetWarehouse)) {
    throw new HttpError(400, 'targetWarehouse must be main or secondary.');
  }
  const returnQty = quantity(body.quantity, 'quantity');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  ensureWarehouseSchema(database);

  return database.transaction(() => {
    const order = database.prepare('SELECT id, order_code, status, client_id FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(workshopOrderId);
    if (!order) throw new HttpError(404, 'Workshop order was not found.');

    let movementId = null;
    let selectedMaterial = null;
    let createdOffcut = null;

    if (targetWarehouse === 'main') {
      const materialId = positiveId(body.materialId, 'materialId');
      selectedMaterial = activeMaterial(materialId, database);
      database.prepare('UPDATE materials SET stock = stock + ? WHERE id = ?').run(returnQty, materialId);
      movementId = logMovement(database, {
        materialId,
        kind: 'return',
        quantity: returnQty,
        warehouse: 'main',
        reference: order.order_code,
        sourceType: 'workshop_order',
        sourceId: order.id,
        unitCostCents: selectedMaterial.unit_cost_cents,
        notes: notes || `Returned whole-unit material from ${order.order_code}`,
        actorId,
      });
    } else {
      const materialId = body.materialId ? positiveId(body.materialId, 'materialId') : null;
      const offcutName = requireText(body.offcutName, 'offcutName', { maxLength: 200 });
      const offcutDimensions = requireText(body.offcutDimensions, 'offcutDimensions', { maxLength: 200 });
      const unit = body.unit ? requireText(body.unit, 'unit', { maxLength: 50 }) : 'قطعة';
      let unitCostCents = 0;
      if (body.unitCostCents !== undefined) {
        unitCostCents = nonNegativeInteger(body.unitCostCents, 'unitCostCents');
      } else if (materialId) {
        selectedMaterial = activeMaterial(materialId, database);
        unitCostCents = selectedMaterial.unit_cost_cents;
      }

      // Check credit capping: credit source job once, capped at issue cost
      const issuedTotal = database.prepare(`
        SELECT COALESCE(SUM(quantity * COALESCE(unit_cost_cents, 0)), 0) AS total_cents
        FROM inventory_movements
        WHERE source_type = 'workshop_order' AND source_id = ? AND kind = 'issue'
      `).get(order.id).total_cents;

      const alreadyCredited = database.prepare(`
        SELECT COALESCE(SUM(quantity * COALESCE(unit_cost_cents, 0)), 0) AS total_cents
        FROM inventory_movements
        WHERE source_type = 'workshop_order' AND source_id = ? AND kind IN ('return', 'offcut_return')
      `).get(order.id).total_cents;

      const maxEligibleCredit = Math.max(0, issuedTotal - alreadyCredited);
      if (returnQty * unitCostCents > maxEligibleCredit && maxEligibleCredit > 0) {
        unitCostCents = Math.floor(maxEligibleCredit / returnQty);
      }

      const finish = optionalText(body.finish, 'finish', { maxLength: 100 });
      const location = optionalText(body.location || body.warehouseLocation, 'location', { maxLength: 100 });
      const isScrap = (body.isScrap === 1 || body.isScrap === true || body.is_scrap === 1) ? 1 : 0;
      const isCustomerOwned = (body.isCustomerOwned === 1 || body.isCustomerOwned === true || body.is_customer_owned === 1) ? 1 : 0;
      const clientId = isCustomerOwned
        ? (body.clientId || body.client_id ? positiveId(body.clientId || body.client_id, 'clientId') : (order.client_id ?? null))
        : null;

      const inserted = database.prepare(`
        INSERT INTO secondary_warehouse_offcuts
          (material_id, name, dimensions, quantity, unit, unit_cost_cents, origin_workshop_order_id, status, notes,
           finish, location, is_scrap, is_customer_owned, client_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?)
      `).run(
        materialId, offcutName, offcutDimensions, returnQty, unit, unitCostCents, order.id, notes,
        finish, location, isScrap, isCustomerOwned, clientId,
      );
      const offcutId = Number(inserted.lastInsertRowid);
      createdOffcut = database.prepare('SELECT * FROM secondary_warehouse_offcuts WHERE id = ?').get(offcutId);

      movementId = logMovement(database, {
        materialId,
        offcutId,
        kind: 'offcut_return',
        quantity: returnQty,
        warehouse: 'secondary',
        reference: order.order_code,
        sourceType: 'workshop_order',
        sourceId: order.id,
        unitCostCents,
        notes: notes || `Offcut return from ${order.order_code}`,
        actorId,
      });
    }

    recordStockAudit(database, actorId, 'inventory_movement', movementId, 'workshop_return', null, {
      order_id: order.id,
      order_code: order.order_code,
      warehouse: targetWarehouse,
      quantity: returnQty,
      movement_id: movementId,
    });

    return {
      movementId,
      orderCode: order.order_code,
      warehouse: targetWarehouse,
      quantity: returnQty,
      material: selectedMaterial,
      offcut: createdOffcut,
    };
  }).immediate();
}

export function reserveMaterial(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['workshopOrderId', 'materialId', 'offcutId', 'warehouse', 'quantity']);
  const workshopOrderId = positiveId(body.workshopOrderId, 'workshopOrderId');
  const warehouse = body.warehouse ?? 'main';
  const reqQuantity = quantity(body.quantity, 'quantity');

  return database.transaction(() => {
    const order = database.prepare('SELECT id, order_code FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(workshopOrderId);
    if (!order) throw new HttpError(404, 'Workshop order was not found.');

    if (warehouse === 'main') {
      const materialId = positiveId(body.materialId, 'materialId');
      const material = activeMaterial(materialId, database);
      const available = material.stock - (material.reserved_stock ?? 0);
      if (available < reqQuantity) {
        throw new HttpError(409, `Insufficient unreserved stock for ${material.code}. Available: ${available}, Requested: ${reqQuantity}`);
      }
      database.prepare('UPDATE materials SET reserved_stock = reserved_stock + ? WHERE id = ?').run(reqQuantity, materialId);
      const res = database.prepare(`
        INSERT INTO inventory_reservations (workshop_order_id, material_id, warehouse, reserved_quantity, status)
        VALUES (?, ?, 'main', ?, 'active')
      `).run(workshopOrderId, materialId, reqQuantity);
      return { id: Number(res.lastInsertRowid), workshopOrderId, materialId, reservedQuantity: reqQuantity };
    } else {
      const offcutId = positiveId(body.offcutId, 'offcutId');
      const offcut = database.prepare('SELECT * FROM secondary_warehouse_offcuts WHERE id = ?').get(offcutId);
      if (!offcut || offcut.status !== 'available') throw new HttpError(409, 'Offcut not available for reservation.');
      const res = database.prepare(`
        INSERT INTO inventory_reservations (workshop_order_id, offcut_id, warehouse, reserved_quantity, status)
        VALUES (?, ?, 'secondary', ?, 'active')
      `).run(workshopOrderId, offcutId, reqQuantity);
      return { id: Number(res.lastInsertRowid), workshopOrderId, offcutId, reservedQuantity: reqQuantity };
    }
  }).immediate();
}

export function releaseReservation(reservationId, actorId = null, database = db) {
  const id = positiveId(reservationId, 'reservationId');
  return database.transaction(() => {
    const res = database.prepare('SELECT * FROM inventory_reservations WHERE id = ?').get(id);
    if (!res || res.status !== 'active') throw new HttpError(404, 'Active reservation was not found.');
    if (res.warehouse === 'main' && res.material_id) {
      database.prepare('UPDATE materials SET reserved_stock = MAX(0, reserved_stock - ?) WHERE id = ?').run(res.reserved_quantity, res.material_id);
    }
    database.prepare("UPDATE inventory_reservations SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return { released: true, id };
  }).immediate();
}

