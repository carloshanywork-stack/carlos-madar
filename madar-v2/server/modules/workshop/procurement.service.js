import { createHash } from 'node:crypto';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
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
import { getWorkshopOrderCosting } from './costing.js';
import { assertCashAvailable, getCashBalanceCents, insertTreasuryEntry } from '../finance/treasury.service.js';
import { nextInvoiceCode } from '../finance/invoices.service.js';

const PURCHASE_CATEGORY = 'مشتريات خامات ومواد';

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new HttpError(400, `${label} must be a positive number.`);
  }
  return number;
}

function nextCode(prefix, tableName, column, database) {
  const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
  const pattern = `${prefix}-${yearMonth}-%`;
  const existing = database.prepare(`
    SELECT ${column} AS code FROM ${tableName}
    WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1
  `).get(pattern);
  let nextSeq = 1;
  if (existing?.code) {
    const parts = existing.code.split('-');
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq)) nextSeq = seq + 1;
  }
  return `${prefix}-${yearMonth}-${String(nextSeq).padStart(4, '0')}`;
}

export function createPurchaseRequest(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['workshopOrderId', 'materialId', 'requestedQuantity', 'notes']);
  const workshopOrderId = body.workshopOrderId ? positiveId(body.workshopOrderId, 'workshopOrderId') : null;
  const materialId = positiveId(body.materialId, 'materialId');
  const requestedQuantity = positiveNumber(body.requestedQuantity, 'requestedQuantity');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  const material = database.prepare('SELECT id, code, name FROM materials WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(materialId);
  if (!material) throw new HttpError(404, 'Active material was not found.');

  if (workshopOrderId) {
    const order = database.prepare('SELECT id, order_code FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(workshopOrderId);
    if (!order) throw new HttpError(404, 'Workshop order was not found.');
  }

  const requestCode = nextCode('PR', 'purchase_requests', 'request_code', database);
  const result = database.prepare(`
    INSERT INTO purchase_requests (request_code, workshop_order_id, material_id, requested_quantity, status, notes, created_by)
    VALUES (?, ?, ?, ?, 'draft', ?, ?)
  `).run(requestCode, workshopOrderId, materialId, requestedQuantity, notes, actorId);

  return database.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(result.lastInsertRowid);
}

export function listPurchaseRequests({ workshopOrderId = null, status = null } = {}, database = db) {
  const conditions = [];
  const params = [];
  if (workshopOrderId) {
    conditions.push('pr.workshop_order_id = ?');
    params.push(workshopOrderId);
  }
  if (status) {
    conditions.push('pr.status = ?');
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return database.prepare(`
    SELECT pr.*, m.code AS material_code, m.name AS material_name, m.unit AS material_unit,
      wo.order_code AS workshop_order_code
    FROM purchase_requests AS pr
    JOIN materials AS m ON m.id = pr.material_id
    LEFT JOIN workshop_orders AS wo ON wo.id = pr.workshop_order_id
    ${where}
    ORDER BY pr.id DESC
  `).all(...params);
}

export function createPurchaseOrder(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['supplier', 'workshopOrderId', 'expectedDate', 'notes', 'items']);
  const supplier = requireText(body.supplier, 'supplier', { maxLength: 200 });
  const workshopOrderId = body.workshopOrderId ? positiveId(body.workshopOrderId, 'workshopOrderId') : null;
  const expectedDate = body.expectedDate ? isoDate(body.expectedDate, 'expectedDate') : null;
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, 'items must be a non-empty array of purchase order items.');
  }

  return database.transaction(() => {
    if (workshopOrderId) {
      const order = database.prepare('SELECT id, order_code FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(workshopOrderId);
      if (!order) throw new HttpError(404, 'Workshop order was not found.');
    }

    let calculatedTotalCents = 0;
    const validatedItems = body.items.map((it, idx) => {
      const materialId = positiveId(it.materialId, `items[${idx}].materialId`);
      const quantity = positiveNumber(it.quantity, `items[${idx}].quantity`);
      const unitCostCents = nonNegativeInteger(it.unitCostCents, `items[${idx}].unitCostCents`);
      const lineTotal = Math.round(quantity * unitCostCents);
      calculatedTotalCents += lineTotal;
      const purchaseRequestId = it.purchaseRequestId ? positiveId(it.purchaseRequestId, `items[${idx}].purchaseRequestId`) : null;
      return { materialId, quantity, unitCostCents, lineTotalCents: lineTotal, purchaseRequestId };
    });

    const poCode = nextCode('PO', 'purchase_orders', 'po_code', database);
    const poResult = database.prepare(`
      INSERT INTO purchase_orders (po_code, supplier, workshop_order_id, status, expected_date, total_cents, notes, created_by)
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(poCode, supplier, workshopOrderId, expectedDate, calculatedTotalCents, notes, actorId);
    const poId = Number(poResult.lastInsertRowid);

    const insertItem = database.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, material_id, purchase_request_id, quantity, unit_cost_cents, line_total_cents, received_quantity)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    for (const item of validatedItems) {
      insertItem.run(poId, item.materialId, item.purchaseRequestId, item.quantity, item.unitCostCents, item.lineTotalCents);
      if (item.purchaseRequestId) {
        database.prepare("UPDATE purchase_requests SET status = 'converted_to_po' WHERE id = ?").run(item.purchaseRequestId);
      }
    }

    recordAudit({
      database,
      actorId,
      action: 'create_purchase_order',
      entityType: 'purchase_order',
      entityId: poId,
      newValues: { poCode, supplier, workshopOrderId, totalCents: calculatedTotalCents, itemsCount: validatedItems.length },
    });

    return readPurchaseOrder(poId, database);
  }).immediate();
}

export function approvePurchaseOrder(id, actorId = null, database = db) {
  const poId = positiveId(id, 'purchaseOrderId');
  const po = database.prepare('SELECT id, status FROM purchase_orders WHERE id = ?').get(poId);
  if (!po) throw new HttpError(404, 'Purchase order was not found.');
  if (po.status !== 'draft') throw new HttpError(409, `Only draft purchase orders can be approved (current: ${po.status}).`);

  database.prepare(`
    UPDATE purchase_orders
    SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(actorId, poId);

  recordAudit({
    database,
    actorId,
    action: 'approve_purchase_order',
    entityType: 'purchase_order',
    entityId: poId,
  });

  return readPurchaseOrder(poId, database);
}

export function readPurchaseOrder(id, database = db) {
  const poId = positiveId(id, 'purchaseOrderId');
  const po = database.prepare(`
    SELECT po.*, wo.order_code AS workshop_order_code
    FROM purchase_orders AS po
    LEFT JOIN workshop_orders AS wo ON wo.id = po.workshop_order_id
    WHERE po.id = ?
  `).get(poId);
  if (!po) throw new HttpError(404, 'Purchase order was not found.');

  const items = database.prepare(`
    SELECT poi.*, m.code AS material_code, m.name AS material_name, m.unit AS material_unit
    FROM purchase_order_items AS poi
    JOIN materials AS m ON m.id = poi.material_id
    WHERE poi.purchase_order_id = ?
    ORDER BY poi.id ASC
  `).all(poId);

  const receipts = database.prepare(`
    SELECT gr.* FROM goods_receipts AS gr
    WHERE gr.purchase_order_id = ?
    ORDER BY gr.id DESC
  `).all(poId);

  return { ...po, items, receipts };
}

export function listPurchaseOrders({ workshopOrderId = null, status = null } = {}, database = db) {
  const conditions = [];
  const params = [];
  if (workshopOrderId) {
    conditions.push('po.workshop_order_id = ?');
    params.push(workshopOrderId);
  }
  if (status) {
    conditions.push('po.status = ?');
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return database.prepare(`
    SELECT po.*, wo.order_code AS workshop_order_code,
      COUNT(poi.id) AS items_count
    FROM purchase_orders AS po
    LEFT JOIN workshop_orders AS wo ON wo.id = po.workshop_order_id
    LEFT JOIN purchase_order_items AS poi ON poi.purchase_order_id = po.id
    ${where}
    GROUP BY po.id
    ORDER BY po.id DESC
  `).all(...params);
}

export function createGoodsReceipt(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['purchaseOrderId', 'notes', 'items']);
  const purchaseOrderId = positiveId(body.purchaseOrderId, 'purchaseOrderId');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, 'items must be a non-empty array of goods receipt items.');
  }

  return database.transaction(() => {
    const po = database.prepare(`
      SELECT id, po_code, status, workshop_order_id FROM purchase_orders WHERE id = ?
    `).get(purchaseOrderId);
    if (!po) throw new HttpError(404, 'Purchase order was not found.');
    if (!['approved', 'partially_received'].includes(po.status)) {
      throw new HttpError(409, `Receipts can only be posted for approved or partially received purchase orders (current: ${po.status}).`);
    }

    const receiptCode = nextCode('GRN', 'goods_receipts', 'receipt_code', database);
    const grResult = database.prepare(`
      INSERT INTO goods_receipts (receipt_code, purchase_order_id, status, received_by, notes)
      VALUES (?, ?, 'confirmed', ?, ?)
    `).run(receiptCode, po.id, actorId, notes);
    const grId = Number(grResult.lastInsertRowid);

    const getPoItem = database.prepare(`
      SELECT poi.*, m.code AS material_code, m.stock, m.unit_cost_cents AS material_unit_cost_cents
      FROM purchase_order_items AS poi
      JOIN materials AS m ON m.id = poi.material_id
      WHERE poi.id = ? AND poi.purchase_order_id = ?
    `);

    const updatePoItem = database.prepare(`
      UPDATE purchase_order_items
      SET received_quantity = received_quantity + ?
      WHERE id = ?
    `);

    const insertGrItem = database.prepare(`
      INSERT INTO goods_receipt_items (goods_receipt_id, po_item_id, material_id, quantity_received, quantity_accepted, quantity_rejected, warehouse, inventory_movement_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMovement = database.prepare(`
      INSERT INTO inventory_movements (material_id, kind, quantity, warehouse, unit_cost_cents, reference, source_type, source_id, notes, created_by)
      VALUES (?, 'purchase', ?, ?, ?, ?, NULL, ?, ?, ?)
    `);

    const updateMaterial = database.prepare(`
      UPDATE materials SET stock = stock + ?, unit_cost_cents = ? WHERE id = ?
    `);

    for (const [idx, item] of body.items.entries()) {
      const poItemId = positiveId(item.poItemId, `items[${idx}].poItemId`);
      const poItem = getPoItem.get(poItemId, po.id);
      if (!poItem) throw new HttpError(404, `Purchase order line ${poItemId} was not found on this PO.`);

      const quantityReceived = positiveNumber(item.quantityReceived ?? item.quantityAccepted, `items[${idx}].quantityReceived`);
      const quantityAccepted = item.quantityAccepted !== undefined ? Number(item.quantityAccepted) : quantityReceived;
      const quantityRejected = item.quantityRejected !== undefined ? Number(item.quantityRejected) : Math.max(0, quantityReceived - quantityAccepted);

      if (quantityAccepted < 0 || quantityRejected < 0 || quantityAccepted > quantityReceived) {
        throw new HttpError(400, `Accepted/rejected quantities are invalid for line ${poItemId}.`);
      }

      // Check over-receipt against outstanding quantity
      const outstanding = poItem.quantity - poItem.received_quantity;
      if (quantityAccepted > outstanding) {
        throw new HttpError(409, `Over-receipt prohibited: accepted quantity (${quantityAccepted}) exceeds remaining outstanding PO line quantity (${outstanding}).`);
      }

      const warehouse = item.warehouse === 'secondary' ? 'secondary' : 'main';
      let movementId = null;

      if (quantityAccepted > 0) {
        // Calculate moving weighted average unit cost:
        // (currentStock * currentCost + receivedQty * itemUnitCostCents) / totalQty
        const currentMat = database.prepare(`
          SELECT stock, unit_cost_cents, weighted_average_cost_cents
          FROM materials WHERE id = ?
        `).get(poItem.material_id);

        const currentStock = Number(currentMat?.stock || 0);
        const currentCost = Number(currentMat?.weighted_average_cost_cents ?? currentMat?.unit_cost_cents ?? 0);
        const receivedQty = quantityAccepted;
        const itemUnitCostCents = Number(poItem.unit_cost_cents || 0);
        const totalQty = currentStock + receivedQty;
        const weightedAvgCost = totalQty > 0
          ? Math.round(((currentStock * currentCost) + (receivedQty * itemUnitCostCents)) / totalQty)
          : itemUnitCostCents;

        database.prepare(`
          UPDATE materials
          SET stock = stock + ?,
              unit_cost_cents = ?,
              weighted_average_cost_cents = ?
          WHERE id = ?
        `).run(receivedQty, weightedAvgCost, weightedAvgCost, poItem.material_id);

        const movResult = insertMovement.run(
          poItem.material_id,
          quantityAccepted,
          warehouse,
          poItem.unit_cost_cents,
          receiptCode,
          po.id,
          `PO: ${po.po_code} - Receipt: ${receiptCode}`,
          actorId,
        );
        movementId = Number(movResult.lastInsertRowid);
        updatePoItem.run(quantityAccepted, poItemId);
      }

      insertGrItem.run(
        grId,
        poItemId,
        poItem.material_id,
        quantityReceived,
        quantityAccepted,
        quantityRejected,
        warehouse,
        movementId,
      );
    }

    // Determine if all lines are fully received
    const allPoItems = database.prepare('SELECT quantity, received_quantity FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id);
    const fullyReceived = allPoItems.every((it) => it.received_quantity >= it.quantity);
    database.prepare(`
      UPDATE purchase_orders
      SET status = ?
      WHERE id = ?
    `).run(fullyReceived ? 'received' : 'partially_received', po.id);

    recordAudit({
      database,
      actorId,
      action: 'create_goods_receipt',
      entityType: 'goods_receipt',
      entityId: grId,
      newValues: { receiptCode, purchaseOrderId: po.id, fullyReceived },
    });

    return readGoodsReceipt(grId, database);
  }).immediate();
}

export function readGoodsReceipt(id, database = db) {
  const grId = positiveId(id, 'goodsReceiptId');
  const receipt = database.prepare(`
    SELECT gr.*, po.po_code, po.supplier, po.workshop_order_id
    FROM goods_receipts AS gr
    JOIN purchase_orders AS po ON po.id = gr.purchase_order_id
    WHERE gr.id = ?
  `).get(grId);
  if (!receipt) throw new HttpError(404, 'Goods receipt was not found.');

  const items = database.prepare(`
    SELECT gri.*, m.code AS material_code, m.name AS material_name, m.unit AS material_unit
    FROM goods_receipt_items AS gri
    JOIN materials AS m ON m.id = gri.material_id
    WHERE gri.goods_receipt_id = ?
  `).all(grId);

  return { ...receipt, items };
}

export function listGoodsReceipts({ purchaseOrderId = null } = {}, database = db) {
  const conditions = [];
  const params = [];
  if (purchaseOrderId) {
    conditions.push('gr.purchase_order_id = ?');
    params.push(purchaseOrderId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return database.prepare(`
    SELECT gr.*, po.po_code, po.supplier, po.workshop_order_id,
      COUNT(gri.id) AS items_count,
      SUM(gri.quantity_accepted) AS total_accepted_quantity
    FROM goods_receipts AS gr
    JOIN purchase_orders AS po ON po.id = gr.purchase_order_id
    LEFT JOIN goods_receipt_items AS gri ON gri.goods_receipt_id = gr.id
    ${where}
    GROUP BY gr.id
    ORDER BY gr.id DESC
  `).all(...params);
}

export function getWorkshopOrderTrace(orderId, database = db) {
  const id = positiveId(orderId, 'workshopOrderId');
  const order = database.prepare(`
    SELECT wo.*, c.name AS client_name, c.code AS client_code
    FROM workshop_orders AS wo
    JOIN clients AS c ON c.id = wo.client_id
    WHERE wo.id = ? AND wo.deleted_at IS NULL
  `).get(id);
  if (!order) throw new HttpError(404, 'Workshop order was not found.');

  // Quotation & Snapshot
  let quotation = null;
  let snapshot = null;
  if (order.quotation_id) {
    quotation = database.prepare('SELECT * FROM product_quotations WHERE id = ?').get(order.quotation_id);
    snapshot = database.prepare(`
      SELECT * FROM quotation_snapshots WHERE quotation_id = ? ORDER BY version_number DESC LIMIT 1
    `).get(order.quotation_id);
    if (snapshot?.snapshot_payload_json) {
      try { snapshot.payload = JSON.parse(snapshot.snapshot_payload_json); } catch {}
    }
  }

  // Reservations
  const reservations = database.prepare(`
    SELECT r.*, m.code AS material_code, m.name AS material_name
    FROM inventory_reservations AS r
    LEFT JOIN materials AS m ON m.id = r.material_id
    WHERE r.workshop_order_id = ?
  `).all(id);

  // Procurement
  const purchaseRequests = database.prepare(`
    SELECT pr.*, m.code AS material_code, m.name AS material_name
    FROM purchase_requests AS pr
    JOIN materials AS m ON m.id = pr.material_id
    WHERE pr.workshop_order_id = ?
  `).all(id);

  const purchaseOrders = database.prepare(`
    SELECT po.* FROM purchase_orders AS po
    WHERE po.workshop_order_id = ?
    ORDER BY po.id ASC
  `).all(id);

  for (const po of purchaseOrders) {
    po.items = database.prepare(`
      SELECT poi.*, m.code AS material_code, m.name AS material_name
      FROM purchase_order_items AS poi
      JOIN materials AS m ON m.id = poi.material_id
      WHERE poi.purchase_order_id = ?
    `).all(po.id);
    po.receipts = database.prepare(`
      SELECT gr.* FROM goods_receipts AS gr WHERE gr.purchase_order_id = ?
    `).all(po.id);
  }

  // Matched Invoices & Payments
  const supplierInvoices = database.prepare(`
    SELECT inv.* FROM invoices AS inv
    WHERE inv.workshop_order_id = ? AND inv.kind = 'purchase' AND inv.deleted_at IS NULL
  `).all(id);

  for (const inv of supplierInvoices) {
    inv.payments = database.prepare(`
      SELECT te.* FROM treasury_entries AS te WHERE te.invoice_id = ?
    `).all(inv.id);
  }

  // Production Stage Logs & Inspections
  const stageLogs = database.prepare(`
    SELECT wsl.*, emp.name AS employee_name
    FROM workshop_stage_logs AS wsl
    JOIN employees AS emp ON emp.id = wsl.employee_id
    WHERE wsl.order_id = ?
    ORDER BY wsl.id ASC
  `).all(id);

  const inspections = database.prepare(`
    SELECT wqi.*, u.full_name AS inspector_name
    FROM workshop_quality_inspections AS wqi
    JOIN users AS u ON u.id = wqi.inspector_user_id
    WHERE wqi.order_id = ?
    ORDER BY wqi.id ASC
  `).all(id);

  // Material movements (issued & returned)
  const materialMovements = database.prepare(`
    SELECT im.*, m.code AS material_code, m.name AS material_name
    FROM inventory_movements AS im
    LEFT JOIN materials AS m ON m.id = im.material_id
    WHERE im.source_id = ? AND im.source_type = 'workshop_order'
    ORDER BY im.id ASC
  `).all(id);

  // Sales Invoice & Customer Payments
  const salesInvoice = database.prepare(`
    SELECT inv.* FROM invoices AS inv
    WHERE inv.workshop_order_id = ? AND inv.kind = 'sales' AND inv.deleted_at IS NULL
  `).get(id);

  let customerReceipts = [];
  if (salesInvoice) {
    customerReceipts = database.prepare(`
      SELECT te.* FROM treasury_entries AS te WHERE te.invoice_id = ?
    `).all(salesInvoice.id);
  }

  // Costing & Variance Analysis
  const costing = getWorkshopOrderCosting(id, database);

  return {
    order,
    quotation,
    snapshot,
    reservations,
    procurement: {
      requests: purchaseRequests,
      purchaseOrders,
      supplierInvoices,
    },
    production: {
      stageLogs,
      inspections,
      materialMovements,
    },
    salesAndTreasury: {
      salesInvoice,
      customerReceipts,
    },
    costing,
    costingVariance: costing?.variance ?? null,
    quotationSnapshot: snapshot,
    purchaseRequests,
    purchaseOrders,
    matchedInvoices: supplierInvoices,
    stageLogs,
    qaInspections: inspections,
    offcutCredits: costing?.offcutCreditsCents ?? 0,
  };
}

export function cashPurchase(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, [
    'supplier',
    'supplierId',
    'materialId',
    'quantity',
    'unitCostCents',
    'warehouse',
    'warehouseId',
    'notes',
    'operationId',
    'workshopOrderId',
  ]);

  const supplier = body.supplier
    ? requireText(body.supplier, 'supplier', { maxLength: 200 })
    : body.supplierId !== undefined && body.supplierId !== null
      ? String(body.supplierId)
      : 'مورد نقدي مباشر';

  const materialId = positiveId(body.materialId, 'materialId');
  const quantity = positiveNumber(body.quantity, 'quantity');
  const unitCostCents = nonNegativeInteger(body.unitCostCents, 'unitCostCents');
  const totalCostCents = Math.round(quantity * unitCostCents);
  const warehouse = (body.warehouseId === 'secondary' || body.warehouse === 'secondary') ? 'secondary' : 'main';
  const workshopOrderId = body.workshopOrderId ? positiveId(body.workshopOrderId, 'workshopOrderId') : null;
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  const operationId = body.operationId;

  // Validate operationId if provided
  let opId = null;
  let payloadSha256 = null;
  if (operationId !== undefined && operationId !== null) {
    if (typeof operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
      throw new HttpError(400, 'operationId must be a UUID v4.');
    }
    opId = operationId.toLowerCase();
    const payload = JSON.stringify({
      operationType: 'cash_purchase',
      materialId,
      quantity,
      unitCostCents,
      warehouse,
      supplier,
      workshopOrderId,
    });
    payloadSha256 = createHash('sha256').update(payload).digest('hex');

    // Check if operation already executed (Idempotency check)
    const existing = database.prepare(`
      SELECT actor_id, operation_type, invoice_id, payload_sha256, response_json
      FROM finance_settlement_operations WHERE operation_id = ?
    `).get(opId);
    if (existing) {
      if (existing.payload_sha256 !== payloadSha256) {
        throw new HttpError(409, 'operationId was already used for different financial content.', {
          apiCode: 'FINANCE_OPERATION_ID_CONFLICT',
        });
      }
      return { ...JSON.parse(existing.response_json), idempotent: true };
    }
  }

  // Pre-flight checks before transaction
  const material = database.prepare('SELECT id, code, name, unit, stock, unit_cost_cents FROM materials WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(materialId);
  if (!material) throw new HttpError(404, 'Active material was not found.');

  if (workshopOrderId) {
    const order = database.prepare('SELECT id, order_code FROM workshop_orders WHERE id = ? AND deleted_at IS NULL').get(workshopOrderId);
    if (!order) throw new HttpError(404, 'Workshop order was not found.');
  }

  // Ensure cash available in treasury
  assertCashAvailable(totalCostCents, database);

  const effectiveActorId = actorId || database.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get()?.id || 1;

  return database.transaction(() => {
    // Double check idempotency inside transaction
    if (opId) {
      const existing = database.prepare(`
        SELECT actor_id, operation_type, invoice_id, payload_sha256, response_json
        FROM finance_settlement_operations WHERE operation_id = ?
      `).get(opId);
      if (existing) {
        if (existing.payload_sha256 !== payloadSha256) {
          throw new HttpError(409, 'operationId was already used for different financial content.', {
            apiCode: 'FINANCE_OPERATION_ID_CONFLICT',
          });
        }
        return { ...JSON.parse(existing.response_json), idempotent: true };
      }
    }

    // 1. Create Purchase Order in status 'received'
    const poCode = nextCode('PO', 'purchase_orders', 'po_code', database);
    const poResult = database.prepare(`
      INSERT INTO purchase_orders (po_code, supplier, workshop_order_id, status, expected_date, total_cents, notes, created_by, approved_by, approved_at)
      VALUES (?, ?, ?, 'received', CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(poCode, supplier, workshopOrderId, totalCostCents, notes, effectiveActorId, effectiveActorId);
    const poId = Number(poResult.lastInsertRowid);

    const poItemResult = database.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, material_id, purchase_request_id, quantity, unit_cost_cents, line_total_cents, received_quantity)
      VALUES (?, ?, NULL, ?, ?, ?, ?)
    `).run(poId, materialId, quantity, unitCostCents, totalCostCents, quantity);
    const poItemId = Number(poItemResult.lastInsertRowid);

    // 2. Create Goods Receipt (GRN) in status 'confirmed', incrementing stock only in target warehouse
    const receiptCode = nextCode('GRN', 'goods_receipts', 'receipt_code', database);
    const grResult = database.prepare(`
      INSERT INTO goods_receipts (receipt_code, purchase_order_id, status, received_by, notes)
      VALUES (?, ?, 'confirmed', ?, ?)
    `).run(receiptCode, poId, effectiveActorId, notes);
    const grId = Number(grResult.lastInsertRowid);

    // Calculate moving weighted average unit cost for direct cash purchase
    const currentMat = database.prepare(`
      SELECT stock, unit_cost_cents, weighted_average_cost_cents
      FROM materials WHERE id = ?
    `).get(materialId);

    const currentStock = Number(currentMat?.stock || 0);
    const currentCost = Number(currentMat?.weighted_average_cost_cents ?? currentMat?.unit_cost_cents ?? 0);
    const receivedQty = quantity;
    const itemUnitCostCents = unitCostCents;
    const totalQty = currentStock + receivedQty;
    const weightedAvgCost = totalQty > 0
      ? Math.round(((currentStock * currentCost) + (receivedQty * itemUnitCostCents)) / totalQty)
      : itemUnitCostCents;

    // Increment stock and update weighted average cost in materials
    database.prepare(`
      UPDATE materials
      SET stock = stock + ?,
          unit_cost_cents = ?,
          weighted_average_cost_cents = ?
      WHERE id = ?
    `).run(receivedQty, weightedAvgCost, weightedAvgCost, materialId);

    // Record inventory movement
    const movResult = database.prepare(`
      INSERT INTO inventory_movements (material_id, kind, quantity, warehouse, unit_cost_cents, reference, source_type, source_id, notes, created_by)
      VALUES (?, 'purchase', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      materialId,
      quantity,
      warehouse,
      unitCostCents,
      receiptCode,
      workshopOrderId ? 'workshop_order' : null,
      workshopOrderId ?? null,
      notes ?? `شراء نقدي مباشر: ${poCode}`,
      effectiveActorId,
    );
    const movementId = Number(movResult.lastInsertRowid);

    database.prepare(`
      INSERT INTO goods_receipt_items (goods_receipt_id, po_item_id, material_id, quantity_received, quantity_accepted, quantity_rejected, warehouse, inventory_movement_id)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(grId, poItemId, materialId, quantity, quantity, warehouse, movementId);

    // 3. Create Matched Purchase Invoice in status 'paid' (marked matched to GRN/PO to ensure ZERO duplicate stock increment)
    const invoiceCode = nextInvoiceCode('PUR', database);
    const invResult = database.prepare(`
      INSERT INTO invoices
        (code, kind, supplier, purchase_order_id, goods_receipt_id, workshop_order_id,
         subtotal_cents, tax_cents, total_cents, paid_total_cents, remaining_cents,
         payment_status, status, notes, created_by)
      VALUES (?, 'purchase', ?, ?, ?, ?, ?, 0, ?, ?, 0, 'paid', 'approved', ?, ?)
    `).run(invoiceCode, supplier, poId, grId, workshopOrderId, totalCostCents, totalCostCents, totalCostCents, notes, effectiveActorId);
    const invoiceId = Number(invResult.lastInsertRowid);

    database.prepare(`
      INSERT INTO invoice_items
        (invoice_id, line_number, material_id, material_code, material_name, unit, quantity, unit_cost_cents, line_total_cents)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceId, material.id, material.code, material.name, material.unit, quantity, unitCostCents, totalCostCents);

    // 4. Disburse cash from treasury
    const treasuryEntryId = insertTreasuryEntry({
      database,
      kind: 'expense',
      category: PURCHASE_CATEGORY,
      amountCents: totalCostCents,
      invoiceId,
      reference: invoiceCode,
      notes: notes ?? `شراء نقدي مباشر: ${supplier}`,
      actorId: effectiveActorId,
    });

    // 5. Audit log
    recordAudit({
      database,
      actorId: effectiveActorId,
      action: 'cash_purchase',
      entityType: 'goods_receipt',
      entityId: grId,
      newValues: {
        poCode,
        receiptCode,
        invoiceCode,
        materialId,
        quantity,
        unitCostCents,
        totalCostCents,
        warehouse,
        treasuryEntryId,
      },
    });

    const updatedMaterial = database.prepare('SELECT stock FROM materials WHERE id = ?').get(materialId);
    const cashBalance = getCashBalanceCents(database);

    const response = {
      success: true,
      purchaseOrderId: poId,
      poCode,
      goodsReceiptId: grId,
      receiptCode,
      invoiceId,
      invoiceCode,
      transactionId: treasuryEntryId,
      treasuryEntryId,
      newStock: updatedMaterial.stock,
      cashBalanceCents: cashBalance,
      materialId,
      quantity,
      unitCostCents,
      totalCostCents,
    };

    // 6. Store operation in finance_settlement_operations if operationId provided
    if (opId) {
      database.prepare(`
        INSERT INTO finance_settlement_operations
          (operation_id, actor_id, operation_type, invoice_id, payload_sha256, response_json)
        VALUES (?, ?, 'purchase_payment', ?, ?, ?)
      `).run(opId, effectiveActorId, invoiceId, payloadSha256, JSON.stringify(response));
    }

    return response;
  }).immediate();
}

