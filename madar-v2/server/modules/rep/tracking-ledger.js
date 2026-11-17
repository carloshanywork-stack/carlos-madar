import { createHash } from 'node:crypto';

export function trackingPayloadHash(point) {
  return createHash('sha256').update(JSON.stringify({ latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy, speed: point.speed, updatedAt: point.updatedAt })).digest('hex');
}
export function previousTrackingReceipt(database, userId, point) {
  if (!point.clientPointId) return null;
  const receipt = database.prepare('SELECT payload_sha256 FROM rep_gps_receipts WHERE user_id=? AND client_point_id=?').get(userId, point.clientPointId);
  if (!receipt) return null;
  return receipt.payload_sha256 === trackingPayloadHash(point) ? 'duplicate' : 'identity_conflict';
}
export function persistTrackingPoint(database, userId, sessionId, workDate, point) {
  const inserted = database.prepare(`INSERT OR IGNORE INTO rep_gps_points
    (user_id,duty_session_id,work_date,latitude,longitude,accuracy,speed,recorded_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(userId, sessionId, workDate, point.latitude, point.longitude, point.accuracy, point.speed, point.updatedAt);
  const stored = database.prepare(`SELECT id FROM rep_gps_points WHERE user_id=? AND recorded_at=? AND latitude=? AND longitude=? AND accuracy=? AND speed=?`)
    .get(userId, point.updatedAt, point.latitude, point.longitude, point.accuracy, point.speed);
  if (point.clientPointId) database.prepare('INSERT INTO rep_gps_receipts(user_id,client_point_id,payload_sha256,point_id) VALUES (?,?,?,?)')
    .run(userId, point.clientPointId, trackingPayloadHash(point), stored.id);
  return inserted.changes > 0;
}

/** Historical ingestion never changes duty state. Ambiguous or unknown ownership/session requires review. */
export function trackingSessionForPoint(database, userId, point) {
  const sessions = database.prepare(`SELECT id FROM rep_duty_sessions WHERE rep_user_id=?
    AND julianday(started_at)<=julianday(?) AND (ended_at IS NULL OR julianday(ended_at)>=julianday(?))
    ORDER BY started_at DESC LIMIT 2`).all(userId, point.updatedAt, point.updatedAt);
  return sessions.length === 1 ? sessions[0].id : null;
}

export function recordAttendanceDuty(database, userId, action, occurredAt, location) {
  if (action === 'in') {
    let open = database.prepare('SELECT id FROM rep_duty_sessions WHERE rep_user_id=? AND ended_at IS NULL').get(userId);
    let sessionId = open?.id;
    if (!open) {
      const result = database.prepare('INSERT INTO rep_duty_sessions(rep_user_id,started_at,start_location_json) VALUES (?,?,?)')
        .run(userId, occurredAt, location ? JSON.stringify(location) : null);
      sessionId = Number(result.lastInsertRowid);
    }
    if (location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))) {
      const normalized = {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        accuracy: Number(location.accuracy) || 10,
        speed: Number(location.speed) || 0,
        updatedAt: location.updatedAt || occurredAt,
      };
      database.prepare(`
        UPDATE users SET is_online = 1,
          last_location_json = CASE
            WHEN last_location_json IS NULL OR datetime(json_extract(last_location_json, '$.updatedAt')) <= datetime(?)
              THEN ? ELSE last_location_json END
        WHERE id = ? AND role = 'rep' AND active = 1 AND deleted_at IS NULL
      `).run(normalized.updatedAt, JSON.stringify(normalized), userId);

      const workDate = (normalized.updatedAt || occurredAt).slice(0, 10);
      database.prepare(`
        INSERT OR IGNORE INTO rep_gps_points
          (user_id, duty_session_id, work_date, latitude, longitude, accuracy, speed, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, sessionId, workDate, normalized.latitude, normalized.longitude, normalized.accuracy, normalized.speed, normalized.updatedAt);
    } else {
      database.prepare(`
        UPDATE users SET is_online = 1
        WHERE id = ? AND role = 'rep' AND active = 1 AND deleted_at IS NULL
      `).run(userId);
    }
  } else {
    database.prepare(`UPDATE rep_duty_sessions SET ended_at=?,end_location_json=?,updated_at=CURRENT_TIMESTAMP
      WHERE rep_user_id=? AND ended_at IS NULL AND julianday(started_at)<=julianday(?)`)
      .run(occurredAt, location ? JSON.stringify(location) : null, userId, occurredAt);
    database.prepare('UPDATE users SET is_online = 0 WHERE id = ? AND role = \'rep\'').run(userId);
  }
}
