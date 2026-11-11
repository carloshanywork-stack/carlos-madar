import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-db-maintenance-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'maintenance.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [{ db, createConnection }, { initializeDatabase, migrateAccountLoginProtection, migrateAttendanceAdminClockOutNote, migrateAttendanceBiometricConfirmation, migrateAttendanceClockLocations, migrateCairoTimezone, migrateDurableOperationsEvents, migrateMaintenancePhotoRotations, migrateMaintenancePhysicalPhotoRotations, migrateMachineMaintenanceNotes, migrateMachineNotesHistory, migrateWholeUnitMainWarehouse }, { runDatabaseMaintenance }] = await Promise.all([
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/database/maintenance.js'),
]);

initializeDatabase({ initialAdminPassword: 'Maintenance-test-password-2026!' });

after(() => {
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('database initialization sets Cairo and adds account lockout fields', () => {
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get().value, 'Africa/Cairo');
  const userColumns = new Map(db.pragma('table_info(users)').map((column) => [column.name, column]));
  assert.ok(userColumns.has('failed_login_attempts'));
  assert.ok(userColumns.has('locked_until'));
  assert.equal(db.prepare('SELECT failed_login_attempts, locked_until FROM users WHERE username = ?').get('admin')
    .failed_login_attempts, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261103-account-login-protection'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261103-gps-retention-index'").get().count, 1);
  assert.ok(db.pragma('table_info(employee_daily_attendance)').some((column) => column.name === 'clock_out_admin_note'));
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employee_daily_attendance'").get().sql, /'cancelled'/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261111-attendance-cancellation-status'").get().count, 1);
  assert.ok(db.pragma('table_info(maintenance_card_photo_rotations)').some((column) => column.name === 'angle'));
  assert.ok(db.pragma('table_info(maintenance_card_photo_rotations)').some((column) => column.name === 'rotated_path'));
  assert.ok(db.pragma('table_info(operations_events)').some((column) => column.name === 'event_id'));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-durable-operations-events'").get().count, 1);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inventory_movements'").get().sql, /offcut_return/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-main-warehouse-whole-units'").get().count, 1);
  migrateDurableOperationsEvents(db);
  migrateWholeUnitMainWarehouse(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-durable-operations-events'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-main-warehouse-whole-units'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261109-maintenance-photo-rotation-metadata'").get().count, 1);
  migrateMaintenancePhotoRotations(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261109-maintenance-photo-rotation-metadata'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-maintenance-photo-rotation-derivatives'").get().count, 1);
  migrateMaintenancePhysicalPhotoRotations(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-maintenance-photo-rotation-derivatives'").get().count, 1);
  assert.ok(db.pragma('table_info(machines)').some((column) => column.name === 'maintenance_note'));
  assert.ok(db.pragma('table_info(machines)').some((column) => column.name === 'updated_at'));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261111-machine-updated-at'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261109-machine-maintenance-notes'").get().count, 1);
  migrateMachineMaintenanceNotes(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261109-machine-maintenance-notes'").get().count, 1);
  assert.ok(db.pragma('table_info(machine_notes_history)').some((column) => column.name === 'author_role'));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-machine-notes-history'").get().count, 1);
  migrateMachineNotesHistory(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-machine-notes-history'").get().count, 1);
  migrateAttendanceAdminClockOutNote(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261104-attendance-admin-clockout-note'").get().count, 1);
  const attendanceColumns = new Set(db.pragma('table_info(employee_daily_attendance)').map((column) => column.name));
  for (const column of [
    'clock_in_accuracy', 'clock_in_location_at', 'clock_out_lat', 'clock_out_lng',
    'clock_out_accuracy', 'clock_out_location_at',
  ]) assert.ok(attendanceColumns.has(column), `missing attendance GPS column ${column}`);
  migrateAttendanceClockLocations(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261105-attendance-clock-gps'").get().count, 1);
  assert.deepEqual(db.pragma('index_xinfo(idx_rep_breadcrumbs_recorded_at)').filter((column) => column.key)
    .map((column) => column.name), [null], 'retention pruning indexes the julianday expression');
  const biometricColumns = new Set(db.pragma('table_info(employee_daily_attendance)').map((column) => column.name));
  assert.ok(biometricColumns.has('clock_in_biometric_verified'));
  assert.ok(biometricColumns.has('clock_out_biometric_verified'));
  migrateAttendanceBiometricConfirmation(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261105-attendance-biometric-confirmation'").get().count, 1);
});

test('main-stock migration preserves movement IDs and adds fractional-offcut movements and whole-unit triggers', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE materials (id INTEGER PRIMARY KEY, stock REAL NOT NULL DEFAULT 0);
      CREATE TABLE secondary_warehouse_offcuts (id INTEGER PRIMARY KEY);
      CREATE TABLE inventory_movements (
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
      INSERT INTO materials (id, stock) VALUES (4, 6);
      INSERT INTO inventory_movements (id, material_id, kind, quantity, warehouse)
        VALUES (52, 4, 'purchase', 6, 'main');
    `);
    migrateWholeUnitMainWarehouse(legacy);
    migrateWholeUnitMainWarehouse(legacy);

    assert.deepEqual(legacy.prepare('SELECT id, material_id, kind, quantity, warehouse FROM inventory_movements').get(), {
      id: 52, material_id: 4, kind: 'purchase', quantity: 6, warehouse: 'main',
    });
    assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261110-main-warehouse-whole-units'").get().count, 1);
    legacy.prepare(`INSERT INTO inventory_movements (material_id, kind, quantity, warehouse)
      VALUES (4, 'offcut_return', 0.5, 'secondary')`).run();
    assert.throws(() => legacy.prepare('INSERT INTO materials (id, stock) VALUES (5, 0.5)').run(), /whole units/);
    assert.throws(() => legacy.prepare('UPDATE materials SET stock = 6.5 WHERE id = 4').run(), /whole units/);
    assert.equal(legacy.prepare('SELECT stock FROM materials WHERE id = 4').get().stock, 6);
  } finally {
    legacy.close();
  }
});

test('machine notes history migration backfills card and fallback notes additively and is idempotent', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL);
      CREATE TABLE machines (id INTEGER PRIMARY KEY, code TEXT NOT NULL, maintenance_note TEXT NOT NULL DEFAULT '');
      CREATE TABLE maintenance_orders (id INTEGER PRIMARY KEY, order_code TEXT NOT NULL);
      CREATE TABLE maintenance_cards (
        id INTEGER PRIMARY KEY, machine_id INTEGER NOT NULL REFERENCES machines(id),
        order_id INTEGER NOT NULL REFERENCES maintenance_orders(id), notes TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE rep_visits (
        id INTEGER PRIMARY KEY, visit_uuid TEXT, rep_user_id INTEGER, order_id INTEGER, card_id INTEGER,
        machine_id INTEGER, notes TEXT, captured_at TEXT, status TEXT
      );
      INSERT INTO users (id, full_name) VALUES (13, 'محمود المندوب');
      INSERT INTO machines (id, code, maintenance_note) VALUES
        (71, 'LEGACY-NOTE-MACHINE', ''), (72, 'LEGACY-FALLBACK-MACHINE', 'Fallback history note');
      INSERT INTO maintenance_orders (id, order_code) VALUES (81, 'MNT-0081');
      INSERT INTO maintenance_cards (id, machine_id, order_id, notes, created_at)
        VALUES (91, 71, 81, 'Preserved card note' || char(10) || '[مندوب · 2026-10-02T09:00:00.000Z] Field visit note', '2026-10-02 09:15:00');
      INSERT INTO rep_visits (id, visit_uuid, rep_user_id, order_id, card_id, machine_id, notes, captured_at, status)
        VALUES (101, 'legacy-visit-101', 13, 81, 91, 71, 'Field visit note', '2026-10-02T09:00:00.000Z', 'completed');
      INSERT INTO schema_migrations (version) VALUES ('prior-version');
    `);
    migrateMachineNotesHistory(legacy);
    migrateMachineNotesHistory(legacy);

    assert.deepEqual(legacy.prepare(`SELECT machine_id, card_id, order_id, author_name, author_role, note, created_at
      FROM machine_notes_history WHERE card_id IS NOT NULL AND author_role = 'admin'`).get(), {
      machine_id: 71,
      card_id: 91,
      order_id: 81,
      author_name: 'إدارة',
      author_role: 'admin',
      note: 'Preserved card note',
      created_at: '2026-10-02 09:15:00',
    });
    assert.deepEqual(legacy.prepare(`SELECT machine_id, card_id, order_id, author_id, author_name, author_role, note, created_at
      FROM machine_notes_history WHERE author_role = 'rep'`).get(), {
      machine_id: 71,
      card_id: 91,
      order_id: 81,
      author_id: 13,
      author_name: 'محمود المندوب',
      author_role: 'rep',
      note: 'Field visit note',
      created_at: '2026-10-02T09:00:00.000Z',
    });
    assert.deepEqual(legacy.prepare(`SELECT machine_id, card_id, order_id, author_name, author_role, note
      FROM machine_notes_history WHERE card_id IS NULL`).get(), {
      machine_id: 72,
      card_id: null,
      order_id: null,
      author_name: 'إدارة',
      author_role: 'admin',
      note: 'Fallback history note',
    });
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM machine_notes_history').get().count, 3);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2);
  } finally {
    legacy.close();
  }
});

test('maintenance photo rotation migration is additive, preserves records, and is idempotent', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE maintenance_cards (id INTEGER PRIMARY KEY);
      INSERT INTO users (id) VALUES (8);
      INSERT INTO maintenance_cards (id) VALUES (31);
      INSERT INTO schema_migrations (version) VALUES ('prior-version');
    `);
    migrateMaintenancePhotoRotations(legacy);
    legacy.prepare(`
      INSERT INTO maintenance_card_photo_rotations (card_id, phase, filename, angle, updated_by)
      VALUES (31, 'before', 'field-photo.jpg', 270, 8)
    `).run();
    migrateMaintenancePhotoRotations(legacy);

    assert.deepEqual(legacy.prepare('SELECT card_id, phase, filename, angle, updated_by FROM maintenance_card_photo_rotations').get(), {
      card_id: 31,
      phase: 'before',
      filename: 'field-photo.jpg',
      angle: 270,
      updated_by: 8,
    });
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2);
  } finally {
    legacy.close();
  }
});

test('physical photo-rotation migration adds only a nullable derivative path and preserves rotation history', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE maintenance_cards (id INTEGER PRIMARY KEY);
      INSERT INTO users (id) VALUES (8);
      INSERT INTO maintenance_cards (id) VALUES (31);
      INSERT INTO schema_migrations (version) VALUES ('prior-version');`);
    migrateMaintenancePhotoRotations(legacy);
    legacy.prepare(`INSERT INTO maintenance_card_photo_rotations (card_id, phase, filename, angle, updated_by)
      VALUES (31, 'before', 'field-photo.jpg', 270, 8)`).run();
    migrateMaintenancePhysicalPhotoRotations(legacy);
    migrateMaintenancePhysicalPhotoRotations(legacy);

    assert.deepEqual(legacy.prepare(`SELECT card_id, phase, filename, angle, updated_by, rotated_path
      FROM maintenance_card_photo_rotations`).get(), {
      card_id: 31,
      phase: 'before',
      filename: 'field-photo.jpg',
      angle: 270,
      updated_by: 8,
      rotated_path: null,
    });
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM maintenance_card_photo_rotations').get().count, 1);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 3);
  } finally {
    legacy.close();
  }
});

test('attendance GPS migration is additive, preserves existing records, and is idempotent', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE employee_daily_attendance (
        id INTEGER PRIMARY KEY, clock_in_lat REAL, clock_in_lng REAL, clock_out_time TEXT
      );
      INSERT INTO employee_daily_attendance (id, clock_in_lat, clock_in_lng) VALUES (91, 30.1, 31.2);`);
    migrateAttendanceClockLocations(legacy);
    migrateAttendanceClockLocations(legacy);
    const record = legacy.prepare('SELECT * FROM employee_daily_attendance WHERE id = 91').get();
    assert.equal(record.clock_in_lat, 30.1);
    assert.equal(record.clock_in_lng, 31.2);
    assert.equal(record.clock_out_lat, null);
    assert.equal(record.clock_out_accuracy, null);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM employee_daily_attendance').get().count, 1);
    assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261105-attendance-clock-gps'").get().count, 1);
  } finally {
    legacy.close();
  }
});

test('attendance biometric migration is additive, preserves existing rows, and is idempotent', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE employee_daily_attendance (
        id INTEGER PRIMARY KEY, work_date TEXT NOT NULL, clock_in_time TEXT
      );
      INSERT INTO employee_daily_attendance (id, work_date, clock_in_time)
        VALUES (92, '2026-11-05', '2026-11-05T06:00:00.000Z');`);
    migrateAttendanceBiometricConfirmation(legacy);
    migrateAttendanceBiometricConfirmation(legacy);
    const record = legacy.prepare('SELECT * FROM employee_daily_attendance WHERE id = 92').get();
    assert.equal(record.clock_in_time, '2026-11-05T06:00:00.000Z');
    assert.equal(record.clock_in_biometric_verified, 0);
    assert.equal(record.clock_out_biometric_verified, 0);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM employee_daily_attendance').get().count, 1);
    assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261105-attendance-biometric-confirmation'").get().count, 1);
  } finally {
    legacy.close();
  }
});

