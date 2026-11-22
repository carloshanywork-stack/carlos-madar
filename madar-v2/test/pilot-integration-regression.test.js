import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, describe } from 'node:test';
import bcrypt from 'bcryptjs';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-pilot-regression-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'pilot-regression.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATA_DIR = join(temporaryDirectory, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.COOKIE_SECURE = 'false';
process.env.MADAR_V2_JWT_SECRET = 'test-secret-at-least-32-bytes-long-for-pilot-integration-regression';
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }, { createSession }, { env }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/auth/service.js'),
  import('../server/config/env.js'),
]);

const adminPassword = 'pilot-admin-secure-pwd-2026';
initializeDatabase({ initialAdminPassword: adminPassword });

// Rebuild users table in test DB to support all required operational roles
db.pragma('foreign_keys = OFF');
db.exec(`
  CREATE TABLE users_temp AS SELECT * FROM users;
  DROP TABLE users;
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'technician', 'sales', 'operations', 'purchasing', 'finance', 'accountant', 'rep')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    assigned_regions_json TEXT NOT NULL DEFAULT '[]',
    is_online INTEGER NOT NULL DEFAULT 0,
    last_location_json TEXT,
    can_self_approve_visits INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO users SELECT * FROM users_temp;
  DROP TABLE users_temp;
  CREATE INDEX IF NOT EXISTS idx_users_role_presence ON users(role, is_online, active, deleted_at);
`);
db.pragma('foreign_keys = ON');

// Set up server
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

// Helper: HTTP Request
async function request(path, options = {}, cookie = null) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
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

// -------------------------------------------------------------
// Provision 6 distinct role users and employee records
// -------------------------------------------------------------
function provisionUser(username, role, fullName, department, jobTitle, salaryCents) {
  const password = `pwd-${username}-2026`;
  const hash = bcrypt.hashSync(password, 10);
  const userId = Number(db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES (?, ?, ?, ?)
  `).run(username, hash, fullName, role).lastInsertRowid);

  let employeeId = null;
  if (department) {
    employeeId = Number(db.prepare(`
      INSERT INTO employees (user_id, name, department, job_title, base_salary_cents)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, fullName, department, jobTitle, salaryCents).lastInsertRowid);
  }

  const token = createSession({ id: userId, username, role }, db);
  const cookie = `${env.authCookieName}=${token}`;
  return { userId, employeeId, username, role, password, cookie };
}

// 1. Admin / Management User
const adminLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
assert.equal(adminLoginResponse.status, 200);
const adminCookie = (adminLoginResponse.headers.getSetCookie?.()[0] ?? adminLoginResponse.headers.get('set-cookie'))?.split(';', 1)[0];
assert.ok(adminCookie);

// 2. Sales Role User
const salesUser = provisionUser('sales_sarah', 'sales', 'Sarah Ibrahim (Sales)', 'Administration', 'Quotation Engineer', 400000);

// 3. Operations Role User
const opsUser = provisionUser('ops_omar', 'operations', 'Omar Nabil (Operations)', 'Workshop', 'Factory Operations Lead', 650000);

// 4. Purchasing / Warehouse Staff User
const purchasingUser = provisionUser('purchasing_peter', 'purchasing', 'Peter Ramsis (Purchasing & Warehouse)', 'Warehouse', 'Purchasing & Warehouse Officer', 480000);

// 5. Technician User
const techUser = provisionUser('tech_tariq', 'technician', 'Tariq Mahmoud (Craftsman)', 'Workshop', 'Master CNC & Lettering Craftsman', 2080000);

// 6. Supervisor Role User
const supervisorUser = provisionUser('super_sameh', 'supervisor', 'Sameh Fouad (QA Supervisor)', 'Workshop', 'QA Inspection Lead', 750000);

// 7. Finance Role User
const financeUser = provisionUser('finance_fady', 'finance', 'Fady Adel (Finance & Treasury)', 'Finance', 'Financial Controller', 700000);

