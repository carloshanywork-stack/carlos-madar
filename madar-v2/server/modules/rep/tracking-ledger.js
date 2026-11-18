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
  // Allow up to 10 minutes grace window before started_at
  const sessions = database.prepare(`SELECT id, started_at, ended_at FROM rep_duty_sessions WHERE rep_user_id=?
    AND (julianday(started_at) - (10.0 / 1440.0)) <= julianday(?)
    AND (ended_at IS NULL OR (julianday(ended_at) + (5.0 / 1440.0)) >= julianday(?))
    ORDER BY started_at DESC`).all(userId, point.updatedAt, point.updatedAt);
  if (sessions.length > 0) {
    if (sessions.length === 1) return sessions[0].id;
    // If multiple sessions overlap, choose the open one first, then the latest started
    const openSession = sessions.find((s) => s.ended_at === null);
    return openSession ? openSession.id : sessions[0].id;
  }

  // Graceful auto-healing: if point has no matched session, check if rep is clocked in today
  const activeAttendance = database.prepare(`
    SELECT attendance.id, attendance.clock_in_time
    FROM employee_daily_attendance attendance
    JOIN employees employee ON employee.id = attendance.employee_id
    WHERE employee.user_id = ? AND attendance.clock_in_time IS NOT NULL AND attendance.clock_out_time IS NULL
    ORDER BY attendance.work_date DESC, attendance.id DESC LIMIT 1
  `).get(userId);

  if (activeAttendance) {
    let open = database.prepare('SELECT id FROM rep_duty_sessions WHERE rep_user_id=? AND ended_at IS NULL').get(userId);
    if (open) return open.id;
    const result = database.prepare('INSERT INTO rep_duty_sessions(rep_user_id, started_at) VALUES (?, ?)')
      .run(userId, activeAttendance.clock_in_time || point.updatedAt);
    return Number(result.lastInsertRowid);
  }

  return null;
}

export function recordAttendanceDuty(database, userId, action, occurredAt, location) {
  if (action === 'in') {
    // Auto-close any stale open duty sessions older than 20 hours (0.83 days) for this rep
    database.prepare(`UPDATE rep_duty_sessions SET ended_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE rep_user_id = ? AND ended_at IS NULL AND (julianday(?) - julianday(started_at)) > 0.83`)
      .run(occurredAt, userId, occurredAt);

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
