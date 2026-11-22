import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-procurement-atomicity-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'procurement-atomicity.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATA_DIR = join(temporaryDirectory, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.COOKIE_SECURE = 'false';
process.env.MADAR_V2_JWT_SECRET = 'test-secret-at-least-32-bytes-long-for-procurement-atomicity';
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
]);

const adminPassword = 'atomicity-test-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });

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
assert.equal(loginResponse.status, 200);
const authCookie = (loginResponse.headers.getSetCookie?.()[0] ?? loginResponse.headers.get('set-cookie'))?.split(';', 1)[0];
assert.ok(authCookie);

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
  let body = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }
  return { response, body };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('Test 1: 2-Batch partial receipts from PO: batch 1 increments stock, batch 2 increments stock, over-receipt rejected', async () => {
  // 1. Create a fresh material with 0 stock
  const mat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-2BATCH-TEST',
    name: '2-Batch Test Acrylic 3mm',
    unit: 'sheet',
    minStock: 2,
    unitCostCents: 100000, // 1,000 EGP
    initialStock: 0,
  }))).body;
  assert.equal(mat.stock, 0);

  // 2. Create Purchase Order for 10 sheets @ 1,000 EGP = 10,000 EGP (1,000,000 cents)
  const po = (await request('/api/workshop/procurement/orders', jsonOptions('POST', {
    supplier: 'Al-Safwa Industrial Materials',
    notes: 'PO for 10 sheets to test 2-batch receipt',
    items: [{
      materialId: mat.id,
      quantity: 10,
      unitCostCents: 100000,
    }],
  }))).body;
  assert.equal(po.total_cents, 1000000);
  assert.equal(po.status, 'draft');

  // Approve PO
  const approvedPo = (await request(`/api/workshop/procurement/orders/${po.id}/approve`, jsonOptions('POST', {}))).body;
  assert.equal(approvedPo.status, 'approved');
  const poItemId = approvedPo.items[0].id;

  // 3. Batch 1: Partial receipt of 4 sheets
  const gr1Res = await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
    purchaseOrderId: po.id,
    notes: 'Batch 1 of 2: 4 sheets received',
    items: [{
      poItemId,
      quantityReceived: 4,
      quantityAccepted: 4,
      warehouse: 'main',
    }],
  }));
  assert.equal(gr1Res.response.status, 201);
  const gr1 = gr1Res.body;
  assert.equal(gr1.status, 'confirmed');
  assert.equal(gr1.items[0].quantity_accepted, 4);

  // Verify stock incremented by exactly 4
  let matCheck = (await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id);
  assert.equal(matCheck.stock, 4, 'Stock after batch 1 must be exactly 4');

  // Verify PO status is partially_received with received_quantity = 4
  let poCheck = (await request(`/api/workshop/procurement/orders/${po.id}`)).body;
  assert.equal(poCheck.status, 'partially_received');
  assert.equal(poCheck.items[0].received_quantity, 4);

  // 4. Batch 2: Receive remaining 6 sheets
  const gr2Res = await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
    purchaseOrderId: po.id,
    notes: 'Batch 2 of 2: remaining 6 sheets received',
    items: [{
      poItemId,
      quantityReceived: 6,
      quantityAccepted: 6,
      warehouse: 'main',
    }],
  }));
  assert.equal(gr2Res.response.status, 201);
  const gr2 = gr2Res.body;
  assert.equal(gr2.status, 'confirmed');
  assert.equal(gr2.items[0].quantity_accepted, 6);

  // Verify stock incremented to exactly 10
  matCheck = (await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id);
  assert.equal(matCheck.stock, 10, 'Stock after batch 2 must be exactly 10');

  // Verify PO status is received with received_quantity = 10
  poCheck = (await request(`/api/workshop/procurement/orders/${po.id}`)).body;
  assert.equal(poCheck.status, 'received');
  assert.equal(poCheck.items[0].received_quantity, 10);

  // 5. Attempt over-receipt (receiving 1 more sheet on this PO) -> must be rejected with 409
  const overReceiptRes = await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
    purchaseOrderId: po.id,
    notes: 'Attempting over-receipt',
    items: [{
      poItemId,
      quantityReceived: 1,
      quantityAccepted: 1,
      warehouse: 'main',
    }],
  }));
  assert.equal(overReceiptRes.response.status, 409, 'Over-receipt must be blocked with 409 Conflict');

  // Stock must remain strictly 10
  matCheck = (await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id);
  assert.equal(matCheck.stock, 10, 'Stock must not increase after blocked over-receipt');

  // Verify exactly 2 inventory movements exist for this material
  const movements = db.prepare('SELECT * FROM inventory_movements WHERE material_id = ?').all(mat.id);
  assert.equal(movements.length, 2, 'Exactly 2 receipt movements must exist');
  assert.equal(movements[0].quantity, 4);
  assert.equal(movements[1].quantity, 6);
});