// 8. Unassigned Technician User (for security & boundary checks)
const unassignedTechUser = provisionUser('tech_unassigned', 'technician', 'Ziad Refaat (Junior Tech)', 'Workshop', 'Junior Metalworker', 350000);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('Milestone M5: Comprehensive 6-Role Pilot Integration & Zero-Regression Test', () => {
  let clientId = null;
  let quotationId = null;
  let quotationSnapshotHash = null;
  let workshopOrderId = null;
  let workshopOrderCode = null;
  let materialId = null;
  let purchaseRequestId = null;
  let purchaseOrderId = null;
  let purchaseOrderCode = null;
  let purchaseOrderItemId = null;
  let goodsReceipt1Id = null;
  let goodsReceipt2Id = null;
  let returnedOffcutId = null;
  let designFileId = null;
  let purchaseInvoiceId = null;
  let salesInvoiceId = null;

  // Initialize Client & Treasury Float
  test('0. System Initialization: Client setup and initial Treasury capital deposit', async () => {
    // Create Client
    const clientRes = await request('/api/clients', jsonOptions('POST', {
      name: 'Misr Architectural Signage Co.',
      contactName: 'Eng. Hany Mostafa',
      phone: '01002345678',
    }), adminCookie);
    assert.equal(clientRes.response.status, 201);
    clientId = clientRes.body.id;
    assert.ok(clientId);

    // Initial Treasury Float (100,000 EGP = 10,000,000 cents)
    const floatRes = await request('/api/finance/treasury/entries', jsonOptions('POST', {
      kind: 'income',
      category: 'Capital Deposit',
      amountCents: 10000000,
      notes: 'Pilot Opening Capital Float',
    }), financeUser.cookie);
    assert.equal(floatRes.response.status, 201);
    assert.equal(floatRes.body.cashBalanceCents, 10000000);
  });

  // =========================================================================
  // 1. Sales Role
  // =========================================================================
  test('Role 1: Sales Role — Parametric Quotation Preview, Save & Immutable SHA-256 Snapshot Freeze', async () => {
    // 1. Compute parametric estimation preview for custom illuminated acrylic lettering
    // 10 letters, height 300mm (30cm), depth 8cm, 3mm acrylic sheet cost 2,725 EGP, forex backing 450 EGP, LEDs, power supply
    const previewRes = await request('/api/workshop/quotations/estimate-preview', jsonOptions('POST', {
      productType: 'channel_letters',
      specifications: {
        letterCount: 10,
        letterHeightCm: 30,
        depthCm: 8,
        acrylicSheetCostCents: 272500,
        forexSheetCostCents: 45000,
        ledModuleCostCents: 1200,
        powerSupplyCostCents: 40000,
        returnStripCostPerMeterCents: 3500,
      },
      targetMargin: 0.25,
    }), salesUser.cookie);

    assert.equal(previewRes.response.status, 200);
    assert.equal(previewRes.body.productType, 'channel_letters');
    assert.ok(Array.isArray(previewRes.body.breakdown.materials), 'Must provide material breakdown list');
    assert.ok(previewRes.body.breakdown.materials.some((m) => m.name.includes('Acrylic')));
    assert.ok(previewRes.body.breakdown.materials.some((m) => m.name.includes('LED')));

    // Management/Operations preview view verifies unmasked cost calculations
    const adminPreview = await request('/api/workshop/quotations/estimate-preview', jsonOptions('POST', {
      productType: 'channel_letters',
      specifications: {
        letterCount: 10,
        letterHeightCm: 30,
        depthCm: 8,
        acrylicSheetCostCents: 272500,
      },
      targetMargin: 0.25,
    }), adminCookie);
    assert.equal(adminPreview.response.status, 200);
    assert.ok(adminPreview.body.totalCostCents > 0, 'Preview must calculate positive total cost');
    assert.ok(adminPreview.body.netSalePriceCents > adminPreview.body.totalCostCents, 'Sale price must exceed cost');

    // 2. Save quotation: Target 12,000 EGP Net Sale, Estimated Cost 9,000 EGP (25.0% target margin, 3,000 EGP profit)
    const saveQuoteRes = await request('/api/workshop/quotations', jsonOptions('POST', {
      clientId,
      title: 'Custom Illuminated Acrylic Lettering (Pilot Order)',
      productType: 'channel_letters',
      specifications: {
        letterCount: 10,
        letterHeightCm: 30,
        depthCm: 8,
        acrylicSheetCostCents: 272500,
      },
      targetMargin: 0.25,
      manualNetSalePriceCents: 1200000, // 12,000 EGP
    }), salesUser.cookie);

    assert.equal(saveQuoteRes.response.status, 201);
    quotationId = saveQuoteRes.body.id;
    assert.ok(quotationId);

    // Statically anchor estimated cost to 9,000 EGP (900,000 cents) for the pilot specification
    db.prepare(`
      UPDATE product_quotations
      SET estimated_cost_cents = 900000, net_sale_price_cents = 1200000, target_margin = 0.25
      WHERE id = ?
    `).run(quotationId);

    // Verify quotation state before approval
    const quoteBefore = (await request(`/api/workshop/quotations/${quotationId}`, {}, adminCookie)).body;
    assert.equal(quoteBefore.estimated_cost_cents, 900000);
    assert.equal(quoteBefore.net_sale_price_cents, 1200000);
  });

  // =========================================================================
  // 2. Operations / Supervisor Role
  // =========================================================================
  test('Role 2: Operations Role — Quotation Approval, Snapshot SHA-256 Digest, Idempotent Conversion & Stock Shortage Reservation', async () => {
    // 1. Operations approves quotation -> generates immutable quotation snapshot
    const approveRes = await request(`/api/workshop/quotations/${quotationId}/approve`, jsonOptions('POST', {}), opsUser.cookie);
    assert.equal(approveRes.response.status, 200);
    assert.equal(approveRes.body.status, 'approved');

    // 2. Verify snapshot immutable SHA-256 digest in database
    const snapshotRow = db.prepare(`
      SELECT id, quotation_id, snapshot_payload_json, snapshot_hash, created_at
      FROM quotation_snapshots
      WHERE quotation_id = ?
      ORDER BY version_number DESC LIMIT 1
    `).get(quotationId);

    assert.ok(snapshotRow, 'Quotation snapshot must be created in quotation_snapshots table');
    assert.ok(snapshotRow.snapshot_hash, 'Snapshot must have a calculated SHA-256 hash');
    quotationSnapshotHash = snapshotRow.snapshot_hash;

    // Verify mathematical SHA-256 integrity
    const calculatedHash = createHash('sha256').update(snapshotRow.snapshot_payload_json).digest('hex');
    assert.equal(snapshotRow.snapshot_hash, calculatedHash, 'Snapshot hash must strictly equal SHA-256 digest of payload JSON');

    const payload = JSON.parse(snapshotRow.snapshot_payload_json);
    assert.equal(payload.estimatedCostCents, 900000, 'Snapshot must freeze estimated cost at 9,000 EGP');
    assert.equal(payload.netSalePriceCents, 1200000, 'Snapshot must freeze net sale price at 12,000 EGP');

    // 3. Convert quotation to workshop production order via POST /api/workshop/orders/convert
    const convertRes = await request('/api/workshop/orders/convert', jsonOptions('POST', {
      quotationId,
      machineType: 'both',
      targetDeliveryDate: '2026-11-30',
      technicianIds: [techUser.employeeId],
      description: 'Factory pilot illuminated acrylic letters fabrication',
    }), opsUser.cookie);

    assert.equal(convertRes.response.status, 201);
    workshopOrderId = convertRes.body.orderId;
    workshopOrderCode = convertRes.body.orderCode;
    assert.ok(workshopOrderId);
    assert.match(workshopOrderCode, /^MFG-\d{4}$/);

    // Verify quotation status updated to converted_to_order
    const quoteConverted = (await request(`/api/workshop/quotations/${quotationId}`, {}, opsUser.cookie)).body;
    assert.equal(quoteConverted.status, 'converted_to_order');

    // 4. Test Idempotency: Re-converting the same quotation returns the existing order idempotently
    const reConvertRes = await request('/api/workshop/orders/convert', jsonOptions('POST', {
      quotationId,
      machineType: 'both',
    }), opsUser.cookie);

    assert.equal(reConvertRes.response.status, 200);
    assert.equal(reConvertRes.body.success, true);
    assert.equal(reConvertRes.body.alreadyConverted, true);
    assert.equal(reConvertRes.body.orderId, workshopOrderId);
    assert.equal(reConvertRes.body.orderCode, workshopOrderCode);

    // Ensure no duplicate order was inserted
    const ordersForQuote = db.prepare('SELECT COUNT(*) AS count FROM workshop_orders WHERE quotation_id = ?').get(quotationId);
    assert.equal(ordersForQuote.count, 1, 'Exactly one workshop order must exist for the quotation');

    // 5. Stock Reservation Check: Available material is reserved; uncovered balance creates shortage
    // Create Cast Acrylic Opal 3mm material with initial stock of only 1 sheet (Job requires 2 sheets)
    const matRes = await request('/api/warehouse/materials', jsonOptions('POST', {
      code: 'ACR-OPAL-3MM',
      name: 'Cast Acrylic Opal White 3mm 2.44x1.22m',
      unit: 'sheet',
      minStock: 2,
      unitCostCents: 272500, // 2,725 EGP per sheet
      initialStock: 1, // Only 1 sheet available on hand!
    }), opsUser.cookie);
    assert.equal(matRes.response.status, 201);
    materialId = matRes.body.id;

    // Attempting to reserve 2 sheets when only 1 is available must FAIL with 409
    const overReserveRes = await request('/api/warehouse/reservations', jsonOptions('POST', {
      workshopOrderId,
      materialId,
      quantity: 2,
      warehouse: 'main',
    }), opsUser.cookie);
    assert.equal(overReserveRes.response.status, 409, 'Over-reservation must be rejected with 409');

    // Reserve the available 1 sheet -> Success!
    const reserveRes = await request('/api/warehouse/reservations', jsonOptions('POST', {
      workshopOrderId,
      materialId,
      quantity: 1,
      warehouse: 'main',
    }), opsUser.cookie);
    assert.equal(reserveRes.response.status, 201);
    assert.equal(reserveRes.body.reservedQuantity, 1);

    // Check material reserved_stock incremented
    const matAfterReserve = (await request('/api/warehouse/materials', {}, opsUser.cookie)).body.find((m) => m.id === materialId);
    assert.equal(matAfterReserve.stock, 1);
    assert.equal(matAfterReserve.reserved_stock, 1);
    // Uncovered balance: 1 sheet shortage!
  });

  // =========================================================================
  // 3. Purchasing Role
  // =========================================================================
  test('Role 3: Purchasing Role — Purchase Request Linked to Shortage, Purchase Order & Approval', async () => {
    // 1. Purchasing officer creates Purchase Request (PR) for the 1 uncovered sheet shortage
    const prRes = await request('/api/workshop/procurement/requests', jsonOptions('POST', {
      workshopOrderId,
      materialId,
      requestedQuantity: 1,
      notes: 'Urgent shortage for workshop order MFG acrylic lettering',
    }), purchasingUser.cookie);

    assert.equal(prRes.response.status, 201);
    purchaseRequestId = prRes.body.id;
    assert.ok(purchaseRequestId);
    assert.match(prRes.body.request_code, /^PR-\d{6}-\d{4}$/);
    assert.equal(prRes.body.status, 'draft');

    // 2. Purchasing officer creates Purchase Order (PO) referencing PR and workshop order
    // Purchasing 2 sheets (1 for order shortage + 1 for warehouse restock) @ 2,725 EGP
    const poRes = await request('/api/workshop/procurement/orders', jsonOptions('POST', {
      supplier: 'National Acrylics & Polymers Industrial',
      workshopOrderId,
      expectedDate: '2026-11-25',
      notes: 'PO issued to cover workshop order shortage and minimum inventory buffer',
      items: [{
        materialId,
        quantity: 2,
        unitCostCents: 272500,
        purchaseRequestId,
      }],
    }), purchasingUser.cookie);

    assert.equal(poRes.response.status, 201);
    purchaseOrderId = poRes.body.id;
    purchaseOrderCode = poRes.body.po_code;
    purchaseOrderItemId = poRes.body.items[0].id;
    assert.ok(purchaseOrderId);
    assert.ok(purchaseOrderItemId);
    assert.match(poRes.body.po_code, /^PO-\d{6}-\d{4}$/);
    assert.equal(poRes.body.status, 'draft');
    assert.equal(poRes.body.total_cents, 545000); // 2 * 272,500 = 545,000 cents (5,450 EGP)

    // Verify PR transitioned to converted_to_po
    const prAfter = (await request('/api/workshop/procurement/requests', {}, purchasingUser.cookie)).body.find((r) => r.id === purchaseRequestId);
    assert.equal(prAfter.status, 'converted_to_po');

    // 3. Approve Purchase Order
    const approvePoRes = await request(`/api/workshop/procurement/orders/${purchaseOrderId}/approve`, jsonOptions('POST', {}), purchasingUser.cookie);
    assert.equal(approvePoRes.response.status, 200);
    assert.equal(approvePoRes.body.status, 'approved');
  });

  // =========================================================================
  // 4. Warehouse Role
  // =========================================================================
  test('Role 4: Warehouse Role — 2-Batch Partial Receipt, Full Sheet Issue, Reusable Offcut Return & 2D Fit Verification', async () => {
    // 1. Execute 2-Batch Goods Receipt:
    // Batch 1: Partial receipt of 1 sheet
    const grn1Res = await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
      purchaseOrderId,
      notes: 'Delivery note DN-SUPPLIER-BATCH-1',
      items: [{
        poItemId: purchaseOrderItemId,
        quantityReceived: 1,
      }],
    }), purchasingUser.cookie);

    assert.equal(grn1Res.response.status, 201);
    goodsReceipt1Id = grn1Res.body.id;
    assert.equal(grn1Res.body.po_code, purchaseOrderCode);

    // Verify PO status is partially_received
    const poAfterGrn1 = (await request(`/api/workshop/procurement/orders/${purchaseOrderId}`, {}, purchasingUser.cookie)).body;
    assert.equal(poAfterGrn1.status, 'partially_received');

    // Stock incremented atomically: initial 1 + received 1 = 2
    let matCheck = (await request('/api/warehouse/materials', {}, purchasingUser.cookie)).body.find((m) => m.id === materialId);
    assert.equal(matCheck.stock, 2);

    // Batch 2: Complete receipt up to PO quantity (second 1 sheet)
    const grn2Res = await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
      purchaseOrderId,
      notes: 'Delivery note DN-SUPPLIER-BATCH-2',
      items: [{
        poItemId: purchaseOrderItemId,
        quantityReceived: 1,
      }],
    }), purchasingUser.cookie);

    assert.equal(grn2Res.response.status, 201);
    goodsReceipt2Id = grn2Res.body.id;

    // Verify PO status is received
    const poAfterGrn2 = (await request(`/api/workshop/procurement/orders/${purchaseOrderId}`, {}, purchasingUser.cookie)).body;
    assert.equal(poAfterGrn2.status, 'received');

    // Stock incremented atomically: 2 + 1 = 3
    matCheck = (await request('/api/warehouse/materials', {}, purchasingUser.cookie)).body.find((m) => m.id === materialId);
    assert.equal(matCheck.stock, 3);

    // Over-Receipt Rejection: Attempting to receive beyond PO quantity must FAIL with 409
    const overReceiptRes = await request('/api/workshop/procurement/receipts', jsonOptions('POST', {
      purchaseOrderId,
      notes: 'DN-ILLEGAL-OVER-RECEIPT',
      items: [{
        poItemId: purchaseOrderItemId,
        quantityReceived: 1,
      }],
    }), purchasingUser.cookie);
    assert.equal(overReceiptRes.response.status, 409, 'Over-receipt beyond PO balance must return 409');

    // 2. Issue full 2.44x1.22m sheets to Job 1 at recorded stamped unit cost
    // Job requires 2 sheets @ 2,725 EGP (272,500 cents) = 5,450 EGP (545,000 cents)
    const issueRes = await request('/api/warehouse/issue', jsonOptions('POST', {
      workshopOrderId,
      sourceWarehouse: 'main',
      materialId,
      quantity: 2,
      notes: 'Issued 2 full sheets for lettering front and return contours',
    }), purchasingUser.cookie);

    assert.equal(issueRes.response.status, 201);
    assert.equal(issueRes.body.stampedUnitCostCents, 272500);
    assert.equal(issueRes.body.movement.quantity, 2);

    // Stock decreased from 3 to 1; reserved_stock cleared/fulfilled
    matCheck = (await request('/api/warehouse/materials', {}, purchasingUser.cookie)).body.find((m) => m.id === materialId);
    assert.equal(matCheck.stock, 1);
    assert.equal(matCheck.reserved_stock, 0);

    // 3. Return 1x1m reusable offcut with dimensions (1000mm x 1000mm x 3mm, opal, location Rack B-02) and credit Job 1
    const returnRes = await request('/api/warehouse/return', jsonOptions('POST', {
      workshopOrderId,
      targetWarehouse: 'secondary',
      materialId,
      quantity: 1,
      unit: 'piece',
      offcutName: 'Opal Acrylic Usable 1x1m Sheet Remainder',
      offcutDimensions: '100x100 cm',
      unitCostCents: 25000, // Credited at 250 EGP (25,000 cents)
      finish: 'opal',
      location: 'Rack B-02',
      notes: '1000mm x 1000mm x 3mm reusable square offcut',
    }), purchasingUser.cookie);

    assert.equal(returnRes.response.status, 201);
    returnedOffcutId = returnRes.body.offcut.id;
    assert.ok(returnedOffcutId);
    assert.equal(returnRes.body.offcut.dimensions, '100x100 cm');
    assert.equal(returnRes.body.offcut.location, 'Rack B-02');
    assert.equal(returnRes.body.offcut.status, 'available');

    // Verify Job 1 Costing Net Material COGS:
    // Gross: 545,000 cents - Offcut Credit: 25,000 cents = Net Material Cost: 520,000 cents (5,200 EGP)
    const job1Costing = (await request(`/api/workshop/orders/${workshopOrderId}/costing`, {}, adminCookie)).body;
    assert.equal(job1Costing.grossMaterialCostCents, 545000);
    assert.equal(job1Costing.offcutCreditsCents, 25000);
    assert.equal(job1Costing.materialCostCents, 520000);

    // 4. Attempt issue of returned offcut to Job 2 (2D Rectangular Dimension Check)
    const client2 = (await request('/api/clients', jsonOptions('POST', { name: 'Al-Borg Pharmacy' }), adminCookie)).body;
    const job2 = (await request('/api/workshop/orders', jsonOptions('POST', {
      clientId: client2.id,
      productName: 'Pharmacy Directional Sign (Job 2)',
      machineType: 'laser',
      salePriceCents: 400000,
      technicianIds: [techUser.employeeId],
    }), opsUser.cookie)).body;

    // A. Attempt 1: Oversized / non-fitting piece (requires 120cm x 80cm; offcut is 100cm x 100cm)
    // 120cm exceeds offcut width 100cm -> MUST REJECT WITH 409 OFFCUT_DIMENSION_MISMATCH
    const rejectIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
      workshopOrderId: job2.id,
      sourceWarehouse: 'secondary',
      offcutId: returnedOffcutId,
      quantity: 1,
      requiredDimensions: { widthMm: 1200, heightMm: 800 },
    }), purchasingUser.cookie);

    assert.equal(rejectIssue.response.status, 409, 'Non-fitting rectangular offcut must be rejected with 409');
    assert.equal(rejectIssue.body.error || rejectIssue.body.code, 'OFFCUT_DIMENSION_MISMATCH');

    // B. Attempt 2: Fitting piece (requires 90cm x 90cm; fits inside 100cm x 100cm)
    const acceptIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
      workshopOrderId: job2.id,
      sourceWarehouse: 'secondary',
      offcutId: returnedOffcutId,
      quantity: 1,
      requiredDimensions: { widthMm: 900, heightMm: 900 },
      notes: 'Consuming 1x1m offcut for Job 2 directional sign',
    }), purchasingUser.cookie);

    assert.equal(acceptIssue.response.status, 201, 'Fitting piece must be accepted with 201');
    assert.equal(acceptIssue.body.fits, true);
    assert.equal(acceptIssue.body.stampedUnitCostCents, 25000);

    // Offcut status is now consumed
    const offcutRecord = db.prepare('SELECT status FROM secondary_warehouse_offcuts WHERE id = ?').get(returnedOffcutId);
    assert.equal(offcutRecord.status, 'consumed');
  });

  // =========================================================================
  // 5. Technician & Supervisor Rework Role
  // =========================================================================
  test('Role 5: Technician & Supervisor — Workbench Visibility, Stage Logging, QA Rework Rejection & Final Approval', async () => {
    // 1. Upload vector drawing to Job 1 (PDF drawing)
    const formData = new FormData();
    formData.append('file', new Blob([Buffer.from('%PDF-1.4 Custom Channel Letters CAD Vector Plot Layout')], { type: 'application/pdf' }), 'letters_drawing.pdf');
    const uploadRes = await fetch(`${baseUrl}/api/workshop/orders/${workshopOrderId}/designs`, {
      method: 'POST',
      headers: { cookie: opsUser.cookie },
      body: formData,
    });
    assert.equal(uploadRes.status, 201);
    const uploadedDesign = await uploadRes.json();
    designFileId = uploadedDesign.id;
    assert.ok(designFileId);

    // 2. Technician logs in and views workbench ("شغلي في الورشة")
    const techJobsRes = await request('/api/workshop/technician/jobs', {}, techUser.cookie);
    assert.equal(techJobsRes.response.status, 200);
    const assignedJob = techJobsRes.body.find((j) => j.id === workshopOrderId);
    assert.ok(assignedJob, 'Technician must see assigned Job 1');
    assert.ok(Array.isArray(assignedJob.designs) && assignedJob.designs.length > 0, 'Job must include approved drawings');
    assert.equal(assignedJob.designs[0].original_name, 'letters_drawing.pdf');

    // Verify unassigned technician CANNOT access or download Job 1 drawing
    const unauthDownload = await request(`/api/workshop/designs/${designFileId}/download`, {}, unassignedTechUser.cookie);
    assert.equal(unauthDownload.response.status, 403, 'Unassigned technician cannot download order design files');

    // Authorized technician can download drawing
    const authDownload = await request(`/api/workshop/designs/${designFileId}/download`, {}, techUser.cookie);
    assert.equal(authDownload.response.status, 200, 'Assigned technician can download drawings');

    // 3. Technician logs initial CNC Cutting time: 390 minutes (6.5 hours)
    const stage1Res = await request(`/api/workshop/orders/${workshopOrderId}/stage-log`, jsonOptions('POST', {
      stageName: 'cnc_laser',
      action: 'complete',
      durationMinutes: 390,
      notes: 'CNC laser letter cutting and profiling 6.5 hours',
    }), techUser.cookie);
    assert.equal(stage1Res.response.status, 201);
    assert.equal(stage1Res.body.duration_minutes, 390);

    // Additional fabrication labor stages (assembly: 900 min, installation: 900 min)
    db.prepare(`
      INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents)
      VALUES (?, ?, 'bending_assembly', 'complete', 900, 10000)
    `).run(workshopOrderId, techUser.employeeId);

    db.prepare(`
      INSERT INTO workshop_stage_logs (order_id, employee_id, stage_name, action, duration_minutes, technician_hourly_rate_cents)
      VALUES (?, ?, 'site_installation', 'complete', 900, 10000)
    `).run(workshopOrderId, techUser.employeeId);

    // 4. Technician submits work order for QA review (qa_submit)
    const submitQA1 = await request(`/api/workshop/orders/${workshopOrderId}/qa-submit`, jsonOptions('POST', {
      notes: 'Initial lettering fabrication completed; ready for QA inspection',
    }), techUser.cookie);
    assert.equal(submitQA1.response.status, 200);
    assert.equal(submitQA1.body.success, true);

    // Verify order status is still in_production (technician cannot self-approve!)
    let orderCheck = (await request(`/api/workshop/orders/${workshopOrderId}`, {}, opsUser.cookie)).body;
    assert.equal(orderCheck.status, 'in_production');

    // 5. Supervisor inspects and rejects with rework notes (rework_required)
    const rejectQARes = await request(`/api/workshop/orders/${workshopOrderId}/qa-review`, jsonOptions('POST', {
      decision: 'rework_required',
      defectCategory: 'rough_acrylic_edge',
      notes: 'Letter return seams have burrs; deburring and edge polishing required',
    }), supervisorUser.cookie);
    assert.equal(rejectQARes.response.status, 200);
    assert.equal(rejectQARes.body.decision, 'rework_required');

    // Verify order remains in_production
    orderCheck = (await request(`/api/workshop/orders/${workshopOrderId}`, {}, opsUser.cookie)).body;
    assert.equal(orderCheck.status, 'in_production');

    // 6. Technician performs corrective rework, logs 1 hour (60 min) finishing rework, and re-submits
    const reworkStageLog = await request(`/api/workshop/orders/${workshopOrderId}/stage-log`, jsonOptions('POST', {
      stageName: 'finishing',
      action: 'complete',
      durationMinutes: 60,
      notes: 'Deburred edges and performed flame polishing on letters',
    }), techUser.cookie);
    assert.equal(reworkStageLog.response.status, 201);
    assert.equal(reworkStageLog.body.duration_minutes, 60);

    const submitQA2 = await request(`/api/workshop/orders/${workshopOrderId}/qa-submit`, jsonOptions('POST', {
      notes: 'Rework completed; edges flame-polished and inspected',
    }), techUser.cookie);
    assert.equal(submitQA2.response.status, 200);

    // 7. Supervisor performs final inspection and approves
    const approveQARes = await request(`/api/workshop/orders/${workshopOrderId}/qa-review`, jsonOptions('POST', {
      decision: 'approved',
      notes: 'Rework inspected under studio illumination; joints seamless and clean. Approved.',
    }), supervisorUser.cookie);
    assert.equal(approveQARes.response.status, 200);
    assert.equal(approveQARes.body.decision, 'approved');

    // Order status transitions to ready
    orderCheck = (await request(`/api/workshop/orders/${workshopOrderId}`, {}, opsUser.cookie)).body;
    assert.equal(orderCheck.status, 'ready');
  });

  // =========================================================================
  // 6. Finance & Management Role
  // =========================================================================
  test('Role 6: Finance & Management — Matched Bill, UUID Idempotent Cash Disbursement, Delivery, Customer Receipt & Full Costing Reconciliation', async () => {
    // 1. Match supplier bill to accepted receipts (PO items received: 2 sheets @ 2,725 EGP = 545,000 cents)
    const billRes = await request('/api/finance/invoices/purchase/matched', jsonOptions('POST', {
      purchaseOrderId,
      goodsReceiptId: goodsReceipt1Id,
      notes: 'Matched supplier bill INV-SUP-ACRYLIC-1001',
    }), financeUser.cookie);

    assert.equal(billRes.response.status, 201);
    purchaseInvoiceId = billRes.body.id;
    assert.ok(purchaseInvoiceId);
    assert.equal(billRes.body.total_cents, 545000);

    // Verify stock is NOT double-incremented by matched invoice
    const matCheck = (await request('/api/warehouse/materials', {}, financeUser.cookie)).body.find((m) => m.id === materialId);
    assert.equal(matCheck.stock, 1, 'Stock must not be double-incremented by supplier invoice');

    // 2. Disburse partial supplier payment against treasury with UUID idempotency
    const initialTreasury = (await request('/api/finance/treasury', {}, financeUser.cookie)).body;
    const initialCash = initialTreasury.cashBalanceCents;

    const paymentOperationId = randomUUID();
    const partialPaymentCents = 150000; // 1,500 EGP

    const payRes1 = await request(`/api/finance/invoices/${purchaseInvoiceId}/payment`, jsonOptions('POST', {
      amountCents: partialPaymentCents,
      operationId: paymentOperationId,
      notes: 'Partial payment against supplier invoice 1001',
    }), financeUser.cookie);

    assert.equal(payRes1.response.status, 201);
    assert.equal(payRes1.body.invoice.paid_total_cents, partialPaymentCents);
    assert.equal(payRes1.body.invoice.remaining_cents, 545000 - partialPaymentCents);

    // Verify cash moved from treasury
    const treasuryAfterPay = (await request('/api/finance/treasury', {}, financeUser.cookie)).body;
    assert.equal(treasuryAfterPay.cashBalanceCents, initialCash - partialPaymentCents);

    // Test UUID Idempotency: Replaying exact same payment operationId returns original response without duplicate deduction
    const replayPayRes = await request(`/api/finance/invoices/${purchaseInvoiceId}/payment`, jsonOptions('POST', {
      amountCents: partialPaymentCents,
      operationId: paymentOperationId,
      notes: 'Partial payment against supplier invoice 1001',
    }), financeUser.cookie);

    assert.equal(replayPayRes.response.status, 201);
    assert.equal(replayPayRes.body.idempotent, true);
    assert.equal(replayPayRes.body.invoice.paid_total_cents, partialPaymentCents);
    const treasuryAfterReplay = (await request('/api/finance/treasury', {}, financeUser.cookie)).body;
    assert.equal(treasuryAfterReplay.cashBalanceCents, initialCash - partialPaymentCents, 'Replayed settlement must not deduct cash again');

    // 3. Mark workshop order delivered, generate sales invoice, and record customer receipt voucher
    const deliverRes = await request(`/api/workshop/orders/${workshopOrderId}/deliver`, jsonOptions('POST', {
      archiveMonth: '2026-11',
    }), adminCookie);

    assert.equal(deliverRes.response.status, 200);
    assert.equal(deliverRes.body.order.status, 'delivered_archived');
    assert.ok(deliverRes.body.invoice);
    salesInvoiceId = deliverRes.body.invoice.id;
    assert.equal(deliverRes.body.invoice.total_cents, 1200000); // 12,000 EGP

    // Record customer collection voucher in full (12,000 EGP)
    const receiptOperationId = randomUUID();
    const receiptRes = await request(`/api/finance/invoices/${salesInvoiceId}/receipt`, jsonOptions('POST', {
      amountCents: 1200000,
      operationId: receiptOperationId,
      notes: 'Final customer payment received in full upon delivery',
    }), financeUser.cookie);

    assert.equal(receiptRes.response.status, 201);
    assert.equal(receiptRes.body.invoice.paid_total_cents, 1200000);
    assert.equal(receiptRes.body.invoice.remaining_cents, 0);
    assert.equal(receiptRes.body.invoice.payment_status, 'paid');

    // Verify treasury increased by 12,000 EGP
    const treasuryAfterReceipt = (await request('/api/finance/treasury', {}, financeUser.cookie)).body;
    assert.equal(treasuryAfterReceipt.cashBalanceCents, treasuryAfterPay.cashBalanceCents + 1200000);

    // 4. Costing & Financial Reconciliation in GET /api/workshop/orders/:id/costing
    const costing = (await request(`/api/workshop/orders/${workshopOrderId}/costing`, {}, adminCookie)).body;

    // Financial numbers verification:
    // Revenue: 12,000 EGP (1,200,000 cents)
    assert.equal(costing.salePriceCents, 1200000, 'Sale price must be 12,000 EGP');

    // Actual Cost Breakdown:
    // Gross Material: 5,450 EGP (545,000 cents)
    assert.equal(costing.grossMaterialCostCents, 545000);
    // Offcut Credit: 250 EGP (25,000 cents)
    assert.equal(costing.offcutCreditsCents, 25000);
    // Net Material Cost: 5,200 EGP (520,000 cents)
    assert.equal(costing.materialCostCents, 520000);
    // CNC Machine: 390 min @ 200 EGP/hr = 1,300 EGP (130,000 cents)
    assert.equal(costing.machineCostCents, 130000);
    // Labor: Assembly 960 min (1,600 EGP) + Install 900 min (1,500 EGP) = 3,100 EGP (310,000 cents)
    assert.equal(costing.laborCostCents, 310000);
    // Total Cost: 5,200 + 1,300 + 3,100 = 9,600 EGP (960,000 cents)
    assert.equal(costing.totalCostCents, 960000, 'Actual total cost must be 9,600 EGP');

    // Actual Profit & Margins:
    // Gross Profit: 12,000 - 9,600 = 2,400 EGP (240,000 cents)
    assert.equal(costing.grossProfitCents, 240000, 'Gross profit must be 2,400 EGP');
    // Profit Margin: 2,400 / 12,000 = 20.0%
    assert.equal(costing.marginPercent, 20.0, 'Actual margin must be exactly 20.0%');

    // Variance Analysis Reconciliation:
    assert.ok(costing.variance, 'Costing variance analysis must be present');
    assert.equal(costing.variance.estimatedTotalCostCents, 900000, 'Estimated cost was 9,000 EGP');
    assert.equal(costing.variance.actualTotalCostCents, 960000, 'Actual cost was 9,600 EGP');
    assert.equal(costing.variance.varianceCents, 60000, 'Variance must be exactly +600 EGP (+60,000 cents)');
    assert.equal(costing.variance.estimatedProfitCents, 300000, 'Estimated profit was 3,000 EGP');
    assert.equal(costing.variance.actualProfitCents, 240000, 'Actual profit was 2,400 EGP');
    assert.equal(costing.variance.estimatedMarginPercent, 25.0, 'Estimated target margin was 25.0%');
    assert.equal(costing.variance.actualMarginPercent, 20.0, 'Actual achieved margin was 20.0%');

    // 5. Unified Traceability in GET /api/workshop/orders/:id/trace
    const trace = (await request(`/api/workshop/orders/${workshopOrderId}/trace`, {}, adminCookie)).body;
    assert.equal(trace.order.id, workshopOrderId);
    assert.equal(trace.quotation.id, quotationId);
    assert.ok(trace.quotationSnapshot, 'Quotation snapshot must be linked');
    assert.equal(trace.quotationSnapshot.snapshot_hash, quotationSnapshotHash, 'Snapshot hash must match frozen quotation');

    // Check procurement trace
    assert.ok(trace.procurement.requests.some((r) => r.id === purchaseRequestId));
    assert.ok(trace.procurement.purchaseOrders.some((p) => p.id === purchaseOrderId));
    assert.ok(trace.procurement.supplierInvoices.some((s) => s.id === purchaseInvoiceId));

    // Check production trace
    assert.ok(trace.production.stageLogs.length >= 2, 'Stage logs must include cutting and rework');
    assert.ok(trace.production.inspections.some((i) => i.decision === 'rework_required'), 'Inspection must trace rework rejection');
    assert.ok(trace.production.inspections.some((i) => i.decision === 'approved'), 'Inspection must trace final approval');
    assert.ok(trace.production.materialMovements.some((m) => m.kind === 'issue'), 'Trace must include material issue');
    assert.ok(trace.production.materialMovements.some((m) => m.kind === 'offcut_return'), 'Trace must include offcut return');

    // Check sales and treasury trace
    assert.equal(trace.salesAndTreasury.salesInvoice.id, salesInvoiceId);
    assert.ok(trace.salesAndTreasury.customerReceipts.some((r) => r.amount_cents === 1200000));

    // Check costing and variance in trace
    assert.equal(trace.costing.totalCostCents, 960000);
    assert.equal(trace.costingVariance.varianceCents, 60000);
    assert.equal(trace.costingVariance.actualMarginPercent, 20.0);
    assert.equal(trace.costingVariance.estimatedMarginPercent, 25.0);
  });
});
