import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { HttpError, nonNegativeInteger, optionalText, positiveId, requireObject, requireText } from '../http.js';

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function cashBalanceBigInt(database) {
  const row = database.prepare(`
    SELECT CAST(COALESCE(SUM(
      CASE kind WHEN 'income' THEN amount_cents ELSE -amount_cents END
    ), 0) AS TEXT) AS balance_cents
    FROM treasury_entries
  `).get();
  return BigInt(row.balance_cents);
}

function toSafeCents(value, label = 'Cents total') {
  if (value > MAX_SAFE_CENTS || value < -MAX_SAFE_CENTS) {
    throw new HttpError(500, `${label} exceeds the safe integer-cents range.`);
  }
  return Number(value);
}

export function getCashBalanceCents(database = db) {
  return toSafeCents(cashBalanceBigInt(database), 'Treasury balance');
}

export function assertCashAvailable(amountCents, database = db) {
  const amount = BigInt(nonNegativeInteger(amountCents, 'amountCents'));
  if (cashBalanceBigInt(database) < amount) {
    throw new HttpError(409, 'Insufficient treasury cash for this expense.');
  }
}

/** Insert a ledger row inside the caller's transaction so it commits with its business record. */
export function insertTreasuryEntry({
  database = db,
  kind,
  category,
  amountCents,
  invoiceId = null,
  maintenanceOrderId = null,
  employeeId = null,
  reference = null,
  notes = null,
  actorId = null,
}) {
  const result = database.prepare(`
    INSERT INTO treasury_entries
      (kind, category, amount_cents, invoice_id, maintenance_order_id,
       employee_id, reference, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    kind,
    category,
    amountCents,
    invoiceId,
    maintenanceOrderId,
    employeeId,
    reference,
    notes,
    actorId,
  );
  return Number(result.lastInsertRowid);
}

export function listTreasuryEntries(database = db) {
  return database.prepare(`
    SELECT entry.id, entry.kind, entry.category, entry.amount_cents,
      entry.invoice_id, invoice.code AS invoice_code,
      entry.maintenance_order_id, maintenance.order_code AS maintenance_order_code,
      invoice_workshop.order_code AS workshop_order_code,
      entry.employee_id, employee.name AS employee_name,
      entry.reference, entry.notes, entry.created_by,
      creator.full_name AS created_by_name, entry.created_at
    FROM treasury_entries entry
    LEFT JOIN invoices invoice ON invoice.id = entry.invoice_id
    LEFT JOIN maintenance_orders maintenance ON maintenance.id = entry.maintenance_order_id
    LEFT JOIN workshop_orders invoice_workshop ON invoice_workshop.id = invoice.workshop_order_id
    LEFT JOIN employees employee ON employee.id = entry.employee_id
    LEFT JOIN users creator ON creator.id = entry.created_by
    ORDER BY entry.created_at DESC, entry.id DESC
    LIMIT 100
  `).all();
}

export function getTreasury(database = db) {
  return {
    cashBalanceCents: getCashBalanceCents(database),
    entries: listTreasuryEntries(database),
  };
}

export function createTreasuryEntry(input, actorId = null, database = db) {
  const body = requireObject(input);
  const allowed = ['kind', 'category', 'amountCents', 'employeeId', 'reference', 'notes'];
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) throw new HttpError(400, `Unsupported field: ${unknown}.`);
  if (!['income', 'expense'].includes(body.kind)) {
    throw new HttpError(400, 'kind must be income or expense.');
  }
  const category = requireText(body.category, 'category', { maxLength: 200 });
  const amountCents = nonNegativeInteger(body.amountCents, 'amountCents');
  if (amountCents < 1) throw new HttpError(400, 'amountCents must be greater than zero.');
  const employeeId = body.employeeId === undefined || body.employeeId === null
    ? null
    : positiveId(body.employeeId, 'employeeId');
  const reference = optionalText(body.reference, 'reference', { maxLength: 300 });
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  const entryId = database.transaction(() => {
    if (employeeId !== null && !database.prepare(`
      SELECT 1 FROM employees WHERE id = ? AND active = 1 AND deleted_at IS NULL
    `).get(employeeId)) {
      throw new HttpError(404, 'Active employee was not found.');
    }
    if (body.kind === 'expense') assertCashAvailable(amountCents, database);
    const id = insertTreasuryEntry({
      database,
      kind: body.kind,
      category,
      amountCents,
      employeeId,
      reference,
      notes,
      actorId,
    });
    recordAudit({
      database,
      actorId,
      action: 'create',
      entityType: 'treasury_entry',
      entityId: id,
      newValues: {
        kind: body.kind,
        category,
        amount_cents: amountCents,
        employee_id: employeeId,
        reference,
        notes,
      },
    });
    return id;
  }).immediate();

  return {
    entry: database.prepare('SELECT * FROM treasury_entries WHERE id = ?').get(entryId),
    cashBalanceCents: getCashBalanceCents(database),
  };
}

export { MAX_SAFE_CENTS, toSafeCents };
