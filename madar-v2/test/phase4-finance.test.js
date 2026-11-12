import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

async function request(path, options = {}, cookie = authCookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(cookie ? { cookie } : {}) },
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
  const createUser = async (username, role, fullName) => request('/api/users', jsonOptions('POST', {
    username,
    role,
    full_name: fullName,
    password: 'access-guard-test-password',
  }));
  const login = async (username) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'access-guard-test-password' }),
    });
    const cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
    return { response, cookie: cookie?.split(';', 1)[0] };
  };

  const salesUser = await createUser('finance-guard-sales', 'sales', 'Sales Guard User');
  assert.equal(salesUser.response.status, 201, JSON.stringify(salesUser.body));
  assert.deepEqual(
    db.prepare('SELECT department, department_label FROM employees WHERE user_id = ?').get(salesUser.body.id),
    { department: 'Finance', department_label: 'Sales' },
    'sales HR records are labelled separately and must not gain treasury access from the shared department code',
  );
  const salesLogin = await login('finance-guard-sales');
  assert.equal(salesLogin.response.status, 200);
  assert.equal((await request('/api/finance/treasury', {}, salesLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income', category: 'Unauthorized', amountCents: 100,
  }), salesLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/finance/invoices/purchase', jsonOptions('POST', {}), salesLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/finance/invoices/1/payment', jsonOptions('POST', { amountCents: 1 }), salesLogin.cookie)).response.status, 403);

  const purchasingUser = await createUser('finance-guard-purchasing', 'purchasing', 'Purchasing Guard User');
  assert.equal(purchasingUser.response.status, 201, JSON.stringify(purchasingUser.body));
  const purchasingLogin = await login('finance-guard-purchasing');
  assert.equal(purchasingLogin.response.status, 200);
  assert.equal((await request('/api/finance/treasury', {}, purchasingLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/finance/invoices/1/receipt', jsonOptions('POST', { amountCents: 1 }), purchasingLogin.cookie)).response.status, 403);

  const financeUser = await createUser('finance-guard-clerk', 'operations', 'Finance Department Guard User');
  assert.equal(financeUser.response.status, 201, JSON.stringify(financeUser.body));
  db.prepare(`UPDATE employees SET department = 'Finance', department_label = NULL WHERE user_id = ?`)
    .run(financeUser.body.id);
  const financeLogin = await login('finance-guard-clerk');
  assert.equal(financeLogin.response.status, 200);
  assert.equal((await request('/api/finance/treasury', {}, financeLogin.cookie)).response.status, 200);

  const financeRole = await createUser('finance-guard-finance-role', 'finance', 'Finance Role User');
  assert.equal(financeRole.response.status, 201, JSON.stringify(financeRole.body));
  const financeRoleLogin = await login('finance-guard-finance-role');
  assert.equal(financeRoleLogin.response.status, 200);
  assert.equal((await request('/api/finance/treasury', {}, financeRoleLogin.cookie)).response.status, 200);

  const accountantRole = await createUser('finance-guard-accountant-role', 'accountant', 'Accountant Role User');
  assert.equal(accountantRole.response.status, 201, JSON.stringify(accountantRole.body));
  const accountantLogin = await login('finance-guard-accountant-role');
  assert.equal(accountantLogin.response.status, 200);
  assert.equal((await request('/api/finance/treasury', {}, accountantLogin.cookie)).response.status, 200);

  assert.equal((await request('/api/employees/payroll?month=2026-11', {}, salesLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/employees/payroll?month=2026-11', {}, purchasingLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/employees/payroll?month=2026-11', {}, financeRoleLogin.cookie)).response.status, 200);
  assert.equal((await request('/api/employees/payroll?month=2026-11', {}, accountantLogin.cookie)).response.status, 200);

  const auditAsAdmin = await request('/api/system/audit-log?page=1&limit=10&action=login&entityType=user');
  assert.equal(auditAsAdmin.response.status, 200, JSON.stringify(auditAsAdmin.body));
  assert.ok(auditAsAdmin.body.items.some((entry) => entry.action === 'login'), 'successful logins are audited');
  assert.equal((await request('/api/system/audit-log?page=1&limit=10', {}, financeRoleLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/system/audit-log?page=0&limit=10')).response.status, 400);
  assert.equal((await request('/api/system/audit-log?startDate=2026-02-31&endDate=2026-03-01')).response.status, 400);

  assert.equal((await request('/api/warehouse/materials', jsonOptions('POST', {}), salesLogin.cookie)).response.status, 403);
  assert.equal((await request('/api/workshop/orders', jsonOptions('POST', {}), purchasingLogin.cookie)).response.status, 403);

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
  assert.equal(purchase.body.paid_total_cents, 0);
  assert.equal(purchase.body.remaining_cents, 1_000_000);
  assert.equal(purchase.body.payment_status, 'unpaid');
  assert.equal(purchase.body.items[0].line_total_cents, 1_000_000);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 10_000_000);
  assert.equal((await request('/api/warehouse/materials')).body.find((row) => row.id === material.id).stock, 5);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM treasury_entries WHERE invoice_id = ?').get(purchase.body.id).count,
    0,
    'creating a purchase invoice records a liability but must not move treasury cash',
  );
  const purchasePaymentOperationId = randomUUID();
  const firstPaymentPayload = {
    amountCents: 600_000,
    notes: 'First supplier installment.',
    operationId: purchasePaymentOperationId,
  };
  const [partialPurchasePayment, concurrentPaymentRetry] = await Promise.all([
    request(`/api/finance/invoices/${purchase.body.id}/payment`, jsonOptions('POST', firstPaymentPayload)),
    request(`/api/finance/invoices/${purchase.body.id}/payment`, jsonOptions('POST', firstPaymentPayload)),
  ]);
  assert.equal(partialPurchasePayment.response.status, 201, JSON.stringify(partialPurchasePayment.body));
  assert.equal(concurrentPaymentRetry.response.status, 201, JSON.stringify(concurrentPaymentRetry.body));
  assert.equal(concurrentPaymentRetry.body.idempotent, true);
  assert.equal(concurrentPaymentRetry.body.treasuryEntry.id, partialPurchasePayment.body.treasuryEntry.id);
  const committedPaymentRetry = await request(
    `/api/finance/invoices/${purchase.body.id}/payment`, jsonOptions('POST', firstPaymentPayload),
  );
  assert.equal(committedPaymentRetry.response.status, 201);
  assert.equal(committedPaymentRetry.body.idempotent, true);
  assert.equal(committedPaymentRetry.body.treasuryEntry.id, partialPurchasePayment.body.treasuryEntry.id);
  const [identicalRace, conflictingRace] = await Promise.all([
    request(`/api/finance/invoices/${purchase.body.id}/payment`, jsonOptions('POST', firstPaymentPayload)),
    request(`/api/finance/invoices/${purchase.body.id}/payment`, jsonOptions('POST', {
      ...firstPaymentPayload,
      amountCents: 599_998,
    })),
  ]);
  assert.equal(identicalRace.response.status, 201);
  assert.equal(identicalRace.body.idempotent, true);
  assert.equal(conflictingRace.response.status, 409);
  assert.equal(conflictingRace.body.code, 'FINANCE_OPERATION_ID_CONFLICT');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM treasury_entries WHERE invoice_id = ?').get(purchase.body.id).count,
    1,
  );
  const changedOperationPayload = await request(
    `/api/finance/invoices/${purchase.body.id}/payment`,
    jsonOptions('POST', { ...firstPaymentPayload, amountCents: 599_999 }),
  );
  assert.equal(changedOperationPayload.response.status, 409);
  assert.equal(changedOperationPayload.body.code, 'FINANCE_OPERATION_ID_CONFLICT');
  const changedInvoiceOperation = await request(
    `/api/finance/invoices/999999/payment`, jsonOptions('POST', firstPaymentPayload),
  );
  assert.equal(changedInvoiceOperation.response.status, 409);
  assert.equal(changedInvoiceOperation.body.code, 'FINANCE_OPERATION_ID_CONFLICT');
  const changedOperationType = await request(
    `/api/finance/invoices/${purchase.body.id}/receipt`, jsonOptions('POST', firstPaymentPayload),
  );
  assert.equal(changedOperationType.response.status, 409);
  assert.equal(changedOperationType.body.code, 'FINANCE_OPERATION_ID_CONFLICT');
  const otherActorReplay = await request(
    `/api/finance/invoices/${purchase.body.id}/payment`,
    jsonOptions('POST', firstPaymentPayload),
    financeLogin.cookie,
  );
  assert.equal(otherActorReplay.response.status, 409);
  assert.equal(partialPurchasePayment.body.invoice.paid_total_cents, 600_000);
  assert.equal(partialPurchasePayment.body.invoice.remaining_cents, 400_000);
  assert.equal(partialPurchasePayment.body.invoice.payment_status, 'partial');
  assert.equal(partialPurchasePayment.body.treasuryEntry.kind, 'expense');
  assert.equal(partialPurchasePayment.body.treasuryEntry.category, 'مشتريات خامات ومواد');
  assert.equal(partialPurchasePayment.body.treasuryEntry.invoice_id, purchase.body.id);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 9_400_000);
  const overpayPurchase = await request(
    `/api/finance/invoices/${purchase.body.id}/payment`,
    jsonOptions('POST', { amountCents: 400_001 }),
  );
  assert.equal(overpayPurchase.response.status, 409);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 9_400_000);
  const retryAfterRollbackOperationId = randomUUID();
  db.exec(`CREATE TRIGGER test_abort_purchase_payment_audit BEFORE INSERT ON audit_log
    WHEN NEW.action = 'purchase_payment' BEGIN SELECT RAISE(ABORT, 'test rollback'); END;`);
  const rollbackPayload = { amountCents: 400_000, operationId: retryAfterRollbackOperationId };
  const rollbackAttempt = await request(
    `/api/finance/invoices/${purchase.body.id}/payment`, jsonOptions('POST', rollbackPayload),
  );
  assert.equal(rollbackAttempt.response.status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finance_settlement_operations WHERE operation_id = ?')
    .get(retryAfterRollbackOperationId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM treasury_entries WHERE invoice_id = ?').get(purchase.body.id).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'purchase_payment' AND entity_id = ?")
    .get(purchase.body.id).count, 1);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 9_400_000);
  db.exec('DROP TRIGGER test_abort_purchase_payment_audit');
  const finalPurchasePayment = await request(
    `/api/finance/invoices/${purchase.body.id}/payment`,
    jsonOptions('POST', rollbackPayload),
  );
  assert.equal(finalPurchasePayment.response.status, 201, JSON.stringify(finalPurchasePayment.body));
  assert.equal(finalPurchasePayment.body.invoice.paid_total_cents, 1_000_000);
  assert.equal(finalPurchasePayment.body.invoice.remaining_cents, 0);
  assert.equal(finalPurchasePayment.body.invoice.payment_status, 'paid');
  assert.notEqual(finalPurchasePayment.body.treasuryEntry.id, partialPurchasePayment.body.treasuryEntry.id);
  const fullSettlementReplay = await request(
    `/api/finance/invoices/${purchase.body.id}/payment`, jsonOptions('POST', rollbackPayload),
  );
  assert.equal(fullSettlementReplay.response.status, 201);
  assert.equal(fullSettlementReplay.body.idempotent, true);
  assert.equal(fullSettlementReplay.body.invoice.payment_status, 'paid');
  assert.equal(fullSettlementReplay.body.treasuryEntry.id, finalPurchasePayment.body.treasuryEntry.id);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 9_000_000);
  assert.deepEqual(
    db.prepare(`
      SELECT kind, category, amount_cents, invoice_id, reference
      FROM treasury_entries WHERE invoice_id = ? ORDER BY id
    `).all(purchase.body.id),
    [
      {
        kind: 'expense',
        category: 'مشتريات خامات ومواد',
        amount_cents: 600_000,
        invoice_id: purchase.body.id,
        reference: purchase.body.code,
      },
      {
        kind: 'expense',
        category: 'مشتريات خامات ومواد',
        amount_cents: 400_000,
        invoice_id: purchase.body.id,
        reference: purchase.body.code,
      },
    ],
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
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM treasury_entries WHERE invoice_id = ?').get(delivered.body.invoice.id).count,
    0,
    'workshop delivery creates the sales invoice before any separate receipt is recorded',
  );
  const duplicateDelivery = await request(
    `/api/workshop/orders/${workshopOrder.id}/deliver`,
    jsonOptions('POST', {}),
  );
  assert.equal(duplicateDelivery.response.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE kind = 'sales'").get().count, 1);

  const receiptPayload = {
    amountCents: 1_500_000,
    notes: 'First installment.',
    operationId: randomUUID(),
  };
  const receipt = await request(
    `/api/finance/invoices/${delivered.body.invoice.id}/receipt`,
    jsonOptions('POST', receiptPayload),
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
  const receiptRetry = await request(
    `/api/finance/invoices/${delivered.body.invoice.id}/receipt`, jsonOptions('POST', receiptPayload),
  );
  assert.equal(receiptRetry.response.status, 201);
  assert.equal(receiptRetry.body.idempotent, true);
  assert.equal(receiptRetry.body.treasuryEntry.id, receipt.body.treasuryEntry.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM treasury_entries WHERE invoice_id = ?')
    .get(delivered.body.invoice.id).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'sales_receipt' AND entity_id = ?")
    .get(delivered.body.invoice.id).count, 1);
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
  const legacyReceipt = await request(
    `/api/finance/invoices/${delivered.body.invoice.id}/receipt`,
    jsonOptions('POST', { amountCents: 1_000_000 }),
  );
  assert.equal(legacyReceipt.response.status, 201);
  assert.equal(legacyReceipt.body.invoice.payment_status, 'paid');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finance_settlement_operations WHERE invoice_id = ?')
    .get(delivered.body.invoice.id).count, 1, 'legacy requests remain valid and do not create idempotency records');
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 11_350_000);
});

