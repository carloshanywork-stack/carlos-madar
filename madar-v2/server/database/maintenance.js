import { db as defaultDatabase } from './connection.js';

export const GPS_BREADCRUMB_RETENTION_DAYS = 90;
export const DATABASE_MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

let scheduler = null;
let maintenanceRunning = false;

export function runDatabaseMaintenance(database = defaultDatabase, now = new Date()) {
  const cutoff = new Date(now.valueOf() - GPS_BREADCRUMB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(cutoff.valueOf())) throw new TypeError('A valid maintenance timestamp is required.');
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rep_location_breadcrumbs'").get();
  let deletedBreadcrumbs = 0;
  if (table) {
    const prune = database.transaction(() => database.prepare(`
      DELETE FROM rep_location_breadcrumbs WHERE julianday(recorded_at) < julianday(?)
    `).run(cutoff.toISOString()).changes);
    deletedBreadcrumbs = prune.immediate();
  }
  const optimize = database.pragma('optimize');
  const checkpoint = database.pragma('wal_checkpoint(TRUNCATE)')[0] ?? null;
  return {
    cutoff: cutoff.toISOString(),
    deletedBreadcrumbs,
    optimize,
    checkpoint,
  };
}

export function startDatabaseMaintenanceScheduler({ database = defaultDatabase, intervalMs = DATABASE_MAINTENANCE_INTERVAL_MS } = {}) {
  if (scheduler) return;
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new RangeError('Database maintenance interval must be at least one second.');
  scheduler = setInterval(() => {
    if (maintenanceRunning) return;
    maintenanceRunning = true;
    try {
      const result = runDatabaseMaintenance(database);
      console.log(`Weekly SQLite maintenance complete; purged ${result.deletedBreadcrumbs} GPS point(s).`);
    } catch (error) {
      console.error('Weekly SQLite maintenance failed:', error);
    } finally {
      maintenanceRunning = false;
    }
  }, intervalMs);
  scheduler.unref?.();
}

export function stopDatabaseMaintenanceScheduler() {
  if (!scheduler) return;
  clearInterval(scheduler);
  scheduler = null;
}
