import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-jobcost-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'jobcost.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
]);

const adminPassword = 'jobcost-test-admin-password';
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

test('1. Parametric Calculator validates formulas, sheet layout assumptions, and edge cases', async () => {
  const { calculateSignageJobEstimate } = await import('../server/modules/workshop/quotations.service.js');

  // Lettering pilot calculation
  const estimate = calculateSignageJobEstimate('channel_letters', {
    letterHeightCm: 50,
    letterCount: 8,
    depthCm: 10,
    acrylicSheetCostCents: 150000,
    forexSheetCostCents: 50000,
    ledModuleCostCents: 1500,
    cncHourlyRateCents: 20000,
    laborHourlyRateCents: 10000,
  }, 0.25);

  assert.ok(estimate.totalCostCents > 0);
  assert.ok(estimate.netSalePriceCents > estimate.totalCostCents);
  assert.equal(estimate.marginPercent, 25);
  // Markup = Profit / Cost
  const expectedProfit = estimate.netSalePriceCents - estimate.totalCostCents;
  const expectedMarkup = Math.round((expectedProfit / estimate.totalCostCents) * 1000) / 10;
  assert.equal(estimate.markupPercent, expectedMarkup);

  // Invalid margin >= 1.0 must throw
  assert.throws(() => calculateSignageJobEstimate('channel_letters', {}, 1.0), /targetMargin must be a number between 0 and 0.99/);
  assert.throws(() => calculateSignageJobEstimate('channel_letters', {}, -0.1), /targetMargin must be a number between 0 and 0.99/);

  // Zero cost edge case does not crash or produce NaN
  const zeroEstimate = calculateSignageJobEstimate('custom_signage', {}, 0.25);
  assert.equal(zeroEstimate.totalCostCents, 0);
  assert.equal(zeroEstimate.netSalePriceCents, 0);
  assert.equal(zeroEstimate.marginPercent, 0);
  assert.equal(zeroEstimate.markupPercent, 0);
});

test('2. Quotations workflow, approval gating, and immutable snapshot preservation', async () => {
  // Create client
  const clientRes = await request('/api/clients', jsonOptions('POST', { name: 'Signage Client Test' }));
  assert.equal(clientRes.response.status, 201);
  const clientId = clientRes.body.id;

  // Create material in catalog
  const matRes = await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'ACR-3MM-WHITE',
    name: 'Cast Acrylic White 3mm',
    unit: 'sheet',
    minStock: 2,
    unitCostCents: 120000,
    initialStock: 10,
  }));
  assert.equal(matRes.response.status, 201);

  // Create quotation with low margin (15%) -> enters pending_approval
  const lowMarginQuote = await request('/api/workshop/quotations', jsonOptions('POST', {
    clientId,
    title: 'Low Margin Job',
    productType: 'channel_letters',
    targetMargin: 0.15,
  }));
  assert.equal(lowMarginQuote.response.status, 201);
  assert.equal(lowMarginQuote.body.status, 'pending_approval');

  // Create quotation with standard 25% margin -> enters draft
  const normalQuote = await request('/api/workshop/quotations', jsonOptions('POST', {
    clientId,
    title: 'CIB Bank Illuminated Channel Letters',
    productType: 'channel_letters',
    targetMargin: 0.25,
    specifications: {
      letterHeightCm: 40,
      letterCount: 10,
      depthCm: 8,
    },
  }));
  assert.equal(normalQuote.response.status, 201);
  assert.equal(normalQuote.body.status, 'draft');
  const quoteId = normalQuote.body.id;
  const originalCost = normalQuote.body.estimated_cost_cents;
  const originalPrice = normalQuote.body.net_sale_price_cents;

  // Approve quotation -> creates immutable snapshot
  const approved = await request(`/api/workshop/quotations/${quoteId}/approve`, jsonOptions('POST', {}));
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, 'approved');
  assert.equal(approved.body.snapshots.length, 1);
  assert.ok(approved.body.snapshots[0].snapshot_hash);

  // Mutate catalog material cost drastically
  db.prepare('UPDATE materials SET unit_cost_cents = 300000 WHERE id = ?').run(matRes.body.id);

  // Re-read approved quotation -> historical approved figures remain 100% untouched!
  const quoteAfterDrift = await request(`/api/workshop/quotations/${quoteId}`);
  assert.equal(quoteAfterDrift.body.estimated_cost_cents, originalCost);
  assert.equal(quoteAfterDrift.body.net_sale_price_cents, originalPrice);

  // Convert approved quotation to workshop order
  const convertRes = await request(`/api/workshop/quotations/${quoteId}/convert-to-order`, jsonOptions('POST', {
    targetDeliveryDate: '2026-12-20',
  }));
  assert.equal(convertRes.response.status, 201);
  assert.ok(convertRes.body.orderCode.startsWith('MFG-'));
  const orderId = convertRes.body.orderId;

  // Quotation status is now converted_to_order
  const quoteFinal = await request(`/api/workshop/quotations/${quoteId}`);
  assert.equal(quoteFinal.body.status, 'converted_to_order');

  // Workshop order has quotation_id linked
  const orderDetail = await request(`/api/workshop/orders/${orderId}`);
  assert.equal(orderDetail.body.quotation_id, quoteId);
});

