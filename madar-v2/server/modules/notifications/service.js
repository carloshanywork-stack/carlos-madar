import { db } from '../../database/connection.js';
import { HttpError } from '../http.js';
import { operationNotification } from '../../../shared/operation-notifications.js';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';

function nowIso() {
  return new Date().toISOString();
}

function positiveNotificationId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'notification id must be a positive integer.');
  return id;
}

function serializeNotification(row) {
  return {
    id: Number(row.id),
    eventId: row.event_id === null || row.event_id === undefined ? null : Number(row.event_id),
    type: row.event_type,
    message: row.message,
    href: row.href,
    occurredAt: row.occurred_at,
    read: row.read_at !== null && row.read_at !== undefined,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

function activeAdminIds(database) {
  return database.prepare(`
    SELECT id FROM users
    WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL
    ORDER BY id
  `).all().map((row) => Number(row.id));
}

function activeUserIds(ids, database) {
  const values = [...new Set(ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!values.length) return [];
  const placeholders = values.map(() => '?').join(', ');
  return database.prepare(`
    SELECT id FROM users
    WHERE id IN (${placeholders}) AND active = 1 AND deleted_at IS NULL
    ORDER BY id
  `).all(...values).map((row) => Number(row.id));
}

/**
 * Persists one inbox row per eligible user for a durable operations event.
 * Administrators receive every mapped business notification, matching the
 * existing supervisor stream; explicit `recipientUserIds`/`userId` recipients
 * receive the same notification, matching the representative stream.
 * Dismissed rows are preserved by the unique (user_id, event_id) constraint, so
 * replaying an outbox event can never resurrect a dismissed notification.
 */
export function materializeNotificationsForEvent(event, database = db, { adminIds, readAt = null } = {}) {
  if (!event || !Number.isSafeInteger(Number(event.id)) || Number(event.id) < 1) return 0;
  const notice = operationNotification(event);
  if (!notice) return 0;

  const recipients = new Set(adminIds ?? activeAdminIds(database));
  const explicit = [];
  if (Array.isArray(event.recipientUserIds)) explicit.push(...event.recipientUserIds);
  if (event.userId !== undefined && event.userId !== null) explicit.push(event.userId);
  for (const userId of activeUserIds(explicit, database)) recipients.add(userId);
  if (!recipients.size) return 0;

  const insert = database.prepare(`
    INSERT OR IGNORE INTO user_notifications
      (user_id, event_id, event_type, message, href, occurred_at, read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const occurredAt = typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt))
    ? event.occurredAt
    : nowIso();
  let inserted = 0;
  for (const userId of recipients) {
    const result = insert.run(userId, Number(event.id), event.type, notice.text, notice.href, occurredAt, readAt);
    inserted += Number(result.changes) || 0;
  }
  return inserted;
}

/** One-time migration helper: materialize a bounded, already-seen backlog. */
export function backfillNotificationsFromEvents(database = db, { limit = 100, markRead = true } = {}) {
  const admins = activeAdminIds(database);
  const requested = Number(limit);
  const boundedLimit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 10_000) : 100;
  const rows = database.prepare(`
    SELECT event_id, event_type, payload_json, occurred_at
    FROM (
      SELECT event_id, event_type, payload_json, occurred_at
      FROM operations_events
      ORDER BY event_id DESC
      LIMIT ?
    )
    ORDER BY event_id
  `).all(boundedLimit);
  let inserted = 0;
  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      continue;
    }
    const event = {
      ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
      id: Number(row.event_id),
      type: row.event_type,
      occurredAt: row.occurred_at,
    };
    inserted += materializeNotificationsForEvent(event, database, {
      adminIds: admins,
      // The old notification strip already surfaced these events, so the
      // backlog opens as read instead of a large first-run unread badge.
      readAt: markRead ? row.occurred_at : null,
    });
  }
  return inserted;
}

export function unreadNotificationCount(userIdValue, database = db) {
  const userId = positiveNotificationId(userIdValue);
  return Number(database.prepare(`
    SELECT COUNT(*) AS count FROM user_notifications
    WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL
  `).get(userId).count);
}

export function listNotificationsForUser(userIdValue, database = db) {
  const userId = positiveNotificationId(userIdValue);
  const notifications = database.prepare(`
    SELECT id, event_id, event_type, message, href, occurred_at, read_at, created_at
    FROM user_notifications
    WHERE user_id = ? AND dismissed_at IS NULL
    ORDER BY occurred_at DESC, id DESC
  `).all(userId).map(serializeNotification);
  return {
    notifications,
    unreadCount: unreadNotificationCount(userId, database),
    total: notifications.length,
    timeZone: DEFAULT_TIME_ZONE,
  };
}

export function getNotificationForUser(userIdValue, notificationIdValue, database = db) {
  const userId = positiveNotificationId(userIdValue);
  const id = positiveNotificationId(notificationIdValue);
  const row = database.prepare(`
    SELECT id, event_id, event_type, message, href, occurred_at, read_at, created_at, dismissed_at
    FROM user_notifications
    WHERE id = ? AND user_id = ?
  `).get(id, userId);
  if (!row) throw new HttpError(404, 'Notification was not found.');
  return row;
}

export function markNotificationRead(userIdValue, notificationIdValue, database = db) {
  const userId = positiveNotificationId(userIdValue);
  const id = positiveNotificationId(notificationIdValue);
  const row = getNotificationForUser(userId, id, database);
  if (!row.dismissed_at && !row.read_at) {
    database.prepare(`
      UPDATE user_notifications SET read_at = ?
      WHERE id = ? AND user_id = ? AND read_at IS NULL
    `).run(nowIso(), id, userId);
  }
  return {
    notification: serializeNotification(getNotificationForUser(userId, id, database)),
    unreadCount: unreadNotificationCount(userId, database),
  };
}

export function markAllNotificationsRead(userIdValue, database = db) {
  const userId = positiveNotificationId(userIdValue);
  const result = database.prepare(`
    UPDATE user_notifications
    SET read_at = ?
    WHERE user_id = ? AND read_at IS NULL AND dismissed_at IS NULL
  `).run(nowIso(), userId);
  return {
    updated: Number(result.changes) || 0,
    unreadCount: unreadNotificationCount(userId, database),
  };
}

export function dismissNotification(userIdValue, notificationIdValue, database = db) {
  const userId = positiveNotificationId(userIdValue);
  const id = positiveNotificationId(notificationIdValue);
  const row = getNotificationForUser(userId, id, database);
  if (!row.dismissed_at) {
    database.prepare(`
      UPDATE user_notifications SET dismissed_at = ?
      WHERE id = ? AND user_id = ? AND dismissed_at IS NULL
    `).run(nowIso(), id, userId);
  }
  return {
    id,
    dismissed: true,
    unreadCount: unreadNotificationCount(userId, database),
  };
}
