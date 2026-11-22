import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-cost-val-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'cost-val.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATA_DIR = join(temporaryDirectory, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.COOKIE_SECURE = 'false';
process.env.MADAR_V2_JWT_SECRET = 'test-secret-at-least-32-bytes-long-for-madar-cost-val';
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }, { setWorkshopOverheadRate }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/workshop/costing.js'),
]);

const adminPassword = 'cost-val-test-admin-password';
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

function jsonOptions(method, payload) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

test('Test 1: Receipt costing reconciles: 10 sheets @ EGP 1,000 and 5 sheets @ EGP 1,300 yield EGP 16,500 total and EGP 1,100 average', async () => {
  // Step 1: Create initial material in warehouse: 10 sheets @ 1,000 EGP (100,000 cents)
  const matRes = await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'ACR-CLR-3MM-VAL',
    name: 'Cast Clear Acrylic 3mm Valuation',
    specification: 'Cast acrylic sheet 2050x3050mm 3mm',
    unit: 'sheet',
    minStock: 2,
    unitCostCents: 100000, // 1,000 EGP
    initialStock: 10,
  }));
  assert.equal(matRes.response.status, 201);
  const material = matRes.body;
  assert.equal(material.stock, 10);
  assert.equal(material.unit_cost_cents, 100000);
  assert.equal(material.weighted_average_cost_cents, 100000);

  // Step 2: Create and approve Purchase Order for 5 sheets @ 1,300 EGP (130,000 cents)
  const poRes = await request('/api/workshop/procurement/orders', jsonOptions('POST', {
    supplier: 'Delta Acrylic Imports Co.',
    notes: 'PO for 5 additional sheets at updated supplier rate',
    items: [{
      materialId: material.id,
      quantity: 5,
      unitCostCents: 130000, // 1,300 EGP
    }],
  }));
  assert.equal(poRes.response.status, 201);
  const po = poRes.body;
  const poItemId = po.items[0].id;

  const approveRes = await request(`/api/workshop/procurement/orders/${po.id}/approve`, jsonOptions('POST', {}));
  assert.equal(approveRes.response.status, 200);

  // Step 3: Receive the 5 sheets via Goods Receipt
  const grRes = await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
    purchaseOrderId: po.id,
    notes: 'Received full batch of 5 sheets',
    items: [{
      poItemId,
      quantityReceived: 5,
      quantityAccepted: 5,
    }],
  }));
  assert.equal(grRes.response.status, 201);

  // Step 4: Verification of Moving Weighted Average:
  // Formula: ((10 * 100,000) + (5 * 130,000)) / (10 + 5) = (1,000,000 + 650,000) / 15 = 1,650,000 / 15 = 110,000 cents (1,100 EGP)
  // Total inventory valuation: 15 sheets * 110,000 cents = 1,650,000 cents = 16,500 EGP
  const updatedMatRes = await request(`/api/warehouse/materials/${material.id}/cost-figures`);
  assert.equal(updatedMatRes.response.status, 200);
  const updatedMat = updatedMatRes.body;

  assert.equal(updatedMat.stock, 15, 'Total stock must be 10 + 5 = 15 sheets');
  assert.equal(updatedMat.unit_cost_cents, 110000, 'Unit cost must be moving weighted average: 1,100 EGP (110,000 cents)');
  assert.equal(updatedMat.weighted_average_cost_cents, 110000, 'Weighted average cost must be 1,100 EGP');

  const totalInventoryValuationCents = Math.round(updatedMat.stock * updatedMat.unit_cost_cents);
  assert.equal(totalInventoryValuationCents, 1650000, 'Total inventory value must be exactly 16,500 EGP (1,650,000 cents)');

  // Step 5: Verify cash purchase also updates moving weighted average:
  // Fund treasury opening balance for cash purchases
  await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income',
    category: 'رأس مال / تمويل خزينة',
    amountCents: 10000000, // 100,000 EGP
    notes: 'Treasury funding for direct cash purchases',
  }));

  // Cash purchase 5 sheets @ 1,400 EGP (140,000 cents)
  // New weighted avg = ((15 * 110,000) + (5 * 140,000)) / 20 = (1,650,000 + 700,000) / 20 = 2,350,000 / 20 = 117,500 cents (1,175 EGP)
  const cashRes = await request('/api/workshop/procurement/cash-purchase', jsonOptions('POST', {
    supplier: 'Spot Market Acrylic Trader',
    materialId: material.id,
    quantity: 5,
    unitCostCents: 140000, // 1,400 EGP
    notes: 'Direct cash spot purchase',
  }));
  assert.equal(cashRes.response.status, 201);

  const matAfterCashRes = await request(`/api/warehouse/materials/${material.id}/cost-figures`);
  const matAfterCash = matAfterCashRes.body;
  assert.equal(matAfterCash.stock, 20);
  assert.equal(matAfterCash.unit_cost_cents, 117500, 'Weighted avg after spot purchase: 1,175 EGP');
  assert.equal(matAfterCash.weighted_average_cost_cents, 117500);
  const totalValuationAfterCash = Math.round(matAfterCash.stock * matAfterCash.unit_cost_cents);
  assert.equal(totalValuationAfterCash, 2350000, 'Total inventory value: 23,500 EGP (2,350,000 cents)');
});

