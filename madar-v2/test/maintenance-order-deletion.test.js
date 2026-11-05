import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yauzl from 'yauzl';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-order-delete-'));
const storageRoot = join(temporaryDirectory, 'storage');
const backupRoot = join(temporaryDirectory, 'Backups');
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'data', 'test.sqlite');
process.env.MADAR_V2_DATA_DIR = join(temporaryDirectory, 'data');
process.env.MADAR_V2_STORAGE_ROOT = storageRoot;
process.env.MADAR_V2_BACKUP_ROOT = backupRoot;
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }, { recoverMaintenanceOrderDeletions }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/maintenance/service.js'),
]);

const adminPassword = 'order-delete-admin-password';
initializeDatabase({ initialAdminPassword: adminPassword });
await recoverMaintenanceOrderDeletions(db);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: adminPassword }),
});
assert.equal(adminLogin.status, 200);
const adminCookie = (adminLogin.headers.getSetCookie?.()[0] ?? adminLogin.headers.get('set-cookie'))?.split(';', 1)[0];
assert.ok(adminCookie);
let cookie = adminCookie;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), cookie },
  });
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, body };
}

function zipEntryNames(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) return reject(openError);
      const names = [];
      zipfile.once('error', reject);
      zipfile.once('end', () => resolve(names));
      zipfile.on('entry', (entry) => {
        names.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.readEntry();
    });
  });
}

