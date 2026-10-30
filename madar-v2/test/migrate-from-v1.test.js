import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { migrateFromV1 } from '../scripts/migrate-from-v1.js';
import { schemaPath } from '../server/config/paths.js';

function createSourceDatabase({ unsupportedOrderStatus = false } = {}) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL,
      created_at TEXT NOT NULL, deleted_at TEXT, employee_id INTEGER
    );
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, department TEXT NOT NULL,
      job_title TEXT, phone TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL,
      deleted_at TEXT, monthly_salary_cents INTEGER, base_salary REAL, can_login INTEGER
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      contact_name TEXT, phone TEXT, email TEXT, address TEXT,
      primary_color TEXT, secondary_color TEXT, logo_path TEXT,
      created_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE machines (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL,
      name_en TEXT, area TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL,
      type TEXT NOT NULL, status TEXT NOT NULL, notes TEXT, created_by INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
      deleted_at TEXT, petty_cash_amount_cents INTEGER, actual_expenses_cents INTEGER,
      petty_cash_settled INTEGER, warranty_period_months INTEGER
    );
    CREATE TABLE order_employee_assignments (
      order_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, assigned_at TEXT,
      PRIMARY KEY (order_id, employee_id)
    );
    CREATE TABLE order_machines (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, machine_id INTEGER NOT NULL,
      before_photos TEXT NOT NULL DEFAULT '[]', after_photos TEXT NOT NULL DEFAULT '[]',
      note TEXT, excluded_at TEXT
    );
    CREATE TABLE materials (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL,
      unit TEXT NOT NULL, stock REAL NOT NULL DEFAULT 0, unit_cost REAL,
      min_stock REAL NOT NULL DEFAULT 0, specification TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      deleted_at TEXT, sub_stock REAL NOT NULL DEFAULT 0
    );
  `);

  database.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, deleted_at, employee_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(1, 'admin', 'v1-admin-hash', 'V1 Admin', 'admin', 1, '2026-10-01 00:00:00', null, null);
  database.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, deleted_at, employee_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(2, 'retired-user', 'retired-hash', 'Retired User', 'operations', 0, '2026-10-02 00:00:00', '2026-10-03 00:00:00', 1);
  database.prepare(`
    INSERT INTO employees (id, name, department, job_title, phone, active, created_at, deleted_at, monthly_salary_cents, base_salary, can_login)
    VALUES (1, 'Technician One', 'Maintenance', 'Field Technician', '5550100', 1, '2026-10-01 00:00:00', NULL, 12345, 123.45, 0)
  `).run();
  database.prepare(`
    INSERT INTO clients (id, code, name, contact_name, phone, email, address, primary_color, secondary_color, logo_path, created_at, deleted_at)
    VALUES (1, 'CLIENT-1', 'Client One', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-10-01 00:00:00', NULL)
  `).run();
  database.prepare(`
    INSERT INTO machines (id, code, name_ar, name_en, area, active, created_at, deleted_at)
    VALUES (1, 'MACHINE-1', 'آلة اختبار', 'Test machine', 'North', 1, '2026-10-01 00:00:00', NULL)
  `).run();
  database.prepare(`
    INSERT INTO machines (id, code, name_ar, name_en, area, active, created_at, deleted_at)
    VALUES (2, 'MACHINE-2', 'آلة مؤرشفة', 'Retired machine', 'North', 0, '2026-10-01 00:00:00', '2026-10-02 00:00:00')
  `).run();

  const orderStatus = unsupportedOrderStatus ? 'legacy-state' : 'archived';
  database.prepare(`
    INSERT INTO orders (
      id, code, client_id, type, status, notes, created_by, created_at, updated_at,
      archived_at, deleted_at, petty_cash_amount_cents, actual_expenses_cents,
      petty_cash_settled, warranty_period_months
    ) VALUES (1, 'MN-1001', 1, 'maintenance', ?, 'Archived history', 1,
      '2026-10-01 00:00:00', '2026-10-02 00:00:00', '2026-10-02 00:00:00',
      '2026-10-03 00:00:00', 10000, 7000, 1, NULL)
  `).run(orderStatus);
  database.prepare(`
    INSERT INTO orders (id, code, client_id, type, status, created_by, created_at, updated_at)
    VALUES (2, 'OP-1001', 1, 'operation', 'archived', 1, '2026-10-01 00:00:00', '2026-10-02 00:00:00')
  `).run();
  database.prepare(`
    INSERT INTO order_employee_assignments (order_id, employee_id, assigned_at) VALUES (1, 1, '2026-10-01 00:00:00')
  `).run();
  database.prepare(`
    INSERT INTO order_employee_assignments (order_id, employee_id, assigned_at) VALUES (2, 1, '2026-10-01 00:00:00')
  `).run();
  database.prepare(`
    INSERT INTO order_machines (id, order_id, machine_id, before_photos, after_photos, note)
    VALUES (1, 1, 1, ?, ?, 'Inspection note')
  `).run(JSON.stringify(['Clients/Client One/Maintenance/MN-1001/MACHINE-1/Before/before.jpg']), '[]');
  database.prepare(`
    INSERT INTO order_machines (id, order_id, machine_id, before_photos, after_photos)
    VALUES (2, 2, 1, '[]', '[]')
  `).run();
  database.prepare(`
    INSERT INTO materials (id, code, name, unit, stock, unit_cost, min_stock, specification, active, created_at, sub_stock)
    VALUES (1, 'MAT-1', 'Acrylic sheet', 'sheet', 4, 12.34, 1, '3mm', 1, '2026-10-01 00:00:00', 0)
  `).run();

  return database;
}

function createTargetDatabase() {
  const database = new Database(':memory:');
  database.exec(readFileSync(schemaPath, 'utf8'));
  database.pragma('foreign_keys = ON');
  database.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role)
    VALUES (1, 'admin', 'v2-bootstrap-hash', 'System Administrator', 'admin')
  `).run();
  return database;
}

