import { db } from '../database/connection.js';

/** Durable SQLite event log with in-process fan-out for the single-process deployment. */
const subscribers = new Set();
let fallbackSequence = 0;
const MAX_REPLAY_EVENTS = 10_000;

function deserializeEvent(row) {
  const payload = JSON.parse(row.payload_json);
  return Object.freeze({
    ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload }),
    id: Number(row.event_id),
    type: row.event_type,
    occurredAt: row.occurred_at,
  });
}

export function subscribeOperationsEvents(listener) {
  if (typeof listener !== 'function') throw new TypeError('An event listener is required.');
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function getOperationsEventsAfter(eventId = 0, { limit = 1000, database = db } = {}) {
  const cursor = Number(eventId);
  const count = Number(limit);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError('An event cursor must be a non-negative safe integer.');
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('An event replay limit must be a positive safe integer.');
  const boundedLimit = Math.min(count, MAX_REPLAY_EVENTS);
  return database.prepare(`
    SELECT event_id, event_type, payload_json, occurred_at
    FROM operations_events
    WHERE event_id > ? AND event_type <> 'system.shutdown'
    ORDER BY event_id
    LIMIT ?
  `).all(cursor, boundedLimit).map(deserializeEvent);
}

export function publishOperationsEvent(type, details = {}, database = db) {
  if (typeof type !== 'string' || !type.trim()) throw new TypeError('An event type is required.');
  const occurredAt = new Date().toISOString();
  const payload = JSON.stringify(details);
  let eventId;
  try {
    const result = database.prepare(`
      INSERT INTO operations_events (event_type, payload_json, occurred_at)
      VALUES (?, ?, ?)
    `).run(type, payload, occurredAt);
    eventId = Number(result.lastInsertRowid);
    if (eventId % 250 === 0) {
      database.prepare(`
        DELETE FROM operations_events
        WHERE event_id < (
          SELECT event_id FROM operations_events ORDER BY event_id DESC LIMIT 1 OFFSET ?
        )
      `).run(MAX_REPLAY_EVENTS - 1);
    }
  } catch (error) {
    // Keep the business mutation and live notification usable if a migration or
    // disk error prevents persistence; clients still reconcile through APIs.
    fallbackSequence += 1;
    eventId = `${Date.now()}-${fallbackSequence}`;
    console.error('Could not persist an operations event; API refresh remains the reconciliation path:', error.message);
  }
  const event = Object.freeze({
    ...(details && typeof details === 'object' && !Array.isArray(details) ? details : { value: details }),
    id: eventId,
    type,
    occurredAt,
  });
  for (const listener of subscribers) {
    try {
      listener(event);
    } catch {
      subscribers.delete(listener);
    }
  }
  return event;
}
