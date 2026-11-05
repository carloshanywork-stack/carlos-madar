import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-database-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'test.sqlite');
process.env.NODE_ENV = 'test';

const { createConnection, db, transaction } = await import('../server/database/connection.js');
const { schemaPath } = await import('../server/config/paths.js');
const {
  initializeDatabase,
  migrateClientMachineDeployments,
  migrateClientProfileCrud,
  migrateFinanceAccountRoles,
  migrateOptionalOffcutMaterial,
} = await import('../server/database/init.js');

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('connection enables required SQLite pragmas', () => {
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('synchronous', { simple: true }), 1);
  assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
});

test('transaction helper commits successful work and rolls back failures', () => {
  db.exec('CREATE TABLE transaction_probe (value INTEGER NOT NULL)');

  transaction((value) => {
    db.prepare('INSERT INTO transaction_probe (value) VALUES (?)').run(value);
  }, 7);
  assert.equal(db.prepare('SELECT value FROM transaction_probe').get().value, 7);

  assert.throws(() => transaction(() => {
    db.prepare('INSERT INTO transaction_probe (value) VALUES (?)').run(9);
    throw new Error('force rollback');
  }), /force rollback/);
  assert.deepEqual(
    db.prepare('SELECT value FROM transaction_probe ORDER BY value').all().map((row) => row.value),
    [7],
  );
});

test('client profile migration adds fields without changing legacy client identity or code', () => {
  const migrationDb = createConnection(join(temporaryDirectory, 'client-profile-migration.sqlite'));
  try {
    migrationDb.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE clients (
        id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        contact_name TEXT, phone TEXT, email TEXT, address TEXT,
        primary_color TEXT, secondary_color TEXT, logo_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
      );
      INSERT INTO clients (id, code, name, address) VALUES (37, 'OLD-CLIENT-37', 'عميل سابق', 'مقر العميل');
    `);
    migrationDb.transaction(() => migrateClientProfileCrud(migrationDb)).immediate();

    assert.deepEqual(migrationDb.prepare(`
      SELECT id, code, name, name_ar, name_en, address, notes, storage_code
      FROM clients WHERE id = 37
    `).get(), {
      id: 37,
      code: 'OLD-CLIENT-37',
      name: 'عميل سابق',
      name_ar: null,
      name_en: null,
      address: 'مقر العميل',
      notes: null,
      storage_code: 'OLD-CLIENT-37',
    });
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('20261105-client-profile-crud').count, 1);
    migrationDb.prepare('INSERT INTO clients (code, name) VALUES (?, ?)')
      .run('NEW-DIRECT-CLIENT', 'Direct Insert Client');
    assert.equal(migrationDb.prepare('SELECT storage_code FROM clients WHERE code = ?')
      .get('NEW-DIRECT-CLIENT').storage_code, 'NEW-DIRECT-CLIENT');
    migrationDb.transaction(() => migrateClientProfileCrud(migrationDb)).immediate();
    assert.equal(migrationDb.prepare('SELECT COUNT(*) AS count FROM clients').get().count, 2);
  } finally {
    migrationDb.close();
  }
});

test('finance/accountant role migration preserves user IDs and foreign keys', () => {
  const legacyDb = createConnection(join(temporaryDirectory, 'finance-role-migration.sqlite'));
  try {
    legacyDb.pragma('foreign_keys = ON');
    legacyDb.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'sales', 'operations', 'purchasing', 'rep')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
        locked_until TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT,
        assigned_regions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assigned_regions_json)),
        is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1)),
        last_location_json TEXT CHECK (last_location_json IS NULL OR json_valid(last_location_json))
      );
      CREATE TABLE dependent_rows (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL
      );
      INSERT INTO users (id, username, password_hash, full_name, role) VALUES
        (41, 'legacy-admin', 'hash-admin', 'Legacy Admin', 'admin'),
        (42, 'legacy-rep', 'hash-rep', 'Legacy Rep', 'rep');
      INSERT INTO dependent_rows (id, user_id, label) VALUES (71, 42, 'rep assignments');
    `);

    migrateFinanceAccountRoles(legacyDb);

    assert.deepEqual(legacyDb.prepare('SELECT id, username, role FROM users ORDER BY id').all(), [
      { id: 41, username: 'legacy-admin', role: 'admin' },
      { id: 42, username: 'legacy-rep', role: 'rep' },
    ]);
    assert.equal(legacyDb.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get().sql.includes("'finance'"), true);
    assert.equal(legacyDb.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get().sql.includes("'accountant'"), true);
    assert.deepEqual(legacyDb.pragma('foreign_key_check'), []);
    assert.equal(legacyDb.prepare('SELECT COUNT(*) AS count FROM dependent_rows WHERE user_id = 42').get().count, 1);
    assert.equal(legacyDb.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(legacyDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('20261105-finance-account-roles').count, 1);
    migrateFinanceAccountRoles(legacyDb);
    assert.equal(legacyDb.prepare('SELECT COUNT(*) AS count FROM dependent_rows').get().count, 1);
  } finally {
    legacyDb.close();
  }
});

