import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { schemaPath } from '../config/paths.js';
import { db } from './connection.js';
import { syncEmployeeForUser } from '../modules/employees/user-sync.js';

const defaultSettings = [
  ['app_name', 'MADAR V2'],
  ['locale', 'ar'],
  ['currency', 'SAR'],
  ['timezone', 'Africa/Cairo'],
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
const maintenanceUnmatchedFolderDeletionMigration = '20261031-maintenance-unmatched-folder-purge-recovery';
const maintenanceCardMultiReasonMigration = '20261031-maintenance-card-multi-reasons';
const maintenanceUnmatchedFolderDuplicateMigration = '20261101-maintenance-unmatched-folder-duplicate-flags';
const repUserProfileMigration = '20261102-rep-user-profile';
const repVisitIngestionMigration = '20261102-rep-offline-visit-ingestion';
const repSupervisorRadarMigration = '20261102-rep-supervisor-radar-qa';
const repVisitConditionMigration = '20261103-rep-visit-machine-condition';
const maintenanceOrderRepsMigration = '20261103-maintenance-order-representatives';
const repVisitPhotosMigration = '20261103-rep-visit-photo-collections';
const nativeAttendanceMigration = '20261103-native-attendance-clock-fields';
const userEmployeeSyncMigration = '20261103-user-employee-links';
const userEmployeeProfileSyncMigration = '20261103-user-employee-profile-reconciliation';
const machineGeofenceBreadcrumbsMigration = '20261103-machine-geofence-route-stops';
const accountLoginProtectionMigration = '20261103-account-login-protection';
const cairoTimezoneMigration = '20261103-africa-cairo-timezone';
const gpsRetentionIndexMigration = '20261103-gps-retention-index';

const repUsersTableSql = `
  CREATE TABLE users_rep_migration_v1 (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'sales', 'operations', 'purchasing', 'rep')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT,
    assigned_regions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assigned_regions_json)),
    is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1)),
    last_location_json TEXT CHECK (last_location_json IS NULL OR json_valid(last_location_json))
  );
`;

function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function hasRepUserProfileSchema(database) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!table) return false;
  const columns = new Set(database.pragma('table_info(users)').map((column) => column.name));
  return table.sql?.includes("'rep'")
    && columns.has('assigned_regions_json')
    && columns.has('is_online')
    && columns.has('last_location_json');
}

