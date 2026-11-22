import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import bcrypt from 'bcryptjs';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-prod-offcuts-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'prod-offcuts.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATA_DIR = join(temporaryDirectory, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.COOKIE_SECURE = 'false';
process.env.MADAR_V2_JWT_SECRET = 'test-secret-at-least-32-bytes-long-for-madar-m3-offcuts';
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }, { createSession }, { env }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/auth/service.js'),
  import('../server/config/env.js'),
]);

const adminPassword = 'prod-test-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });

// Rebuild users table in test DB to support 'technician' and 'supervisor' roles
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

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

// Authenticate Admin
const adminLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
assert.equal(adminLoginResponse.status, 200);
const adminCookie = (adminLoginResponse.headers.getSetCookie?.()[0] ?? adminLoginResponse.headers.get('set-cookie'))?.split(';', 1)[0];
assert.ok(adminCookie);

// Create Technician User & Employee
const techPassword = 'tech-secure-password-123';
const techPasswordHash = bcrypt.hashSync(techPassword, 10);
const techUserId = Number(db.prepare(`
  INSERT INTO users (username, password_hash, full_name, role)
  VALUES ('tech_ahmed', ?, 'Ahmed Hassan Technician', 'technician')
`).run(techPasswordHash).lastInsertRowid);

const techEmployeeId = Number(db.prepare(`
  INSERT INTO employees (user_id, name, department, job_title, base_salary_cents)
  VALUES (?, 'Ahmed Hassan Technician', 'Workshop', 'CNC Craftsman', 520000)
`).run(techUserId).lastInsertRowid);

const techToken = createSession({ id: techUserId, username: 'tech_ahmed', role: 'technician' }, db);
const techCookie = `${env.authCookieName}=${techToken}`;
assert.ok(techCookie);

// Create Supervisor User & Employee
const superPassword = 'super-secure-password-123';
const superPasswordHash = bcrypt.hashSync(superPassword, 10);
const superUserId = Number(db.prepare(`
  INSERT INTO users (username, password_hash, full_name, role)
  VALUES ('super_mahmoud', ?, 'Mahmoud Quality Supervisor', 'supervisor')
`).run(superPasswordHash).lastInsertRowid);

const superEmployeeId = Number(db.prepare(`
  INSERT INTO employees (user_id, name, department, job_title, base_salary_cents)
  VALUES (?, 'Mahmoud Quality Supervisor', 'Workshop', 'QA Lead', 800000)
`).run(superUserId).lastInsertRowid);