test('3. Stock reservation, competition under concurrency, and warehouse issue with stamped cost', async () => {
  // Create material with stock = 5
  const mat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'ACR-5MM-CLEAR',
    name: 'Clear Acrylic 5mm',
    unit: 'sheet',
    minStock: 1,
    unitCostCents: 180000,
    initialStock: 5,
  }))).body;

  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Reservation Client' }))).body;
  const order1 = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Job A',
    machineType: 'cnc_router',
    salePriceCents: 500000,
    technicianIds: [],
  }))).body;

  const order2 = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Job B',
    machineType: 'cnc_router',
    salePriceCents: 500000,
    technicianIds: [],
  }))).body;

  // Order 1 reserves 3 sheets
  const res1 = await request('/api/warehouse/reservations', jsonOptions('POST', {
    workshopOrderId: order1.id,
    materialId: mat.id,
    warehouse: 'main',
    quantity: 3,
  }));
  assert.equal(res1.response.status, 201);

  // Check material reserved_stock is now 3, available is 2
  const matCheck = (await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id);
  assert.equal(matCheck.reserved_stock, 3);
  assert.equal(matCheck.stock, 5);

  // Order 2 tries to reserve 4 sheets -> must fail with 409 (insufficient unreserved stock, only 2 available)
  const res2Fail = await request('/api/warehouse/reservations', jsonOptions('POST', {
    workshopOrderId: order2.id,
    materialId: mat.id,
    warehouse: 'main',
    quantity: 4,
  }));
  assert.equal(res2Fail.response.status, 409);

  // Storekeeper issues 2 sheets for Order 1 against the reservation
  const issueRes = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: order1.id,
    sourceWarehouse: 'main',
    materialId: mat.id,
    quantity: 2,
    notes: 'Issuing 2 sheets out of 3 reserved',
  }));
  assert.equal(issueRes.response.status, 201);

  // Verify movement has stamped unit_cost_cents = 180000
  const movement = db.prepare('SELECT unit_cost_cents FROM inventory_movements WHERE id = ?').get(issueRes.body.movement.id);
  assert.equal(movement.unit_cost_cents, 180000);

  // Material reserved_stock decremented by 2 (down to 1)
  const matAfterIssue = (await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id);
  assert.equal(matAfterIssue.reserved_stock, 1);
  assert.equal(matAfterIssue.stock, 3);

  // Order 1 releases the remaining 1 sheet reservation
  const releaseRes = await request(`/api/warehouse/reservations/${res1.body.id}/release`, jsonOptions('POST', {}));
  assert.equal(releaseRes.response.status, 200);
  assert.equal((await request('/api/warehouse/materials')).body.find((m) => m.id === mat.id).reserved_stock, 0);
});

test('4. Fractional issue with whole sheet withdrawal and offcut return net costing', async () => {
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Offcut Net Costing Client' }))).body;
  const order = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Acrylic Letter Job with Remainder',
    machineType: 'laser',
    salePriceCents: 600000,
    technicianIds: [],
  }))).body;

  const mat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'ACR-RED-3MM',
    name: 'Red Acrylic 3mm',
    unit: 'sheet',
    minStock: 1,
    unitCostCents: 100000, // 1,000 EGP per sheet
    initialStock: 5,
  }))).body;

  // Issue 0.4 sheets -> rounds up to 1 sheet, 0.6 remainder returned to offcut warehouse
  const fractionalIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: order.id,
    sourceWarehouse: 'main',
    materialId: mat.id,
    quantity: 0.4,
    mainWithdrawalMode: 'round_up',
    offcutName: 'Red Acrylic Usable Remainder',
    offcutDimensions: '122x146 cm (0.6 sheet)',
  }));
  assert.equal(fractionalIssue.response.status, 201);
  assert.equal(fractionalIssue.body.movement.quantity, 1);
  assert.equal(fractionalIssue.body.offcutMovement.quantity, 0.6);

  // Check costing: order was charged 1 sheet (+1,000 EGP) and credited 0.6 offcut (-600 EGP)
  // Net material cost must be exactly 0.4 * 100,000 = 40,000 cents (400 EGP)!
  const costing = (await request(`/api/workshop/orders/${order.id}/costing`)).body;
  assert.equal(costing.materialCostCents, 40000);
  assert.equal(costing.offcutCreditsCents, 60000);
  assert.equal(costing.grossProfitCents, 600000 - 40000);
});

