import { db as defaultDatabase } from './connection.js';

// Business data is retained forever. GPS breadcrumbs are never purged by time.
export const DATABASE_MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

let scheduler = null;
let maintenanceRunning = false;

export function runDatabaseMaintenance(database = defaultDatabase, now = new Date()) {
  if (!Number.isFinite(now.valueOf())) throw new TypeError('A valid maintenance timestamp is required.');
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rep_location_breadcrumbs'").get();
  const retainedBreadcrumbs = table
    ? database.prepare('SELECT COUNT(*) AS count FROM rep_location_breadcrumbs').get().count
    : 0;
  const optimize = database.pragma('optimize');
  const checkpoint = database.pragma('wal_checkpoint(TRUNCATE)')[0] ?? null;
  return {
    deletedBreadcrumbs: 0,
    retainedBreadcrumbs,
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
      console.log(`Weekly SQLite maintenance complete; retained ${result.retainedBreadcrumbs} GPS point(s).`);
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
