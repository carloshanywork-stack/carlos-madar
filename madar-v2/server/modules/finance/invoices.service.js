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
import { assertCashAvailable, insertTreasuryEntry, MAX_SAFE_CENTS, toSafeCents } from './treasury.service.js';

const PURCHASE_CATEGORY = 'مشتريات خامات ومواد';
const RECEIPT_CATEGORY = 'تحصيل مبيعات';
const MAX_QUANTITY = 1_000_000_000_000;
const INVOICE_KINDS = ['sales', 'purchase', 'other_expense'];

function positiveQuantity(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_QUANTITY) {
    throw new HttpError(400, `${label} must be a positive finite quantity.`);
  }
  return value;
}

function decimalRational(value) {
  const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole, fractional = ''] = coefficient.split('.');
  let numerator = BigInt(`${whole}${fractional}`);
  const decimalPlaces = fractional.length - exponent;
  if (decimalPlaces < 0) {
    numerator *= 10n ** BigInt(-decimalPlaces);
    return { numerator, denominator: 1n };
  }
  return { numerator, denominator: 10n ** BigInt(decimalPlaces) };
}

function calculateLineTotalCents(item) {
  const { numerator, denominator } = decimalRational(item.quantity);
  const product = numerator * BigInt(item.unitCostCents);
  if (product % denominator !== 0n) {
    throw new HttpError(400, 'Purchase line total must resolve to an integer number of cents.');
  }
  return toSafeCents(product / denominator, 'Purchase line total');
}

function nextInvoiceCode(prefix, database) {
  const rows = database.prepare('SELECT code FROM invoices WHERE code GLOB ?').all(`${prefix}-[0-9]*`);
  const largest = rows.reduce((maximum, row) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(row.code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 1000);
  return `${prefix}-${String(largest + 1).padStart(4, '0')}`;
}

function readInvoice(invoiceId, database) {
  const invoice = database.prepare(`
    SELECT invoice.*, client.code AS client_code, client.name AS client_name,
      workshop_order.order_code AS workshop_order_code
    FROM invoices invoice
    LEFT JOIN clients client ON client.id = invoice.client_id
    LEFT JOIN workshop_orders workshop_order ON workshop_order.id = invoice.workshop_order_id
    WHERE invoice.id = ?
  `).get(invoiceId);
  if (!invoice) throw new HttpError(404, 'Invoice was not found.');
  const items = database.prepare(`
    SELECT id, line_number, material_id, material_code, material_name,
      unit, quantity, unit_cost_cents, line_total_cents
    FROM invoice_items WHERE invoice_id = ? ORDER BY line_number
  `).all(invoice.id);
  return { ...invoice, items };
}

function assertActiveEmployee(employeeId, database) {
  if (employeeId === null) return;
  if (!database.prepare('SELECT 1 FROM employees WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(employeeId)) {
    throw new HttpError(404, 'Active employee was not found.');
  }
}

function normalizePurchaseItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    throw new HttpError(400, 'items must contain between 1 and 200 purchase lines.');
  }
  const seenMaterialIds = new Set();
  let total = 0n;
  const items = value.map((row, index) => {
    const item = requireObject(row, `items[${index}]`);
    allowOnlyKeys(item, ['materialId', 'quantity', 'unitCostCents']);
    const materialId = positiveId(item.materialId, `items[${index}].materialId`);
    if (seenMaterialIds.has(materialId)) {
      throw new HttpError(400, 'A material can appear only once per purchase invoice.');
    }
    seenMaterialIds.add(materialId);
    const purchaseQuantity = positiveQuantity(item.quantity, `items[${index}].quantity`);
    if (!Number.isInteger(purchaseQuantity)) {
      throw new HttpError(400, `items[${index}].quantity must be a whole-unit main-warehouse quantity.`);
    }
    const normalized = {
      materialId,
      quantity: purchaseQuantity,
      unitCostCents: nonNegativeInteger(item.unitCostCents, `items[${index}].unitCostCents`),
    };
    normalized.lineTotalCents = calculateLineTotalCents(normalized);
    total += BigInt(normalized.lineTotalCents);
    if (total > MAX_SAFE_CENTS) throw new HttpError(400, 'Purchase invoice total exceeds the safe integer-cents range.');
    return normalized;
  });
  if (total <= 0n) throw new HttpError(400, 'Purchase invoice total must be greater than zero.');
  return { items, totalCents: Number(total) };
}