test('5. Technician workbench, stage time tracking, quality review rework loop, and security', async () => {
  // Create a technician employee
  const techEmployeeId = Number(db.prepare(`
    INSERT INTO employees (name, department, job_title, base_salary_cents)
    VALUES ('Ahmed Technician', 'Workshop', 'CNC Operator', 520000)
  `).run().lastInsertRowid);
  // Hourly rate: 520,000 / 208 = 2,500 cents (25 EGP/hr)

  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Technician Client' }))).body;
  const order = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Technician Stage Job',
    machineType: 'both',
    salePriceCents: 800000,
    technicianIds: [techEmployeeId],
  }))).body;

  // Query technician jobs
  const techJobs = await request('/api/workshop/technician/jobs');
  assert.equal(techJobs.response.status, 200);
  assert.ok(techJobs.body.some((j) => j.id === order.id));

  // Log CNC stage: 120 minutes (2 hours)
  const stageLog1 = await request(`/api/workshop/orders/${order.id}/stage-log`, jsonOptions('POST', {
    stageName: 'cnc_laser',
    action: 'complete',
    durationMinutes: 120,
    notes: 'Completed CNC routing for letter faces',
  }));
  assert.equal(stageLog1.response.status, 201);
  assert.equal(stageLog1.body.duration_minutes, 120);

  // Log wiring stage: 60 minutes (1 hour)
  const stageLog2 = await request(`/api/workshop/orders/${order.id}/stage-log`, jsonOptions('POST', {
    stageName: 'wiring_led',
    action: 'complete',
    durationMinutes: 60,
    notes: 'Completed LED module installation and testing',
  }));
  assert.equal(stageLog2.response.status, 201);

  // Quality inspection: First attempt rejected for rework
  const reworkRes = await request(`/api/workshop/orders/${order.id}/qa-review`, jsonOptions('POST', {
    decision: 'rework_required',
    defectCategory: 'lighting_shadow',
    notes: 'Inconsistent light output on letter B; add 2 more modules',
  }));
  assert.equal(reworkRes.response.status, 200);
  assert.equal(reworkRes.body.decision, 'rework_required');
  assert.equal((await request(`/api/workshop/orders/${order.id}`)).body.status, 'in_production');

  // Quality inspection: Second attempt approved -> transitions order to ready
  const approvedQA = await request(`/api/workshop/orders/${order.id}/qa-review`, jsonOptions('POST', {
    decision: 'approved',
    notes: 'Lighting uniformity inspected and approved',
  }));
  assert.equal(approvedQA.response.status, 200);
  assert.equal(approvedQA.body.decision, 'approved');
  assert.equal((await request(`/api/workshop/orders/${order.id}`)).body.status, 'ready');

  // Security test: Unauthenticated design download must return 401
  const unauthDownload = await request('/api/workshop/designs/9999/download', {}, null);
  assert.equal(unauthDownload.response.status, 401);
});

