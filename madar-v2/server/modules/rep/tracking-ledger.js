import {createHash} from 'node:crypto';

export function trackingPayloadHash(point) {
  return createHash('sha256').update(JSON.stringify({latitude:point.latitude,longitude:point.longitude,accuracy:point.accuracy,speed:point.speed,updatedAt:point.updatedAt})).digest('hex');
}
export function previousTrackingReceipt(database,userId,point) {
  if (!point.clientPointId) return null;
  const receipt=database.prepare('SELECT payload_sha256 FROM rep_gps_receipts WHERE user_id=? AND client_point_id=?').get(userId,point.clientPointId);
  if (!receipt) return null;
  return receipt.payload_sha256 === trackingPayloadHash(point) ? 'duplicate' : 'identity_conflict';
}
export function persistTrackingPoint(database,userId,sessionId,workDate,point) {
  const inserted=database.prepare(`INSERT OR IGNORE INTO rep_gps_points
    (user_id,duty_session_id,work_date,latitude,longitude,accuracy,speed,recorded_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(userId,sessionId,workDate,point.latitude,point.longitude,point.accuracy,point.speed,point.updatedAt);
  const stored=database.prepare(`SELECT id FROM rep_gps_points WHERE user_id=? AND recorded_at=? AND latitude=? AND longitude=? AND accuracy=? AND speed=?`)
    .get(userId,point.updatedAt,point.latitude,point.longitude,point.accuracy,point.speed);
  if (point.clientPointId) database.prepare('INSERT INTO rep_gps_receipts(user_id,client_point_id,payload_sha256,point_id) VALUES (?,?,?,?)')
    .run(userId,point.clientPointId,trackingPayloadHash(point),stored.id);
  return inserted.changes > 0;
}

/** Historical ingestion never changes duty state. Ambiguous or unknown ownership/session requires review. */
export function trackingSessionForPoint(database,userId,point) {
  const sessions=database.prepare(`SELECT id FROM rep_duty_sessions WHERE rep_user_id=?
    AND julianday(started_at)<=julianday(?) AND (ended_at IS NULL OR julianday(ended_at)>=julianday(?))
    ORDER BY started_at DESC LIMIT 2`).all(userId,point.updatedAt,point.updatedAt);
  return sessions.length===1 ? sessions[0].id : null;
}

export function recordAttendanceDuty(database,userId,action,occurredAt,location) {
  if (action==='in') {
    const open=database.prepare('SELECT id FROM rep_duty_sessions WHERE rep_user_id=? AND ended_at IS NULL').get(userId);
    if (!open) database.prepare('INSERT INTO rep_duty_sessions(rep_user_id,started_at,start_location_json) VALUES (?,?,?)')
      .run(userId,occurredAt,location ? JSON.stringify(location):null);
  } else database.prepare(`UPDATE rep_duty_sessions SET ended_at=?,end_location_json=?,updated_at=CURRENT_TIMESTAMP
    WHERE rep_user_id=? AND ended_at IS NULL AND julianday(started_at)<=julianday(?)`)
    .run(occurredAt,location?JSON.stringify(location):null,userId,occurredAt);
}
