import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { insertSalesInvoiceForWorkshopOrder } from '../finance/invoices.service.js';
import {
  allowOnlyKeys,
  HttpError,
  integerIdArray,
  isoDate,
  nonNegativeInteger,
  optionalText,
  positiveId,
  requireObject,
  requireText,
  safeOriginalName,
} from '../http.js';
import { removeStorageFile, storageDirectory, writeStorageFile } from '../storage.js';

const WORKSHOP_STATUSES = ['in_production', 'ready', 'delivered_archived'];
const MACHINE_TYPES = ['cnc_router', 'laser', 'both', 'manual'];
const DESIGN_EXTENSIONS = new Set(['.dxf', '.cdr', '.ai', '.pdf']);

function findWorkshopOrder(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  const order = database.prepare(`
    SELECT order_record.*, client.code AS client_code, client.name AS client_name
    FROM workshop_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.id = ? AND order_record.deleted_at IS NULL
  `).get(id);
  if (!order) throw new HttpError(404, 'Workshop order was not found.');
  return order;
}

function nextOrderCode(database) {
  const orderCodes = database.prepare("SELECT order_code FROM workshop_orders WHERE order_code GLOB 'MFG-[0-9]*'").all();
  const largest = orderCodes.reduce((maximum, row) => {
    const match = /^MFG-(\d+)$/.exec(row.order_code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 1000);
  return `MFG-${String(largest + 1).padStart(4, '0')}`;
}

function assertActiveClient(clientId, database) {
  if (!database.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').get(clientId)) {
    throw new HttpError(404, 'Active client was not found.');
  }
}

function assertActiveTechnicians(technicianIds, database) {
  if (!technicianIds.length) return;
  const placeholders = technicianIds.map(() => '?').join(', ');
  const employees = database.prepare(`
    SELECT id, department FROM employees
    WHERE id IN (${placeholders}) AND active = 1 AND deleted_at IS NULL
  `).all(...technicianIds);
  if (employees.length !== technicianIds.length) {
    throw new HttpError(400, 'All assigned technicians must exist and be active.');
  }
  if (employees.some((employee) => employee.department !== 'Workshop')) {
    throw new HttpError(400, 'Workshop technicians must belong to the Workshop department.');
  }
}

export function listWorkshopOrders(status, database = db) {
  if (!WORKSHOP_STATUSES.includes(status)) {
    throw new HttpError(400, `status is required and must be one of: ${WORKSHOP_STATUSES.join(', ')}.`);
  }
  return database.prepare(`
    SELECT order_record.id, order_record.order_code, order_record.client_id,
      client.code AS client_code, client.name AS client_name,
      order_record.product_name, order_record.description, order_record.machine_type,
      order_record.status, order_record.target_delivery_date, order_record.sale_price_cents,
      order_record.delivered_at, order_record.created_at, order_record.updated_at,
      (SELECT COUNT(*) FROM workshop_order_technicians assigned WHERE assigned.order_id = order_record.id) AS technician_count,
      (SELECT COUNT(*) FROM workshop_design_files design WHERE design.order_id = order_record.id) AS design_file_count
    FROM workshop_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.status = ? AND order_record.deleted_at IS NULL
    ORDER BY order_record.created_at DESC, order_record.id DESC
  `).all(status);
}

export function createWorkshopOrder(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, [
    'clientId', 'productName', 'description', 'machineType', 'targetDeliveryDate',
    'salePriceCents', 'technicianIds',
  ]);
  const clientId = positiveId(body.clientId, 'clientId');
  const productName = requireText(body.productName, 'productName', { maxLength: 300 });
  const description = optionalText(body.description, 'description', { maxLength: 10000 });
  if (!MACHINE_TYPES.includes(body.machineType)) {
    throw new HttpError(400, `machineType must be one of: ${MACHINE_TYPES.join(', ')}.`);
  }
  const targetDeliveryDate = isoDate(body.targetDeliveryDate, 'targetDeliveryDate');
  const salePriceCents = nonNegativeInteger(body.salePriceCents, 'salePriceCents');
  const technicianIds = integerIdArray(body.technicianIds, 'technicianIds');

  const id = database.transaction(() => {
    assertActiveClient(clientId, database);
    assertActiveTechnicians(technicianIds, database);
    const orderCode = nextOrderCode(database);
    const result = database.prepare(`
      INSERT INTO workshop_orders
        (order_code, client_id, product_name, description, machine_type,
         target_delivery_date, sale_price_cents, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderCode,
      clientId,
      productName,
      description,
      body.machineType,
      targetDeliveryDate,
      salePriceCents,
      actorId,
    );
    const orderId = Number(result.lastInsertRowid);
    const assign = database.prepare(`
      INSERT INTO workshop_order_technicians (order_id, employee_id) VALUES (?, ?)
    `);
    for (const technicianId of technicianIds) assign.run(orderId, technicianId);
    recordAudit({
      database,
      actorId,
      action: 'create',
      entityType: 'workshop_order',
      entityId: orderId,
      newValues: {
        order_code: orderCode,
        client_id: clientId,
        product_name: productName,
        machine_type: body.machineType,
        sale_price_cents: salePriceCents,
        technician_ids: technicianIds,
      },
    });
    return orderId;
  }).immediate();

  return getWorkshopOrder(id, database);
}

export function getWorkshopOrder(orderId, database = db) {
  const order = findWorkshopOrder(orderId, database);
  const technicians = database.prepare(`
    SELECT employee.id, employee.name, employee.job_title, employee.department
    FROM workshop_order_technicians assigned
    JOIN employees employee ON employee.id = assigned.employee_id
    WHERE assigned.order_id = ?
    ORDER BY employee.name COLLATE NOCASE, employee.id
  `).all(order.id);
  const designFiles = database.prepare(`
    SELECT id, order_id, original_name, stored_path, extension, byte_size, created_at
    FROM workshop_design_files WHERE order_id = ? ORDER BY id
  `).all(order.id).map((file) => ({
    ...file,
    download_url: `/api/workshop/designs/${file.id}/download`,
  }));
  const materialConsumption = database.prepare(`
    SELECT movement.id, movement.material_id, movement.offcut_id,
      material.code AS material_code,
      COALESCE(material.name, offcut.name) AS material_name,
      COALESCE(material.unit, offcut.unit) AS unit,
      movement.warehouse, movement.reference, movement.notes, movement.created_at
    FROM inventory_movements movement
    LEFT JOIN materials material ON material.id = movement.material_id
    LEFT JOIN secondary_warehouse_offcuts offcut ON offcut.id = movement.offcut_id
    WHERE movement.source_type = 'workshop_order' AND movement.source_id = ? AND movement.kind = 'issue'
    ORDER BY movement.id
  `).all(order.id);
  const offcuts = database.prepare(`
    SELECT offcut.*, material.code AS material_code, material.name AS material_name
    FROM secondary_warehouse_offcuts offcut
    LEFT JOIN materials material ON material.id = offcut.material_id
    WHERE offcut.origin_workshop_order_id = ?
    ORDER BY offcut.id
  `).all(order.id);
  const client = database.prepare(`
    SELECT id, code, name, contact_name, phone, email, primary_color, secondary_color, logo_path
    FROM clients WHERE id = ?
  `).get(order.client_id);
  const salesInvoice = order.sales_invoice_id === null
    ? null
    : database.prepare(`
      SELECT id, code, kind, total_cents, paid_total_cents, remaining_cents,
        payment_status, status, created_at
      FROM invoices WHERE id = ?
    `).get(order.sales_invoice_id);
  return { ...order, client, technicians, designFiles, materialConsumption, offcuts, salesInvoice };
}

export async function saveWorkshopDesign(orderId, file, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  if (!file?.buffer?.length) throw new HttpError(400, 'A vector design file is required.');
  const order = findWorkshopOrder(id, database);
  if (order.status === 'delivered_archived') throw new HttpError(409, 'Delivered workshop orders are read-only.');
  const extension = extname(file.originalname).toLowerCase();
  if (!DESIGN_EXTENSIONS.has(extension)) throw new HttpError(400, 'Unsupported design extension.');
  const originalName = safeOriginalName(file.originalname);
  const storedPath = `${storageDirectory('clients', order.client_code, 'workshop', order.order_code, 'designs')}/${randomUUID()}${extension}`;
  const savedFile = await writeStorageFile(storedPath, file.buffer);
  try {
    const fileId = database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO workshop_design_files (order_id, original_name, stored_path, extension, byte_size)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, originalName, storedPath, extension, file.buffer.length);
      const newId = Number(result.lastInsertRowid);
      recordAudit({
        database,
        actorId,
        action: 'design_upload',
        entityType: 'workshop_order',
        entityId: id,
        newValues: { design_file_id: newId, original_name: originalName, stored_path: storedPath },
      });
      return newId;
    })();
    return database.prepare(`
      SELECT id, order_id, original_name, stored_path, extension, byte_size, created_at
      FROM workshop_design_files WHERE id = ?
    `).get(fileId);
  } catch (error) {
    await removeStorageFile(savedFile.absolutePath);
    throw error;
  }
}

export function getWorkshopDesign(fileId, database = db) {
  const id = positiveId(fileId, 'fileId');
  const file = database.prepare(`
    SELECT design.id, design.order_id, design.original_name, design.stored_path,
      design.extension, design.byte_size, order_record.order_code, client.code AS client_code
    FROM workshop_design_files design
    JOIN workshop_orders order_record ON order_record.id = design.order_id
    JOIN clients client ON client.id = order_record.client_id
    WHERE design.id = ? AND order_record.deleted_at IS NULL
  `).get(id);
  if (!file) throw new HttpError(404, 'Workshop design file was not found.');
  const expectedPrefix = `${storageDirectory('clients', file.client_code, 'workshop', file.order_code, 'designs')}/`;
  if (!file.stored_path.startsWith(expectedPrefix)) {
    throw new HttpError(403, 'Workshop design is outside its order storage directory.');
  }
  return file;
}

function normalizeOffcuts(input, database) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) {
    throw new HttpError(400, 'offcuts must be an array containing at most 100 items.');
  }
  return input.map((value, index) => {
    const offcut = requireObject(value, `offcuts[${index}]`);
    allowOnlyKeys(offcut, ['name', 'dimensions', 'quantity', 'unit', 'materialId']);
    if (typeof offcut.quantity !== 'number' || !Number.isFinite(offcut.quantity) || offcut.quantity <= 0) {
      throw new HttpError(400, `offcuts[${index}].quantity must be a positive number.`);
    }
    const materialId = offcut.materialId === undefined || offcut.materialId === null
      ? null
      : positiveId(offcut.materialId, `offcuts[${index}].materialId`);
    if (materialId !== null && !database.prepare('SELECT 1 FROM materials WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(materialId)) {
      throw new HttpError(400, `offcuts[${index}].materialId must reference an active material.`);
    }
    return {
      name: requireText(offcut.name, `offcuts[${index}].name`, { maxLength: 200 }),
      dimensions: requireText(offcut.dimensions, `offcuts[${index}].dimensions`, { maxLength: 200 }),
      quantity: offcut.quantity,
      unit: requireText(offcut.unit, `offcuts[${index}].unit`, { maxLength: 50 }),
      materialId,
    };
  });
}

export function transitionWorkshopToReady(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input ?? {});
  allowOnlyKeys(body, ['offcuts']);
  const offcuts = normalizeOffcuts(body.offcuts, database);
  database.transaction(() => {
    const order = findWorkshopOrder(id, database);
    if (order.status !== 'in_production') throw new HttpError(409, 'Only in-production workshop orders can be marked ready.');
    database.prepare(`
      UPDATE workshop_orders SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
    const insertOffcut = database.prepare(`
      INSERT INTO secondary_warehouse_offcuts
        (material_id, name, dimensions, quantity, unit, origin_workshop_order_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'available')
    `);
    const createdOffcuts = [];
    for (const offcut of offcuts) {
      const result = insertOffcut.run(
        offcut.materialId,
        offcut.name,
        offcut.dimensions,
        offcut.quantity,
        offcut.unit,
        id,
      );
      createdOffcuts.push(Number(result.lastInsertRowid));
    }
    recordAudit({
      database,
      actorId,
      action: 'ready',
      entityType: 'workshop_order',
      entityId: id,
      oldValues: { status: order.status },
      newValues: { status: 'ready', offcut_ids: createdOffcuts },
    });
    return createdOffcuts;
  })();
  return getWorkshopOrder(id, database);
}

export function transitionWorkshopToDelivered(orderId, input = {}, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input ?? {});
  allowOnlyKeys(body, []);
  const invoice = database.transaction(() => {
    const order = findWorkshopOrder(id, database);
    if (order.status !== 'ready') throw new HttpError(409, 'Only ready workshop orders can be delivered and archived.');
    const salesInvoice = insertSalesInvoiceForWorkshopOrder(id, actorId, database);
    database.prepare(`
      UPDATE workshop_orders
      SET status = 'delivered_archived', sales_invoice_id = ?,
        delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(salesInvoice.id, id);
    recordAudit({
      database,
      actorId,
      action: 'delivered_archive',
      entityType: 'workshop_order',
      entityId: id,
      oldValues: { status: order.status, delivered_at: order.delivered_at, sales_invoice_id: order.sales_invoice_id },
      newValues: { status: 'delivered_archived', sales_invoice_id: salesInvoice.id, invoice_code: salesInvoice.code },
    });
    return salesInvoice;
  }).immediate();
  return { order: getWorkshopOrder(id, database), invoice };
}