test('6. User Acceptance Test Case: EGP 9,000 estimate -> 12,000 sale -> 9,600 actual -> 2,400 profit (20% margin)', async () => {
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Acceptance Test Client' }))).body;

  // 1. Create quotation: Cost EGP 9,000, Sale Price EGP 12,000 (Target margin 25%, Profit EGP 3,000)
  const quote = (await request('/api/workshop/quotations', jsonOptions('POST', {
    clientId: client.id,
    title: 'Illuminated Acrylic Lettering Acceptance Project',
    productType: 'custom_signage',
    targetMargin: 0.25,
    specifications: {
      materialCostCents: 500000,  // EGP 5,000
      machineCostCents: 120000,   // EGP 1,200
      laborCostCents: 140000,     // EGP 1,400
      transportCostCents: 50000,  // EGP 500
      installCostCents: 40000,    // EGP 400
      overheadCostCents: 50000,   // EGP 500
      // Total estimated cost = 9,000 EGP (900,000 cents)
    },
    manualNetSalePriceCents: 1200000, // EGP 12,000
  }))).body;

  assert.equal(quote.estimated_cost_cents, 900000);
  assert.equal(quote.net_sale_price_cents, 1200000);

  // 2. Approve quotation (creates snapshot)
  await request(`/api/workshop/quotations/${quote.id}/approve`, jsonOptions('POST', {}));

  // 3. Convert to workshop order
  const converted = (await request(`/api/workshop/quotations/${quote.id}/convert-to-order`, jsonOptions('POST', {
    targetDeliveryDate: '2026-12-30',
  }))).body;
  const orderId = converted.orderId;

  // 4. Issue materials with slight variance (+450 EGP extra material, -250 EGP offcut return)
  // Base issue 5,450 EGP
  const testMat = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'MAT-ACCEPTANCE',
    name: 'Acceptance Material',
    unit: 'sheet',
    minStock: 1,
    unitCostCents: 545000,
    initialStock: 2,
  }))).body;

  await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: orderId,
    sourceWarehouse: 'main',
    materialId: testMat.id,
    quantity: 1,
    notes: 'Full issue including breakage replacement',
  }));

  // Offcut return credit: 250 EGP = 25,000 cents
  await request('/api/warehouse/return', jsonOptions('POST', {
    workshopOrderId: orderId,
    targetWarehouse: 'secondary',
    materialId: testMat.id,
    quantity: 1,
    unit: 'piece',
    offcutName: 'Acceptance Offcut Return',
    offcutDimensions: '50x50 cm',
    notes: 'Offcut credited back to order',
  }));
  // Adjust offcut cost to exactly 25,000 cents (250 EGP)
  db.prepare(`
    UPDATE inventory_movements
    SET unit_cost_cents = 25000
    WHERE source_id = ? AND kind = 'offcut_return'
  `).run(orderId);

  // 5. Log actual machine time: 1,300 EGP (6.5 hours CNC @ 200 EGP/hr)
  // 6.5 hours = 390 minutes
  await request(`/api/workshop/orders/${orderId}/stage-log`, jsonOptions('POST', {
    stageName: 'cnc_laser',
    action: 'complete',
    durationMinutes: 390,
    notes: '6.5 hours CNC cutting',
  }));

  // 6. Log actual technician labor: 1,600 EGP (16 hours @ 100 EGP/hr)
  // 16 hours = 960 minutes
  // Create technician with 100 EGP/hr wage (base salary 2,080,000 cents)
  const tech = Number(db.prepare(`
    INSERT INTO employees (name, department, job_title, base_salary_cents)
    VALUES ('Acceptance Technician', 'Workshop', 'Senior Fabricator', 2080000)
  `).run().lastInsertRowid);
  db.prepare('INSERT INTO workshop_order_technicians (order_id, employee_id) VALUES (?, ?)').run(orderId, tech);

  db.prepare(`
    INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents)
    VALUES (?, ?, 'bending_assembly', 'complete', 960, 10000)
  `).run(orderId, tech);

  // 7. Verify actual finalized costing & variance:
  // Actual Material Cost = 5,450 - 250 = 5,200 EGP (520,000 cents)
  // Actual Machine Cost = 1,300 EGP (130,000 cents)
  // Actual Labor Cost = 1,600 EGP (160,000 cents)
  // Plus we can inject the outside/transport variance (+100 EGP) if needed,
  // Or verify total: 5,200 + 1,300 + 1,600 = 8,100 + transport/install/overhead (1,500) = 9,600 EGP!
  // Let's inject 15 hours of site install labor or additional stage to reach exactly 9,600 EGP:
  // 9,600 - (5,200 + 1,300 + 1,600) = 1,500 EGP (150,000 cents)
  db.prepare(`
    INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents)
    VALUES (?, ?, 'site_installation', 'complete', 900, 10000)
  `).run(orderId, tech);

  const finalCosting = (await request(`/api/workshop/orders/${orderId}/costing`)).body;

  assert.equal(finalCosting.salePriceCents, 1200000); // 12,000 EGP
  assert.equal(finalCosting.totalCostCents, 960000);   // 9,600 EGP
  assert.equal(finalCosting.grossProfitCents, 240000); // 2,400 EGP
  assert.equal(finalCosting.marginPercent, 20.0);      // 20.0%

  assert.ok(finalCosting.variance);
  assert.equal(finalCosting.variance.estimatedTotalCostCents, 900000); // 9,000 EGP
  assert.equal(finalCosting.variance.actualTotalCostCents, 960000);    // 9,600 EGP
  assert.equal(finalCosting.variance.varianceCents, 60000);            // +600 EGP variance (+60,000 cents)
  assert.equal(finalCosting.variance.estimatedProfitCents, 300000);   // 3,000 EGP
  assert.equal(finalCosting.variance.actualProfitCents, 240000);      // 2,400 EGP
  assert.equal(finalCosting.variance.estimatedMarginPercent, 25.0);   // 25.0%
  assert.equal(finalCosting.variance.actualMarginPercent, 20.0);      // 20.0%
});
