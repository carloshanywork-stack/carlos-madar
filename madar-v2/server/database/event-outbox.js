/** Additive durable publication intents; triggers share each domain statement's transaction. */
export function migrateTransactionalEventOutbox(database) {
  const version = '20261113-transactional-event-outbox';
  if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE operations_event_outbox (
      publication_key TEXT PRIMARY KEY, event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
    )`);
    // Coalesce invalidation while a delivery is pending. No customer data enters this payload.
    for (const table of ['maintenance_orders', 'maintenance_cards', 'maintenance_order_reps', 'machines', 'maintenance_card_photo_reviews']) {
      for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
        database.exec(`CREATE TRIGGER outbox_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN
          INSERT INTO operations_event_outbox(publication_key,event_type,payload_json,occurred_at)
          VALUES ('maintenance.reconcile','maintenance.changed',json_object('recipientUserIds',
            json((SELECT json_group_array(id) FROM users WHERE role='rep' AND active=1 AND deleted_at IS NULL))),
            strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          ON CONFLICT(publication_key) DO UPDATE SET payload_json=excluded.payload_json,occurred_at=excluded.occurred_at;
        END`);
      }
    }
    database.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version);
  })();
}
