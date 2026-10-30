import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { assertCashAvailable, insertTreasuryEntry } from '../finance/treasury.service.js';
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
import {
  removeStorageFile,
  resolveStorageFile,
  storageDirectory,
  writeStorageFile,
} from '../storage.js';

const MAINTENANCE_STATUSES = ['in_progress', 'review', 'archived'];
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

function findMaintenanceOrder(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  const order = database.prepare(`
    SELECT order_record.id, order_record.order_code, order_record.client_id,
      order_record.status, order_record.notes, order_record.warranty_period_months,
      order_record.petty_cash_disbursed_cents, order_record.actual_expenses_cents,
      order_record.petty_cash_refund_cents, order_record.archived_at,
      order_record.archived_by, order_record.created_by, order_record.created_at,
      order_record.updated_at, order_record.deleted_at,
      client.code AS client_code, client.name AS client_name
    FROM maintenance_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.id = ? AND order_record.deleted_at IS NULL
  `).get(id);
  if (!order) throw new HttpError(404, 'Maintenance order was not found.');
  return order;
}

function safeMachineCode(value) {
  const code = requireText(value, 'code', { maxLength: 64 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code)) {
    throw new HttpError(400, 'Machine code may contain only letters, numbers, dots, underscores, and hyphens.');
  }
  return code;
}

function parsePhotoJson(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validateStoredPhotoList(value, label) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new HttpError(400, `${label} must be an array containing at most 100 stored file paths.`);
  }
  return value.map((photo, index) => requireText(photo, `${label}[${index}]`, { maxLength: 1024 }));
}

export function listMachines({ area, search } = {}, database = db) {
  const where = ['active = 1', 'deleted_at IS NULL'];
  const parameters = [];
  if (area !== undefined && area !== '') {
    where.push('area = ? COLLATE NOCASE');
    parameters.push(requireText(area, 'area', { maxLength: 160 }));
  }
  const query = search ?? '';
  if (query !== '') {
    const term = `%${requireText(query, 'search', { maxLength: 160 })}%`;
    where.push('(code LIKE ? COLLATE NOCASE OR name_ar LIKE ? OR name_en LIKE ? COLLATE NOCASE OR area LIKE ? COLLATE NOCASE)');
    parameters.push(term, term, term, term);
  }
  return database.prepare(`
    SELECT id, code, name_ar, name_en, area, active, created_at
    FROM machines WHERE ${where.join(' AND ')}
    ORDER BY area COLLATE NOCASE, name_ar COLLATE NOCASE, id
  `).all(...parameters);
}

export function listAreas(database = db) {
  return database.prepare(`
    SELECT DISTINCT area FROM machines
    WHERE active = 1 AND deleted_at IS NULL
    ORDER BY area COLLATE NOCASE
  `).all().map((row) => row.area);
}

