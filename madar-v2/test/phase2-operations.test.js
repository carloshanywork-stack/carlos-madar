import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-phase2-'));
const storageDirectory = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'phase2.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = storageDirectory;
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
]);

const adminPassword = 'phase2-test-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });
const maintenanceTechnicianId = Number(db.prepare(`
  INSERT INTO employees (name, department, job_title) VALUES ('Field Technician', 'Maintenance', 'Technician')
`).run().lastInsertRowid);
const workshopTechnicianId = Number(db.prepare(`
  INSERT INTO employees (name, department, job_title) VALUES ('CNC Operator', 'Workshop', 'CNC Operator')
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
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  return { response, body };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('Phase 2 client, maintenance, and workshop flows remain isolated and transactional', async () => {
  const clientCreated = await request('/api/clients', jsonOptions('POST', {
    name: 'Acrylic & Maintenance Client',
    contactName: 'Operations Contact',
    phone: '+966500000001',
    email: 'ops@example.local',
    primaryColor: '#124ABC',
    secondaryColor: '#E5E7EB',
  }));
  assert.equal(clientCreated.response.status, 201);
  const client = clientCreated.body;
  assert.match(client.code, /^C-\d{4,}$/);
  assert.equal(client.code, 'C-1001');

  const clients = await request('/api/clients');
  assert.equal(clients.response.status, 200);
  assert.deepEqual(clients.body.map((entry) => entry.id), [client.id]);

  const pettyCashFunding = await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income',
    category: 'Phase 2 test capitalization',
    amountCents: 20000,
    reference: 'phase2-test-opening-cash',
  }));
  assert.equal(pettyCashFunding.response.status, 201);
  assert.equal(pettyCashFunding.body.cashBalanceCents, 20000);

  const logoForm = new FormData();
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  logoForm.append('logo', new Blob([pngBytes], { type: 'image/png' }), 'brand.png');
  const uploadedLogo = await request(`/api/clients/${client.id}/logo`, { method: 'POST', body: logoForm });
  assert.equal(uploadedLogo.response.status, 200);
  assert.match(uploadedLogo.body.logo_path, /^clients\/C-1001\/logo\//);
  assert.equal(uploadedLogo.body.logo_url, `/api/clients/${client.id}/logo`);
  const logoDownload = await request(uploadedLogo.body.logo_url);
  assert.equal(logoDownload.response.status, 200);
  assert.deepEqual(logoDownload.body, pngBytes);

  const machineCreated = await request('/api/maintenance/machines', jsonOptions('POST', {
    code: 'MACHINE-ACRYLIC-01',
    name_ar: 'آلة الأكريليك',
    name_en: 'Acrylic machine',
    area: 'Riyadh',
  }));
  assert.equal(machineCreated.response.status, 201);
  const machine = machineCreated.body;
  assert.deepEqual((await request('/api/maintenance/areas')).body, ['Riyadh']);
  const filteredMachines = await request('/api/maintenance/machines?area=Riyadh&search=acrylic');
  assert.deepEqual(filteredMachines.body.machines.map((entry) => entry.id), [machine.id]);
  assert.equal(filteredMachines.body.total, 1);
  assert.deepEqual(filteredMachines.body.areas, ['Riyadh']);

  const rejectedFinancialFields = await request('/api/maintenance/orders', jsonOptions('POST', {
    clientId: client.id,
    employeeIds: [maintenanceTechnicianId],
    materialCostCents: 1234,
  }));
  assert.equal(rejectedFinancialFields.response.status, 400);
  assert.match(rejectedFinancialFields.body.error, /Unsupported field/);

  const maintenanceCreated = await request('/api/maintenance/orders', jsonOptions('POST', {
    clientId: client.id,
    area: 'Riyadh',
    employeeIds: [maintenanceTechnicianId],
    notes: 'Inspect acrylic equipment at site.',
    pettyCashDisbursedCents: 12500,
  }));
  assert.equal(maintenanceCreated.response.status, 201);
  const maintenanceOrder = maintenanceCreated.body;
  assert.match(maintenanceOrder.order_code, /^MN-\d{4,}$/);
  assert.equal(maintenanceOrder.technicians[0].id, maintenanceTechnicianId);
  assert.equal('material_cost' in maintenanceOrder, false);
  assert.equal('selling_price' in maintenanceOrder, false);
  assert.equal('cogs' in maintenanceOrder, false);
  assert.equal('profit' in maintenanceOrder, false);

  const cardCreated = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/cards`,
    jsonOptions('POST', { machineId: machine.id, notes: 'Initial inspection.' }),
  );
  assert.equal(cardCreated.response.status, 201);
  const card = cardCreated.body;

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
  async function uploadPhoto(phase) {
    const form = new FormData();
    form.append('photo', new Blob([jpegBytes], { type: 'image/jpeg' }), `${phase}.jpg`);
    return request(
      `/api/maintenance/orders/${maintenanceOrder.id}/cards/${card.id}/photos/${phase}`,
      { method: 'POST', body: form },
    );
  }
  const beforePhoto = await uploadPhoto('before');
  const afterPhoto = await uploadPhoto('after');
  assert.equal(beforePhoto.response.status, 201);
  assert.equal(afterPhoto.response.status, 201);
  assert.match(beforePhoto.body.path, /^clients\/C-1001\/maintenance\/MN-\d+\/MACHINE-ACRYLIC-01\/before\//);
  assert.match(afterPhoto.body.path, /^clients\/C-1001\/maintenance\/MN-\d+\/MACHINE-ACRYLIC-01\/after\//);
  assert.equal(existsSync(join(storageDirectory, ...beforePhoto.body.path.split('/'))), true);
  assert.equal(existsSync(join(storageDirectory, ...afterPhoto.body.path.split('/'))), true);
  const beforeDownload = await request(beforePhoto.body.url);
  assert.equal(beforeDownload.response.status, 200);
  assert.deepEqual(beforeDownload.body, jpegBytes);

  const updatedCard = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/cards/${card.id}`,
    jsonOptions('PATCH', {
      beforePhotos: [beforePhoto.body.path],
      afterPhotos: [afterPhoto.body.path],
      notes: 'Before and after evidence attached.',
    }),
  );
  assert.equal(updatedCard.response.status, 200);
  assert.deepEqual(updatedCard.body.before_photos, [beforePhoto.body.path]);
  assert.deepEqual(updatedCard.body.after_photos, [afterPhoto.body.path]);
  const rejectedOutsidePhoto = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/cards/${card.id}`,
    jsonOptions('PATCH', { beforePhotos: ['../../outside.jpg'] }),
  );
  assert.equal(rejectedOutsidePhoto.response.status, 400);

  const maintenanceDetail = await request(`/api/maintenance/orders/${maintenanceOrder.id}`);
  assert.equal(maintenanceDetail.response.status, 200);
  assert.equal(maintenanceDetail.body.client.id, client.id);
  assert.equal(maintenanceDetail.body.cards[0].machine_code, machine.code);
  assert.deepEqual(maintenanceDetail.body.cards[0].before_photos, [beforePhoto.body.path]);

  const renamedMachineCard = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/cards/${card.id}`,
    jsonOptions('PATCH', { machineCode: 'MACHINE-ACRYLIC-RENAMED' }),
  );
  assert.equal(renamedMachineCard.response.status, 200, JSON.stringify(renamedMachineCard.body));
  assert.equal(renamedMachineCard.body.machine_id, machine.id);
  assert.equal(renamedMachineCard.body.machine_code, 'MACHINE-ACRYLIC-RENAMED');
  assert.equal(db.prepare('SELECT code FROM machines WHERE id = ?').get(machine.id).code, 'MACHINE-ACRYLIC-RENAMED');

  const correctMachineCreated = await request('/api/maintenance/machines', jsonOptions('POST', {
    code: 'MACHINE-ACRYLIC-CORRECT',
    name_ar: 'آلة الأكريليك الصحيحة',
    name_en: 'Correct acrylic machine',
    area: 'Riyadh',
  }));
  assert.equal(correctMachineCreated.response.status, 201);
  const relinkedCard = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/cards/${card.id}`,
    jsonOptions('PATCH', { machineCode: correctMachineCreated.body.code }),
  );
  assert.equal(relinkedCard.response.status, 200, JSON.stringify(relinkedCard.body));
  assert.equal(relinkedCard.body.machine_id, correctMachineCreated.body.id);
  assert.equal(relinkedCard.body.machine_code, correctMachineCreated.body.code);
  const machineCodeAudit = db.prepare(`
    SELECT action, old_values_json, new_values_json FROM audit_log
    WHERE entity_type = 'maintenance_card' AND entity_id = ? AND action = 'update_card_machine_code'
    ORDER BY id DESC LIMIT 1
  `).get(card.id);
  assert.equal(machineCodeAudit.action, 'update_card_machine_code');
  assert.equal(JSON.parse(machineCodeAudit.old_values_json).machine_code, 'MACHINE-ACRYLIC-RENAMED');
  assert.equal(JSON.parse(machineCodeAudit.new_values_json).machine_code, 'MACHINE-ACRYLIC-CORRECT');
  const invalidMachineCode = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/cards/${card.id}`,
    jsonOptions('PATCH', { machineCode: '../invalid' }),
  );
  assert.equal(invalidMachineCode.response.status, 400);

  const legacyPhotoPath = 'Clients/Legacy Client/Archived_Orders/LEGACY-ORDER/MACHINE-ACRYLIC-01/Before/legacy-photo.jpg';
  const legacyPhotoAbsolutePath = join(storageDirectory, ...legacyPhotoPath.split('/'));
  mkdirSync(join(storageDirectory, ...legacyPhotoPath.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(legacyPhotoAbsolutePath, jpegBytes);
  db.prepare('UPDATE maintenance_cards SET before_photos_json = ? WHERE id = ?')
    .run(JSON.stringify([legacyPhotoPath]), card.id);
  const legacyPhotoDetail = await request(`/api/maintenance/orders/${maintenanceOrder.id}`);
  const legacyPhotoDownload = await request(legacyPhotoDetail.body.cards[0].before_photo_urls[0]);
  assert.equal(legacyPhotoDownload.response.status, 200);
  assert.deepEqual(legacyPhotoDownload.body, jpegBytes);

  const movedToReview = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/status`,
    jsonOptions('PATCH', {}),
  );
  assert.equal(movedToReview.response.status, 200);
  assert.equal(movedToReview.body.status, 'review');
  const archived = await request(
    `/api/maintenance/orders/${maintenanceOrder.id}/archive`,
    jsonOptions('POST', { warrantyPeriodMonths: 6, actualExpensesCents: 4500 }),
  );
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.order.status, 'archived');
  assert.equal(archived.body.order.warranty_period_months, 6);
  assert.equal(archived.body.order.actual_expenses_cents, 4500);
  assert.equal(archived.body.order.petty_cash_refund_cents, 8000);
  assert.ok(archived.body.order.archived_at);
  assert.ok(archived.body.order.archived_by);
  const custodyEntries = (await request('/api/finance/treasury')).body.entries
    .filter((entry) => entry.maintenance_order_id === maintenanceOrder.id);
  assert.deepEqual(custodyEntries.map((entry) => [entry.kind, entry.category, entry.amount_cents]), [
    ['income', 'رد عهدة صيانة', 8000],
    ['expense', 'عهدة نقدية صيانة', 12500],
  ]);
  assert.ok(custodyEntries.every((entry) => entry.maintenance_order_code === maintenanceOrder.order_code));
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 15500);

  const workshopCreated = await request('/api/workshop/orders', jsonOptions('POST', {
    clientId: client.id,
    productName: 'Acrylic sign panel',
    description: 'CNC cut panel',
    machineType: 'cnc_router',
    targetDeliveryDate: '2026-11-15',
    salePriceCents: 54000,
    technicianIds: [workshopTechnicianId],
  }));
  assert.equal(workshopCreated.response.status, 201);
  const workshopOrder = workshopCreated.body;
  assert.match(workshopOrder.order_code, /^MFG-\d{4,}$/);
  assert.equal(workshopOrder.machine_type, 'cnc_router');
  assert.equal(workshopOrder.target_delivery_date, '2026-11-15');
  assert.equal(workshopOrder.technicians[0].id, workshopTechnicianId);

  const dxfContents = Buffer.from('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n', 'utf8');
  const rejectedDesignForm = new FormData();
  rejectedDesignForm.append('file', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'panel.svg');
  const rejectedDesign = await request(`/api/workshop/orders/${workshopOrder.id}/designs`, {
    method: 'POST',
    body: rejectedDesignForm,
  });
  assert.equal(rejectedDesign.response.status, 400);
  const designForm = new FormData();
  designForm.append('file', new Blob([dxfContents], { type: 'application/dxf' }), 'panel.dxf');
  const uploadedDesign = await request(`/api/workshop/orders/${workshopOrder.id}/designs`, {
    method: 'POST',
    body: designForm,
  });
  assert.equal(uploadedDesign.response.status, 201);
  assert.equal(uploadedDesign.body.extension, '.dxf');
  assert.match(uploadedDesign.body.stored_path, /^clients\/C-1001\/workshop\/MFG-\d+\/designs\//);
  assert.equal(existsSync(join(storageDirectory, ...uploadedDesign.body.stored_path.split('/'))), true);

  const designDownload = await request(`/api/workshop/designs/${uploadedDesign.body.id}/download`);
  assert.equal(designDownload.response.status, 200);
  assert.deepEqual(designDownload.body, dxfContents);

  const ready = await request(
    `/api/workshop/orders/${workshopOrder.id}/ready`,
    jsonOptions('POST', {
      offcuts: [{ name: 'Acrylic remnant', dimensions: '50x50 cm', quantity: 1, unit: 'piece' }],
    }),
  );
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.status, 'ready');
  assert.equal(ready.body.offcuts.length, 1);
  assert.equal(ready.body.offcuts[0].material_id, null);
  assert.equal(ready.body.offcuts[0].dimensions, '50x50 cm');
  assert.equal(ready.body.offcuts[0].status, 'available');

  const maintenanceList = await request('/api/maintenance/orders?status=archived');
  const workshopList = await request('/api/workshop/orders?status=ready');
  assert.deepEqual(maintenanceList.body.map((order) => order.order_code), [maintenanceOrder.order_code]);
  assert.deepEqual(maintenanceList.body[0].areas, ['Riyadh']);
  assert.equal(maintenanceList.body[0].area_summary, 'Riyadh');
  assert.deepEqual(workshopList.body.map((order) => order.order_code), [workshopOrder.order_code]);
  assert.equal(maintenanceList.body.some((order) => order.order_code.startsWith('MFG-')), false);
  assert.equal(workshopList.body.some((order) => order.order_code.startsWith('MN-')), false);
  db.prepare('UPDATE maintenance_orders SET area = NULL WHERE id = ?').run(maintenanceOrder.id);
  const legacyAreaList = await request('/api/maintenance/orders?status=archived');
  assert.deepEqual(legacyAreaList.body[0].areas, ['Riyadh'], 'machine areas provide a fallback for old orders without an area');
  assert.equal((await request('/api/maintenance/orders?status=all')).response.status, 400);
  assert.equal((await request('/api/workshop/orders')).response.status, 400);

  const profile = await request(`/api/clients/${client.id}`);
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.primary_color, '#124ABC');
  assert.deepEqual(profile.body.statistics, {
    activeMaintenanceOrders: 0,
    completedMaintenanceVisits: 1,
    activeWorkshopOrders: 1,
  });
  assert.equal(profile.body.machines.some((entry) => entry.id === machine.id), true);

  const delivered = await request(
    `/api/workshop/orders/${workshopOrder.id}/deliver`,
    jsonOptions('POST', {}),
  );
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.body.order.status, 'delivered_archived');
  assert.ok(delivered.body.order.delivered_at);
  assert.match(delivered.body.invoice.code, /^INV-\d{4,}$/);
  assert.equal(delivered.body.invoice.workshop_order_id, workshopOrder.id);
  assert.equal(delivered.body.invoice.client_id, client.id);
  assert.equal(delivered.body.invoice.total_cents, 54000);
  assert.equal(delivered.body.order.sales_invoice_id, delivered.body.invoice.id);
  assert.equal((await request(`/api/workshop/orders/${workshopOrder.id}/deliver`, jsonOptions('POST', {}))).response.status, 409);
  assert.deepEqual(
    (await request('/api/workshop/orders?status=delivered_archived')).body.map((entry) => entry.order_code),
    [workshopOrder.order_code],
  );

  const auditCount = db.prepare(`
    SELECT COUNT(*) AS count FROM audit_log
    WHERE entity_type IN ('maintenance_order', 'workshop_order', 'maintenance_card')
  `).get().count;
  assert.ok(auditCount >= 6);
});