test('V1 migration preserves identities, soft deletes, assignments, cards, and legacy photo references', () => {
  const sourceDb = createSourceDatabase();
  const targetDb = createTargetDatabase();
  try {
    const stats = migrateFromV1({ sourceDb, targetDb });

    assert.equal(stats.users.total, 2);
    assert.equal(stats.users.inserted, 1);
    assert.equal(stats.users.matched, 1);
    assert.equal(stats.employees.total, 1);
    assert.equal(stats.clients.total, 1);
    assert.equal(stats.machines.total, 2);
    assert.equal(stats.maintenanceOrders.total, 1);
    assert.equal(stats.maintenanceTechnicians.total, 1);
    assert.equal(stats.maintenanceCards.total, 1);
    assert.deepEqual(stats.photoReferences, { before: 1, after: 0, total: 1 });
    assert.equal(stats.softDeleted.machines, 1);
    assert.equal(stats.softDeleted.maintenanceOrders, 1);

    assert.equal(targetDb.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash, 'v2-bootstrap-hash');
    assert.equal(targetDb.prepare('SELECT deleted_at FROM users WHERE id = 2').get().deleted_at, '2026-10-03 00:00:00');
    assert.equal(targetDb.prepare('SELECT user_id FROM employees WHERE id = 1').get().user_id, 2);
    assert.equal(targetDb.prepare('SELECT deleted_at FROM machines WHERE id = 2').get().deleted_at, '2026-10-02 00:00:00');
    assert.equal(targetDb.prepare('SELECT deleted_at FROM maintenance_orders WHERE id = 1').get().deleted_at, '2026-10-03 00:00:00');
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM maintenance_order_technicians').get().count, 1);
    assert.deepEqual(
      targetDb.prepare('SELECT before_photos_json, status, notes FROM maintenance_cards WHERE id = 1').get(),
      {
        before_photos_json: JSON.stringify(['Clients/Client One/Maintenance/MN-1001/MACHINE-1/Before/before.jpg']),
        status: 'completed',
        notes: 'Inspection note',
      },
    );
    assert.equal(targetDb.prepare('SELECT petty_cash_refund_cents FROM maintenance_orders WHERE id = 1').get().petty_cash_refund_cents, 3000);
    assert.equal(targetDb.prepare('SELECT unit_cost_cents FROM materials WHERE id = 1').get().unit_cost_cents, 1234);
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('migrate-from-v1-data-v1').count, 1);
    assert.deepEqual(targetDb.pragma('foreign_key_check'), []);

    const rerun = migrateFromV1({ sourceDb, targetDb });
    assert.equal(rerun.alreadyApplied, true);
    assert.deepEqual(rerun.users, { total: 2, inserted: 0, matched: 2 });
    assert.deepEqual(rerun.maintenanceCards, { total: 1, inserted: 0, matched: 1 });
    assert.equal(rerun.photoReferences.total, 1);
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM maintenance_cards').get().count, 1);
    assert.equal(targetDb.prepare('SELECT password_hash FROM users WHERE id = 1').get().password_hash, 'v2-bootstrap-hash');
  } finally {
    sourceDb.close();
    targetDb.close();
  }
});

test('V1 migration rolls back the complete target transaction when source rows cannot map safely', () => {
  const sourceDb = createSourceDatabase({ unsupportedOrderStatus: true });
  const targetDb = createTargetDatabase();
  try {
    assert.throws(() => migrateFromV1({ sourceDb, targetDb }), /unsupported status/);
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM employees').get().count, 0);
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM clients').get().count, 0);
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM machines').get().count, 0);
    assert.equal(targetDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('migrate-from-v1-data-v1').count, 0);
  } finally {
    sourceDb.close();
    targetDb.close();
  }
});
