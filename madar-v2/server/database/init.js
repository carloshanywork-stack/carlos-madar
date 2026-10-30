import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { schemaPath } from '../config/paths.js';
import { db } from './connection.js';

const defaultSettings = [
  ['app_name', 'MADAR V2'],
  ['locale', 'ar'],
  ['currency', 'SAR'],
  ['timezone', 'Asia/Riyadh'],
  ['default_warranty_period_months', '3'],
];

const optionalOffcutMaterialMigration = '20261030-secondary-offcut-material-optional';
const authenticationSessionsMigration = '20261030-authentication-sessions';
const clientMachineDeploymentMigration = '20261030-client-machine-deployments';
const warehouseLifecycleMigration = '20261030-warehouse-lifecycle';
const financeLifecycleMigration = '20261030-finance-lifecycle';

export function migrateClientMachineDeployments(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(clientMachineDeploymentMigration);
  if (applied) return;

  database.exec(`
    INSERT OR IGNORE INTO client_machines (client_id, machine_id, site_area, first_seen_at, last_seen_at)
    SELECT order_record.client_id, card.machine_id, machine.area,
      MIN(order_record.created_at), MAX(order_record.updated_at)
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.deleted_at IS NULL
    GROUP BY order_record.client_id, card.machine_id;
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(clientMachineDeploymentMigration);
}

export function migrateAuthenticationSessions(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(authenticationSessionsMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry
      ON sessions(user_id, expires_at);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(authenticationSessionsMigration);
}

export function migrateOptionalOffcutMaterial(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(optionalOffcutMaterialMigration);
  if (applied) return;

  const materialColumn = database.pragma('table_info(secondary_warehouse_offcuts)')
    .find((column) => column.name === 'material_id');
  if (materialColumn?.notnull) {
    database.exec(`
      CREATE TABLE secondary_warehouse_offcuts_rebuild (
        id INTEGER PRIMARY KEY,
        material_id INTEGER REFERENCES materials(id),
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
      INSERT INTO secondary_warehouse_offcuts_rebuild (
        id, material_id, name, dimensions, quantity, unit, unit_cost_cents,
        origin_workshop_order_id, status, notes, created_at, updated_at
      )
      SELECT
        id, material_id, name, dimensions, quantity, unit, unit_cost_cents,
        origin_workshop_order_id, status, notes, created_at, updated_at
      FROM secondary_warehouse_offcuts;
      DROP TABLE secondary_warehouse_offcuts;
      ALTER TABLE secondary_warehouse_offcuts_rebuild RENAME TO secondary_warehouse_offcuts;
      CREATE INDEX IF NOT EXISTS idx_secondary_offcuts_material_status
        ON secondary_warehouse_offcuts(material_id, status);
    `);
  }

  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(optionalOffcutMaterialMigration);
}

export function migrateWarehouseLifecycle(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(warehouseLifecycleMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE secondary_warehouse_offcuts_rebuild (
      id INTEGER PRIMARY KEY,
      material_id INTEGER REFERENCES materials(id),
      name TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
      origin_workshop_order_id INTEGER REFERENCES workshop_orders(id),
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'consumed', 'scrapped_sold', 'variance_lost')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO secondary_warehouse_offcuts_rebuild (
      id, material_id, name, dimensions, quantity, unit, unit_cost_cents,
      origin_workshop_order_id, status, notes, created_at, updated_at
    )
    SELECT
      id, material_id, name, dimensions, quantity, unit, unit_cost_cents,
      origin_workshop_order_id, status, notes, created_at, updated_at
    FROM secondary_warehouse_offcuts;
    DROP TABLE secondary_warehouse_offcuts;
    ALTER TABLE secondary_warehouse_offcuts_rebuild RENAME TO secondary_warehouse_offcuts;

    CREATE TABLE inventory_movements_rebuild (
      id INTEGER PRIMARY KEY,
      material_id INTEGER REFERENCES materials(id),
      offcut_id INTEGER REFERENCES secondary_warehouse_offcuts(id),
      kind TEXT NOT NULL CHECK (kind IN ('purchase', 'issue', 'scrap_sale', 'variance_gain', 'variance_loss')),
      quantity REAL NOT NULL CHECK (quantity > 0),
      warehouse TEXT NOT NULL CHECK (warehouse IN ('main', 'secondary')),
      reference TEXT,
      source_type TEXT CHECK (source_type IN ('workshop_order', 'maintenance_custody', 'manual', 'stock_count')),
      source_id INTEGER,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (material_id IS NOT NULL OR offcut_id IS NOT NULL)
    );
    INSERT INTO inventory_movements_rebuild (
      id, material_id, offcut_id, kind, quantity, warehouse, reference,
      source_type, source_id, notes, created_by, created_at
    )
    SELECT
      id, material_id, NULL, kind, quantity, warehouse, reference,
      source_type, source_id, notes, created_by, created_at
    FROM inventory_movements;
    DROP TABLE inventory_movements;
    ALTER TABLE inventory_movements_rebuild RENAME TO inventory_movements;

    CREATE INDEX idx_secondary_offcuts_material_status
      ON secondary_warehouse_offcuts(material_id, status);
    CREATE INDEX idx_inventory_movements_material_created
      ON inventory_movements(material_id, created_at);
    CREATE INDEX idx_inventory_movements_offcut_created
      ON inventory_movements(offcut_id, created_at);
    CREATE INDEX idx_inventory_movements_source
      ON inventory_movements(source_type, source_id, created_at);
  `);

  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(warehouseLifecycleMigration);
}

export function migrateFinanceLifecycle(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(financeLifecycleMigration);
  if (applied) return;

  const treasuryColumns = new Set(database.pragma('table_info(treasury_entries)').map((column) => column.name));
  if (!treasuryColumns.has('maintenance_order_id')) {
    database.exec(`
      ALTER TABLE treasury_entries
      ADD COLUMN maintenance_order_id INTEGER REFERENCES maintenance_orders(id)
    `);
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_invoices_workshop_order
      ON invoices(workshop_order_id, kind);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
      ON invoice_items(invoice_id, line_number);
    CREATE INDEX IF NOT EXISTS idx_treasury_entries_invoice
      ON treasury_entries(invoice_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_treasury_entries_maintenance_order
      ON treasury_entries(maintenance_order_id, created_at);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(financeLifecycleMigration);
}

export function initializeDatabase({ database = db, initialAdminPassword = env.initialAdminPassword } = {}) {
  const schema = readFileSync(schemaPath, 'utf8');
  let adminCreated = false;

  const initialize = database.transaction(() => {
    database.exec(schema);
    migrateAuthenticationSessions(database);
    migrateOptionalOffcutMaterial(database);
    migrateClientMachineDeployments(database);
    migrateWarehouseLifecycle(database);
    migrateFinanceLifecycle(database);

    const hasUsers = database.prepare('SELECT 1 FROM users LIMIT 1').get();

    // Keep explicit unattended bootstrap available, but leave a fresh install empty by default
    // so the first administrator is created through the one-time setup screen.
    if (!hasUsers && initialAdminPassword) {
      if (initialAdminPassword.length < 12) {
        throw new Error('MADAR_INITIAL_ADMIN_PASSWORD must contain at least 12 characters.');
      }
      database.prepare(`
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES (?, ?, ?, ?)
      `).run('admin', bcrypt.hashSync(initialAdminPassword, 12), 'System Administrator', 'admin');
      adminCreated = true;
    }

    const insertSetting = database.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `);
    for (const setting of defaultSettings) insertSetting.run(...setting);
  });

  initialize();
  const setupRequired = database
    .prepare('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL')
    .get().count === 0;
  return { adminCreated, setupRequired };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = initializeDatabase();
    console.log(`MADAR V2 database initialized at ${db.name}.`);
    if (result.adminCreated) {
      console.log('Initial administrator username: admin');
      console.log('Initial administrator password was read from MADAR_INITIAL_ADMIN_PASSWORD.');
    } else if (result.setupRequired) {
      console.log('No account was created. Create the root administrator in the first-run setup screen.');
    } else {
      console.log('Existing user accounts and credentials were left unchanged.');
    }
  } catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