test('legacy timezone migration updates Riyadh only and preserves explicit custom zones', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO settings (key, value) VALUES ('timezone', 'Asia/Riyadh');`);
    migrateCairoTimezone(legacy);
    assert.equal(legacy.prepare("SELECT value FROM settings WHERE key = 'timezone'").get().value, 'Africa/Cairo');
    legacy.prepare("UPDATE settings SET value = 'Europe/London' WHERE key = 'timezone'").run();
    legacy.prepare("DELETE FROM schema_migrations WHERE version = '20261103-africa-cairo-timezone'").run();
    migrateCairoTimezone(legacy);
    assert.equal(legacy.prepare("SELECT value FROM settings WHERE key = 'timezone'").get().value, 'Europe/London');
  } finally {
    legacy.close();
  }
});

test('account lockout migration preserves user identity and can run repeatedly', () => {
  const legacy = createConnection(':memory:');
  try {
    legacy.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL);
      INSERT INTO users (id, username, password_hash) VALUES (71, 'legacy', 'preserved-hash');`);
    migrateAccountLoginProtection(legacy);
    migrateAccountLoginProtection(legacy);
    assert.deepEqual(legacy.prepare('SELECT id, username, password_hash, failed_login_attempts, locked_until FROM users').get(), {
      id: 71,
      username: 'legacy',
      password_hash: 'preserved-hash',
      failed_login_attempts: 0,
      locked_until: null,
    });
    assert.equal(legacy.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20261103-account-login-protection'").get().count, 1);
  } finally {
    legacy.close();
  }
});

test('weekly maintenance retains every breadcrumb forever and checkpoints SQLite', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');
  const oldDate = new Date(now.valueOf() - (91 * 24 * 60 * 60 * 1000)).toISOString();
  const cutoff = new Date(now.valueOf() - (90 * 24 * 60 * 60 * 1000)).toISOString();
  const recentDate = new Date(now.valueOf() - (89 * 24 * 60 * 60 * 1000)).toISOString();
  const userId = db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  const insert = db.prepare(`INSERT INTO rep_location_breadcrumbs
    (user_id, work_date, latitude, longitude, accuracy, speed, recorded_at)
    VALUES (?, '2026-08-01', 30, 31, 4, 0, ?)`);
  insert.run(userId, oldDate);
  insert.run(userId, cutoff);
  insert.run(userId, recentDate);

  const result = runDatabaseMaintenance(db, now);
  assert.equal(result.deletedBreadcrumbs, 0);
  assert.equal(result.retainedBreadcrumbs, 3);
  assert.ok(result.checkpoint);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_breadcrumbs').get().count, 3);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