test('Test 2: Matched supplier bill creation: stock is NOT double-incremented', async () => {
  // Query material from Test 1 (MAT-2BATCH-TEST) which currently has stock = 10
  const mat = (await request('/api/warehouse/materials')).body.find((m) => m.code === 'MAT-2BATCH-TEST');
  assert.ok(mat);
  assert.equal(mat.stock, 10);

  // Find the PO for this material
  const po = (await request('/api/workshop/procurement/orders')).body.find((p) => p.supplier === 'Al-Safwa Industrial Materials');
  assert.ok(po);
  assert.equal(po.status, 'received');

  // Post matched purchase invoice (Accounts Payable)
  const matchedInvoiceRes = await request('/api/finance/invoices/purchase/matched', jsonOptions('POST', {
    purchaseOrderId: po.id,
    supplier: 'Al-Safwa Industrial Materials',
    notes: 'Matched invoice to PO and 2 Goods Receipts',
  }));
  assert.equal(matchedInvoiceRes.response.status, 201);
  const matchedInvoice = matchedInvoiceRes.body;

  assert.equal(matchedInvoice.kind, 'purchase');
  assert.equal(matchedInvoice.purchase_order_id, po.id);
  assert.equal(matchedInvoice.total_cents, 1000000);
  assert.equal(matchedInvoice.paid_total_cents, 0);
  assert.equal(matchedInvoice.remaining_cents, 1000000);
  assert.equal(matchedInvoice.payment_status, 'unpaid');
  assert.equal(matchedInvoice.status, 'approved');

  // CRITICAL CHECK: Verify material stock did NOT increment again (remains 10)
  const matAfterInvoice = (await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id);
  assert.equal(matAfterInvoice.stock, 10, 'Stock MUST remain 10 — invoice must NOT increment stock');

  // Verify inventory movements count for this material remains exactly 2
  const movements = db.prepare('SELECT * FROM inventory_movements WHERE material_id = ?').all(mat.id);
  assert.equal(movements.length, 2, 'No new inventory movement should be created by matched invoice');

  // Idempotent re-creation: posting matched invoice for the same PO returns the existing invoice
  const retryInvoiceRes = await request('/api/finance/invoices/purchase/matched', jsonOptions('POST', {
    purchaseOrderId: po.id,
  }));
  assert.ok([200, 201].includes(retryInvoiceRes.response.status));
  assert.equal(retryInvoiceRes.body.id, matchedInvoice.id);

  // Stock still remains 10
  const matRetry = (await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id);
  assert.equal(matRetry.stock, 10);
});