test('Test 2: New supplier quote updates replacement estimate without altering approved job costs', async () => {
  // Step 1: Create client
  const clientRes = await request('/api/clients', jsonOptions('POST', { name: 'Replacement Cost Integrity Client' }));
  const client = clientRes.body;

  // Step 2: Create material with cost 1,000 EGP (100,000 cents)
  const matRes = await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'ACR-CAST-WHITE-HIST',
    name: 'Cast White Acrylic 3mm Historical',
    unit: 'sheet',
    minStock: 2,
    unitCostCents: 100000, // 1,000 EGP
    replacementCostCents: 100000,
    initialStock: 10,
  }));
  const mat = matRes.body;

  // Step 3: Create quotation with estimated cost 9,000 EGP and net sale 12,000 EGP (25% margin)
  const quoteRes = await request('/api/workshop/quotations', jsonOptions('POST', {
    clientId: client.id,
    title: 'Illuminated Acrylic Letters for CIB',
    productType: 'channel_letters',
    targetMargin: 0.25,
    manualNetSalePriceCents: 1200000, // 12,000 EGP
    specifications: {
      letterHeightCm: 40,
      letterCount: 10,
      depthCm: 8,
    },
  }));
  const quote = quoteRes.body;

  // Approve quotation -> creates immutable snapshot with SHA-256 hash
  const approveQuoteRes = await request(`/api/workshop/quotations/${quote.id}/approve`, jsonOptions('POST', {}));
  assert.equal(approveQuoteRes.response.status, 200);

  const quoteBefore = (await request(`/api/workshop/quotations/${quote.id}`)).body;
  const initialSnapshotHash = quoteBefore.snapshots[0].snapshot_hash;
  assert.ok(initialSnapshotHash);

  // Convert to workshop order
  const convertRes = await request(`/api/workshop/quotations/${quote.id}/convert-to-order`, jsonOptions('POST', {}));
  const orderId = convertRes.body.orderId;

  // Issue 1 sheet of acrylic to the job at current stamped cost (100,000 cents = 1,000 EGP)
  const issueRes = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: orderId,
    sourceWarehouse: 'main',
    materialId: mat.id,
    quantity: 1,
    notes: 'Issuing 1 sheet for face cutting',
  }));
  assert.equal(issueRes.response.status, 201);

  // Costing before supplier quote update
  const costingBefore = (await request(`/api/workshop/orders/${orderId}/costing`)).body;
  assert.equal(costingBefore.materialCostCents, 100000, 'Material cost charged to job must be 1,000 EGP');

  // Step 4: New supplier quote arrives with steep price increase to 2,000 EGP (200,000 cents)
  // Update replacement estimate via POST /api/warehouse/materials/:id/replacement-cost
  const updateReplRes = await request(`/api/warehouse/materials/${mat.id}/replacement-cost`, jsonOptions('POST', {
    replacementCostCents: 200000, // 2,000 EGP replacement quote
  }));
  assert.equal(updateReplRes.response.status, 200);
  assert.equal(updateReplRes.body.replacement_cost_cents, 200000);

  // Verify the 3 distinct material cost figures exposed by API:
  // (a) Moving weighted average monthly receipt cost: 100,000 cents
  // (b) Actual issued cost net of approved credits: 100,000 cents
  // (c) Current replacement estimate: 200,000 cents
  const costFigures = (await request(`/api/warehouse/materials/${mat.id}/cost-figures`)).body;
  assert.equal(costFigures.unit_cost_cents, 100000, 'Historical unit cost must remain unchanged at 1,000 EGP');
  assert.equal(costFigures.weighted_average_cost_cents, 100000, 'Moving weighted average receipt cost remains 1,000 EGP');
  assert.equal(costFigures.replacement_cost_cents, 200000, 'Replacement cost reflects new quote of 2,000 EGP');

  // CRITICAL VERIFICATION:
  // 1. Approved historical job costing must NOT be repriced
  const costingAfter = (await request(`/api/workshop/orders/${orderId}/costing`)).body;
  assert.equal(costingAfter.materialCostCents, 100000, 'Historical job material cost must stay 1,000 EGP and not be repriced');
  assert.equal(costingAfter.actualIssuedCostNetCents, 100000);

  // 2. Frozen quotation snapshot must NOT be altered
  const quoteAfter = (await request(`/api/workshop/quotations/${quote.id}`)).body;
  assert.equal(quoteAfter.snapshots[0].snapshot_hash, initialSnapshotHash, 'Snapshot hash must remain identical');
  const snapshotPayload = db.prepare('SELECT snapshot_payload_json FROM quotation_snapshots WHERE id = ?').get(quoteAfter.snapshots[0].id);
  const parsed = JSON.parse(snapshotPayload.snapshot_payload_json);
  assert.equal(parsed.estimatedCostCents, quote.estimated_cost_cents, 'Quotation estimated cost remains frozen');
});