/** Add rep role/profile fields without changing user IDs or dependent foreign keys. */
export function migrateRepUserProfiles(database) {
  if (!tableExists(database, 'users')) return;

  const migrationTableExists = tableExists(database, 'schema_migrations');
  if (!migrationTableExists) {
    database.exec(`CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(repUserProfileMigration);
  if (hasRepUserProfileSchema(database)) {
    database.exec('CREATE INDEX IF NOT EXISTS idx_users_role_presence ON users(role, is_online, active, deleted_at)');
    if (!applied) database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(repUserProfileMigration);
    return;
  }
  if (database.inTransaction) {
    throw new Error('Rep user profile migration must run outside a transaction to preserve existing user foreign keys.');
  }

  const foreignKeysWereEnabled = database.pragma('foreign_keys', { simple: true }) === 1;
  database.pragma('foreign_keys = OFF');
  try {
    const rebuild = database.transaction(() => {
      if (tableExists(database, 'users_rep_migration_v1')) {
        throw new Error('A prior rep-user migration table exists; refusing to overwrite it.');
      }
      const columns = new Set(database.pragma('table_info(users)').map((column) => column.name));
      const preservedRegions = columns.has('assigned_regions_json') ? "COALESCE(assigned_regions_json, '[]')" : "'[]'";
      const preservedOnline = columns.has('is_online') ? 'COALESCE(is_online, 0)' : '0';
      const preservedLocation = columns.has('last_location_json') ? 'last_location_json' : 'NULL';

      database.exec(repUsersTableSql);
      database.exec(`
        INSERT INTO users_rep_migration_v1 (
          id, username, password_hash, full_name, role, active, created_at, deleted_at,
          assigned_regions_json, is_online, last_location_json
        )
        SELECT id, username, password_hash, full_name, role, active, created_at, deleted_at,
          ${preservedRegions}, ${preservedOnline}, ${preservedLocation}
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_rep_migration_v1 RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_role_presence ON users(role, is_online, active, deleted_at);
      `);
      if (!applied) database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(repUserProfileMigration);

      const violations = database.pragma('foreign_key_check').filter((violation) => violation.parent === 'users');
      if (violations.length) {
        throw new Error(`Rep user migration would leave foreign-key violations: ${JSON.stringify(violations.slice(0, 5))}`);
      }
    });
    rebuild.immediate();
  } finally {
    if (foreignKeysWereEnabled) database.pragma('foreign_keys = ON');
  }
}

export function migrateRepVisitIngestion(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(repVisitIngestionMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS rep_visits (
      id INTEGER PRIMARY KEY,
      visit_uuid TEXT NOT NULL UNIQUE,
      rep_user_id INTEGER NOT NULL REFERENCES users(id),
      order_id INTEGER REFERENCES maintenance_orders(id) ON DELETE SET NULL,
      card_id INTEGER REFERENCES maintenance_cards(id) ON DELETE SET NULL,
      machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
      order_code TEXT NOT NULL,
      machine_code TEXT NOT NULL,
      region_name TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
      status TEXT NOT NULL CHECK (status IN ('receiving', 'completed', 'failed')),
      reason_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reason_ids_json)),
      notes TEXT,
      captured_at TEXT NOT NULL,
      location_json TEXT CHECK (location_json IS NULL OR json_valid(location_json)),
      staging_path TEXT NOT NULL,
      final_path TEXT NOT NULL,
      before_path TEXT,
      after_path TEXT,
      failure_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rep_visits_rep_status_created
      ON rep_visits(rep_user_id, status, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_rep_visits_card_created
      ON rep_visits(card_id, created_at, id);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(repVisitIngestionMigration);
}

export function migrateRepSupervisorRadar(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(repSupervisorRadarMigration);
    if (applied) return;

    const visitColumns = new Set(database.pragma('table_info(rep_visits)').map((column) => column.name));
    if (!visitColumns.has('before_captured_at')) database.exec('ALTER TABLE rep_visits ADD COLUMN before_captured_at TEXT');
    if (!visitColumns.has('after_captured_at')) database.exec('ALTER TABLE rep_visits ADD COLUMN after_captured_at TEXT');
    database.exec(`
    CREATE TABLE IF NOT EXISTS rep_visit_reviews (
      visit_id INTEGER PRIMARY KEY REFERENCES rep_visits(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'reshoot')),
      review_note TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rep_visit_reviews_status_created
      ON rep_visit_reviews(status, created_at, visit_id);

    CREATE TABLE IF NOT EXISTS rep_duty_sessions (
      id INTEGER PRIMARY KEY,
      rep_user_id INTEGER NOT NULL REFERENCES users(id),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      start_location_json TEXT CHECK (start_location_json IS NULL OR json_valid(start_location_json)),
      end_location_json TEXT CHECK (end_location_json IS NULL OR json_valid(end_location_json)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_duty_sessions_one_active
      ON rep_duty_sessions(rep_user_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_rep_duty_sessions_rep_started
      ON rep_duty_sessions(rep_user_id, started_at, ended_at);

    CREATE TABLE IF NOT EXISTS rep_location_points (
      id INTEGER PRIMARY KEY,
      rep_user_id INTEGER NOT NULL REFERENCES users(id),
      duty_session_id INTEGER REFERENCES rep_duty_sessions(id),
      latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      accuracy REAL NOT NULL CHECK (accuracy >= 0 AND accuracy <= 100000),
      captured_at TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (rep_user_id, captured_at)
    );
    CREATE INDEX IF NOT EXISTS idx_rep_location_points_rep_captured
      ON rep_location_points(rep_user_id, captured_at, id);
    `);
    const locationColumns = new Set(database.pragma('table_info(rep_location_points)').map((column) => column.name));
    if (!locationColumns.has('duty_session_id')) {
      database.exec('ALTER TABLE rep_location_points ADD COLUMN duty_session_id INTEGER REFERENCES rep_duty_sessions(id)');
    }
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(repSupervisorRadarMigration);
  });
  migrate.immediate();
}

export function migrateRepVisitMachineCondition(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(repVisitConditionMigration);
    if (applied) return;
    const columns = new Set(database.pragma('table_info(rep_visits)').map((column) => column.name));
    if (!columns.has('machine_condition')) {
      database.exec(`ALTER TABLE rep_visits ADD COLUMN machine_condition TEXT NOT NULL DEFAULT 'working'
        CHECK (machine_condition IN ('working', 'faulty', 'preventive_maintenance'))`);
    }
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(repVisitConditionMigration);
  });
  migrate.immediate();
}

export function migrateMaintenanceOrderRepresentatives(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(maintenanceOrderRepsMigration);
    if (applied) return;
    database.exec(`
      CREATE TABLE IF NOT EXISTS maintenance_order_reps (
        order_id INTEGER NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        assigned_by INTEGER REFERENCES users(id),
        assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (order_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_maintenance_order_reps_user_order
        ON maintenance_order_reps(user_id, order_id);
    `);
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(maintenanceOrderRepsMigration);
  });
  migrate.immediate();
}

export function migrateRepVisitPhotoCollections(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(repVisitPhotosMigration);
    if (applied) return;
    database.exec(`
      CREATE TABLE IF NOT EXISTS rep_visit_photos (
        id INTEGER PRIMARY KEY,
        visit_id INTEGER NOT NULL REFERENCES rep_visits(id) ON DELETE CASCADE,
        phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        stored_path TEXT NOT NULL UNIQUE,
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (visit_id, phase, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_rep_visit_photos_visit_phase
        ON rep_visit_photos(visit_id, phase, ordinal, id);
    `);
    const columns = new Set(database.pragma('table_info(rep_visits)').map((column) => column.name));
    if (columns.has('before_path') && columns.has('after_path')) {
      database.exec(`
        INSERT OR IGNORE INTO rep_visit_photos (visit_id, phase, ordinal, stored_path, captured_at)
        SELECT id, 'before', 0, before_path, COALESCE(before_captured_at, captured_at)
        FROM rep_visits WHERE before_path IS NOT NULL;
        INSERT OR IGNORE INTO rep_visit_photos (visit_id, phase, ordinal, stored_path, captured_at)
        SELECT id, 'after', 0, after_path, COALESCE(after_captured_at, captured_at)
        FROM rep_visits WHERE after_path IS NOT NULL;
      `);
    }
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(repVisitPhotosMigration);
  });
  migrate.immediate();
}

export function migrateMaintenanceCardMultiReasons(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(maintenanceCardMultiReasonMigration);
  if (applied) return;

  const columns = new Set(database.pragma('table_info(maintenance_cards)').map((column) => column.name));
  if (!columns.has('reason_ids_json')) {
    database.exec("ALTER TABLE maintenance_cards ADD COLUMN reason_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  database.prepare(`
    UPDATE maintenance_cards
    SET reason_ids_json = json_array(reason_id)
    WHERE reason_id IS NOT NULL AND (reason_ids_json IS NULL OR reason_ids_json = '[]')
  `).run();

  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(maintenanceCardMultiReasonMigration);
}

export function migrateMaintenanceUnmatchedFolderDuplicates(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(maintenanceUnmatchedFolderDuplicateMigration);
  if (applied) return;

  const columns = new Set(database.pragma('table_info(maintenance_unmatched_folders)').map((column) => column.name));
  if (!columns.has('is_duplicate')) {
    database.exec('ALTER TABLE maintenance_unmatched_folders ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0 CHECK (is_duplicate IN (0, 1))');
  }
  if (!columns.has('duplicate_of_folder')) {
    database.exec('ALTER TABLE maintenance_unmatched_folders ADD COLUMN duplicate_of_folder TEXT');
  }
  if (!columns.has('duplicate_machine_id')) {
    database.exec('ALTER TABLE maintenance_unmatched_folders ADD COLUMN duplicate_machine_id INTEGER REFERENCES machines(id)');
  }
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(maintenanceUnmatchedFolderDuplicateMigration);
}

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

export function migrateMaintenanceUnmatchedFolderDeletion(database) {
  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
    .get(maintenanceUnmatchedFolderDeletionMigration);
  if (applied) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_unmatched_folder_deletion_operations (
      operation_id TEXT PRIMARY KEY,
      folder_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      client_code TEXT NOT NULL,
      order_code TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      source_name TEXT,
      targets_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'committed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_unmatched_folder_deletion_operations_state
      ON maintenance_unmatched_folder_deletion_operations(state, created_at, operation_id);
  `);
  database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
    .run(maintenanceUnmatchedFolderDeletionMigration);
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

export function migrateNativeAttendance(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(nativeAttendanceMigration);
    if (applied) return;

    const columns = new Set(database.pragma('table_info(employee_daily_attendance)').map((column) => column.name));
    const additions = [
      ['clock_in_time', 'TEXT'],
      ['clock_in_source', "TEXT CHECK (clock_in_source IN ('app', 'admin'))"],
      ['clock_in_lat', 'REAL'],
      ['clock_in_lng', 'REAL'],
      ['clock_out_time', 'TEXT'],
      ['clock_out_source', "TEXT CHECK (clock_out_source IN ('app', 'admin'))"],
      ['total_hours', 'REAL DEFAULT 0'],
      ['regular_hours', 'REAL DEFAULT 0'],
      ['overtime_status', "TEXT DEFAULT 'none' CHECK (overtime_status IN ('none', 'pending', 'approved', 'rejected'))"],
      ['overtime_approved_by', 'INTEGER REFERENCES users(id)'],
    ];
    for (const [column, declaration] of additions) {
      if (!columns.has(column)) {
        database.exec(`ALTER TABLE employee_daily_attendance ADD COLUMN ${column} ${declaration}`);
      }
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_employee_attendance_overtime
        ON employee_daily_attendance(overtime_status, work_date, employee_id);
    `);
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(nativeAttendanceMigration);
  });
  migrate.immediate();
}

export function migrateUserEmployeeLinks(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(userEmployeeSyncMigration);
    if (applied) return;

    const employeeColumns = new Set(database.pragma('table_info(employees)').map((column) => column.name));
    if (!employeeColumns.has('user_id')) {
      database.exec('ALTER TABLE employees ADD COLUMN user_id INTEGER REFERENCES users(id)');
    }
    if (!employeeColumns.has('can_login')) {
      database.exec('ALTER TABLE employees ADD COLUMN can_login INTEGER NOT NULL DEFAULT 0 CHECK (can_login IN (0, 1))');
    }
    if (!employeeColumns.has('department_label')) {
      database.exec("ALTER TABLE employees ADD COLUMN department_label TEXT CHECK (department_label IS NULL OR department_label IN ('Management', 'Sales'))");
    }

    const duplicate = database.prepare(`
      SELECT user_id, GROUP_CONCAT(id) AS employee_ids
      FROM employees WHERE user_id IS NOT NULL
      GROUP BY user_id HAVING COUNT(*) > 1 LIMIT 1
    `).get();
    if (duplicate) {
      throw new Error(`Cannot enforce one employee per user: user ${duplicate.user_id} is linked to employee rows ${duplicate.employee_ids}.`);
    }
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id) WHERE user_id IS NOT NULL');

    const users = database.prepare(`SELECT user.id, user.full_name, user.role, user.active, user.deleted_at, user.created_at
      FROM users AS user
      WHERE NOT EXISTS (SELECT 1 FROM employees AS employee WHERE employee.user_id = user.id)
      ORDER BY user.id`).all();
    for (const user of users) syncEmployeeForUser(database, user);

    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(userEmployeeSyncMigration);
  });
  migrate.immediate();
}

/** Reconcile pre-existing user links as well as accounts added by the link migration. */
export function migrateUserEmployeeProfileSync(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(userEmployeeProfileSyncMigration);
    if (applied) return;

    const users = database.prepare(`SELECT id, full_name, role, active, deleted_at, created_at
      FROM users WHERE role IN ('admin', 'sales', 'operations', 'purchasing', 'rep') ORDER BY id`).all();
    for (const user of users) syncEmployeeForUser(database, user);

    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
      .run(userEmployeeProfileSyncMigration);
  });
  migrate.immediate();
}

export function migrateMachineGeofenceAndBreadcrumbs(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(machineGeofenceBreadcrumbsMigration);
    if (applied) return;

    const machineColumns = new Set(database.pragma('table_info(machines)').map((column) => column.name));
    const machineAdditions = [
      ['latitude', 'REAL'],
      ['longitude', 'REAL'],
      ['is_location_locked', 'INTEGER NOT NULL DEFAULT 0 CHECK (is_location_locked IN (0, 1))'],
      ['geofence_radius_meters', 'INTEGER NOT NULL DEFAULT 50 CHECK (geofence_radius_meters BETWEEN 1 AND 10000)'],
      ['area_name', 'TEXT'],
    ];
    for (const [column, declaration] of machineAdditions) {
      if (!machineColumns.has(column)) database.exec(`ALTER TABLE machines ADD COLUMN ${column} ${declaration}`);
    }
    database.exec(`
      UPDATE machines SET area_name = area WHERE area_name IS NULL OR trim(area_name) = '';

      CREATE TABLE IF NOT EXISTS rep_location_breadcrumbs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        duty_session_id INTEGER REFERENCES rep_duty_sessions(id),
        work_date TEXT NOT NULL,
        latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        accuracy REAL NOT NULL DEFAULT 0 CHECK (accuracy >= 0 AND accuracy <= 100000),
        speed REAL NOT NULL DEFAULT 0 CHECK (speed >= 0),
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_stop INTEGER NOT NULL DEFAULT 0 CHECK (is_stop IN (0, 1)),
        stop_duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (stop_duration_minutes >= 0),
        stop_name TEXT,
        stop_arrived_at TEXT,
        stop_departed_at TEXT,
        UNIQUE (user_id, recorded_at)
      );
      CREATE INDEX IF NOT EXISTS idx_rep_breadcrumbs_user_date
        ON rep_location_breadcrumbs(user_id, work_date, recorded_at, id);
    `);

    // Retain route history already collected before this migration.
    const historicalPoints = database.prepare(`SELECT point.id, point.rep_user_id, point.duty_session_id,
      point.latitude, point.longitude, point.accuracy, point.captured_at
      FROM rep_location_points point
      WHERE NOT EXISTS (
        SELECT 1 FROM rep_location_breadcrumbs breadcrumb
        WHERE breadcrumb.user_id = point.rep_user_id AND breadcrumb.recorded_at = point.captured_at
      ) ORDER BY point.id`).all();
    const timeZone = database.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()?.value || 'Africa/Cairo';
    const localDateFormatter = (() => {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
      catch { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    })();
    const insertBreadcrumb = database.prepare(`INSERT OR IGNORE INTO rep_location_breadcrumbs
      (user_id, duty_session_id, work_date, latitude, longitude, accuracy, speed, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)`);
    for (const point of historicalPoints) {
      const parts = Object.fromEntries(localDateFormatter.formatToParts(new Date(point.captured_at))
        .filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
      insertBreadcrumb.run(point.rep_user_id, point.duty_session_id,
        `${parts.year}-${parts.month}-${parts.day}`, point.latitude, point.longitude, point.accuracy, point.captured_at);
    }

    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')
      .run(machineGeofenceBreadcrumbsMigration);
  });
  migrate.immediate();
}

/** Add persistent per-account lockout fields without rebuilding users or changing IDs. */
export function migrateAccountLoginProtection(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(accountLoginProtectionMigration);
    const columns = new Set(database.pragma('table_info(users)').map((column) => column.name));
    if (!columns.has('failed_login_attempts')) {
      database.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0)');
    }
    if (!columns.has('locked_until')) database.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');
    if (!applied) {
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(accountLoginProtectionMigration);
    }
  });
  migrate.immediate();
}

/** Default legacy Riyadh installs to Cairo, while preserving any other explicit timezone choice. */
export function migrateCairoTimezone(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(cairoTimezoneMigration);
    database.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'Africa/Cairo')").run();
    if (!applied) {
      database.prepare(`UPDATE settings SET value = 'Africa/Cairo', updated_at = CURRENT_TIMESTAMP
        WHERE key = 'timezone' AND value = 'Asia/Riyadh'`).run();
      database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(cairoTimezoneMigration);
    }
  });
  migrate.immediate();
}

/** Index the pruning predicate without rebuilding the breadcrumb table. */
export function migrateGpsRetentionIndex(database) {
  const migrate = database.transaction(() => {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
      .get(gpsRetentionIndexMigration);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_rep_breadcrumbs_recorded_at
      ON rep_location_breadcrumbs(julianday(recorded_at))`);
    if (!applied) database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(gpsRetentionIndexMigration);
  });
  migrate.immediate();
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

  // Rebuild an existing users table before the main transaction so SQLite can
  // safely preserve every table that references users(id).
  migrateRepUserProfiles(database);

  const initialize = database.transaction(() => {
    database.exec(schema);
    migrateRepUserProfiles(database);
    migrateAccountLoginProtection(database);
    migrateAuthenticationSessions(database);
    migrateOptionalOffcutMaterial(database);
    migrateClientMachineDeployments(database);
    migrateWarehouseLifecycle(database);
    migrateFinanceLifecycle(database);
    migrateV2FeatureParity(database);
    migrateRepVisitIngestion(database);
    migrateRepSupervisorRadar(database);
    migrateCairoTimezone(database);
    migrateMachineGeofenceAndBreadcrumbs(database);
    migrateGpsRetentionIndex(database);
    migrateRepVisitMachineCondition(database);
    migrateMaintenanceOrderRepresentatives(database);
    migrateRepVisitPhotoCollections(database);
    migrateNativeAttendance(database);
    migrateUserEmployeeLinks(database);
    migrateUserEmployeeProfileSync(database);
    migrateMaintenanceTripFolders(database);
    migrateMaintenanceOrderDeletion(database);
    migrateMaintenanceCardDeletion(database);
    migrateMaintenanceMachineDecommission(database);
    migrateMaintenanceUnmatchedFolderDeletion(database);
    migrateMaintenanceCardMultiReasons(database);
    migrateMaintenanceUnmatchedFolderDuplicates(database);

    const hasUsers = database.prepare('SELECT 1 FROM users LIMIT 1').get();

    // Keep explicit unattended bootstrap available, but leave a fresh install empty by default
    // so the first administrator is created through the one-time setup screen.
    if (!hasUsers && initialAdminPassword) {
      if (typeof initialAdminPassword !== 'string' || initialAdminPassword.length < 4
          || Buffer.byteLength(initialAdminPassword, 'utf8') > 72) {
        throw new Error('MADAR_INITIAL_ADMIN_PASSWORD must contain at least 4 characters and no more than 72 UTF-8 bytes.');
      }
      database.prepare(`
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES (?, ?, ?, ?)
      `).run('admin', bcrypt.hashSync(initialAdminPassword, 12), 'System Administrator', 'admin');
      const admin = database.prepare("SELECT id, full_name, role, active, deleted_at, created_at FROM users WHERE username = 'admin'").get();
      syncEmployeeForUser(database, admin);
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
