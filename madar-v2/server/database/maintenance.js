import { db as defaultDatabase } from './connection.js';

// Business data is retained forever. GPS breadcrumbs are never purged by time.
export const DATABASE_MAINTENANCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

let scheduler = null;
let maintenanceRunning = false;
let lastMaintenanceAt = 0;

export function runDatabaseMaintenance(database = defaultDatabase, now = new Date()) {
  if (!Number.isFinite(now.valueOf())) throw new TypeError('A valid maintenance timestamp is required.');
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rep_location_breadcrumbs'").get();
  const retainedBreadcrumbs = table
    ? database.prepare('SELECT COUNT(*) AS count FROM rep_location_breadcrumbs').get().count
    : 0;
  const optimize = database.pragma('optimize');
  const checkpoint = database.pragma('wal_checkpoint(TRUNCATE)')[0] ?? null;
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
  return {
    deletedBreadcrumbs: 0,
    retainedBreadcrumbs,
    optimize,
    checkpoint,
    integrity,
  };
}

export function startDatabaseMaintenanceScheduler({ database = defaultDatabase, intervalMs = DATABASE_MAINTENANCE_INTERVAL_MS } = {}) {
  if (scheduler) return;
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new RangeError('Database maintenance interval must be at least one second.');
  const checkIntervalMs = Math.min(intervalMs, 60 * 60 * 1000);
  scheduler = setInterval(() => {
    const now = new Date();
    if (maintenanceRunning || now.getHours() < 1 || now.getHours() >= 5
        || Date.now() - lastMaintenanceAt < intervalMs) return;
    maintenanceRunning = true;
    try {
      const result = runDatabaseMaintenance(database, now);
      lastMaintenanceAt = now.valueOf();
      console.log(`Weekly off-hours SQLite maintenance complete; retained ${result.retainedBreadcrumbs} GPS point(s); integrity=${result.integrity}.`);
    } catch (error) {
      console.error('Weekly SQLite maintenance failed:', error);
    } finally {
      maintenanceRunning = false;
    }
  }, checkIntervalMs);
  scheduler.unref?.();
}

export function stopDatabaseMaintenanceScheduler() {
  if (!scheduler) return;
  clearInterval(scheduler);
  scheduler = null;
}
