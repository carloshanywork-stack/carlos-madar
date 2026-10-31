import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-phase4-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'phase4.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
]);

const adminPassword = 'phase4-test-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });
const financeEmployeeId = Number(db.prepare(`
  INSERT INTO employees (name, department, job_title) VALUES ('Finance Clerk', 'Finance', 'Treasury Clerk')
`).run().lastInsertRowid);

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
if (!loginResponse.ok) throw new Error(`Test administrator login failed: ${loginResponse.status}`);
const loginCookieHeader = loginResponse.headers.getSetCookie?.()[0] ?? loginResponse.headers.get('set-cookie');
const authCookie = loginCookieHeader?.split(';', 1)[0];
if (!authCookie) throw new Error('Test administrator login did not issue a session cookie.');

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), cookie: authCookie },
  });
  return { response, body: await response.json() };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('Phase 4 finance lifecycle keeps integer-cents, stock, custody, billing, and client debt coherent', async () => {
  const capitalized = await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income',
    category: 'Opening treasury balance',
    amountCents: 10_000_000,
    employeeId: financeEmployeeId,
    reference: 'Opening capitalization',
  }));
  assert.equal(capitalized.response.status, 201);
  assert.equal(capitalized.body.cashBalanceCents, 10_000_000);

  const openedMaterial = await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-FINANCE-ACR',
    name: 'Finance acrylic 3mm',
    unit: 'لوح',
    minStock: 1,
    unitCostCents: 200_000,
    initialStock: 0,
  }));
  assert.equal(openedMaterial.response.status, 201);
  const material = openedMaterial.body;

  const purchase = await request('/api/finance/invoices/purchase', jsonOptions('POST', {
    supplier: 'Acrylic Sheet Supplier',
    employeeId: financeEmployeeId,
    items: [{ materialId: material.id, quantity: 5, unitCostCents: 200_000 }],
    notes: 'Five full acrylic sheets, paid at purchase.',
  }));
  assert.equal(purchase.response.status, 201);
  assert.match(purchase.body.code, /^PUR-\d{4,}$/);
  assert.equal(purchase.body.kind, 'purchase');
  assert.equal(purchase.body.total_cents, 1_000_000);
  assert.equal(purchase.body.paid_total_cents, 1_000_000);
  assert.equal(purchase.body.remaining_cents, 0);
  assert.equal(purchase.body.payment_status, 'paid');
  assert.equal(purchase.body.items[0].line_total_cents, 1_000_000);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 9_000_000);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 5);
  assert.deepEqual(
    db.prepare(`
      SELECT kind, category, amount_cents, invoice_id, reference
      FROM treasury_entries WHERE invoice_id = ?
    `).get(purchase.body.id),
    {
      kind: 'expense',
      category: 'مشتريات خامات ومواد',
      amount_cents: 1_000_000,
      invoice_id: purchase.body.id,
      reference: purchase.body.code,
    },
  );
  assert.equal(
    db.prepare(`
      SELECT kind, quantity, warehouse, reference, source_id
      FROM inventory_movements WHERE source_id = ? AND kind = 'purchase'
    `).get(purchase.body.id).quantity,
    5,
  );

  const fractionalCentPurchase = await request('/api/finance/invoices/purchase', jsonOptions('POST', {
    supplier: 'Invalid Fractional Cent Supplier',
    items: [{ materialId: material.id, quantity: 0.5, unitCostCents: 1 }],
  }));
  assert.equal(fractionalCentPurchase.response.status, 400);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 9_000_000);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 5);

  const clientResult = await request('/api/clients', jsonOptions('POST', { name: 'Finance Client' }));
  assert.equal(clientResult.response.status, 201);
  const client = clientResult.body;
  const workshopResult = await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Acrylic display stand',
    description: 'Acrylic display stand, CNC router finish',
    machineType: 'cnc_router',
    targetDeliveryDate: '2026-12-20',
    salePriceCents: 2_500_000,
    technicianIds: [],
  }));
  assert.equal(workshopResult.response.status, 201);
  const workshopOrder = workshopResult.body;

  const prematureDelivery = await request(
    `/api/workshop/orders/${workshopOrder.id}/deliver`,
    jsonOptions('POST', {}),
  );
  assert.equal(prematureDelivery.response.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE kind = 'sales'").get().count, 0);

  const ready = await request(
    `/api/workshop/orders/${workshopOrder.id}/ready`,
    jsonOptions('POST', { offcuts: [] }),
  );
  assert.equal(ready.response.status, 200);
  const delivered = await request(
    `/api/workshop/orders/${workshopOrder.id}/deliver`,
    jsonOptions('POST', {}),
  );
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.body.order.status, 'delivered_archived');
  assert.match(delivered.body.invoice.code, /^INV-\d{4,}$/);
  assert.equal(delivered.body.invoice.kind, 'sales');
  assert.equal(delivered.body.invoice.client_id, client.id);
  assert.equal(delivered.body.invoice.workshop_order_id, workshopOrder.id);
  assert.equal(delivered.body.invoice.total_cents, 2_500_000);
  assert.equal(delivered.body.invoice.paid_total_cents, 0);
  assert.equal(delivered.body.invoice.remaining_cents, 2_500_000);
  assert.equal(delivered.body.invoice.payment_status, 'unpaid');
  assert.equal(delivered.body.order.sales_invoice_id, delivered.body.invoice.id);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 9_000_000);
  const duplicateDelivery = await request(
    `/api/workshop/orders/${workshopOrder.id}/deliver`,
    jsonOptions('POST', {}),
  );
  assert.equal(duplicateDelivery.response.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE kind = 'sales'").get().count, 1);

  const receipt = await request(
    `/api/finance/invoices/${delivered.body.invoice.id}/receipt`,
    jsonOptions('POST', { amountCents: 1_500_000, notes: 'First installment.' }),
  );
  assert.equal(receipt.response.status, 201);
  assert.equal(receipt.body.invoice.paid_total_cents, 1_500_000);
  assert.equal(receipt.body.invoice.remaining_cents, 1_000_000);
  assert.equal(receipt.body.invoice.payment_status, 'partial');
  assert.equal(receipt.body.treasuryEntry.kind, 'income');
  assert.equal(receipt.body.treasuryEntry.category, 'تحصيل مبيعات');
  assert.equal(receipt.body.treasuryEntry.invoice_id, delivered.body.invoice.id);
  assert.equal(receipt.body.treasuryEntry.reference, delivered.body.invoice.code);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 10_500_000);
  const overpayment = await request(
    `/api/finance/invoices/${delivered.body.invoice.id}/receipt`,
    jsonOptions('POST', { amountCents: 1_000_001 }),
  );
  assert.equal(overpayment.response.status, 409);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 10_500_000);

  const maintenanceCreated = await request('/api/maintenance/orders', jsonOptions('POST', {
    clientId: client.id,
    area: 'Cairo',
    employeeIds: [],
    notes: 'Maintenance with petty-cash custody.',
    pettyCashDisbursedCents: 200_000,
  }));
  assert.equal(maintenanceCreated.response.status, 201);
  const maintenanceOrder = maintenanceCreated.body;
  assert.equal(maintenanceOrder.order_code, 'MN-1001');
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 10_300_000);
  const custodyAdvance = db.prepare(`
    SELECT kind, category, amount_cents, maintenance_order_id, reference
    FROM treasury_entries WHERE maintenance_order_id = ?
  `).get(maintenanceOrder.id);
  assert.deepEqual(custodyAdvance, {
    kind: 'expense',
    category: 'عهدة نقدية صيانة',
    amount_cents: 200_000,
    maintenance_order_id: maintenanceOrder.id,
    reference: 'MN-1001',
  });

  const inReview = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/status`,
    jsonOptions('PATCH', {}),
  );
  assert.equal(inReview.response.status, 200);
  const archived = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/archive`,
    jsonOptions('POST', { warrantyPeriodMonths: 3, actualExpensesCents: 150_000 }),
  );
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.order.petty_cash_refund_cents, 50_000);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 10_350_000);
  const custodyRefund = db.prepare(`
    SELECT kind, category, amount_cents, maintenance_order_id, reference
    FROM treasury_entries
    WHERE maintenance_order_id = ? AND category = 'رد عهدة صيانة'
  `).get(maintenanceOrder.id);
  assert.deepEqual(custodyRefund, {
    kind: 'income',
    category: 'رد عهدة صيانة',
    amount_cents: 50_000,
    maintenance_order_id: maintenanceOrder.id,
    reference: 'MN-1001',
  });

  db.prepare("UPDATE invoices SET created_at = datetime('now', '-61 days') WHERE id = ?")
    .run(delivered.body.invoice.id);
  const salesInvoices = await request('/api/finance/invoices?kind=sales');
  assert.equal(salesInvoices.response.status, 200);
  assert.equal(salesInvoices.body.length, 1);
  assert.equal(salesInvoices.body[0].client_name, client.name);
  assert.equal(salesInvoices.body[0].client_code, client.code);
  assert.equal(salesInvoices.body[0].workshop_order_code, workshopOrder.order_code);
  const purchaseInvoices = await request('/api/finance/invoices?kind=purchase');
  assert.equal(purchaseInvoices.response.status, 200);
  assert.equal(purchaseInvoices.body[0].code, purchase.body.code);

  const statement = await request(`/api/clients/${client.id}/statement`);
  assert.equal(statement.response.status, 200);
  assert.equal(statement.body.totalBilledCents, 2_500_000);
  assert.equal(statement.body.totalPaidCents, 1_500_000);
  assert.equal(statement.body.outstandingBalanceCents, 1_000_000);
  assert.equal(statement.body.hasOverdueDebt, true);
  assert.equal(statement.body.overdueInvoices.length, 1);
  assert.equal(statement.body.overdueInvoices[0].id, delivered.body.invoice.id);
  assert.ok(statement.body.overdueInvoices[0].days_overdue > 60);

  const treasury = await request('/api/finance/treasury');
  assert.equal(treasury.response.status, 200);
  assert.equal(treasury.body.cashBalanceCents, 10_350_000);
  assert.ok(treasury.body.entries.length <= 100);
  const signedOpening = treasury.body.entries.find((entry) => entry.reference === 'Opening capitalization');
  assert.equal(signedOpening.employee_name, 'Finance Clerk');
  assert.ok(signedOpening.created_by_name);
  const linkedReceipt = treasury.body.entries.find((entry) => entry.invoice_id === delivered.body.invoice.id);
  assert.equal(linkedReceipt.invoice_code, delivered.body.invoice.code);
  assert.equal(linkedReceipt.workshop_order_code, workshopOrder.order_code);

  const invalidCents = await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income', category: 'Invalid precision', amountCents: 1.5,
  }));
  assert.equal(invalidCents.response.status, 400);
  const unaffordableExpense = await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'expense', category: 'Overdraw attempt', amountCents: 10_350_001,
  }));
  assert.equal(unaffordableExpense.response.status, 409);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 10_350_000);
});