test('monthly attendance matrix exports, bulk-marks present idempotently, and feeds draft payroll', async () => {
  const firstCreated = await request('/api/employees', jsonOptions('POST', {
    name: 'Monthly Attendance Alpha', department: 'Maintenance', monthly_salary_cents: 260_000,
  }));
  assert.equal(firstCreated.response.status, 201, JSON.stringify(firstCreated.body));
  const alpha = firstCreated.body;
  const secondCreated = await request('/api/employees', jsonOptions('POST', {
    name: 'Monthly Attendance Beta', department: 'Workshop', monthly_salary_cents: 234_000,
  }));
  assert.equal(secondCreated.response.status, 201, JSON.stringify(secondCreated.body));
  const beta = secondCreated.body;
  const inactive = await request(`/api/employees/${beta.id}`, jsonOptions('PATCH', { active: false }));
  assert.equal(inactive.response.status, 200);

  const month = '2026-02';
  const initialMatrix = await request(`/api/employees/attendance/monthly?month=${month}`);
  assert.equal(initialMatrix.response.status, 200, JSON.stringify(initialMatrix.body));
  assert.equal(initialMatrix.body.month, month);
  assert.equal(initialMatrix.body.daysInMonth, 28);
  assert.ok(initialMatrix.body.employees.some((employee) => employee.employee_id === alpha.id));
  assert.ok(!initialMatrix.body.employees.some((employee) => employee.employee_id === beta.id));

  const allPresentDate = '2026-02-03';
  const marked = await request('/api/employees/attendance/mark-all-present', jsonOptions('POST', { date: allPresentDate }));
  assert.equal(marked.response.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.count, initialMatrix.body.employees.length);
  const recordsAfterFirstMark = db.prepare('SELECT COUNT(*) AS count FROM employee_daily_attendance WHERE work_date = ?').get(allPresentDate).count;
  const markedAgain = await request('/api/employees/attendance/mark-all-present', jsonOptions('POST', { date: allPresentDate }));
  assert.equal(markedAgain.response.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM employee_daily_attendance WHERE work_date = ?').get(allPresentDate).count, recordsAfterFirstMark,
    'repeated bulk marking updates the existing employee/date rows without inserting duplicates');

  const batchSave = await request('/api/employees/attendance/monthly', jsonOptions('POST', {
    month,
    records: [
      { employeeId: alpha.id, date: '2026-02-04', status: 'absent' },
      { employeeId: alpha.id, date: '2026-02-05', status: 'leave' },
      { employeeId: alpha.id, date: '2026-02-06', status: 'late', overtimeHours: 2.5, notes: 'Half day.' },
      { employeeId: alpha.id, date: '2026-02-07', status: 'present' },
    ],
  }));
  assert.equal(batchSave.response.status, 200, JSON.stringify(batchSave.body));
  assert.equal(batchSave.body.daysInMonth, 28);
  const payroll = await request(`/api/employees/payroll?month=${month}`);
  assert.equal(payroll.response.status, 200, JSON.stringify(payroll.body));
  const alphaPayroll = payroll.body.lines.find((line) => line.employee_id === alpha.id);
  assert.equal(alphaPayroll.present_days, 3, 'bulk present, late, and present statuses count as payroll attendance');
  assert.equal(alphaPayroll.absent_days, 1);
  assert.equal(alphaPayroll.overtime_hours, 2.5);

  const exportResponse = await fetch(`${baseUrl}/api/employees/attendance/export-monthly?month=${month}`, {
    headers: { cookie: authCookie },
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.equal((await exportResponse.arrayBuffer()).byteLength > 4, true);

  const finalized = await request('/api/employees/payroll/finalize', jsonOptions('POST', { month }));
  assert.equal(finalized.response.status, 200, JSON.stringify(finalized.body));
  const lockedAttendance = await request('/api/employees/attendance/monthly', jsonOptions('POST', {
    month,
    records: [{ employeeId: alpha.id, date: '2026-02-04', status: 'present' }],
  }));
  assert.equal(lockedAttendance.response.status, 409, 'finalized payroll months cannot drift from their attendance snapshot');
});