const superToken = createSession({ id: superUserId, username: 'super_mahmoud', role: 'supervisor' }, db);
const supervisorCookie = `${env.authCookieName}=${superToken}`;
assert.ok(supervisorCookie);

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}, cookie = adminCookie) {
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

test('Test 1: Sheet issued, 1x1m reusable offcut returned and credited, and issued to a second job, with quantity and valuation fully reconciled across both orders', async () => {
  // 1. Create client and initial workshop order (Job 1)
  const clientRes = await request('/api/clients', jsonOptions('POST', { name: 'Al-Madar Retail Store' }));
  assert.equal(clientRes.response.status, 201);
  const clientId = clientRes.body.id;

  const job1Res = await request('/api/workshop/orders', jsonOptions('POST', {
    clientId,
    productName: 'Channel Letters Frontage (Job 1)',
    machineType: 'laser',
    salePriceCents: 500000, // 5,000 EGP
    technicianIds: [techEmployeeId],
  }));
  assert.equal(job1Res.response.status, 201);
  const job1Id = job1Res.body.id;

  // 2. Create raw material: 1 whole sheet of Cast Acrylic 3mm White @ 1,000 EGP (100,000 cents)
  const materialRes = await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'ACR-WHT-3MM-PRIME',
    name: 'Cast Acrylic White 3mm 205x305cm',
    unit: 'sheet',
    minStock: 1,
    unitCostCents: 100000, // 1,000 EGP per sheet
    initialStock: 5,
  }));
  assert.equal(materialRes.response.status, 201);
  const materialId = materialRes.body.id;

  // 3. Issue 1 whole sheet from main warehouse to Job 1 at recorded cost (stamped 100,000 cents)
  const issueJob1Res = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: job1Id,
    sourceWarehouse: 'main',
    materialId,
    quantity: 1,
    notes: 'Whole sheet issued for Job 1 faces cutting',
  }));
  assert.equal(issueJob1Res.response.status, 201);
  assert.equal(issueJob1Res.body.movement.quantity, 1);
  assert.equal(issueJob1Res.body.stampedUnitCostCents, 100000);

  // Material stock decremented from 5 to 4
  const matCheck1 = (await request('/api/warehouse/materials')).body.find((m) => m.id === materialId);
  assert.equal(matCheck1.stock, 4);

  // 4. Return reusable 1x1m remainder to secondary warehouse with dimensions, credit source job
  const returnRes = await request('/api/warehouse/return', jsonOptions('POST', {
    workshopOrderId: job1Id,
    targetWarehouse: 'secondary',
    materialId,
    quantity: 1,
    unit: 'piece',
    offcutName: 'White Acrylic Usable 1x1m Remainder',
    offcutDimensions: '100x100 cm',
    unitCostCents: 40000, // Valued at 400 EGP (40% of sheet)
    finish: 'glossy',
    location: 'Rack-A3',
    notes: 'Clean reusable square offcut from Job 1',
  }));
  assert.equal(returnRes.response.status, 201);
  const offcutId = returnRes.body.offcut.id;
  assert.equal(returnRes.body.offcut.dimensions, '100x100 cm');
  assert.equal(returnRes.body.offcut.unit_cost_cents, 40000);
  assert.equal(returnRes.body.offcut.status, 'available');

  // Verify Job 1 Costing Net Reconciliation:
  // Job 1 COGS = (whole sheet cost 100,000 - offcut credit 40,000) = 60,000 cents (600 EGP)
  const job1Costing = (await request(`/api/workshop/orders/${job1Id}/costing`)).body;
  assert.equal(job1Costing.materialCostCents, 60000, 'Job 1 Net Material COGS must be 60,000 cents');
  assert.equal(job1Costing.offcutCreditsCents, 40000, 'Job 1 Offcut Credit must be 40,000 cents');

  // 5. Create a second workshop order (Job 2)
  const client2Res = await request('/api/clients', jsonOptions('POST', { name: 'Delta Pharmacy Group' }));
  const job2Res = await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client2Res.body.id,
    productName: 'Pharmacy Counter Sign (Job 2)',
    machineType: 'laser',
    salePriceCents: 300000, // 3,000 EGP
    technicianIds: [techEmployeeId],
  }));
  assert.equal(job2Res.response.status, 201);
  const job2Id = job2Res.body.id;

  // 6. Issue the 1x1m reusable offcut from secondary warehouse to Job 2
  // Job 2 requires a 90x90cm piece (fits within 100x100cm)
  const issueJob2Res = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: job2Id,
    sourceWarehouse: 'secondary',
    offcutId,
    quantity: 1,
    requiredDimensions: { widthCm: 90, heightCm: 90 },
    notes: 'Consuming 1x1m offcut for Job 2 counter sign',
  }));
  assert.equal(issueJob2Res.response.status, 201);
  assert.equal(issueJob2Res.body.success, true);
  assert.equal(issueJob2Res.body.fits, true);
  assert.equal(issueJob2Res.body.stampedUnitCostCents, 40000);

  // Offcut is now consumed
  const offcutsList = (await request('/api/warehouse/offcuts?status=consumed')).body;
  assert.ok(offcutsList.some((o) => o.id === offcutId && o.status === 'consumed'));

  // 7. Verify Job 2 Costing:
  // Job 2 COGS = 40,000 cents (charged exact offcut value)
  const job2Costing = (await request(`/api/workshop/orders/${job2Id}/costing`)).body;
  assert.equal(job2Costing.materialCostCents, 40000, 'Job 2 Material COGS must be charged 40,000 cents');
  assert.equal(job2Costing.offcutCreditsCents, 0);

  // 8. Full Financial Reconciliation across both jobs:
  // Job 1 COGS (60,000) + Job 2 COGS (40,000) = 100,000 cents (Original whole sheet issue cost!)
  const totalReconciledCents = job1Costing.materialCostCents + job2Costing.materialCostCents;
  assert.equal(totalReconciledCents, 100000, 'Total COGS across Job 1 and Job 2 must equal the 1,000 EGP whole sheet issue cost');
});

