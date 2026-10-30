import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-phase5-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'phase5.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
]);

const adminPassword = 'phase5-test-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });
const maintenanceEmployeeId = Number(db.prepare(`
  INSERT INTO employees (name, department, job_title) VALUES ('Phase Five Technician', 'Maintenance', 'Field Technician')
`).run().lastInsertRowid);
db.prepare(`
  INSERT INTO employees (name, department, job_title) VALUES ('Phase Five Designer', 'Workshop', 'Designer')
`).run();
db.prepare(`
  INSERT INTO employees (name, department, job_title, active) VALUES ('Inactive Technician', 'Maintenance', 'Technician', 0)
`).run();

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

test('employee selectors filter active staff and maintenance custody advances stay linked and auditable', async () => {
  const allEmployees = await request('/api/employees');
  assert.equal(allEmployees.response.status, 200);
  assert.deepEqual(allEmployees.body.map((employee) => employee.name), ['Phase Five Technician', 'Phase Five Designer']);

  const maintenanceEmployees = await request('/api/employees?department=Maintenance');
  assert.equal(maintenanceEmployees.response.status, 200);
  assert.deepEqual(maintenanceEmployees.body.map((employee) => employee.id), [maintenanceEmployeeId]);
  assert.equal((await request('/api/employees?department=Unknown')).response.status, 400);

  const client = await request('/api/clients', jsonOptions('POST', { name: 'Phase Five Client' }));
  assert.equal(client.response.status, 201);
  const funding = await request('/api/finance/treasury/entries', jsonOptions('POST', {
    kind: 'income', category: 'Phase five opening balance', amountCents: 50000,
  }));
  assert.equal(funding.response.status, 201);

  const created = await request('/api/maintenance/orders', jsonOptions('POST', {
    clientId: client.body.id,
    employeeIds: [maintenanceEmployeeId],
    notes: 'A separate custody advance is expected after order creation.',
  }));
  assert.equal(created.response.status, 201);
  const orderId = created.body.id;
  assert.equal(created.body.petty_cash_disbursed_cents, 0);

  const firstAdvance = await request(`/api/maintenance/orders/${orderId}/custody-advance`, jsonOptions('POST', {
    amountCents: 12500, notes: 'Initial field advance',
  }));
  assert.equal(firstAdvance.response.status, 201);
  assert.equal(firstAdvance.body.petty_cash_disbursed_cents, 12500);

  const secondAdvance = await request(`/api/maintenance/orders/${orderId}/custody-advance`, jsonOptions('POST', {
    amountCents: 4000,
  }));
  assert.equal(secondAdvance.response.status, 201);
  assert.equal(secondAdvance.body.petty_cash_disbursed_cents, 16500);

  const unaffordableAdvance = await request(`/api/maintenance/orders/${orderId}/custody-advance`, jsonOptions('POST', {
    amountCents: 50000,
  }));
  assert.equal(unaffordableAdvance.response.status, 409);
  assert.equal((await request(`/api/maintenance/orders/${orderId}`)).body.petty_cash_disbursed_cents, 16500);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 33500);

  const linkedExpenses = (await request('/api/finance/treasury')).body.entries
    .filter((entry) => entry.maintenance_order_id === orderId && entry.kind === 'expense');
  assert.equal(linkedExpenses.length, 2);
  assert.ok(linkedExpenses.every((entry) => entry.maintenance_order_code === created.body.order_code));
  assert.deepEqual(linkedExpenses.map((entry) => entry.amount_cents).sort((a, b) => a - b), [4000, 12500]);

  const review = await request(`/api/maintenance/orders/${orderId}/status`, jsonOptions('PATCH', {}));
  assert.equal(review.response.status, 200);
  assert.equal((await request(`/api/maintenance/orders/${orderId}/custody-advance`, jsonOptions('POST', {
    amountCents: 100,
  }))).response.status, 409);

  const archived = await request(`/api/maintenance/orders/${orderId}/archive`, jsonOptions('POST', {
    warrantyPeriodMonths: 3,
    actualExpensesCents: 4000,
  }));
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.order.petty_cash_disbursed_cents, 16500);
  assert.equal(archived.body.order.petty_cash_refund_cents, 12500);
  assert.equal((await request('/api/finance/treasury')).body.cashBalanceCents, 46000);

  const auditRows = db.prepare(`
    SELECT action, old_values_json, new_values_json
    FROM audit_log WHERE entity_type = 'maintenance_order' AND entity_id = ?
    ORDER BY id
  `).all(orderId);
  const advanceAudits = auditRows.filter((row) => row.action === 'custody_advance');
  assert.equal(advanceAudits.length, 2);
  assert.deepEqual(JSON.parse(advanceAudits[1].old_values_json), { petty_cash_disbursed_cents: 12500 });
  assert.equal(JSON.parse(advanceAudits[1].new_values_json).petty_cash_disbursed_cents, 16500);
});