export function listInvoices(kind, database = db) {
  if (kind !== undefined && !INVOICE_KINDS.includes(kind)) {
    throw new HttpError(400, `kind must be one of: ${INVOICE_KINDS.join(', ')}.`);
  }
  const filter = kind === undefined ? '' : 'AND invoice.kind = ?';
  const parameters = kind === undefined ? [] : [kind];
  return database.prepare(`
    SELECT invoice.id, invoice.code, invoice.kind, invoice.client_id,
      client.code AS client_code, client.name AS client_name,
      invoice.workshop_order_id, workshop_order.order_code AS workshop_order_code,
      invoice.supplier, invoice.employee_id, invoice.subtotal_cents,
      invoice.tax_cents, invoice.total_cents, invoice.paid_total_cents,
      invoice.remaining_cents, invoice.payment_status, invoice.status,
      invoice.notes, invoice.created_by, invoice.created_at
    FROM invoices invoice
    LEFT JOIN clients client ON client.id = invoice.client_id
    LEFT JOIN workshop_orders workshop_order ON workshop_order.id = invoice.workshop_order_id
    WHERE invoice.deleted_at IS NULL ${filter}
    ORDER BY invoice.created_at DESC, invoice.id DESC
  `).all(...parameters);
}

export function createPurchaseInvoice(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['supplier', 'employeeId', 'items', 'notes']);
  const supplier = requireText(body.supplier, 'supplier', { maxLength: 200 });
  const employeeId = body.employeeId === undefined || body.employeeId === null
    ? null
    : positiveId(body.employeeId, 'employeeId');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });
  const { items, totalCents } = normalizePurchaseItems(body.items);

  const invoiceId = database.transaction(() => {
    assertActiveEmployee(employeeId, database);
    const invoiceCode = nextInvoiceCode('PUR', database);
    const invoiceResult = database.prepare(`
      INSERT INTO invoices
        (code, kind, supplier, employee_id, subtotal_cents, tax_cents,
         total_cents, paid_total_cents, remaining_cents, payment_status,
         status, notes, created_by)
      VALUES (?, 'purchase', ?, ?, ?, 0, ?, 0, ?, 'unpaid', 'approved', ?, ?)
    `).run(invoiceCode, supplier, employeeId, totalCents, totalCents, totalCents, notes, actorId);
    const id = Number(invoiceResult.lastInsertRowid);
    const getMaterial = database.prepare(`
      SELECT id, code, name, unit, stock FROM materials
      WHERE id = ? AND active = 1 AND deleted_at IS NULL
    `);
    const insertLine = database.prepare(`
      INSERT INTO invoice_items
        (invoice_id, line_number, material_id, material_code, material_name,
         unit, quantity, unit_cost_cents, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateMaterial = database.prepare('UPDATE materials SET stock = ?, unit_cost_cents = ? WHERE id = ?');
    const insertMovement = database.prepare(`
      INSERT INTO inventory_movements
        (material_id, kind, quantity, warehouse, reference, source_type, source_id, notes, created_by)
      VALUES (?, 'purchase', ?, 'main', ?, 'manual', ?, ?, ?)
    `);
    const auditItems = [];
    for (const [index, item] of items.entries()) {
      const material = getMaterial.get(item.materialId);
      if (!material) throw new HttpError(404, `Active material ${item.materialId} was not found.`);
      if (!Number.isInteger(material.stock)) {
        throw new HttpError(409, `Main stock for ${material.code} has a fractional legacy balance; reconcile a physical stock count before receiving more.`);
      }
      const nextStock = material.stock + item.quantity;
      if (!Number.isFinite(nextStock) || nextStock > MAX_QUANTITY) {
        throw new HttpError(400, `Purchase quantity would exceed stock capacity for ${material.code}.`);
      }
      insertLine.run(
        id,
        index + 1,
        material.id,
        material.code,
        material.name,
        material.unit,
        item.quantity,
        item.unitCostCents,
        item.lineTotalCents,
      );
      updateMaterial.run(nextStock, item.unitCostCents, material.id);
      const movementId = Number(insertMovement.run(
        material.id,
        item.quantity,
        invoiceCode,
        id,
        `Supplier: ${supplier}`,
        actorId,
      ).lastInsertRowid);
      auditItems.push({
        material_id: material.id,
        material_code: material.code,
        previous_stock: material.stock,
        quantity: item.quantity,
        new_stock: nextStock,
        unit_cost_cents: item.unitCostCents,
        line_total_cents: item.lineTotalCents,
        movement_id: movementId,
      });
    }

    recordAudit({
      database,
      actorId,
      action: 'purchase_invoice',
      entityType: 'invoice',
      entityId: id,
      newValues: {
        code: invoiceCode,
        kind: 'purchase',
        supplier,
        total_cents: totalCents,
        paid_total_cents: 0,
        remaining_cents: totalCents,
        payment_status: 'unpaid',
        items: auditItems,
      },
    });
    return id;
  }).immediate();

  return readInvoice(invoiceId, database);
}

export function insertSalesInvoiceForWorkshopOrder(workshopOrderId, actorId = null, database = db) {
  const id = positiveId(workshopOrderId, 'workshopOrderId');
  const order = database.prepare(`
    SELECT id, order_code, client_id, sale_price_cents, status, sales_invoice_id
    FROM workshop_orders WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!order) throw new HttpError(404, 'Workshop order was not found.');
  if (order.status !== 'ready') throw new HttpError(409, 'Only ready workshop orders can be invoiced on delivery.');
  if (order.sales_invoice_id !== null) throw new HttpError(409, 'Workshop order already has a sales invoice.');
  const existing = database.prepare(`
    SELECT id FROM invoices WHERE workshop_order_id = ? AND kind = 'sales' AND deleted_at IS NULL
  `).get(id);
  if (existing) throw new HttpError(409, 'Workshop order already has a sales invoice.');
  const totalCents = nonNegativeInteger(order.sale_price_cents, 'sale_price_cents');
  const code = nextInvoiceCode('INV', database);
  const result = database.prepare(`
    INSERT INTO invoices
      (code, kind, client_id, workshop_order_id, subtotal_cents, tax_cents,
       total_cents, paid_total_cents, remaining_cents, payment_status,
       status, notes, created_by)
    VALUES (?, 'sales', ?, ?, ?, 0, ?, 0, ?, 'unpaid', 'approved', ?, ?)
  `).run(
    code,
    order.client_id,
    order.id,
    totalCents,
    totalCents,
    totalCents,
    `Automated invoice for workshop order ${order.order_code}`,
    actorId,
  );
  const invoiceId = Number(result.lastInsertRowid);
  recordAudit({
    database,
    actorId,
    action: 'create_sales_invoice',
    entityType: 'invoice',
    entityId: invoiceId,
    newValues: {
      code,
      client_id: order.client_id,
      workshop_order_id: order.id,
      total_cents: totalCents,
      paid_total_cents: 0,
      remaining_cents: totalCents,
      payment_status: 'unpaid',
    },
  });
  return readInvoice(invoiceId, database);
}

export function recordPurchasePayment(invoiceId, input, actorId = null, database = db) {
  const id = positiveId(invoiceId, 'invoiceId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['amountCents', 'notes']);
  const amountCents = nonNegativeInteger(body.amountCents, 'amountCents');
  if (amountCents < 1) throw new HttpError(400, 'amountCents must be greater than zero.');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  const result = database.transaction(() => {
    const invoice = database.prepare(`
      SELECT id, code, kind, status, supplier, employee_id,
        total_cents, paid_total_cents, remaining_cents
      FROM invoices WHERE id = ? AND deleted_at IS NULL
    `).get(id);
    if (!invoice) throw new HttpError(404, 'Invoice was not found.');
    if (invoice.kind !== 'purchase' || invoice.status !== 'approved') {
      throw new HttpError(409, 'Payments can only be applied to approved purchase invoices.');
    }
    if (amountCents > invoice.remaining_cents) {
      throw new HttpError(409, 'Payment amount cannot exceed the invoice remaining balance.');
    }
    const paidCents = BigInt(invoice.paid_total_cents) + BigInt(amountCents);
    if (paidCents > MAX_SAFE_CENTS || paidCents > BigInt(invoice.total_cents)) {
      throw new HttpError(400, 'Payment would exceed the invoice total or safe integer-cents range.');
    }
    assertCashAvailable(amountCents, database);
    const remainingCents = BigInt(invoice.total_cents) - paidCents;
    const paymentStatus = remainingCents === 0n ? 'paid' : paidCents === 0n ? 'unpaid' : 'partial';
    database.prepare(`
      UPDATE invoices
      SET paid_total_cents = ?, remaining_cents = ?, payment_status = ?
      WHERE id = ?
    `).run(Number(paidCents), Number(remainingCents), paymentStatus, id);
    const treasuryEntryId = insertTreasuryEntry({
      database,
      kind: 'expense',
      category: PURCHASE_CATEGORY,
      amountCents,
      invoiceId: id,
      employeeId: invoice.employee_id,
      reference: invoice.code,
      notes: notes ?? invoice.supplier,
      actorId,
    });
    recordAudit({
      database,
      actorId,
      action: 'purchase_payment',
      entityType: 'invoice',
      entityId: id,
      oldValues: {
        paid_total_cents: invoice.paid_total_cents,
        remaining_cents: invoice.remaining_cents,
        payment_status: invoice.remaining_cents === invoice.total_cents ? 'unpaid' : 'partial',
      },
      newValues: {
        paid_total_cents: Number(paidCents),
        remaining_cents: Number(remainingCents),
        payment_status: paymentStatus,
        treasury_entry_id: treasuryEntryId,
      },
    });
    return { treasuryEntryId };
  }).immediate();

  return {
    invoice: readInvoice(id, database),
    treasuryEntry: database.prepare('SELECT * FROM treasury_entries WHERE id = ?').get(result.treasuryEntryId),
  };
}

export function recordSalesReceipt(invoiceId, input, actorId = null, database = db) {
  const id = positiveId(invoiceId, 'invoiceId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['amountCents', 'notes']);
  const amountCents = nonNegativeInteger(body.amountCents, 'amountCents');
  if (amountCents < 1) throw new HttpError(400, 'amountCents must be greater than zero.');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  const result = database.transaction(() => {
    const invoice = database.prepare(`
      SELECT id, code, kind, status, total_cents, paid_total_cents, remaining_cents
      FROM invoices WHERE id = ? AND deleted_at IS NULL
    `).get(id);
    if (!invoice) throw new HttpError(404, 'Invoice was not found.');
    if (invoice.kind !== 'sales' || invoice.status !== 'approved') {
      throw new HttpError(409, 'Receipts can only be applied to approved sales invoices.');
    }
    if (amountCents > invoice.remaining_cents) {
      throw new HttpError(409, 'Receipt amount cannot exceed the invoice remaining balance.');
    }
    const paidCents = BigInt(invoice.paid_total_cents) + BigInt(amountCents);
    if (paidCents > MAX_SAFE_CENTS || paidCents > BigInt(invoice.total_cents)) {
      throw new HttpError(400, 'Receipt would exceed the invoice total or safe integer-cents range.');
    }
    const remainingCents = BigInt(invoice.total_cents) - paidCents;
    const paymentStatus = remainingCents === 0n ? 'paid' : paidCents === 0n ? 'unpaid' : 'partial';
    database.prepare(`
      UPDATE invoices
      SET paid_total_cents = ?, remaining_cents = ?, payment_status = ?
      WHERE id = ?
    `).run(Number(paidCents), Number(remainingCents), paymentStatus, id);
    const treasuryEntryId = insertTreasuryEntry({
      database,
      kind: 'income',
      category: RECEIPT_CATEGORY,
      amountCents,
      invoiceId: id,
      reference: invoice.code,
      notes,
      actorId,
    });
    recordAudit({
      database,
      actorId,
      action: 'sales_receipt',
      entityType: 'invoice',
      entityId: id,
      oldValues: {
        paid_total_cents: invoice.paid_total_cents,
        remaining_cents: invoice.remaining_cents,
        payment_status: invoice.remaining_cents === invoice.total_cents ? 'unpaid' : 'partial',
      },
      newValues: {
        paid_total_cents: Number(paidCents),
        remaining_cents: Number(remainingCents),
        payment_status: paymentStatus,
        treasury_entry_id: treasuryEntryId,
      },
    });
    return { treasuryEntryId };
  }).immediate();

  return {
    invoice: readInvoice(id, database),
    treasuryEntry: database.prepare('SELECT * FROM treasury_entries WHERE id = ?').get(result.treasuryEntryId),
  };
}