test('initializer can seed a bcrypt-hashed admin with an explicit password and remains idempotent', () => {
  const first = initializeDatabase({ initialAdminPassword: 'V2-test-password-2026!' });
  assert.equal(first.adminCreated, true);

  const admin = db.prepare("SELECT username, password_hash, role FROM users WHERE username = 'admin'").get();
  assert.equal(admin.username, 'admin');
  assert.equal(admin.role, 'admin');
  assert.notEqual(admin.password_hash, 'V2-test-password-2026!');
  assert.equal(bcrypt.compareSync('V2-test-password-2026!', admin.password_hash), true);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'currency'").get().value, 'SAR');

  const second = initializeDatabase({ initialAdminPassword: 'A-different-password-2026!' });
  assert.equal(second.adminCreated, false);
  assert.equal(
    db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get().password_hash,
    admin.password_hash,
  );
});

test('fresh initialization leaves administrator setup to the first-run screen by default', () => {
  const cleanDatabase = createConnection(join(temporaryDirectory, 'first-run.sqlite'));
  try {
    const result = initializeDatabase({ database: cleanDatabase, initialAdminPassword: '' });
    assert.equal(result.adminCreated, false);
    assert.equal(cleanDatabase.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  assert.equal(cleanDatabase.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    assert.equal(
      cleanDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
        .get('20261030-authentication-sessions').count,
      1,
    );
    assert.equal(
      cleanDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
        .get('20261031-maintenance-order-soft-delete-recovery').count,
      1,
    );
    assert.equal(cleanDatabase.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'maintenance_order_deletion_operations'
    `).get().count, 1);
    assert.equal(cleanDatabase.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'maintenance_card_deletion_operations'
    `).get().count, 1);
    assert.equal(cleanDatabase.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'maintenance_machine_decommission_operations'
    `).get().count, 1);
    assert.equal(cleanDatabase.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'maintenance_unmatched_folder_deletion_operations'
    `).get().count, 1);
    assert.ok(cleanDatabase.pragma('table_info(maintenance_cards)').some((column) => column.name === 'deleted_at'));
    assert.equal(cleanDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('20261031-maintenance-card-soft-delete-recovery').count, 1);
    assert.equal(cleanDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('20261031-maintenance-machine-decommission-recovery').count, 1);
    assert.equal(cleanDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('20261031-maintenance-unmatched-folder-purge-recovery').count, 1);
    assert.equal(cleanDatabase.prepare('SELECT COUNT(*) AS count FROM settings').get().count, 5);
  } finally {
    cleanDatabase.close();
  }
});