test('Test 2: Offcut selection rejects same-area offcuts whose dimensions/orientation do not fit (e.g. required 1x1m piece vs 0.8x1.25m offcut rejected with 409; 1.1x1.0m offcut accepted)', async () => {
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Fit Geometry Test Client' }))).body;
  const job = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Geometric Fitting Order',
    machineType: 'cnc_router',
    salePriceCents: 400000,
    technicianIds: [],
  }))).body;

  // Required piece: 1x1m (100cm x 100cm = 10,000 cm² area)
  const required1x1m = { widthMm: 1000, heightMm: 1000 };

  // Offcut 1: 0.8x1.25m (80cm x 125cm = 10,000 cm² area).
  // Has the EXACT SAME area as 1x1m, but neither 80x125 nor 125x80 can contain a 100x100 piece!
  const offcutWrongRatio = (await request('/api/warehouse/offcuts', jsonOptions('POST', {
    name: 'Narrow Long Strip Offcut (0.8x1.25m)',
    dimensions: '80x125 cm',
    quantity: 1,
    unit: 'piece',
    unitCostCents: 35000,
  }))).body;

  // Attempt to issue Offcut 1 to Job -> MUST REJECT WITH 409 OFFCUT_DIMENSION_MISMATCH
  const rejectRes = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: job.id,
    sourceWarehouse: 'secondary',
    offcutId: offcutWrongRatio.id,
    quantity: 1,
    requiredDimensions: required1x1m,
  }));
  assert.equal(rejectRes.response.status, 409, 'Must reject with HTTP 409');
  assert.equal(rejectRes.body.error || rejectRes.body.code, 'OFFCUT_DIMENSION_MISMATCH');
  assert.ok(
    (rejectRes.body.message || rejectRes.body.error).includes('Offcut dimensions do not fit the required piece dimensions'),
    'Error message must state that same area does not guarantee geometric fit'
  );

  // Offcut 2: 1.1x1.0m (110cm x 100cm).
  // Can fit a 100x100 piece in normal orientation!
  const offcutSufficient = (await request('/api/warehouse/offcuts', jsonOptions('POST', {
    name: 'Sufficient Sized Offcut (1.1x1.0m)',
    dimensions: '1.1x1.0 m',
    quantity: 1,
    unit: 'piece',
    unitCostCents: 45000,
  }))).body;

  const acceptRes = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: job.id,
    sourceWarehouse: 'secondary',
    offcutId: offcutSufficient.id,
    quantity: 1,
    requiredDimensions: required1x1m,
  }));
  assert.equal(acceptRes.response.status, 201, 'Must accept matching offcut with HTTP 201');
  assert.equal(acceptRes.body.success, true);
  assert.equal(acceptRes.body.fits, true);

  // Offcut 3: 90° Rotated Fit: Required is 110x95cm, Offcut is 100x120cm
  // In normal orientation (100 < 110) it does not fit, but when rotated 90° (120 >= 110 and 100 >= 95) it fits!
  const jobRotated = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Rotated Fitting Order',
    machineType: 'laser',
    salePriceCents: 400000,
    technicianIds: [],
  }))).body;

  const offcutRotated = (await request('/api/warehouse/offcuts', jsonOptions('POST', {
    name: 'Rotated Candidate Offcut (100x120cm)',
    dimensions: '100x120 cm',
    quantity: 1,
    unit: 'piece',
    unitCostCents: 40000,
  }))).body;

  const acceptRotatedRes = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: jobRotated.id,
    sourceWarehouse: 'secondary',
    offcutId: offcutRotated.id,
    quantity: 1,
    requiredDimensions: { widthCm: 110, heightCm: 95 },
  }));
  assert.equal(acceptRotatedRes.response.status, 201, '90° rotated orientation must fit and be accepted');
  assert.equal(acceptRotatedRes.body.fits, true);
});

