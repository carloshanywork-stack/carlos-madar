import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import {
  allowOnlyKeys,
  HttpError,
  optionalText,
  positiveId,
  requireObject,
  requireText,
} from '../http.js';
import { removeStorageFile, storageDirectory, writeStorageFile } from '../storage.js';

const clientColumns = `
  id, code, name, contact_name, phone, email, address,
  primary_color, secondary_color, logo_path, created_at
`;

function optionalColor(value, label) {
  const color = optionalText(value, label, { maxLength: 9 });
  if (color !== null && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) {
    throw new HttpError(400, `${label} must be a hex color such as #12A4EF.`);
  }
  return color;
}

function nextClientCode(database) {
  const codes = database.prepare("SELECT code FROM clients WHERE code GLOB 'C-[0-9]*'").all();
  const largest = codes.reduce((maximum, row) => {
    const match = /^C-(\d+)$/.exec(row.code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 1000);
  return `C-${String(largest + 1).padStart(4, '0')}`;
}

export function listClients(database = db) {
  return database.prepare(`
    SELECT ${clientColumns}
    FROM clients
    WHERE deleted_at IS NULL
    ORDER BY name COLLATE NOCASE, id
  `).all();
}

export function getClientProfile(clientId, database = db) {
  const id = positiveId(clientId, 'clientId');
  const client = database.prepare(`
    SELECT ${clientColumns} FROM clients WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!client) throw new HttpError(404, 'Client was not found.');

  const activeMaintenanceOrders = database.prepare(`
    SELECT COUNT(*) AS count FROM maintenance_orders
    WHERE client_id = ? AND deleted_at IS NULL AND status IN ('in_progress', 'review')
  `).get(id).count;
  const completedMaintenanceVisits = database.prepare(`
    SELECT COUNT(*) AS count FROM maintenance_orders
    WHERE client_id = ? AND deleted_at IS NULL AND status = 'archived'
  `).get(id).count;
  const activeWorkshopOrders = database.prepare(`
    SELECT COUNT(*) AS count FROM workshop_orders
    WHERE client_id = ? AND deleted_at IS NULL AND status IN ('in_production', 'ready')
  `).get(id).count;
  const machines = database.prepare(`
    SELECT m.id, m.code, m.name_ar, m.name_en, m.area,
      deployed.site_area, deployed.first_seen_at, deployed.last_seen_at
    FROM client_machines AS deployed
    JOIN machines AS m ON m.id = deployed.machine_id
    WHERE deployed.client_id = ?
      AND deployed.active = 1
      AND m.active = 1
      AND m.deleted_at IS NULL
    ORDER BY deployed.site_area COLLATE NOCASE, m.name_ar COLLATE NOCASE, m.id
  `).all(id);

  return {
    ...client,
    logo_url: client.logo_path ? `/api/clients/${id}/logo` : null,
    statistics: {
      activeMaintenanceOrders,
      completedMaintenanceVisits,
      activeWorkshopOrders,
    },
    machines,
  };
}

function sumCents(query, parameters, label, database) {
  const row = database.prepare(query).get(...parameters);
  const cents = BigInt(row.cents);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(500, `${label} exceeds the safe integer-cents range.`);
  }
  return Number(cents);
}

export function getClientStatement(clientId, database = db) {
  const id = positiveId(clientId, 'clientId');
  const client = database.prepare(`
    SELECT id, code, name FROM clients WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!client) throw new HttpError(404, 'Client was not found.');

  const approvedSales = `
    FROM invoices WHERE client_id = ? AND kind = 'sales'
      AND status = 'approved' AND deleted_at IS NULL
  `;
  const totalBilledCents = sumCents(`
    SELECT CAST(COALESCE(SUM(total_cents), 0) AS TEXT) AS cents ${approvedSales}
  `, [id], 'Client billed total', database);
  const outstandingBalanceCents = sumCents(`
    SELECT CAST(COALESCE(SUM(remaining_cents), 0) AS TEXT) AS cents ${approvedSales}
  `, [id], 'Client outstanding balance', database);
  const totalPaidCents = sumCents(`
    SELECT CAST(COALESCE(SUM(entry.amount_cents), 0) AS TEXT) AS cents
    FROM treasury_entries entry
    JOIN invoices invoice ON invoice.id = entry.invoice_id
    WHERE invoice.client_id = ? AND invoice.kind = 'sales'
      AND invoice.status = 'approved' AND invoice.deleted_at IS NULL
      AND entry.kind = 'income'
  `, [id], 'Client paid total', database);
  const overdueInvoices = database.prepare(`
    SELECT id, code, total_cents, paid_total_cents, remaining_cents,
      payment_status, created_at,
      CAST(julianday('now') - julianday(created_at) AS INTEGER) AS days_overdue
    FROM invoices
    WHERE client_id = ? AND kind = 'sales' AND status = 'approved'
      AND deleted_at IS NULL AND remaining_cents > 0
      AND created_at < datetime('now', '-60 days')
    ORDER BY created_at, id
  `).all(id);

  return {
    client,
    totalBilledCents,
    totalPaidCents,
    outstandingBalanceCents,
    overdueInvoices,
    hasOverdueDebt: overdueInvoices.length > 0,
  };
}

export function createClient(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['name', 'contactName', 'phone', 'email', 'address', 'primaryColor', 'secondaryColor']);

  const client = {
    name: requireText(body.name, 'name', { maxLength: 200 }),
    contactName: optionalText(body.contactName, 'contactName', { maxLength: 200 }),
    phone: optionalText(body.phone, 'phone', { maxLength: 80 }),
    email: optionalText(body.email, 'email', { maxLength: 254 }),
    address: optionalText(body.address, 'address', { maxLength: 1000 }),
    primaryColor: optionalColor(body.primaryColor, 'primaryColor'),
    secondaryColor: optionalColor(body.secondaryColor, 'secondaryColor'),
  };
  if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) {
    throw new HttpError(400, 'email must be a valid email address.');
  }

  return database.transaction(() => {
    const code = nextClientCode(database);
    const result = database.prepare(`
      INSERT INTO clients
        (code, name, contact_name, phone, email, address, primary_color, secondary_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code,
      client.name,
      client.contactName,
      client.phone,
      client.email,
      client.address,
      client.primaryColor,
      client.secondaryColor,
    );
    const id = Number(result.lastInsertRowid);
    recordAudit({
      database,
      actorId,
      action: 'create',
      entityType: 'client',
      entityId: id,
      newValues: { code, ...client },
    });
    return database.prepare(`SELECT ${clientColumns} FROM clients WHERE id = ?`).get(id);
  }).immediate();
}

function validateImageSignature(file, extension) {
  const bytes = file.buffer;
  const valid = extension === '.png'
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : ['.jpg', '.jpeg'].includes(extension)
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : extension === '.webp'
        ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        : false;
  if (!valid) throw new HttpError(400, 'Logo content does not match its image extension.');
}

export async function saveClientLogo(clientId, file, actorId = null, database = db) {
  const id = positiveId(clientId, 'clientId');
  if (!file?.buffer?.length) throw new HttpError(400, 'A logo image file is required.');
  const client = database.prepare(`
    SELECT id, code, logo_path FROM clients WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!client) throw new HttpError(404, 'Client was not found.');

  const extension = extname(file.originalname).toLowerCase();
  validateImageSignature(file, extension);
  const storedPath = `${storageDirectory('clients', client.code, 'logo')}/${randomUUID()}${extension}`;
  const savedFile = await writeStorageFile(storedPath, file.buffer);
  try {
    const update = database.transaction(() => {
      database.prepare('UPDATE clients SET logo_path = ? WHERE id = ?').run(storedPath, id);
      recordAudit({
        database,
        actorId,
        action: 'logo_upload',
        entityType: 'client',
        entityId: id,
        oldValues: { logo_path: client.logo_path },
        newValues: { logo_path: storedPath },
      });
    });
    update();
  } catch (error) {
    await removeStorageFile(savedFile.absolutePath);
    throw error;
  }
  return getClientProfile(id, database);
}

export function getClientLogo(clientId, database = db) {
  const id = positiveId(clientId, 'clientId');
  const client = database.prepare(`
    SELECT id, code, logo_path FROM clients WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!client) throw new HttpError(404, 'Client was not found.');
  if (!client.logo_path) throw new HttpError(404, 'Client has no logo.');
  const expectedPrefix = `${storageDirectory('clients', client.code, 'logo')}/`;
  if (!client.logo_path.startsWith(expectedPrefix)) throw new HttpError(403, 'Client logo is outside its storage directory.');
  return client.logo_path;
}