test('offcut nullability migration preserves existing rows and records its version', () => {
  const materialId = Number(db.prepare(`
    INSERT INTO materials (code, name, unit) VALUES ('MIGRATION-ACRYLIC', 'Acrylic', 'sheet')
  `).run().lastInsertRowid);
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE secondary_warehouse_offcuts_phase1 (
      id INTEGER PRIMARY KEY,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      name TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
      origin_workshop_order_id INTEGER REFERENCES workshop_orders(id),
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'consumed', 'scrapped_sold')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO secondary_warehouse_offcuts_phase1
      (id, material_id, name, dimensions, quantity, unit, notes)
    VALUES (72, ${materialId}, 'Saved remnant', '50x50 cm', 1, 'piece', 'must survive migration');
    DROP TABLE secondary_warehouse_offcuts;
    ALTER TABLE secondary_warehouse_offcuts_phase1 RENAME TO secondary_warehouse_offcuts;
  `);
  db.pragma('foreign_keys = ON');
  db.prepare('DELETE FROM schema_migrations WHERE version = ?').run('20261030-secondary-offcut-material-optional');

  db.transaction(() => migrateOptionalOffcutMaterial(db))();
  db.transaction(() => migrateOptionalOffcutMaterial(db))();

  const materialColumn = db.pragma('table_info(secondary_warehouse_offcuts)')
    .find((column) => column.name === 'material_id');
  assert.equal(materialColumn.notnull, 0);
  assert.deepEqual(
    db.prepare('SELECT id, material_id, name, dimensions, quantity, unit, notes FROM secondary_warehouse_offcuts').get(),
    {
      id: 72,
      material_id: materialId,
      name: 'Saved remnant',
      dimensions: '50x50 cm',
      quantity: 1,
      unit: 'piece',
      notes: 'must survive migration',
    },
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
      .get('20261030-secondary-offcut-material-optional').count,
    1,
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('client-machine deployment migration backfills service-card relationships once', () => {
  const clientId = Number(db.prepare(`
    INSERT INTO clients (code, name) VALUES ('MIGRATION-CLIENT', 'Migration Client')
  `).run().lastInsertRowid);
  const machineId = Number(db.prepare(`
    INSERT INTO machines (code, name_ar, area) VALUES ('MIGRATION-MACHINE', 'آلة ترحيل', 'Eastern region')
  `).run().lastInsertRowid);
  const orderId = Number(db.prepare(`
    INSERT INTO maintenance_orders (order_code, client_id) VALUES ('MIGRATION-MN-1', ?)
  `).run(clientId).lastInsertRowid);
  db.prepare('INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)').run(orderId, machineId);
  db.prepare('DELETE FROM schema_migrations WHERE version = ?').run('20261030-client-machine-deployments');

  db.transaction(() => migrateClientMachineDeployments(db))();
  db.transaction(() => migrateClientMachineDeployments(db))();

  assert.deepEqual(
    db.prepare(`
      SELECT client_id, machine_id, site_area, active
      FROM client_machines WHERE client_id = ? AND machine_id = ?
    `).get(clientId, machineId),
    { client_id: clientId, machine_id: machineId, site_area: 'Eastern region', active: 1 },
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM client_machines WHERE client_id = ? AND machine_id = ?')
      .get(clientId, machineId).count,
    1,
  );
});

test('warehouse lifecycle migration preserves existing movements and offcut IDs', () => {
  const legacyDatabase = createConnection(join(temporaryDirectory, 'legacy-warehouse.sqlite'));
  try {
    legacyDatabase.exec(readFileSync(schemaPath, 'utf8'));
    legacyDatabase.exec(`
      DROP TABLE inventory_movements;
      DROP TABLE secondary_warehouse_offcuts;
      DROP TABLE treasury_entries;
      CREATE TABLE secondary_warehouse_offcuts (
        id INTEGER PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        name TEXT NOT NULL,
        dimensions TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit TEXT NOT NULL,
        unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
        origin_workshop_order_id INTEGER REFERENCES workshop_orders(id),
        status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'consumed', 'scrapped_sold')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE inventory_movements (
        id INTEGER PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        kind TEXT NOT NULL CHECK (kind IN ('purchase', 'issue', 'scrap_sale', 'variance_gain', 'variance_loss')),
        quantity REAL NOT NULL CHECK (quantity > 0),
        warehouse TEXT NOT NULL CHECK (warehouse IN ('main', 'secondary')),
        reference TEXT,
        source_type TEXT CHECK (source_type IN ('workshop_order', 'maintenance_custody', 'manual', 'stock_count')),
        source_id INTEGER,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE treasury_entries (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
        category TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        invoice_id INTEGER REFERENCES invoices(id),
        employee_id INTEGER REFERENCES employees(id),
        reference TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const clientId = Number(legacyDatabase.prepare(`
      INSERT INTO clients (code, name) VALUES ('LEGACY-WH-CLIENT', 'Legacy warehouse client')
    `).run().lastInsertRowid);
    const materialId = Number(legacyDatabase.prepare(`
      INSERT INTO materials (code, name, unit, stock) VALUES ('LEGACY-WH-MAT', 'Acrylic', 'sheet', 4)
    `).run().lastInsertRowid);
    const orderId = Number(legacyDatabase.prepare(`
      INSERT INTO workshop_orders (order_code, client_id, product_name, machine_type)
      VALUES ('LEGACY-WH-ORDER', ?, 'Legacy product', 'manual')
    `).run(clientId).lastInsertRowid);
    legacyDatabase.prepare(`
      INSERT INTO secondary_warehouse_offcuts
        (id, material_id, name, dimensions, quantity, unit, origin_workshop_order_id, notes)
      VALUES (404, ?, 'Saved offcut', '40x20 cm', 1.5, 'piece', ?, 'preserve me')
    `).run(materialId, orderId);
    legacyDatabase.prepare(`
      INSERT INTO inventory_movements
        (id, material_id, kind, quantity, warehouse, reference, source_type, source_id, notes)
      VALUES (505, ?, 'issue', 2, 'main', 'LEGACY-WH-ORDER', 'workshop_order', ?, 'preserve movement')
    `).run(materialId, orderId);
    legacyDatabase.prepare(`
      INSERT INTO treasury_entries (id, kind, category, amount_cents, reference, notes)
      VALUES (606, 'income', 'Legacy receipt', 2500, 'LEGACY-REF', 'preserve treasury history')
    `).run();

    initializeDatabase({ database: legacyDatabase, initialAdminPassword: 'warehouse-migration-test-password' });
    assert.equal(legacyDatabase.pragma('table_info(inventory_movements)').some((column) => column.name === 'offcut_id'), true);
    assert.equal(
      legacyDatabase.pragma('table_info(inventory_movements)').find((column) => column.name === 'material_id').notnull,
      0,
    );
    assert.equal(
      legacyDatabase.pragma('table_info(secondary_warehouse_offcuts)').find((column) => column.name === 'material_id').notnull,
      0,
    );
    assert.equal(
      legacyDatabase.pragma('table_info(treasury_entries)').some((column) => column.name === 'maintenance_order_id'),
      true,
    );
    assert.deepEqual(
      legacyDatabase.prepare(`
        SELECT id, material_id, offcut_id, kind, quantity, warehouse, source_type, source_id, notes
        FROM inventory_movements WHERE id = 505
      `).get(),
      {
        id: 505,
        material_id: materialId,
        offcut_id: null,
        kind: 'issue',
        quantity: 2,
        warehouse: 'main',
        source_type: 'workshop_order',
        source_id: orderId,
        notes: 'preserve movement',
      },
    );
    assert.deepEqual(
      legacyDatabase.prepare(`
        SELECT id, kind, category, amount_cents, maintenance_order_id, reference, notes
        FROM treasury_entries WHERE id = 606
      `).get(),
      {
        id: 606,
        kind: 'income',
        category: 'Legacy receipt',
        amount_cents: 2500,
        maintenance_order_id: null,
        reference: 'LEGACY-REF',
        notes: 'preserve treasury history',
      },
    );
    assert.deepEqual(
      legacyDatabase.prepare(`
        SELECT id, material_id, name, dimensions, quantity, unit, origin_workshop_order_id, notes
        FROM secondary_warehouse_offcuts WHERE id = 404
      `).get(),
      {
        id: 404,
        material_id: materialId,
        name: 'Saved offcut',
        dimensions: '40x20 cm',
        quantity: 1.5,
        unit: 'piece',
        origin_workshop_order_id: orderId,
        notes: 'preserve me',
      },
    );
    const unclassifiedMovement = legacyDatabase.prepare(`
      INSERT INTO inventory_movements (material_id, offcut_id, kind, quantity, warehouse, source_type)
      VALUES (NULL, 404, 'issue', 0.5, 'secondary', 'workshop_order')
    `).run();
    assert.ok(Number(unclassifiedMovement.lastInsertRowid) > 505);
    initializeDatabase({ database: legacyDatabase, initialAdminPassword: 'warehouse-migration-test-password' });
    assert.equal(legacyDatabase.prepare('SELECT COUNT(*) AS count FROM inventory_movements').get().count, 2);
    assert.deepEqual(legacyDatabase.pragma('foreign_key_check'), []);
    assert.equal(
      legacyDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
        .get('20261030-warehouse-lifecycle').count,
      1,
    );
    assert.equal(
      legacyDatabase.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?')
        .get('20261030-finance-lifecycle').count,
      1,
    );
    assert.equal(
      legacyDatabase.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'secondary_warehouse_offcuts'")
        .get().sql.includes("'variance_lost'"),
      true,
    );
  } finally {
    legacyDatabase.close();
  }
});
