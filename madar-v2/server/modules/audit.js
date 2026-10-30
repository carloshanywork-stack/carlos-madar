import { db as defaultDb } from '../database/connection.js';

export function recordAudit({
  database = defaultDb,
  actorId = null,
  action,
  entityType,
  entityId,
  oldValues = null,
  newValues = null,
}) {
  database.prepare(`
    INSERT INTO audit_log
      (actor_id, action, entity_type, entity_id, old_values_json, new_values_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    actorId,
    action,
    entityType,
    entityId,
    oldValues === null ? null : JSON.stringify(oldValues),
    newValues === null ? null : JSON.stringify(newValues),
  );
}