test('Test 3: Partial and full payment: cash moves from treasury, invoice balance decrements', async () => {
  // 1. Initial funding of treasury with 5,000,000 cents (50,000 EGP)
  const fundingRes = await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income',
    category: 'رأس مال / تمويل خزينة',
    amountCents: 5000000,
    notes: 'Initial treasury capitalization',
  }));
  assert.equal(fundingRes.response.status, 201);

  const initialBalance = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.equal(initialBalance, 5000000);

  // Find the unpaid matched invoice from Test 2
  const invoices = (await request('/api/finance/invoices?kind=purchase')).body;
  const invoice = invoices.find((inv) => inv.supplier === 'Al-Safwa Industrial Materials');
  assert.ok(invoice);
  assert.equal(invoice.total_cents, 1000000);
  assert.equal(invoice.remaining_cents, 1000000);

  // 2. Partial Payment 1: Pay 400,000 cents (4,000 EGP)
  const opId1 = randomUUID();
  const pay1Res = await request(`/api/finance/invoices/${invoice.id}/payment`, jsonOptions('POST', {
    amountCents: 400000,
    notes: 'Partial supplier payment 1 (4,000 EGP)',
    operationId: opId1,
  }));
  assert.equal(pay1Res.response.status, 201);
  assert.equal(pay1Res.body.invoice.paid_total_cents, 400000);
  assert.equal(pay1Res.body.invoice.remaining_cents, 600000);
  assert.equal(pay1Res.body.invoice.payment_status, 'partial');

  // Verify cash decreased by exactly 400,000 cents
  let currentBalance = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.equal(currentBalance, 5000000 - 400000);

  // 3. Full Remaining Payment 2: Pay the remaining 600,000 cents (6,000 EGP)
  const opId2 = randomUUID();
  const pay2Res = await request(`/api/finance/invoices/${invoice.id}/payment`, jsonOptions('POST', {
    amountCents: 600000,
    notes: 'Final settlement payment (6,000 EGP)',
    operationId: opId2,
  }));
  assert.equal(pay2Res.response.status, 201);
  assert.equal(pay2Res.body.invoice.paid_total_cents, 1000000);
  assert.equal(pay2Res.body.invoice.remaining_cents, 0);
  assert.equal(pay2Res.body.invoice.payment_status, 'paid');

  // Verify cash decreased by another 600,000 cents (total 1,000,000 cents paid)
  currentBalance = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.equal(currentBalance, 5000000 - 1000000);

  // 4. Overpayment attempt on fully paid invoice -> must fail with 409
  const overpayRes = await request(`/api/finance/invoices/${invoice.id}/payment`, jsonOptions('POST', {
    amountCents: 50000,
    notes: 'Extra payment attempt',
  }));
  assert.equal(overpayRes.response.status, 409);

  // Stock must NOT have changed at all during payments
  const mat = (await request('/api/warehouse/materials')).body.find((m) => m.code === 'MAT-2BATCH-TEST');
  assert.equal(mat.stock, 10, 'Payments must never alter material stock');
});