test('Admin archive removal soft-deletes, audits, safely stages photos, and recovers interrupted operations', async () => {
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run('C-DELETE-1', 'Delete Test Client').lastInsertRowid);
  const machineId = Number(db.prepare('INSERT INTO machines (code, name_ar, area) VALUES (?, ?, ?)').run('DELETE-01', 'ماكينة الحذف', 'Delete Area').lastInsertRowid);
  const createOrder = (orderCode, status = 'archived') => {
    const id = Number(db.prepare(`
      INSERT INTO maintenance_orders (order_code, client_id, status, archived_at)
      VALUES (?, ?, ?, CASE WHEN ? = 'archived' THEN CURRENT_TIMESTAMP ELSE NULL END)
    `).run(orderCode, clientId, status, status).lastInsertRowid);
    const cardId = Number(db.prepare('INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)').run(id, machineId).lastInsertRowid);
    const photoDirectory = join(storageRoot, 'Clients', 'C-DELETE-1', 'Archived_Orders', orderCode);
    mkdirSync(photoDirectory, { recursive: true });
    writeFileSync(join(photoDirectory, 'archive-photo.jpg'), Buffer.from('synthetic archived photo'));
    return { id, cardId, orderCode, photoDirectory };
  };

  const order = createOrder('MN-DELETE-1');
  const operationsUserId = Number(db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES (?, ?, ?, 'operations')
  `).run('order-delete-operator', bcrypt.hashSync('order-delete-operator-password', 10), 'Operations User').lastInsertRowid);
  assert.ok(operationsUserId);

  const operationsLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'order-delete-operator', password: 'order-delete-operator-password' }),
  });
  assert.equal(operationsLogin.status, 200);
  cookie = (operationsLogin.headers.getSetCookie?.()[0] ?? operationsLogin.headers.get('set-cookie'))?.split(';', 1)[0];
  assert.ok(cookie);

  const forbidden = await request(`/api/maintenance/orders/${order.id}`, { method: 'DELETE' });
  assert.equal(forbidden.response.status, 403);
  assert.equal(existsSync(order.photoDirectory), true);
  assert.equal(db.prepare('SELECT deleted_at FROM maintenance_orders WHERE id = ?').get(order.id).deleted_at, null);

  cookie = adminCookie;
  const abortTrigger = 'test_abort_maintenance_archive_removal';
  db.exec(`CREATE TRIGGER ${abortTrigger} BEFORE UPDATE OF deleted_at ON maintenance_orders
    WHEN OLD.id = ${order.id} AND NEW.deleted_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'forced isolated deletion rollback'); END`);
  let failedRemoval;
  try {
    failedRemoval = await request(`/api/maintenance/orders/${order.id}`, { method: 'DELETE' });
  } finally {
    db.exec(`DROP TRIGGER IF EXISTS ${abortTrigger}`);
  }
  assert.equal(failedRemoval.response.status, 500);
  assert.equal(existsSync(order.photoDirectory), true, 'a database failure restores the staged archive folder');
  assert.equal(db.prepare('SELECT deleted_at FROM maintenance_orders WHERE id = ?').get(order.id).deleted_at, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_order_deletion_operations').get().count, 0);

  const removed = await request(`/api/maintenance/orders/${order.id}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(removed.body, { ok: true, deletedOrderCode: order.orderCode });
  assert.equal(existsSync(order.photoDirectory), false);
  assert.ok(db.prepare('SELECT deleted_at FROM maintenance_orders WHERE id = ?').get(order.id).deleted_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_cards WHERE order_id = ?').get(order.id).count, 1,
    'soft deletion retains the historical maintenance card');
  assert.deepEqual(db.prepare(`
    SELECT actor_id, action, entity_type, entity_id
    FROM audit_log WHERE action = 'delete_maintenance_order' AND entity_id = ?
  `).get(order.id), {
    actor_id: Number(db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id),
    action: 'delete_maintenance_order',
    entity_type: 'maintenance_order',
    entity_id: order.id,
  });
  assert.equal((await request('/api/maintenance/orders?status=archived')).body.some((item) => item.id === order.id), false);
  assert.equal((await request(`/api/maintenance/orders/${order.id}`)).response.status, 404);

  const backup = await request('/api/system/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(backup.response.status, 201, JSON.stringify(backup.body));
  const backupFile = await request(`/api/system/backups/${encodeURIComponent(backup.body.filename)}/download`);
  assert.equal(backupFile.response.status, 200);
  const backupEntries = await zipEntryNames(backupFile.body);
  assert.equal(backupEntries.some((name) => name.startsWith('storage/.madar-recovery/')), false,
    'maintenance deletion staging is excluded from local backups');

  const interruptedRestore = createOrder('MN-RECOVERY-PREPARED');
  const preparedId = 'a1111111-1111-4111-8111-111111111111';
  const preparedStageDirectory = join(storageRoot, '.madar-recovery', 'maintenance-order-deletions', preparedId);
  mkdirSync(preparedStageDirectory, { recursive: true });
  renameSync(interruptedRestore.photoDirectory, join(preparedStageDirectory, 'payload'));
  db.prepare(`
    INSERT INTO maintenance_order_deletion_operations
      (operation_id, order_id, client_code, order_code, original_path, staged_path, state)
    VALUES (?, ?, ?, ?, ?, ?, 'prepared')
  `).run(preparedId, interruptedRestore.id, 'C-DELETE-1', interruptedRestore.orderCode,
    `Clients/C-DELETE-1/Archived_Orders/${interruptedRestore.orderCode}`,
    `.madar-recovery/maintenance-order-deletions/${preparedId}/payload`);
  assert.deepEqual(await recoverMaintenanceOrderDeletions(db), { recoveredCount: 1 });
  assert.equal(existsSync(interruptedRestore.photoDirectory), true, 'startup recovery restores files for an active order');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_order_deletion_operations WHERE operation_id = ?').get(preparedId).count, 0);

  const interruptedCleanup = createOrder('MN-RECOVERY-COMMITTED');
  const committedId = 'b2222222-2222-4222-8222-222222222222';
  const committedStageDirectory = join(storageRoot, '.madar-recovery', 'maintenance-order-deletions', committedId);
  mkdirSync(committedStageDirectory, { recursive: true });
  renameSync(interruptedCleanup.photoDirectory, join(committedStageDirectory, 'payload'));
  db.prepare('UPDATE maintenance_orders SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(interruptedCleanup.id);
  db.prepare(`
    INSERT INTO maintenance_order_deletion_operations
      (operation_id, order_id, client_code, order_code, original_path, staged_path, state)
    VALUES (?, ?, ?, ?, ?, ?, 'committed')
  `).run(committedId, interruptedCleanup.id, 'C-DELETE-1', interruptedCleanup.orderCode,
    `Clients/C-DELETE-1/Archived_Orders/${interruptedCleanup.orderCode}`,
    `.madar-recovery/maintenance-order-deletions/${committedId}/payload`);
  assert.deepEqual(await recoverMaintenanceOrderDeletions(db), { recoveredCount: 1 });
  assert.equal(existsSync(interruptedCleanup.photoDirectory), false, 'startup recovery finishes cleanup for a soft-deleted order');
  assert.equal(existsSync(committedStageDirectory), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_order_deletion_operations WHERE operation_id = ?').get(committedId).count, 0);
});

test('Admin can reopen archived maintenance and rearchive without duplicating or misposting the cash refund', async () => {
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)')
    .run('C-REOPEN-1', 'Reopen Test Client').lastInsertRowid);
  const machineId = Number(db.prepare('INSERT INTO machines (code, name_ar, area) VALUES (?, ?, ?)')
    .run('REOPEN-01', 'ماكينة إعادة فتح', 'Reopen Area').lastInsertRowid);
  const adminId = Number(db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id);
  const orderId = Number(db.prepare(`
    INSERT INTO maintenance_orders (
      order_code, client_id, status, archived_at, archived_by,
      petty_cash_disbursed_cents, actual_expenses_cents, petty_cash_refund_cents, warranty_period_months
    ) VALUES (?, ?, 'archived', '2026-11-05 10:00:00', ?, 1000, 400, 600, 3)
  `).run('MN-REOPEN-1', clientId, adminId).lastInsertRowid);
  const cardId = Number(db.prepare('INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)')
    .run(orderId, machineId).lastInsertRowid);
  db.prepare(`
    INSERT INTO treasury_entries (kind, category, amount_cents, maintenance_order_id, reference, created_by)
    VALUES ('income', 'رد عهدة صيانة', 600, ?, 'MN-REOPEN-1', ?)
  `).run(orderId, adminId);

  const operationsPassword = 'order-reopen-operator-password';
  db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES (?, ?, ?, 'operations')
  `).run('order-reopen-operator', bcrypt.hashSync(operationsPassword, 10), 'Reopen Operator');
  const operationsLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'order-reopen-operator', password: operationsPassword }),
  });
  assert.equal(operationsLogin.status, 200);
  cookie = (operationsLogin.headers.getSetCookie?.()[0] ?? operationsLogin.headers.get('set-cookie'))?.split(';', 1)[0];
  assert.ok(cookie);
  const deniedArchivedEdit = await request(`/api/maintenance/orders/${orderId}/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes: 'محاولة تعديل بدون صلاحية' }),
  });
  assert.equal(deniedArchivedEdit.response.status, 403);
  const denied = await request(`/api/maintenance/orders/${orderId}/unarchive`, { method: 'POST' });
  assert.equal(denied.response.status, 403);
  assert.equal(db.prepare('SELECT status FROM maintenance_orders WHERE id = ?').get(orderId).status, 'archived');

  cookie = adminCookie;
  const reopened = await request(`/api/maintenance/orders/${orderId}/unarchive`, { method: 'POST' });
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.status, 'in_progress');
  assert.equal(reopened.body.archived_at, null);
  assert.equal(reopened.body.archived_by, null);
  assert.equal(reopened.body.petty_cash_refund_cents, 600, 'the original settlement stays on record while the order is reopened');
  assert.equal((await request(`/api/maintenance/orders/${orderId}/unarchive`, { method: 'POST' })).response.status, 409);

  const reopenedAudit = db.prepare(`
    SELECT actor_id, old_values_json, new_values_json FROM audit_log
    WHERE action = 'unarchive_order' AND entity_id = ? ORDER BY id DESC LIMIT 1
  `).get(orderId);
  assert.equal(reopenedAudit.actor_id, adminId);
  assert.equal(JSON.parse(reopenedAudit.old_values_json).status, 'archived');
  assert.equal(JSON.parse(reopenedAudit.new_values_json).status, 'in_progress');

  assert.equal((await request(`/api/maintenance/orders/${orderId}/status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}',
  })).response.status, 200);
  const archivedAgain = await request(`/api/maintenance/orders/${orderId}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actualExpensesCents: 400, warrantyPeriodMonths: 3 }),
  });
  assert.equal(archivedAgain.response.status, 200, JSON.stringify(archivedAgain.body));
  assert.equal(archivedAgain.body.refundCents, 600);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM treasury_entries WHERE maintenance_order_id = ?').get(orderId).count, 1,
    'repeating the original settlement must not duplicate the treasury refund');

  assert.equal((await request(`/api/maintenance/orders/${orderId}/unarchive`, { method: 'POST' })).response.status, 200);
  assert.equal((await request(`/api/maintenance/orders/${orderId}/status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}',
  })).response.status, 200);
  const adjustedArchive = await request(`/api/maintenance/orders/${orderId}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actualExpensesCents: 500, warrantyPeriodMonths: 6 }),
  });
  assert.equal(adjustedArchive.response.status, 200, JSON.stringify(adjustedArchive.body));
  assert.equal(adjustedArchive.body.refundCents, 500);
  assert.deepEqual(db.prepare(`
    SELECT kind, category, amount_cents FROM treasury_entries
    WHERE maintenance_order_id = ? ORDER BY id
  `).all(orderId), [
    { kind: 'income', category: 'رد عهدة صيانة', amount_cents: 600 },
    { kind: 'expense', category: 'تسوية رد عهدة صيانة بعد إعادة الفتح', amount_cents: 100 },
  ]);
  assert.equal(db.prepare(`
    SELECT COALESCE(SUM(CASE kind WHEN 'income' THEN amount_cents ELSE -amount_cents END), 0) AS balance
    FROM treasury_entries WHERE maintenance_order_id = ?
  `).get(orderId).balance, 500);
  assert.equal(db.prepare('SELECT id FROM maintenance_cards WHERE id = ? AND order_id = ?').get(cardId, orderId).id, cardId);
  cookie = adminCookie;
});