export function createMachine(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['code', 'name_ar', 'name_en', 'area']);
  const machine = {
    code: safeMachineCode(body.code),
    nameAr: requireText(body.name_ar, 'name_ar', { maxLength: 200 }),
    nameEn: optionalText(body.name_en, 'name_en', { maxLength: 200 }),
    area: requireText(body.area, 'area', { maxLength: 160 }),
  };

  try {
    return database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO machines (code, name_ar, name_en, area) VALUES (?, ?, ?, ?)
      `).run(machine.code, machine.nameAr, machine.nameEn, machine.area);
      const id = Number(result.lastInsertRowid);
      recordAudit({
        database,
        actorId,
        action: 'create',
        entityType: 'machine',
        entityId: id,
        newValues: machine,
      });
      return database.prepare('SELECT id, code, name_ar, name_en, area, active, created_at FROM machines WHERE id = ?')
        .get(id);
    }).immediate();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'Machine code already exists.');
    throw error;
  }
}

export function listMaintenanceOrders(status, database = db) {
  if (!MAINTENANCE_STATUSES.includes(status)) {
    throw new HttpError(400, `status is required and must be one of: ${MAINTENANCE_STATUSES.join(', ')}.`);
  }
  return database.prepare(`
    SELECT order_record.id, order_record.order_code, order_record.client_id,
      client.code AS client_code, client.name AS client_name,
      order_record.status, order_record.notes, order_record.warranty_period_months,
      order_record.petty_cash_disbursed_cents, order_record.actual_expenses_cents,
      order_record.petty_cash_refund_cents, order_record.archived_at,
      order_record.created_at, order_record.updated_at,
      (SELECT COUNT(*) FROM maintenance_cards card WHERE card.order_id = order_record.id) AS card_count,
      (SELECT COUNT(*) FROM maintenance_order_technicians assigned WHERE assigned.order_id = order_record.id) AS technician_count
    FROM maintenance_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.status = ? AND order_record.deleted_at IS NULL
    ORDER BY order_record.created_at DESC, order_record.id DESC
  `).all(status);
}

function assertActiveClient(clientId, database) {
  if (!database.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').get(clientId)) {
    throw new HttpError(404, 'Active client was not found.');
  }
}

function assertActiveEmployees(employeeIds, department, database) {
  if (!employeeIds.length) return;
  const placeholders = employeeIds.map(() => '?').join(', ');
  const employees = database.prepare(`
    SELECT id, department FROM employees
    WHERE id IN (${placeholders}) AND active = 1 AND deleted_at IS NULL
  `).all(...employeeIds);
  if (employees.length !== employeeIds.length) {
    throw new HttpError(400, 'All assigned employees must exist and be active.');
  }
  if (employees.some((employee) => employee.department !== department)) {
    throw new HttpError(400, `Maintenance technicians must belong to the ${department} department.`);
  }
}

function nextOrderCode(database) {
  const orderCodes = database.prepare("SELECT order_code FROM maintenance_orders WHERE order_code GLOB 'MN-[0-9]*'").all();
  const largest = orderCodes.reduce((maximum, row) => {
    const match = /^MN-(\d+)$/.exec(row.order_code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 1000);
  return `MN-${String(largest + 1).padStart(4, '0')}`;
}

export function createMaintenanceOrder(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['clientId', 'employeeIds', 'notes', 'pettyCashDisbursedCents']);
  const clientId = positiveId(body.clientId, 'clientId');
  const employeeIds = integerIdArray(body.employeeIds, 'employeeIds');
  const notes = optionalText(body.notes, 'notes', { maxLength: 10000 });
  const pettyCashDisbursedCents = body.pettyCashDisbursedCents === undefined
    ? 0
    : nonNegativeInteger(body.pettyCashDisbursedCents, 'pettyCashDisbursedCents');

  const orderId = database.transaction(() => {
    assertActiveClient(clientId, database);
    assertActiveEmployees(employeeIds, 'Maintenance', database);
    if (pettyCashDisbursedCents > 0) assertCashAvailable(pettyCashDisbursedCents, database);
    const orderCode = nextOrderCode(database);
    const result = database.prepare(`
      INSERT INTO maintenance_orders (order_code, client_id, notes, petty_cash_disbursed_cents, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(orderCode, clientId, notes, pettyCashDisbursedCents, actorId);
    const id = Number(result.lastInsertRowid);
    let treasuryEntryId = null;
    if (pettyCashDisbursedCents > 0) {
      treasuryEntryId = insertTreasuryEntry({
        database,
        kind: 'expense',
        category: 'عهدة نقدية صيانة',
        amountCents: pettyCashDisbursedCents,
        maintenanceOrderId: id,
        reference: orderCode,
        notes: 'Maintenance petty cash custody advance',
        actorId,
      });
    }
    const assign = database.prepare(`
      INSERT INTO maintenance_order_technicians (order_id, employee_id) VALUES (?, ?)
    `);
    for (const employeeId of employeeIds) assign.run(id, employeeId);
    recordAudit({
      database,
      actorId,
      action: 'create',
      entityType: 'maintenance_order',
      entityId: id,
      newValues: {
        order_code: orderCode,
        client_id: clientId,
        employee_ids: employeeIds,
        notes,
        petty_cash_disbursed_cents: pettyCashDisbursedCents,
        treasury_entry_id: treasuryEntryId,
      },
    });
    return id;
  }).immediate();

  return getMaintenanceOrder(orderId, database);
}