test('Test 3: Scrap separation: scrap offcuts cannot be issued to production jobs', async () => {
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Scrap & Customer Stock Client' }))).body;
  const job = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Standard Production Order',
    machineType: 'cnc_router',
    salePriceCents: 250000,
    technicianIds: [],
  }))).body;

  // 1. Create a scrap offcut with isScrap = 1
  const scrapOffcut = (await request('/api/warehouse/offcuts', jsonOptions('POST', {
    name: 'Laser Edge Shreds & Scrap',
    dimensions: '15x20 cm',
    quantity: 1,
    unit: 'piece',
    unitCostCents: 0,
    isScrap: 1,
    notes: 'Damaged chipped acrylic remnants',
  }))).body;

  // Verify scrap offcut is excluded from available list
  const availableOffcuts = (await request('/api/warehouse/offcuts?status=available')).body;
  assert.ok(!availableOffcuts.some((o) => o.id === scrapOffcut.id), 'Scrap offcuts must not appear in available inventory');

  // Verify scrap offcut appears in scrap list
  const scrapOffcuts = (await request('/api/warehouse/offcuts?status=scrap')).body;
  assert.ok(scrapOffcuts.some((o) => o.id === scrapOffcut.id), 'Scrap offcuts must be queryable via status=scrap');

  // Attempt to issue scrap offcut to a production workshop order -> MUST FAIL WITH 409
  const issueScrapRes = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: job.id,
    sourceWarehouse: 'secondary',
    offcutId: scrapOffcut.id,
    quantity: 1,
  }));
  assert.equal(issueScrapRes.response.status, 409, 'Issuing scrap to production must return 409');
  assert.ok(
    (issueScrapRes.body.message || issueScrapRes.body.error).includes('Scrap offcuts cannot be issued to production jobs'),
    'Must explain that scrap offcuts cannot be issued'
  );

  // 2. Customer-owned stock separation:
  // Create another client (Client B)
  const clientB = (await request('/api/clients', jsonOptions('POST', { name: 'Consigned Customer B' }))).body;

  // Create material owned by Client B
  const clientBMaterial = (await request('/api/warehouse/materials', jsonOptions('POST', {
    code: 'CLIENT-B-ACRYLIC',
    name: 'Customer B Consigned Gold Acrylic',
    unit: 'sheet',
    minStock: 0,
    unitCostCents: 150000,
    initialStock: 2,
    isCustomerOwned: 1,
    clientId: clientB.id,
  }))).body;

  // Attempt to issue Client B material to Job (which belongs to Client A) -> MUST FAIL WITH 409
  const crossCustomerIssue = await request('/api/warehouse/issue', jsonOptions('POST', {
    workshopOrderId: job.id,
    sourceWarehouse: 'main',
    materialId: clientBMaterial.id,
    quantity: 1,
  }));
  assert.equal(crossCustomerIssue.response.status, 409, 'Cross-client material issue must be rejected with 409');
  assert.ok(
    (crossCustomerIssue.body.message || crossCustomerIssue.body.error).includes('Customer-owned stock'),
    'Must enforce customer stock separation'
  );
});