test('Test 3: Rent rate change across two months applies only to work recorded in the respective period', async () => {
  // Step 1: Set period-effective overhead / rent rates for two distinct calendar months:
  // Month A: October 2026 -> 150 EGP/hr (15,000 cents)
  // Month B: November 2026 -> 250 EGP/hr (25,000 cents)
  setWorkshopOverheadRate({ yearMonth: '2026-10', hourlyRateCents: 15000, rentAllocationCents: 3000000 }, db);
  setWorkshopOverheadRate({ yearMonth: '2026-11', hourlyRateCents: 25000, rentAllocationCents: 4000000 }, db);

  // Verify rates were recorded in workshop_overhead_rates table
  const rateOct = db.prepare('SELECT * FROM workshop_overhead_rates WHERE year_month = ?').get('2026-10');
  const rateNov = db.prepare('SELECT * FROM workshop_overhead_rates WHERE year_month = ?').get('2026-11');
  assert.equal(rateOct.hourly_rate_cents, 15000);
  assert.equal(rateNov.hourly_rate_cents, 25000);

  // Step 2: Create a workshop order spanning work across both months
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Multi-Month Factory Order Client' }))).body;
  const order = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Two-Month Production Job',
    machineType: 'laser',
    salePriceCents: 500000,
    technicianIds: [],
  }))).body;

  const techId = Number(db.prepare(`
    INSERT INTO employees (name, department, job_title, base_salary_cents)
    VALUES ('Overhead Rate Specialist', 'Workshop', 'CNC Operator', 1500000)
  `).run().lastInsertRowid);
  db.prepare('INSERT INTO workshop_order_technicians (order_id, employee_id) VALUES (?, ?)').run(order.id, techId);

  // Step 3: Record work in Month A (October 2026): 120 minutes (2.0 hours) of CNC machine work
  db.prepare(`
    INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents, created_at)
    VALUES (?, ?, 'cnc_laser', 'complete', 120, 10000, '2026-10-15 10:30:00')
  `).run(order.id, techId);

  // Record work in Month B (November 2026): 180 minutes (3.0 hours) of CNC machine work
  db.prepare(`
    INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents, created_at)
    VALUES (?, ?, 'cnc_laser', 'complete', 180, 10000, '2026-11-20 14:00:00')
  `).run(order.id, techId);

  // Step 4: Verify costing uses period-effective rates:
  // Month A: 2 hours @ 150 EGP/hr (15,000 cents) = 30,000 cents (300 EGP)
  // Month B: 3 hours @ 250 EGP/hr (25,000 cents) = 75,000 cents (750 EGP)
  // Expected total machine/overhead cost = 30,000 + 75,000 = 105,000 cents (1,050 EGP)
  const costing1 = (await request(`/api/workshop/orders/${order.id}/costing`)).body;
  assert.equal(costing1.totalMachineMinutes, 300, 'Total machine time: 120 + 180 = 300 minutes (5 hours)');
  assert.equal(costing1.machineCostCents, 105000, 'Machine/overhead cost must be 30,000 (Oct) + 75,000 (Nov) = 105,000 cents');

  assert.equal(costing1.monthlyOverheadAllocations.length, 2);
  const octAlloc = costing1.monthlyOverheadAllocations.find((a) => a.yearMonth === '2026-10');
  const novAlloc = costing1.monthlyOverheadAllocations.find((a) => a.yearMonth === '2026-11');
  assert.equal(octAlloc.hourlyRateCents, 15000);
  assert.equal(octAlloc.costCents, 30000);
  assert.equal(novAlloc.hourlyRateCents, 25000);
  assert.equal(novAlloc.costCents, 75000);

  // Step 5: Update November rate to 350 EGP/hr (35,000 cents)
  // Strictly verify: October work remains 30,000 cents; only November work re-evaluates to 3 * 35,000 = 105,000 cents
  setWorkshopOverheadRate({ yearMonth: '2026-11', hourlyRateCents: 35000 }, db);

  const costing2 = (await request(`/api/workshop/orders/${order.id}/costing`)).body;
  assert.equal(costing2.machineCostCents, 135000, 'October work stays at 30,000 cents; November work updates to 105,000 cents (total 135,000 cents)');
  const octAlloc2 = costing2.monthlyOverheadAllocations.find((a) => a.yearMonth === '2026-10');
  const novAlloc2 = costing2.monthlyOverheadAllocations.find((a) => a.yearMonth === '2026-11');
  assert.equal(octAlloc2.costCents, 30000, 'Work recorded in month A strictly preserves month A evaluation');
  assert.equal(novAlloc2.costCents, 105000, 'Work recorded in month B evaluates with month B rate');
});