export function disburseMaintenanceCustody(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['amountCents', 'notes']);
  const amountCents = nonNegativeInteger(body.amountCents, 'amountCents');
  if (amountCents < 1) throw new HttpError(400, 'amountCents must be greater than zero.');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'in_progress') {
      throw new HttpError(409, 'Maintenance custody can only be advanced while the order is in progress.');
    }
    if (!Number.isSafeInteger(order.petty_cash_disbursed_cents + amountCents)) {
      throw new HttpError(400, 'Maintenance custody exceeds the safe integer-cents range.');
    }
    assertCashAvailable(amountCents, database);
    const nextAmount = order.petty_cash_disbursed_cents + amountCents;
    const treasuryEntryId = insertTreasuryEntry({
      database,
      kind: 'expense',
      category: 'عهدة نقدية صيانة',
      amountCents,
      maintenanceOrderId: id,
      reference: order.order_code,
      notes,
      actorId,
    });
    database.prepare(`
      UPDATE maintenance_orders
      SET petty_cash_disbursed_cents = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextAmount, id);
    recordAudit({
      database,
      actorId,
      action: 'custody_advance',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues: { petty_cash_disbursed_cents: order.petty_cash_disbursed_cents },
      newValues: {
        petty_cash_disbursed_cents: nextAmount,
        advance_cents: amountCents,
        treasury_entry_id: treasuryEntryId,
      },
    });
  }).immediate();

  return getMaintenanceOrder(id, database);
}

export function getMaintenanceOrder(orderId, database = db) {
  const order = findMaintenanceOrder(orderId, database);
  const technicians = database.prepare(`
    SELECT employee.id, employee.name, employee.job_title, employee.department
    FROM maintenance_order_technicians assigned
    JOIN employees employee ON employee.id = assigned.employee_id
    WHERE assigned.order_id = ?
    ORDER BY employee.name COLLATE NOCASE, employee.id
  `).all(order.id);
  const cards = database.prepare(`
    SELECT card.*, machine.code AS machine_code, machine.name_ar AS machine_name_ar,
      machine.name_en AS machine_name_en, machine.area AS machine_area
    FROM maintenance_cards card
    JOIN machines machine ON machine.id = card.machine_id
    WHERE card.order_id = ?
    ORDER BY card.id
  `).all(order.id).map((card) => {
    const beforePhotos = parsePhotoJson(card.before_photos_json);
    const afterPhotos = parsePhotoJson(card.after_photos_json);
    return {
      ...card,
      before_photos: beforePhotos,
      after_photos: afterPhotos,
      before_photo_urls: beforePhotos.map((storedPath) =>
        `/api/maintenance/orders/${order.id}/cards/${card.id}/photos/before/${encodeURIComponent(storedPath.split('/').at(-1))}`),
      after_photo_urls: afterPhotos.map((storedPath) =>
        `/api/maintenance/orders/${order.id}/cards/${card.id}/photos/after/${encodeURIComponent(storedPath.split('/').at(-1))}`),
    };
  });
  const client = database.prepare(`
    SELECT id, code, name, contact_name, phone, email, address, primary_color, secondary_color, logo_path
    FROM clients WHERE id = ?
  `).get(order.client_id);
  return { ...order, client, technicians, cards };
}

export function addMaintenanceCard(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['machineId', 'notes']);
  const machineId = positiveId(body.machineId, 'machineId');
  const notes = optionalText(body.notes, 'notes', { maxLength: 10000 });

  const cardId = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'in_progress') throw new HttpError(409, 'Inspection cards can only be added while the order is in progress.');
    const machine = database.prepare(`
      SELECT id FROM machines WHERE id = ? AND active = 1 AND deleted_at IS NULL
    `).get(machineId);
    if (!machine) throw new HttpError(404, 'Active machine was not found.');
    const result = database.prepare(`
      INSERT INTO maintenance_cards (order_id, machine_id, notes) VALUES (?, ?, ?)
    `).run(id, machineId, notes);
    const cardId = Number(result.lastInsertRowid);
    database.prepare(`
      INSERT INTO client_machines (client_id, machine_id, site_area)
      SELECT ?, id, area FROM machines WHERE id = ?
      ON CONFLICT(client_id, machine_id) DO UPDATE SET
        site_area = excluded.site_area,
        active = 1,
        last_seen_at = CURRENT_TIMESTAMP
    `).run(order.client_id, machineId);
    recordAudit({
      database,
      actorId,
      action: 'create',
      entityType: 'maintenance_card',
      entityId: cardId,
      newValues: { order_id: id, machine_id: machineId, notes },
    });
    return cardId;
  }).immediate();

  return getMaintenanceOrder(id, database).cards.find((card) => card.id === cardId);
}

export async function updateMaintenanceCard(orderId, cardId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['beforePhotos', 'afterPhotos', 'notes']);
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one card field must be provided.');

  const order = findMaintenanceOrder(id, database);
  if (order.status === 'archived') throw new HttpError(409, 'Archived maintenance orders are read-only.');
  const card = database.prepare(`
    SELECT card.*, machine.code AS machine_code
    FROM maintenance_cards card JOIN machines machine ON machine.id = card.machine_id
    WHERE card.id = ? AND card.order_id = ?
  `).get(targetCardId, id);
  if (!card) throw new HttpError(404, 'Inspection card was not found on this order.');

  const beforePhotos = body.beforePhotos === undefined
    ? parsePhotoJson(card.before_photos_json)
    : validateStoredPhotoList(body.beforePhotos, 'beforePhotos');
  const afterPhotos = body.afterPhotos === undefined
    ? parsePhotoJson(card.after_photos_json)
    : validateStoredPhotoList(body.afterPhotos, 'afterPhotos');
  for (const [phase, paths] of [['before', beforePhotos], ['after', afterPhotos]]) {
    const expectedPrefix = `${storageDirectory('clients', order.client_code, 'maintenance', order.order_code, card.machine_code, phase)}/`;
    for (const photoPath of paths) {
      if (!photoPath.startsWith(expectedPrefix)) {
        throw new HttpError(400, `${phase} photo paths must belong to this client, order, and machine.`);
      }
      await resolveStorageFile(photoPath);
    }
  }
  const notes = body.notes === undefined ? card.notes : optionalText(body.notes, 'notes', { maxLength: 10000 });

  const update = database.transaction(() => {
    database.prepare(`
      UPDATE maintenance_cards
      SET before_photos_json = ?, after_photos_json = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND order_id = ?
    `).run(JSON.stringify(beforePhotos), JSON.stringify(afterPhotos), notes, targetCardId, id);
    recordAudit({
      database,
      actorId,
      action: 'update',
      entityType: 'maintenance_card',
      entityId: targetCardId,
      oldValues: {
        before_photos: parsePhotoJson(card.before_photos_json),
        after_photos: parsePhotoJson(card.after_photos_json),
        notes: card.notes,
      },
      newValues: { before_photos: beforePhotos, after_photos: afterPhotos, notes },
    });
  });
  update();
  return getMaintenanceOrder(id, database).cards.find((item) => item.id === targetCardId);
}

export async function uploadMaintenancePhoto(orderId, cardId, phase, file, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  if (!file?.buffer?.length) throw new HttpError(400, 'A maintenance photo is required.');
  const extension = extname(file.originalname).toLowerCase();
  if (!PHOTO_EXTENSIONS.has(extension)) throw new HttpError(400, 'Unsupported maintenance photo extension.');

  const metadata = database.prepare(`
    SELECT order_record.order_code, client.code AS client_code, machine.code AS machine_code,
      card.id AS card_id, card.order_id, card.before_photos_json, card.after_photos_json
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL
      AND order_record.status != 'archived'
  `).get(id, targetCardId);
  if (!metadata) throw new HttpError(404, 'Active inspection card was not found on this order.');

  const storedPath = `${storageDirectory(
    'clients', metadata.client_code, 'maintenance', metadata.order_code, metadata.machine_code, phase,
  )}/${randomUUID()}${extension}`;
  const savedFile = await writeStorageFile(storedPath, file.buffer);
  try {
    const update = database.transaction(() => {
      const oldPaths = parsePhotoJson(phase === 'before' ? metadata.before_photos_json : metadata.after_photos_json);
      const nextPaths = [...oldPaths, storedPath];
      const column = phase === 'before' ? 'before_photos_json' : 'after_photos_json';
      database.prepare(`UPDATE maintenance_cards SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(JSON.stringify(nextPaths), targetCardId);
      recordAudit({
        database,
        actorId,
        action: 'photo_upload',
        entityType: 'maintenance_card',
        entityId: targetCardId,
        oldValues: { [phase]: oldPaths },
        newValues: { [phase]: nextPaths },
      });
      return nextPaths;
    });
    const photos = update();
    return {
      phase,
      path: storedPath,
      photos,
      url: `/api/maintenance/orders/${id}/cards/${targetCardId}/photos/${phase}/${encodeURIComponent(storedPath.split('/').at(-1))}`,
    };
  } catch (error) {
    await removeStorageFile(savedFile.absolutePath);
    throw error;
  }
}