test('Test 4: Atomic single-action cash purchase: PO, GRN, invoice, and cash disbursement executed in one atomic transaction', async () => {
  // 1. Create a raw material with initial stock = 0
  const mat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-CASH-BUY',
    name: 'Direct Cash Buy Foam Board 10mm',
    unit: 'board',
    minStock: 1,
    unitCostCents: 75000, // 750 EGP
    initialStock: 0,
  }))).body;
  assert.equal(mat.stock, 0);

  const startBalance = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.ok(startBalance >= 375000);

  // 2. Execute Atomic Cash Purchase: 5 boards @ 750 EGP = 3,750 EGP (375,000 cents)
  const cashPurchaseRes = await request('/api/workshop/procurement/cash-purchase', jsonOptions('POST', {
    supplier: 'Al-Madina Signage Supplies',
    materialId: mat.id,
    quantity: 5,
    unitCostCents: 75000,
    warehouseId: 'main',
    notes: 'Direct emergency cash purchase for urgent sign job',
  }));
  assert.equal(cashPurchaseRes.response.status, 201);
  const result = cashPurchaseRes.body;

  assert.equal(result.success, true);
  assert.ok(result.purchaseOrderId, 'Must return purchaseOrderId');
  assert.ok(result.goodsReceiptId, 'Must return goodsReceiptId');
  assert.ok(result.invoiceId, 'Must return invoiceId');
  assert.ok(result.transactionId, 'Must return transactionId');
  assert.equal(result.newStock, 5);
  assert.equal(result.cashBalanceCents, startBalance - 375000);

  // 3. Verify Database State
  // PO check: status = received
  const poRow = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(result.purchaseOrderId);
  assert.ok(poRow);
  assert.equal(poRow.status, 'received');
  assert.equal(poRow.total_cents, 375000);

  // GRN check: status = confirmed
  const grRow = db.prepare('SELECT * FROM goods_receipts WHERE id = ?').get(result.goodsReceiptId);
  assert.ok(grRow);
  assert.equal(grRow.status, 'confirmed');

  // Stock check: incremented by 5 in main warehouse
  const matRow = db.prepare('SELECT stock FROM materials WHERE id = ?').get(mat.id);
  assert.equal(matRow.stock, 5);

  // Inventory movement check: exactly 1 movement created
  const movements = db.prepare('SELECT * FROM inventory_movements WHERE material_id = ?').all(mat.id);
  assert.equal(movements.length, 1, 'Exactly one movement for the goods receipt');
  assert.equal(movements[0].quantity, 5);
  assert.equal(movements[0].unit_cost_cents, 75000);

  // Invoice check: matched to PO & GRN, status = approved, payment_status = paid
  const invRow = db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.invoiceId);
  assert.ok(invRow);
  assert.equal(invRow.purchase_order_id, result.purchaseOrderId);
  assert.equal(invRow.goods_receipt_id, result.goodsReceiptId);
  assert.equal(invRow.payment_status, 'paid');
  assert.equal(invRow.paid_total_cents, 375000);
  assert.equal(invRow.remaining_cents, 0);

  // Treasury entry check: expense entry for invoice
  const treasuryRow = db.prepare('SELECT * FROM treasury_entries WHERE id = ?').get(result.transactionId);
  assert.ok(treasuryRow);
  assert.equal(treasuryRow.kind, 'expense');
  assert.equal(treasuryRow.amount_cents, 375000);
  assert.equal(treasuryRow.invoice_id, result.invoiceId);

  // 4. Atomicity check: insufficient cash rolls back entire transaction
  const currentCash = (await request('/api/finance/treasury')).body.cashBalanceCents;
  const insufficientAmount = currentCash + 1000000; // More than available

  const failRes = await request('/api/workshop/procurement/cash-purchase', jsonOptions('POST', {
    supplier: 'Should Fail Supplier',
    materialId: mat.id,
    quantity: 1000,
    unitCostCents: insufficientAmount,
  }));
  assert.equal(failRes.response.status, 409, 'Must fail with 409 for insufficient cash');

  // Verify ZERO state changes occurred from the failed attempt:
  // Material stock unchanged
  const matAfterFail = db.prepare('SELECT stock FROM materials WHERE id = ?').get(mat.id);
  assert.equal(matAfterFail.stock, 5);
  // Cash balance unchanged
  const cashAfterFail = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.equal(cashAfterFail, currentCash);
});

