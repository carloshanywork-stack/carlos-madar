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
const v2FeatureParityMigration = '20261031-v2-feature-parity-hr-maintenance';
const maintenanceTripFolderMigration = '20261031-maintenance-trip-folder-engine';
const maintenanceOrderDeletionMigration = '20261031-maintenance-order-soft-delete-recovery';
const maintenanceCardDeletionMigration = '20261031-maintenance-card-soft-delete-recovery';
const maintenanceMachineDecommissionMigration = '20261031-maintenance-machine-decommission-recovery';

export function migrateMaintenanceOrderDeletion(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(maintenanceOrderDeletionMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_order_deletion_operations (
      operation_id TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES maintenance_orders(id),
      client_code TEXT NOT NULL,
      order_code TEXT NOT NULL,
      original_path TEXT NOT NULL,
      staged_path TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'committed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_order_deletion_operations_state
      ON maintenance_order_deletion_operations(state, created_at, operation_id);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(maintenanceOrderDeletionMigration);
}

export function migrateMaintenanceCardDeletion(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(maintenanceCardDeletionMigration);
  if (applied) return;

  const columns = new Set(database.pragma('table_info(maintenance_cards)').map((column) => column.name));
  if (!columns.has('deleted_at')) {
    database.exec('ALTER TABLE maintenance_cards ADD COLUMN deleted_at TEXT');
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_maintenance_cards_order_deleted
      ON maintenance_cards(order_id, deleted_at, id);
    CREATE TABLE IF NOT EXISTS maintenance_card_deletion_operations (
      operation_id TEXT PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES maintenance_cards(id),
      order_id INTEGER NOT NULL REFERENCES maintenance_orders(id),
      targets_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'committed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_card_deletion_operations_state
      ON maintenance_card_deletion_operations(state, created_at, operation_id);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(maintenanceCardDeletionMigration);
}

export function migrateMaintenanceMachineDecommission(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(maintenanceMachineDecommissionMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_machine_decommission_operations (
      operation_id TEXT PRIMARY KEY,
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      order_id INTEGER NOT NULL REFERENCES maintenance_orders(id),
      targets_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'committed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_machine_decommission_operations_state
      ON maintenance_machine_decommission_operations(state, created_at, operation_id);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(maintenanceMachineDecommissionMigration);
}

export function migrateMaintenanceTripFolders(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(maintenanceTripFolderMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_unmatched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES maintenance_orders(id),
      folder_name TEXT NOT NULL,
      source_name TEXT,
      before_photos_json TEXT NOT NULL DEFAULT '[]',
      after_photos_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'bound')),
      bound_machine_id INTEGER REFERENCES machines(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      bound_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_unmatched_order_status
      ON maintenance_unmatched_folders(order_id, status, id);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(maintenanceTripFolderMigration);
}

export function migrateV2FeatureParity(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(v2FeatureParityMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_reasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS employee_daily_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      work_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'leave')),
      overtime_hours REAL NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (employee_id, work_date)
    );
    CREATE INDEX IF NOT EXISTS idx_employee_attendance_date
      ON employee_daily_attendance(work_date, employee_id);
    CREATE TABLE IF NOT EXISTS employee_tool_custody (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      tool_name TEXT NOT NULL,
      serial_number TEXT,
      issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      returned_at TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_employee_tools_employee_returned
      ON employee_tool_custody(employee_id, returned_at, issued_at);
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_year TEXT NOT NULL UNIQUE,
      total_base_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_base_cents >= 0),
      total_overtime_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_overtime_cents >= 0),
      total_deductions_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_deductions_cents >= 0),
      net_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (net_total_cents >= 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
      finalized_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payroll_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      base_salary_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_salary_cents >= 0),
      present_days INTEGER NOT NULL DEFAULT 0 CHECK (present_days >= 0),
      absent_days INTEGER NOT NULL DEFAULT 0 CHECK (absent_days >= 0),
      overtime_hours REAL NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
      overtime_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (overtime_amount_cents >= 0),
      deductions_cents INTEGER NOT NULL DEFAULT 0 CHECK (deductions_cents >= 0),
      net_salary_cents INTEGER NOT NULL DEFAULT 0 CHECK (net_salary_cents >= 0),
      notes TEXT,
      UNIQUE (run_id, employee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_lines_employee_run
      ON payroll_lines(employee_id, run_id);
  `);

  const addColumnIfMissing = (table, column, declaration) => {
    const columns = new Set(database.pragma(`table_info(${table})`).map((item) => item.name));
    if (!columns.has(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  };
  addColumnIfMissing('maintenance_orders', 'area', 'TEXT');
  addColumnIfMissing('maintenance_cards', 'reason_id', 'INTEGER REFERENCES maintenance_reasons(id)');
  addColumnIfMissing('employees', 'daily_rate_cents', 'INTEGER NOT NULL DEFAULT 0 CHECK (daily_rate_cents >= 0)');
  addColumnIfMissing('employees', 'hire_date', 'TEXT');
  addColumnIfMissing('employees', 'department_label', "TEXT CHECK (department_label IS NULL OR department_label IN ('Management', 'Sales'))");

  const hasReasons = database.prepare('SELECT 1 FROM maintenance_reasons LIMIT 1').get();
  if (!hasReasons) {
    const insertReason = database.prepare('INSERT INTO maintenance_reasons (name) VALUES (?)');
    for (const name of [
      'صيانة دورية وقائية',
      'استبدال شاشة أو لوحة أكريليك',
      'إصلاح إضاءة الليد والإنارة',
      'صيانة الكاميرات وأجهزة المراقبة',
      'إصلاح أقفال ومفصلات الصراف',
      'أعمال نظافة وتلميع خارجي',
    ]) insertReason.run(name);
  }
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(v2FeatureParityMigration);
}

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
    migrateV2FeatureParity(database);
    migrateMaintenanceTripFolders(database);
    migrateMaintenanceOrderDeletion(database);
    migrateMaintenanceCardDeletion(database);
    migrateMaintenanceMachineDecommission(database);

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