export async function getMaintenancePhoto(orderId, cardId, phase, filename, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  const name = requireText(filename, 'filename', { maxLength: 200 });
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');
  const metadata = database.prepare(`
    SELECT order_record.order_code, client.code AS client_code, machine.code AS machine_code,
      card.before_photos_json, card.after_photos_json
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL
  `).get(id, targetCardId);
  if (!metadata) throw new HttpError(404, 'Inspection card was not found on this order.');
  const photos = parsePhotoJson(phase === 'before' ? metadata.before_photos_json : metadata.after_photos_json);
  const prefix = `${storageDirectory(
    'clients', metadata.client_code, 'maintenance', metadata.order_code, metadata.machine_code, phase,
  )}/`;
  const storedPath = photos.includes(`${prefix}${name}`)
    ? `${prefix}${name}`
    : photos.find((photoPath) => typeof photoPath === 'string' && photoPath.split('/').at(-1) === name);
  if (!PHOTO_EXTENSIONS.has(extname(name).toLowerCase()) || !storedPath) {
    throw new HttpError(404, 'Photo is not attached to this inspection card.');
  }
  return resolveStorageFile(storedPath);
}

export function transitionMaintenanceToReview(orderId, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const transition = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'in_progress') throw new HttpError(409, 'Only in-progress maintenance orders can move to review.');
    database.prepare(`
      UPDATE maintenance_orders SET status = 'review', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
    recordAudit({
      database,
      actorId,
      action: 'status_transition',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues: { status: order.status },
      newValues: { status: 'review' },
    });
  });
  transition();
  return getMaintenanceOrder(id, database);
}

export function archiveMaintenanceOrder(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['warrantyPeriodMonths', 'actualExpensesCents']);
  if (![3, 6].includes(body.warrantyPeriodMonths)) {
    throw new HttpError(400, 'warrantyPeriodMonths must be 3 or 6.');
  }
  const actualExpensesCents = nonNegativeInteger(body.actualExpensesCents, 'actualExpensesCents');

  const refundCents = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'review') throw new HttpError(409, 'Only maintenance orders in review can be archived.');
    const refundCents = order.petty_cash_disbursed_cents - actualExpensesCents;
    if (refundCents < 0) {
      throw new HttpError(400, 'actualExpensesCents cannot exceed the petty cash disbursed to this order.');
    }
    const oldValues = {
      status: order.status,
      warranty_period_months: order.warranty_period_months,
      actual_expenses_cents: order.actual_expenses_cents,
      petty_cash_refund_cents: order.petty_cash_refund_cents,
    };
    database.prepare(`
      UPDATE maintenance_orders
      SET status = 'archived', warranty_period_months = ?, actual_expenses_cents = ?,
        petty_cash_refund_cents = ?, archived_at = CURRENT_TIMESTAMP, archived_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.warrantyPeriodMonths, actualExpensesCents, refundCents, actorId, id);
    let treasuryEntryId = null;
    if (refundCents > 0) {
      treasuryEntryId = insertTreasuryEntry({
        database,
        kind: 'income',
        category: 'رد عهدة صيانة',
        amountCents: refundCents,
        maintenanceOrderId: id,
        reference: order.order_code,
        notes: 'Refund from maintenance petty cash custody',
        actorId,
      });
    }
    recordAudit({
      database,
      actorId,
      action: 'archive',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues,
      newValues: {
        status: 'archived',
        warranty_period_months: body.warrantyPeriodMonths,
        actual_expenses_cents: actualExpensesCents,
        petty_cash_refund_cents: refundCents,
        treasury_entry_id: treasuryEntryId,
      },
    });
    return refundCents;
  }).immediate();

  return { order: getMaintenanceOrder(id, database), refundCents };
}
