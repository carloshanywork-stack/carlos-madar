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

const [{ db, createConnection }, { initializeDatabase, migrateAccountLoginProtection, migrateCairoTimezone }, { runDatabaseMaintenance }] = await Promise.all([
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
  assert.deepEqual(db.pragma('index_xinfo(idx_rep_breadcrumbs_recorded_at)').filter((column) => column.key)
    .map((column) => column.name), [null], 'retention pruning indexes the julianday expression');
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

test('weekly maintenance removes only breadcrumbs older than 90 days and checkpoints SQLite', () => {
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
  assert.equal(result.deletedBreadcrumbs, 1);
  assert.ok(result.checkpoint);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_location_breadcrumbs').get().count, 2);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
