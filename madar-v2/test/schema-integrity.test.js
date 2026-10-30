import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-schema-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'schema.sqlite');
process.env.NODE_ENV = 'test';

const [{ db }, { schemaPath }] = await Promise.all([
  import('../server/database/connection.js'),
  import('../server/config/paths.js'),
]);
const schema = readFileSync(schemaPath, 'utf8');
db.exec(schema);
let seedSequence = 0;

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function seedBaseRecords() {
  seedSequence += 1;
  const userId = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES (?, 'hash', 'Test Administrator', 'admin')
  `).run(`test-admin-${seedSequence}`).lastInsertRowid;
  const clientId = db.prepare(`
    INSERT INTO clients (code, name) VALUES (?, 'Test Client')
  `).run(`CLIENT-${seedSequence}`).lastInsertRowid;
  const employeeId = db.prepare(`
    INSERT INTO employees (name, department) VALUES ('Technician', 'Maintenance')
  `).run().lastInsertRowid;
  const machineId = db.prepare(`
    INSERT INTO machines (code, name_ar, area) VALUES (?, 'آلة اختبار', 'Test area')
  `).run(`MACHINE-${seedSequence}`).lastInsertRowid;
  return { userId, clientId, employeeId, machineId };
}

test('clean schema contains every V2 domain table', () => {
  const actualTables = new Set(db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row) => row.name));
  const requiredTables = [
    'users',
    'sessions',
    'employees',
    'clients',
    'machines',
    'client_machines',
    'maintenance_orders',
    'maintenance_order_technicians',
    'maintenance_cards',
    'workshop_orders',
    'workshop_order_technicians',
    'workshop_design_files',
    'materials',
    'secondary_warehouse_offcuts',
    'inventory_movements',
    'stock_count_sessions',
    'stock_count_lines',
    'invoices',
    'invoice_items',
    'treasury_entries',
    'settings',
  ];
  for (const table of requiredTables) assert.equal(actualTables.has(table), true, `missing table ${table}`);
  assert.equal(
    db.pragma('foreign_key_list(inventory_movements)').some((key) => key.table === 'secondary_warehouse_offcuts'),
    true,
  );
  assert.equal(
    db.pragma('foreign_key_list(treasury_entries)').some((key) => key.table === 'maintenance_orders'),
    true,
  );
});

test('foreign keys reject maintenance orders for unknown clients', () => {
  const { userId } = seedBaseRecords();
  assert.throws(() => db.prepare(`
    INSERT INTO maintenance_orders (order_code, client_id, created_by)
    VALUES ('M-INVALID', 987654321, ?)
  `).run(userId), /FOREIGN KEY constraint failed/);
});

test('maintenance stays free of workshop pricing and cost columns', () => {
  const maintenanceColumns = new Set(
    db.pragma('table_info(maintenance_orders)').map((column) => column.name),
  );
  for (const forbidden of ['material_cost', 'selling_price', 'sale_price_cents', 'product_name']) {
    assert.equal(maintenanceColumns.has(forbidden), false, `${forbidden} must not be in maintenance_orders`);
  }

  const { clientId, userId } = seedBaseRecords();
  const insertOrder = db.prepare(`
    INSERT INTO workshop_orders
      (order_code, client_id, product_name, machine_type, sale_price_cents, created_by)
    VALUES (?, ?, 'Workshop product', ?, ?, ?)
  `);
  for (const [index, machineType] of ['cnc_router', 'laser', 'both', 'manual'].entries()) {
    insertOrder.run(`W-${index + 1}`, clientId, machineType, 12500 + index, userId);
  }
  assert.deepEqual(
    db.prepare('SELECT machine_type, sale_price_cents FROM workshop_orders ORDER BY id').all(),
    [
      { machine_type: 'cnc_router', sale_price_cents: 12500 },
      { machine_type: 'laser', sale_price_cents: 12501 },
      { machine_type: 'both', sale_price_cents: 12502 },
      { machine_type: 'manual', sale_price_cents: 12503 },
    ],
  );
});

test('deleting a maintenance order cascades to cards and technician assignments', () => {
  const { clientId, employeeId, machineId, userId } = seedBaseRecords();
  const orderId = db.prepare(`
    INSERT INTO maintenance_orders (order_code, client_id, created_by)
    VALUES ('M-CASCADE', ?, ?)
  `).run(clientId, userId).lastInsertRowid;
  db.prepare(`
    INSERT INTO maintenance_order_technicians (order_id, employee_id) VALUES (?, ?)
  `).run(orderId, employeeId);
  db.prepare(`
    INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)
  `).run(orderId, machineId);

  db.prepare('DELETE FROM maintenance_orders WHERE id = ?').run(orderId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_cards WHERE order_id = ?').get(orderId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM maintenance_order_technicians WHERE order_id = ?').get(orderId).count, 0);
});

test('schema connection uses WAL journal mode', () => {
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
});