test('Test 4: Rework and approval flow completed with separate technician and supervisor accounts', async () => {
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'QA Workflow Client' }))).body;

  // 1. Supervisor/Admin creates order and assigns technician
  const job = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Illuminated Acrylic Sign QA Rework Test',
    machineType: 'laser',
    salePriceCents: 750000,
    technicianIds: [techEmployeeId],
  }))).body;
  assert.equal(job.status, 'in_production');

  // 2. Technician logs initial stage work (CNC cutting - 90 minutes)
  const stageLog1 = await request(`/api/workshop/orders/${job.id}/stage-log`, jsonOptions('POST', {
    stageName: 'cnc_laser',
    action: 'complete',
    durationMinutes: 90,
    notes: 'Initial laser profiling completed',
  }), techCookie);
  assert.equal(stageLog1.response.status, 201);
  assert.equal(stageLog1.body.duration_minutes, 90);

  // 3. Technician submits job for QA inspection
  const submitQA1 = await request(`/api/workshop/orders/${job.id}/qa-submit`, jsonOptions('POST', {
    notes: 'Fabrication complete; ready for supervisor inspection',
  }), techCookie);
  assert.equal(submitQA1.response.status, 200);
  assert.equal(submitQA1.body.success, true);

  // Order status remains in_production (not self-approved to ready!)
  const jobAfterSubmit1 = (await request(`/api/workshop/orders/${job.id}`)).body;
  assert.equal(jobAfterSubmit1.status, 'in_production');

  // 4. Supervisor inspects and rejects for rework (e.g. edge burrs / rough seams)
  const reworkReview = await request(`/api/workshop/orders/${job.id}/qa-review`, jsonOptions('POST', {
    decision: 'rework_required',
    defectCategory: 'rough_acrylic_edge',
    notes: 'Letter C has burred contour; requires flame polishing and edge deburring',
  }), supervisorCookie);
  assert.equal(reworkReview.response.status, 200);
  assert.equal(reworkReview.body.decision, 'rework_required');

  // Order explicitly transitions back to in_production
  const jobAfterReject = (await request(`/api/workshop/orders/${job.id}`)).body;
  assert.equal(jobAfterReject.status, 'in_production');

  // 5. Technician logs rework time (finishing / polishing - 45 minutes)
  const reworkStageLog = await request(`/api/workshop/orders/${job.id}/stage-log`, jsonOptions('POST', {
    stageName: 'finishing',
    action: 'complete',
    durationMinutes: 45,
    notes: 'Completed flame polishing on letter C contour as requested by supervisor',
  }), techCookie);
  assert.equal(reworkStageLog.response.status, 201);
  assert.equal(reworkStageLog.body.duration_minutes, 45);

  // 6. Technician re-submits for QA
  const submitQA2 = await request(`/api/workshop/orders/${job.id}/qa-submit`, jsonOptions('POST', {
    notes: 'Rework complete; edge flame polished and clean',
  }), techCookie);
  assert.equal(submitQA2.response.status, 200);
  assert.equal(submitQA2.body.success, true);

  // 7. Supervisor re-inspects and approves
  const approveReview = await request(`/api/workshop/orders/${job.id}/qa-review`, jsonOptions('POST', {
    decision: 'approved',
    notes: 'Edges re-inspected under high-intensity light; smooth and clean. Approved.',
  }), supervisorCookie);
  assert.equal(approveReview.response.status, 200);
  assert.equal(approveReview.body.decision, 'approved');

  // Order status transitions to ready
  const jobFinal = (await request(`/api/workshop/orders/${job.id}`)).body;
  assert.equal(jobFinal.status, 'ready');

  // Verify costing traces both the initial work and the rework time
  const costing = (await request(`/api/workshop/orders/${job.id}/costing`)).body;
  assert.equal(costing.totalLaborMinutes, 45); // Finishing rework minutes
  assert.equal(costing.totalMachineMinutes, 90); // CNC cutting minutes
  assert.ok(costing.laborCostCents > 0);
  assert.ok(costing.machineCostCents > 0);
});