test('Test 5: Idempotency replay test: replaying request with identical operationId returns original response without creating duplicate movements, invoices, or treasury records', async () => {
  // 1. Create a fresh material
  const mat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-IDEMPOTENT',
    name: 'Idempotency Test Clear Acrylic',
    unit: 'sheet',
    minStock: 1,
    unitCostCents: 120000, // 1,200 EGP
    initialStock: 0,
  }))).body;
  assert.equal(mat.stock, 0);

  const startBalance = (await request('/api/finance/treasury')).body.cashBalanceCents;
  const opId = randomUUID();

  const payload = {
    supplier: 'Pyramids Acrylic Distribution',
    materialId: mat.id,
    quantity: 2,
    unitCostCents: 120000, // Total 240,000 cents (2,400 EGP)
    warehouseId: 'main',
    notes: 'Idempotent cash purchase test',
    operationId: opId,
  };

  // 2. Initial request
  const firstRes = await request('/api/workshop/procurement/cash-purchase', jsonOptions('POST', payload));
  assert.equal(firstRes.response.status, 201);
  const firstData = firstRes.body;
  assert.equal(firstData.success, true);
  assert.equal(firstData.newStock, 2);
  assert.equal(firstData.cashBalanceCents, startBalance - 240000);

  // Verify stock = 2 and cash decreased
  let currentMat = db.prepare('SELECT stock FROM materials WHERE id = ?').get(mat.id);
  assert.equal(currentMat.stock, 2);
  let currentCash = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.equal(currentCash, startBalance - 240000);

  // 3. Replay EXACT same request with same operationId
  const replayRes = await request('/api/workshop/procurement/cash-purchase', jsonOptions('POST', payload));
  assert.ok(replayRes.response.status === 200 || replayRes.response.status === 201);
  const replayData = replayRes.body;

  // Must return original entity IDs
  assert.equal(replayData.purchaseOrderId, firstData.purchaseOrderId);
  assert.equal(replayData.goodsReceiptId, firstData.goodsReceiptId);
  assert.equal(replayData.invoiceId, firstData.invoiceId);
  assert.equal(replayData.transactionId, firstData.transactionId);
  assert.equal(replayData.idempotent, true);

  // CRITICAL VERIFICATION: Zero duplicate movements, invoices, or treasury records
  currentMat = db.prepare('SELECT stock FROM materials WHERE id = ?').get(mat.id);
  assert.equal(currentMat.stock, 2, 'Stock must NOT be incremented on replay');

  currentCash = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.equal(currentCash, startBalance - 240000, 'Cash must NOT be deducted again on replay');

  const movementsCount = db.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE material_id = ?').get(mat.id).count;
  assert.equal(movementsCount, 1, 'Only one movement must exist in database');

  const invoicesCount = db.prepare('SELECT COUNT(*) AS count FROM invoices WHERE purchase_order_id = ?').get(firstData.purchaseOrderId).count;
  assert.equal(invoicesCount, 1, 'Only one invoice must exist in database');

  const treasuryCount = db.prepare('SELECT COUNT(*) AS count FROM treasury_entries WHERE invoice_id = ?').get(firstData.invoiceId).count;
  assert.equal(treasuryCount, 1, 'Only one treasury entry must exist in database');

  // 4. Replay attempt with same operationId but DIFFERENT financial content -> must fail with 409
  const conflictingPayload = {
    ...payload,
    quantity: 99, // Changed quantity
  };
  const conflictRes = await request('/api/workshop/procurement/cash-purchase', jsonOptions('POST', conflictingPayload));
  assert.equal(conflictRes.response.status, 409, 'Replay with altered payload must be rejected with 409 Conflict');

  // 5. Test idempotency replay on supplier payment endpoint as well
  // Create another invoice to test payment idempotency
  const newMat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-PAY-IDEMPOTENT',
    name: 'Payment Idempotency Test Material',
    unit: 'sheet',
    minStock: 1,
    unitCostCents: 50000,
    initialStock: 5,
  }))).body;

  const po = (await request('/api/workshop/procurement/orders', jsonOptions('POST', {
    supplier: 'Payment Idempotency Supplier',
    items: [{ materialId: newMat.id, quantity: 2, unitCostCents: 50000 }],
  }))).body;
  await request(`/api/workshop/procurement/orders/${po.id}/approve`, jsonOptions('POST', {}));
  await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
    purchaseOrderId: po.id,
    items: [{ poItemId: po.items[0].id, quantityReceived: 2, quantityAccepted: 2 }],
  }));
  const inv = (await request('/api/finance/invoices/purchase/matched', jsonOptions('POST', {
    purchaseOrderId: po.id,
  }))).body;

  const paymentOpId = randomUUID();
  const pay1 = await request(`/api/finance/invoices/${inv.id}/payment`, jsonOptions('POST', {
    amountCents: 50000,
    notes: 'Idempotent partial payment',
    operationId: paymentOpId,
  }));
  assert.equal(pay1.response.status, 201);
  assert.equal(pay1.body.invoice.paid_total_cents, 50000);

  const preReplayBalance = (await request('/api/finance/treasury')).body.cashBalanceCents;

  // Replay payment with identical operationId
  const payReplay = await request(`/api/finance/invoices/${inv.id}/payment`, jsonOptions('POST', {
    amountCents: 50000,
    notes: 'Idempotent partial payment',
    operationId: paymentOpId,
  }));
  assert.ok(payReplay.response.status === 200 || payReplay.response.status === 201);
  assert.equal(payReplay.body.idempotent, true);

  // Verify balance and invoice paid amount are NOT double-deducted
  const postReplayBalance = (await request('/api/finance/treasury')).body.cashBalanceCents;
  assert.equal(postReplayBalance, preReplayBalance, 'Replayed payment must not disburse additional cash');

  const invAfterReplay = db.prepare('SELECT paid_total_cents FROM invoices WHERE id = ?').get(inv.id);
  assert.equal(invAfterReplay.paid_total_cents, 50000, 'Invoice paid amount must remain 50,000 cents');
});