test('Test 4: Net sale of EGP 12,000 moves from estimated 25% margin (EGP 9,000 cost) to actual 20% margin (EGP 9,600 cost), with EGP 600 variance fully traced to actual records', async () => {
  // Reset standard November 2026 machine rate to 200 EGP/hr (20,000 cents) for pilot execution
  setWorkshopOverheadRate({ yearMonth: '2026-11', hourlyRateCents: 20000 }, db);

  // Step 1: Create client and material
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Pilot Financial Trace Client' }))).body;

  const mat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'ACR-RED-PILOT',
    name: 'Red Acrylic 3mm Pilot Batch',
    unit: 'sheet',
    minStock: 2,
    unitCostCents: 272500, // 2,725 EGP per sheet
    initialStock: 10,
  }))).body;

  // Step 2: Create quotation with Net Sale = 12,000 EGP, Estimated Cost = 9,000 EGP (25.0% target margin, 3,000 EGP profit)
  const quote = (await request('/api/workshop/quotations', jsonOptions('POST', {
    clientId: client.id,
    title: 'Custom Illuminated Letters Pilot Order',
    productType: 'channel_letters',
    targetMargin: 0.25,
    manualNetSalePriceCents: 1200000, // 12,000 EGP
  }))).body;

  // Update estimate directly in product_quotations to match pilot specification:
  // Estimated Cost = 9,000 EGP (900,000 cents), Net Sale = 12,000 EGP (1,200,000 cents), Margin = 25%
  db.prepare(`
    UPDATE product_quotations
    SET estimated_cost_cents = 900000, net_sale_price_cents = 1200000, target_margin = 0.25
    WHERE id = ?
  `).run(quote.id);

  // Approve quotation -> immutable snapshot frozen with 9,000 EGP estimate
  await request(`/api/workshop/quotations/${quote.id}/approve`, jsonOptions('POST', {}));

  // Convert quotation to order
  const convertRes = await request(`/api/workshop/quotations/${quote.id}/convert-to-order`, jsonOptions('POST', {}));
  const orderId = convertRes.body.orderId;

  // Step 3: Production Execution & Recorded Costs
  const techId = Number(db.prepare(`
    INSERT INTO employees (name, department, job_title, base_salary_cents)
    VALUES ('Senior Letter Craftsman', 'Workshop', 'Senior Craftsman', 2500000)
  `).run().lastInsertRowid);
  db.prepare('INSERT INTO workshop_order_technicians (order_id, employee_id) VALUES (?, ?)').run(orderId, techId);

  // A. Material Issuance: 2 sheets @ 2,725 EGP = 5,450 EGP (545,000 cents)
  await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: orderId,
    sourceWarehouse: 'main',
    materialId: mat.id,
    quantity: 2,
    notes: 'Issued 2 sheets for letters cutting',
  }));

  // B. Offcut Return Credit: -250 EGP (-25,000 cents)
  await request('/api/warehouse/return', jsonOptions('POST', {
    workshopOrderId: orderId,
    targetWarehouse: 'secondary',
    materialId: mat.id,
    quantity: 1,
    unit: 'piece',
    offcutName: 'Red Acrylic Offcut 120x80cm',
    offcutDimensions: '120x80 cm',
    notes: 'Usable offcut returned from sheet 2',
  }));
  db.prepare(`
    UPDATE inventory_movements
    SET unit_cost_cents = 25000
    WHERE source_id = ? AND kind = 'offcut_return'
  `).run(orderId);
  // Net Material Cost = 5,450 EGP - 250 EGP = 5,200 EGP (520,000 cents)

  // C. Machine Time: 390 min (6.5 hours) @ 200 EGP/hr CNC rate = 1,300 EGP (130,000 cents)
  await request(`/api/workshop/orders/${orderId}/stage-log`, jsonOptions('POST', {
    stageName: 'cnc_laser',
    action: 'complete',
    durationMinutes: 390,
    notes: 'CNC cutting and letter profiling',
  }));

  // D. Assembly Labor: 960 min (16.0 hours) @ 100 EGP/hr = 1,600 EGP (160,000 cents)
  db.prepare(`
    INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents)
    VALUES (?, ?, 'bending_assembly', 'complete', 960, 10000)
  `).run(orderId, techId);

  // E. Site Installation Labor: 900 min (15.0 hours) @ 100 EGP/hr = 1,500 EGP (150,000 cents)
  db.prepare(`
    INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents)
    VALUES (?, ?, 'site_installation', 'complete', 900, 10000)
  `).run(orderId, techId);

  // Total Actual Cost = 5,200 (net material) + 1,300 (machine) + 1,600 (assembly) + 1,500 (installation) = 9,600 EGP (960,000 cents)

  // Step 4: Quality review and delivery
  await request(`/api/workshop/orders/${orderId}/qa-review`, jsonOptions('POST', {
    decision: 'approved',
    notes: 'Quality inspection passed with clean joints and uniform illumination',
  }));

  const deliverRes = (await request(`/api/workshop/orders/${orderId}/deliver`, jsonOptions('POST', {
    archiveMonth: '2026-11',
  }))).body;
  assert.equal(deliverRes.order.status, 'delivered_archived');
  assert.equal(deliverRes.invoice.total_cents, 1200000); // 12,000 EGP sales invoice

  // Step 5: Verify Financial Reconciliation & Variance in GET /api/workshop/orders/:id/costing
  const costing = (await request(`/api/workshop/orders/${orderId}/costing`)).body;

  // Sale price & revenue
  assert.equal(costing.salePriceCents, 1200000, 'Net sale must be 12,000 EGP (1,200,000 cents)');

  // Actual cost breakdown
  assert.equal(costing.grossMaterialCostCents, 545000, 'Gross material: 5,450 EGP');
  assert.equal(costing.offcutCreditsCents, 25000, 'Offcut credit: 250 EGP');
  assert.equal(costing.materialCostCents, 520000, 'Net material cost: 5,200 EGP');
  assert.equal(costing.machineCostCents, 130000, 'Machine cost: 1,300 EGP');
  assert.equal(costing.laborCostCents, 310000, 'Labor cost (assembly + install): 3,100 EGP');
  assert.equal(costing.totalCostCents, 960000, 'Actual total cost must be 9,600 EGP (960,000 cents)');

  // Profit and Margin
  assert.equal(costing.grossProfitCents, 240000, 'Actual gross profit must be 2,400 EGP (12,000 - 9,600)');
  assert.equal(costing.marginPercent, 20.0, 'Actual profit margin moves from estimated 25.0% to actual 20.0%');
  assert.equal(costing.markupPercent, 25.0, 'Actual markup on cost: 2,400 / 9,600 = 25.0%');

  // Exact +600 EGP variance reconciliation
  assert.ok(costing.variance, 'Variance analysis must be present');
  assert.equal(costing.variance.estimatedTotalCostCents, 900000, 'Estimated cost was 9,000 EGP');
  assert.equal(costing.variance.actualTotalCostCents, 960000, 'Actual cost was 9,600 EGP');
  assert.equal(costing.variance.varianceCents, 60000, 'Variance must be exactly +600 EGP (+60,000 cents)');
  assert.equal(costing.variance.estimatedProfitCents, 300000, 'Estimated profit was 3,000 EGP');
  assert.equal(costing.variance.actualProfitCents, 240000, 'Actual profit was 2,400 EGP');
  assert.equal(costing.variance.estimatedMarginPercent, 25.0, 'Estimated margin was 25.0%');
  assert.equal(costing.variance.actualMarginPercent, 20.0, 'Actual margin was 20.0%');

  // Step 6: Verify Unified Order Traceability in GET /api/workshop/orders/:id/trace
  const trace = (await request(`/api/workshop/orders/${orderId}/trace`)).body;
  assert.equal(trace.order.id, orderId);
  assert.equal(trace.order.order_code, costing.orderCode);
  assert.equal(trace.quotation.id, quote.id);
  assert.ok(trace.quotationSnapshot, 'Quotation snapshot must be present in trace');

  // Production records fully traced
  assert.equal(trace.production.stageLogs.length, 3, 'Must trace 3 stage logs (CNC, assembly, installation)');
  assert.equal(trace.production.inspections.length, 1, 'Must trace QA approval inspection');
  assert.equal(trace.production.materialMovements.length, 2, 'Must trace 2 material movements (issue + offcut return)');

  // Sales invoice traced
  assert.equal(trace.salesAndTreasury.salesInvoice.id, deliverRes.invoice.id);
  assert.equal(trace.salesAndTreasury.salesInvoice.total_cents, 1200000);

  // Costing variance traced in trace root and costing sub-object
  assert.equal(trace.costing.totalCostCents, 960000);
  assert.equal(trace.costingVariance.varianceCents, 60000);
  assert.equal(trace.costingVariance.actualMarginPercent, 20.0);
  assert.equal(trace.costingVariance.estimatedMarginPercent, 25.0);
});