test('Test 5: Technician restricted access: cannot view unassigned jobs or approve inspections', async () => {
  const client = (await request('/api/clients', jsonOptions('POST', { name: 'Access Gating Client' }))).body;

  // Job A: Assigned to technician Ahmed
  const assignedJob = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Assigned Job for Ahmed',
    machineType: 'laser',
    salePriceCents: 300000,
    technicianIds: [techEmployeeId],
  }))).body;

  // Job B: Unassigned (or assigned to another employee)
  const unassignedJob = (await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Secret Job for Other Team',
    machineType: 'cnc_router',
    salePriceCents: 500000,
    technicianIds: [], // Ahmed is NOT assigned
  }))).body;

  // 1. Technician workbench list (/api/workshop/technician/jobs) returns ONLY assigned jobs
  const techJobsRes = await request('/api/workshop/technician/jobs', {}, techCookie);
  assert.equal(techJobsRes.response.status, 200);
  const techJobs = techJobsRes.body;
  assert.ok(techJobs.some((j) => j.id === assignedJob.id), 'Assigned job must be in technician job list');
  assert.ok(!techJobs.some((j) => j.id === unassignedJob.id), 'Unassigned job must NOT appear in technician job list');

  // 2. Technician directly accessing unassigned job (/api/workshop/orders/:id) must be rejected with 403
  const directUnassignedRes = await request(`/api/workshop/orders/${unassignedJob.id}`, {}, techCookie);
  assert.equal(directUnassignedRes.response.status, 403, 'Technician cannot view unassigned job detail');

  // 3. Technician directly accessing assigned job (/api/workshop/orders/:id) is permitted
  const directAssignedRes = await request(`/api/workshop/orders/${assignedJob.id}`, {}, techCookie);
  assert.equal(directAssignedRes.response.status, 200, 'Technician can view assigned job detail');

  // 4. Technician listing all orders (/api/workshop/orders) must be rejected with 403
  const listAllOrdersRes = await request('/api/workshop/orders', {}, techCookie);
  assert.equal(listAllOrdersRes.response.status, 403, 'Technician cannot access general orders list');

  // 5. Technician attempting to log stage time on unassigned job must be rejected with 403
  const unassignedStageLog = await request(`/api/workshop/orders/${unassignedJob.id}/stage-log`, jsonOptions('POST', {
    stageName: 'cnc_laser',
    action: 'complete',
    durationMinutes: 30,
  }), techCookie);
  assert.equal(unassignedStageLog.response.status, 403, 'Technician cannot log time for unassigned job');

  // 6. Technician attempting to submit QA for unassigned job must be rejected with 403
  const unassignedQASubmit = await request(`/api/workshop/orders/${unassignedJob.id}/qa-submit`, jsonOptions('POST', {
    notes: 'Unauthorized QA submission',
  }), techCookie);
  assert.equal(unassignedQASubmit.response.status, 403, 'Technician cannot submit QA for unassigned job');

  // 7. Technician attempting to self-approve inspection on assigned job (/api/workshop/orders/:id/qa-review) must be rejected with 403
  const selfApproveReview = await request(`/api/workshop/orders/${assignedJob.id}/qa-review`, jsonOptions('POST', {
    decision: 'approved',
    notes: 'Technician self-approval attempt',
  }), techCookie);
  assert.equal(selfApproveReview.response.status, 403, 'Technician cannot approve quality inspections via qa-review');

  // 8. Technician attempting to force ready transition (/api/workshop/orders/:id/ready) must be rejected with 403
  const forceReadyRes = await request(`/api/workshop/orders/${assignedJob.id}/ready`, jsonOptions('POST', {}), techCookie);
  assert.equal(forceReadyRes.response.status, 403, 'Technician cannot mark orders ready directly');
});
