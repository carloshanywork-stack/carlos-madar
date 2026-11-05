import XLSX from 'xlsx-js-style';
import { db as defaultDatabase } from '../../database/connection.js';
import { HttpError, allowOnlyKeys, optionalText, positiveId, requireObject, requireText } from '../http.js';
import { resolveStorageFile } from '../storage.js';
import { recordAudit } from '../audit.js';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';

function getTimeZone(database) {
  const configured = database.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()?.value;
  try {
    if (typeof configured === 'string' && configured.trim()) {
      new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());
      return configured;
    }
  } catch { /* Use the ERP default if a setting is invalid. */ }
  return DEFAULT_TIME_ZONE;
}

function dayRange(day, database) {
  const timeZone = getTimeZone(database);
  let parts;
  if (day !== undefined) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'day must be formatted YYYY-MM-DD.');
    const parsed = new Date(`${day}T12:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== day) throw new HttpError(400, 'day must be a valid calendar date.');
    const [year, month, date] = day.split('-').map(Number);
    parts = { year, month, day: date };
  } else {
    const values = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const parsed = Object.fromEntries(values.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, Number(value)]));
    parts = { year: parsed.year, month: parsed.month, day: parsed.day };
  }

  const midnight = (dateParts) => {
    const desiredUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day);
    let timestamp = desiredUtc;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const values = formatter.formatToParts(new Date(timestamp));
      const local = Object.fromEntries(values.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, Number(value)]));
      const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
      const correction = desiredUtc - represented;
      timestamp += correction;
      if (!correction) break;
    }
    return new Date(timestamp);
  };
  const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const next = { year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() + 1, day: nextDate.getUTCDate() };
  return {
    start: midnight(parts).toISOString(),
    end: midnight(next).toISOString(),
    day: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
  };
}

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function haversineKm(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDifference = radians(right.latitude - left.latitude);
  const longitudeDifference = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function estimateDistance(points) {
  let distance = 0;
  let previous = null;
  for (const point of points) {
    if (Number(point.accuracy) > 100) continue;
    if (previous) {
      const gapMs = new Date(point.captured_at).valueOf() - new Date(previous.captured_at).valueOf();
      const segment = haversineKm(previous, point);
      if (gapMs > 0 && gapMs <= 2 * 60 * 60 * 1000 && segment <= 100) distance += segment;
    }
    previous = point;
  }
  return Math.round(distance * 10) / 10;
}

export function getSupervisorRadar(database = defaultDatabase, now = new Date()) {
  const todayRange = dayRange(undefined, database);
  const { start, end } = todayRange;
  const reps = database.prepare(`
    SELECT user.id, user.username, user.full_name, user.assigned_regions_json, user.is_online,
      user.last_location_json, employee.phone,
      session.id AS duty_session_id, session.started_at AS duty_started_at
    FROM users user
    LEFT JOIN employees employee ON employee.user_id = user.id AND employee.deleted_at IS NULL
    LEFT JOIN rep_duty_sessions session ON session.rep_user_id = user.id AND session.ended_at IS NULL
    WHERE user.role = 'rep' AND user.deleted_at IS NULL
    ORDER BY user.active DESC, user.full_name COLLATE NOCASE, user.id
  `).all();
  const todayApproved = database.prepare(`
    SELECT visit.rep_user_id, COUNT(*) AS count
    FROM rep_visits visit JOIN rep_visit_reviews review ON review.visit_id = visit.id
    WHERE review.status = 'approved' AND datetime(visit.created_at) >= datetime(?) AND datetime(visit.created_at) < datetime(?)
    GROUP BY visit.rep_user_id
  `).all(start, end);
  const approvedByRep = new Map(todayApproved.map((row) => [Number(row.rep_user_id), Number(row.count)]));
  const todayPending = database.prepare(`
    SELECT visit.rep_user_id, COUNT(*) AS count
    FROM rep_visits visit JOIN rep_visit_reviews review ON review.visit_id = visit.id
    WHERE review.status = 'pending' AND datetime(visit.created_at) >= datetime(?) AND datetime(visit.created_at) < datetime(?)
    GROUP BY visit.rep_user_id
  `).all(start, end);
  const pendingByRep = new Map(todayPending.map((row) => [Number(row.rep_user_id), Number(row.count)]));

  const result = reps.map((rep) => {
    const points = database.prepare(`
      SELECT point.latitude, point.longitude, point.accuracy, point.captured_at
      FROM rep_location_points point
      JOIN rep_duty_sessions duty ON duty.id = point.duty_session_id
      WHERE point.rep_user_id = ? AND datetime(point.captured_at) >= datetime(?) AND datetime(point.captured_at) < datetime(?)
      ORDER BY datetime(point.captured_at), point.id
    `).all(rep.id, start, end);
    const savedLocation = parseJson(rep.last_location_json);
    const latestPoint = points.at(-1);
    const savedLocationTime = savedLocation?.updatedAt ? new Date(savedLocation.updatedAt).valueOf() : Number.NEGATIVE_INFINITY;
    const latestPointTime = latestPoint ? new Date(latestPoint.captured_at).valueOf() : Number.NEGATIVE_INFINITY;
    const useLatestPoint = latestPoint && latestPointTime > savedLocationTime;
    const location = useLatestPoint
      ? { latitude: Number(latestPoint.latitude), longitude: Number(latestPoint.longitude), accuracy: Number(latestPoint.accuracy), updatedAt: latestPoint.captured_at }
      : savedLocation;
    const lastSignal = location?.updatedAt ?? null;
    const staleMs = lastSignal ? now.valueOf() - new Date(lastSignal).valueOf() : Number.POSITIVE_INFINITY;
    const recentPending = database.prepare(`
      SELECT 1 FROM rep_visits visit JOIN rep_visit_reviews review ON review.visit_id = visit.id
      WHERE visit.rep_user_id = ? AND review.status = 'pending'
        AND datetime(visit.created_at) >= datetime('now', '-45 minutes') LIMIT 1
    `).get(rep.id);
    const onDuty = Boolean(rep.duty_session_id);
    const status = !onDuty || staleMs > 2 * 60 * 1000
      ? 'offline'
      : recentPending ? 'onsite' : 'active';
    const trail = points.map((point) => ({
      latitude: Number(point.latitude), longitude: Number(point.longitude), accuracy: Number(point.accuracy), updatedAt: point.captured_at,
    }));
    return {
      id: Number(rep.id), username: rep.username, fullName: rep.full_name, phone: rep.phone ?? '',
      assignedRegions: parseJson(rep.assigned_regions_json, []).filter((region) => typeof region === 'string'),
      onDuty, status, lastSignal, lastLocation: location && Number.isFinite(location.latitude) ? location : null,
      completedToday: approvedByRep.get(Number(rep.id)) ?? 0,
      pendingReview: pendingByRep.get(Number(rep.id)) ?? 0,
      dutyStartedAt: rep.duty_started_at,
      speedKmh: Number.isFinite(Number(location?.speed)) ? Math.round(Math.max(0, Number(location.speed) * 3.6) * 10) / 10 : null,
      distanceKm: estimateDistance(points),
      trail,
    };
  });
  return { success: true, generatedAt: now.toISOString(), businessDate: todayRange.day, representatives: result };
}

export function getSupervisorRepRoute(repIdInput, dateInput, database = defaultDatabase) {
  const repId = positiveId(Number(repIdInput), 'repId');
  const day = dateInput ?? dayRange(undefined, database).day;
  const { start, end } = dayRange(day, database);
  const rep = database.prepare(`SELECT id, username, full_name FROM users
    WHERE id = ? AND role = 'rep' AND deleted_at IS NULL`).get(repId);
  if (!rep) throw new HttpError(404, 'Representative was not found.');

  const points = database.prepare(`SELECT id, latitude, longitude, accuracy, speed, recorded_at,
      is_stop, stop_duration_minutes, stop_name, stop_arrived_at, stop_departed_at
    FROM rep_location_breadcrumbs
    WHERE user_id = ? AND work_date = ?
      AND datetime(recorded_at) >= datetime(?) AND datetime(recorded_at) < datetime(?)
    ORDER BY datetime(recorded_at), id`).all(repId, day, start, end);
  const stopRows = database.prepare(`SELECT stop_arrived_at AS arrived_at,
      stop_departed_at AS departed_at, MAX(stop_duration_minutes) AS duration_minutes,
      stop_name, AVG(latitude) AS latitude, AVG(longitude) AS longitude
    FROM rep_location_breadcrumbs
    WHERE user_id = ? AND work_date = ? AND is_stop = 1 AND stop_arrived_at IS NOT NULL
    GROUP BY stop_arrived_at, stop_departed_at, stop_name
    ORDER BY datetime(stop_arrived_at)`).all(repId, day);
  const visitedRows = database.prepare(`SELECT visit.visit_uuid, visit.machine_code, machine.name_ar AS machine_name,
      visit.region_name, visit.captured_at, review.status AS review_status,
      visit.location_json, machine.latitude AS machine_latitude, machine.longitude AS machine_longitude
    FROM rep_visits visit
    LEFT JOIN rep_visit_reviews review ON review.visit_id = visit.id
    LEFT JOIN machines machine ON machine.id = visit.machine_id
    WHERE visit.rep_user_id = ? AND datetime(visit.captured_at) >= datetime(?)
      AND datetime(visit.captured_at) < datetime(?)
    ORDER BY datetime(visit.captured_at), visit.id`).all(repId, start, end);
  const speeds = points.map((point) => Number(point.speed)).filter((speed) => Number.isFinite(speed) && speed > 0);
  const visitedMachines = visitedRows.map((visit) => {
    const location = parseJson(visit.location_json, {});
    const rawLatitude = location.latitude ?? visit.machine_latitude;
    const rawLongitude = location.longitude ?? visit.machine_longitude;
    const latitude = rawLatitude === null || rawLatitude === undefined ? null : Number(rawLatitude);
    const longitude = rawLongitude === null || rawLongitude === undefined ? null : Number(rawLongitude);
    return {
      visitUuid: visit.visit_uuid,
      machineCode: visit.machine_code,
      machineName: visit.machine_name ?? '',
      regionName: visit.region_name,
      capturedAt: visit.captured_at,
      reviewStatus: visit.review_status ?? 'pending',
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
    };
  });

  return {
    success: true,
    representative: { id: Number(rep.id), username: rep.username, fullName: rep.full_name },
    date: day,
    polyline: points.map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      accuracy: Number(point.accuracy),
      speed: Number(point.speed),
      recordedAt: point.recorded_at,
    })),
    speedSummary: {
      averageKmh: speeds.length ? Math.round(speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length * 36) / 10 : 0,
      maxKmh: speeds.length ? Math.round(Math.max(...speeds) * 36) / 10 : 0,
    },
    visitedMachines,
    stops: stopRows.map((stop) => ({
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
      arrivedAt: stop.arrived_at,
      departedAt: stop.departed_at,
      durationMinutes: Number(stop.duration_minutes),
      name: stop.stop_name,
    })),
  };
}

export function getPendingVisitReviews(database = defaultDatabase) {
  const visits = database.prepare(`
    SELECT visit.id, visit.visit_uuid, visit.rep_user_id, user.full_name AS rep_name,
      visit.order_id, visit.card_id, visit.machine_id, visit.order_code, visit.machine_code,
      visit.region_name, visit.machine_condition, visit.reason_ids_json, visit.notes, visit.captured_at,
      visit.before_captured_at, visit.after_captured_at, visit.before_path, visit.after_path,
      machine.name_ar AS machine_name, client.address AS address,
      review.status, review.review_note, visit.created_at
    FROM rep_visits visit
    JOIN rep_visit_reviews review ON review.visit_id = visit.id
    JOIN users user ON user.id = visit.rep_user_id
    LEFT JOIN machines machine ON machine.id = visit.machine_id
    LEFT JOIN maintenance_orders order_record ON order_record.id = visit.order_id
    LEFT JOIN clients client ON client.id = order_record.client_id
    WHERE visit.status = 'completed' AND review.status = 'pending'
    ORDER BY datetime(visit.created_at), visit.id
  `).all();
  const reasonNames = database.prepare('SELECT id, name FROM maintenance_reasons WHERE active = 1').all();
  const namesById = new Map(reasonNames.map((reason) => [Number(reason.id), reason.name]));
  const photoRows = database.prepare(`
    SELECT visit_id, phase, ordinal, stored_path, captured_at
    FROM rep_visit_photos WHERE visit_id IN (${visits.map(() => '?').join(',') || 'NULL'})
    ORDER BY visit_id, phase, ordinal, id
  `).all(...visits.map((visit) => visit.id));
  const photosByVisit = new Map();
  for (const photo of photoRows) {
    if (!photosByVisit.has(Number(photo.visit_id))) photosByVisit.set(Number(photo.visit_id), { before: [], after: [] });
    photosByVisit.get(Number(photo.visit_id))[photo.phase].push(photo);
  }
  return visits.map((visit) => {
    const beforeMs = visit.before_captured_at ? new Date(visit.before_captured_at).valueOf() : NaN;
    const afterMs = visit.after_captured_at ? new Date(visit.after_captured_at).valueOf() : NaN;
    const storedPhotos = photosByVisit.get(Number(visit.id)) ?? { before: [], after: [] };
    const beforePhotos = storedPhotos.before.length ? storedPhotos.before : (visit.before_path ? [{ ordinal: 0, stored_path: visit.before_path, captured_at: visit.before_captured_at ?? visit.captured_at }] : []);
    const afterPhotos = storedPhotos.after.length ? storedPhotos.after : (visit.after_path ? [{ ordinal: 0, stored_path: visit.after_path, captured_at: visit.after_captured_at ?? visit.captured_at }] : []);
    const photoUrl = (phase, photo, index) => `/api/supervisor/visits/${visit.id}/photos/${phase}/${index + 1}`;
    return {
      id: Number(visit.id), visitUuid: visit.visit_uuid, repId: Number(visit.rep_user_id), repName: visit.rep_name,
      orderId: Number(visit.order_id), cardId: Number(visit.card_id), machineId: Number(visit.machine_id),
      orderCode: visit.order_code, machineCode: visit.machine_code, machineName: visit.machine_name ?? `ماكينة ${visit.machine_code}`,
      regionName: visit.region_name, address: visit.address ?? '', machineCondition: visit.machine_condition ?? 'working',
      reasonIds: parseJson(visit.reason_ids_json, []), reasonNames: parseJson(visit.reason_ids_json, []).map((id) => namesById.get(Number(id))).filter(Boolean),
      notes: visit.notes ?? '', capturedAt: visit.captured_at,
      beforeCapturedAt: visit.before_captured_at, afterCapturedAt: visit.after_captured_at,
      siteDurationSeconds: Number.isFinite(beforeMs) && Number.isFinite(afterMs) && afterMs >= beforeMs
        ? Math.floor((afterMs - beforeMs) / 1000) : null,
      reviewNote: visit.review_note,
      beforePhotos: beforePhotos.map((photo, index) => ({
        url: photoUrl('before', photo, index), capturedAt: photo.captured_at ?? visit.before_captured_at ?? visit.captured_at,
      })),
      afterPhotos: afterPhotos.map((photo, index) => ({
        url: photoUrl('after', photo, index), capturedAt: photo.captured_at ?? visit.after_captured_at ?? visit.captured_at,
      })),
      beforePhotoUrl: photoUrl('before', beforePhotos[0], 0),
      afterPhotoUrl: afterPhotos.length ? photoUrl('after', afterPhotos[0], 0) : null,
      createdAt: visit.created_at,
    };
  });
}

export async function getSupervisorVisitPhoto(visitIdInput, phase, ordinalInput = null, database = defaultDatabase) {
  const visitId = positiveId(Number(visitIdInput), 'visitId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'phase must be before or after.');
  const visit = database.prepare(`
    SELECT visit.before_path, visit.after_path, visit.before_captured_at, visit.after_captured_at, visit.captured_at
    FROM rep_visits visit
    JOIN rep_visit_reviews review ON review.visit_id = visit.id
    WHERE visit.id = ? AND visit.status = 'completed'
  `).get(visitId);
  if (!visit) throw new HttpError(404, 'Visit photo was not found.');
  let storedPath;
  if (ordinalInput !== null && ordinalInput !== undefined) {
    const ordinal = positiveId(Number(ordinalInput), 'ordinal') - 1;
    storedPath = database.prepare(`
      SELECT stored_path FROM rep_visit_photos WHERE visit_id = ? AND phase = ? AND ordinal = ?
    `).get(visitId, phase, ordinal)?.stored_path;
  } else {
    storedPath = database.prepare(`
      SELECT stored_path FROM rep_visit_photos WHERE visit_id = ? AND phase = ? ORDER BY ordinal, id LIMIT 1
    `).get(visitId, phase)?.stored_path ?? (phase === 'before' ? visit.before_path : visit.after_path);
  }
  if (!storedPath) throw new HttpError(404, 'Visit photo was not found.');
  return resolveStorageFile(storedPath);
}

export function reviewRepVisit(visitIdInput, input, actorId, database = defaultDatabase) {
  const visitId = positiveId(Number(visitIdInput), 'visitId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['action', 'note']);
  if (!['approve', 'reshoot'].includes(body.action)) throw new HttpError(400, 'action must be approve or reshoot.');
  const note = optionalText(body.note, 'note', { maxLength: 1000 });
  if (body.action === 'reshoot' && !note) throw new HttpError(400, 'A short note is required when requesting new photos.');
  return database.transaction(() => {
    const visit = database.prepare(`
      SELECT visit.*, review.status AS review_status, review.review_note AS previous_review_note,
        card.before_photos_json, card.after_photos_json, card.reason_id AS card_reason_id,
        card.reason_ids_json AS card_reason_ids_json,
        card.notes AS card_notes, card.status AS card_status,
        order_record.status AS order_status, order_record.deleted_at AS order_deleted_at,
        machine.deleted_at AS machine_deleted_at
      FROM rep_visits visit
      JOIN rep_visit_reviews review ON review.visit_id = visit.id
      LEFT JOIN maintenance_cards card ON card.id = visit.card_id
      LEFT JOIN maintenance_orders order_record ON order_record.id = visit.order_id
      LEFT JOIN machines machine ON machine.id = visit.machine_id
      WHERE visit.id = ? AND visit.status = 'completed'
    `).get(visitId);
    if (!visit) throw new HttpError(404, 'Field visit was not found.');
    if (visit.review_status !== 'pending') throw new HttpError(409, 'This visit has already been reviewed.');

    if (body.action === 'reshoot') {
      database.prepare(`
        UPDATE rep_visit_reviews SET status = 'reshoot', review_note = ?, reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP WHERE visit_id = ? AND status = 'pending'
      `).run(note, actorId, visitId);
      recordAudit({ database, actorId, action: 'request_reshoot', entityType: 'rep_visit', entityId: visitId,
        oldValues: { status: 'pending' }, newValues: { status: 'reshoot', note } });
      return { success: true, status: 'reshoot_requested', visitId, repUserId: Number(visit.rep_user_id) };
    }

    if (!visit.card_id || !visit.before_photos_json || !visit.after_photos_json || visit.order_deleted_at
        || visit.order_status === 'archived' || visit.card_status === 'excluded' || visit.machine_deleted_at) {
      throw new HttpError(409, 'The maintenance card is no longer available for approval.');
    }
    const beforePhotos = parseJson(visit.before_photos_json, []);
    const afterPhotos = parseJson(visit.after_photos_json, []);
    const oldReasonIds = parseJson(visit.card_reason_ids_json, []);
    const incomingReasons = parseJson(visit.reason_ids_json, []);
    const reasonIds = [...new Set([
      ...oldReasonIds.filter((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0).map(Number),
      ...(visit.card_reason_id ? [Number(visit.card_reason_id)] : []),
      ...incomingReasons.filter((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0).map(Number),
    ])];
    const receivedPhotos = database.prepare(`
      SELECT phase, stored_path FROM rep_visit_photos WHERE visit_id = ? ORDER BY phase, ordinal, id
    `).all(visitId);
    const incomingBefore = receivedPhotos.filter((photo) => photo.phase === 'before').map((photo) => photo.stored_path);
    const incomingAfter = receivedPhotos.filter((photo) => photo.phase === 'after').map((photo) => photo.stored_path);
    if (!incomingBefore.length && visit.before_path) incomingBefore.push(visit.before_path);
    if (!incomingAfter.length && visit.after_path) incomingAfter.push(visit.after_path);
    const nextBefore = [...new Set([...beforePhotos, ...incomingBefore])];
    const nextAfter = [...new Set([...afterPhotos, ...incomingAfter])];
    let notes = visit.card_notes;
    if (visit.notes) {
      const visitNote = `[مندوب · ${visit.captured_at}] ${visit.notes}`;
      notes = notes ? `${notes}\n${visitNote}` : visitNote;
      if (notes.length > 10000) throw new HttpError(409, 'The maintenance-card notes are full.');
    }
    const changed = database.prepare(`
      UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?,
        reason_ids_json = ?, reason_id = ?, notes = ?, status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND order_id = ? AND deleted_at IS NULL AND status != 'excluded'
    `).run(JSON.stringify(nextBefore), JSON.stringify(nextAfter), JSON.stringify(reasonIds), reasonIds[0] ?? null,
      notes, visit.card_id, visit.order_id);
    if (changed.changes !== 1) throw new HttpError(409, 'The maintenance card changed before approval.');
    database.prepare(`
      UPDATE rep_visit_reviews SET status = 'approved', review_note = ?, reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP WHERE visit_id = ? AND status = 'pending'
    `).run(note, actorId, visitId);
    recordAudit({ database, actorId, action: 'photo_upload', entityType: 'maintenance_card', entityId: visit.card_id,
      oldValues: { before: beforePhotos, after: afterPhotos },
      newValues: { before: nextBefore, after: nextAfter, visit_uuid: visit.visit_uuid, captured_at: visit.captured_at } });
    recordAudit({ database, actorId, action: 'approve', entityType: 'rep_visit', entityId: visitId,
      oldValues: { status: 'pending', card_status: visit.card_status, reason_ids: oldReasonIds },
      newValues: { status: 'approved', card_status: 'completed', reason_ids: reasonIds, note } });
    return { success: true, status: 'approved', visitId, cardId: Number(visit.card_id), repUserId: Number(visit.rep_user_id) };
  }).immediate();
}

export function buildApprovedVisitsWorkbook(dayInput, database = defaultDatabase) {
  const range = dayRange(dayInput, database);
  const visits = database.prepare(`
    SELECT visit.machine_code, machine.name_ar AS machine_name, visit.region_name,
      visit.order_code, user.full_name AS rep_name, visit.captured_at,
      visit.before_captured_at, visit.after_captured_at, visit.reason_ids_json, visit.notes
    FROM rep_visits visit
    JOIN rep_visit_reviews review ON review.visit_id = visit.id
    JOIN users user ON user.id = visit.rep_user_id
    LEFT JOIN machines machine ON machine.id = visit.machine_id
    WHERE review.status = 'approved' AND datetime(visit.created_at) >= datetime(?) AND datetime(visit.created_at) < datetime(?)
    ORDER BY visit.created_at, visit.id
  `).all(range.start, range.end);
  const arabicOrder = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });
  visits.sort((left, right) => arabicOrder.compare(left.region_name ?? '', right.region_name ?? '')
    || arabicOrder.compare(left.machine_name ?? left.machine_code, right.machine_name ?? right.machine_code)
    || arabicOrder.compare(left.machine_code, right.machine_code));
  const reasons = database.prepare('SELECT id, name FROM maintenance_reasons').all();
  const reasonsById = new Map(reasons.map((reason) => [Number(reason.id), reason.name]));
  const rows = [
    [`زيارات الصيانة المعتمدة — ${range.day}`],
    ['هذا التقرير يشمل الزيارات التي اعتمدها المشرف فقط. مدة الموقع والمسافة تقديرية حسب أوقات GPS المسجلة.'],
    ['المنطقة', 'كود الماكينة', 'اسم الماكينة', 'أمر الصيانة', 'المندوب', 'وقت الزيارة', 'مدة الموقع (دقيقة)', 'أسباب الصيانة', 'ملاحظة'],
  ];
  for (const visit of visits) {
    const before = visit.before_captured_at ? new Date(visit.before_captured_at).valueOf() : NaN;
    const after = visit.after_captured_at ? new Date(visit.after_captured_at).valueOf() : NaN;
    const duration = Number.isFinite(before) && Number.isFinite(after) && after >= before ? Math.round((after - before) / 60000) : '';
    const visitReasons = parseJson(visit.reason_ids_json, []).map((id) => reasonsById.get(Number(id))).filter(Boolean).join('، ');
    rows.push([visit.region_name, visit.machine_code, visit.machine_name ?? `ماكينة ${visit.machine_code}`,
      visit.order_code, visit.rep_name, visit.captured_at, duration, visitReasons, visit.notes ?? '']);
  }
  rows.splice(2, 0, ['الإجمالي', visits.length]);
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const lastColumn = rows[3].length - 1;
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
  ];
  worksheet['!cols'] = [
    { wch: 20 }, { wch: 16 }, { wch: 30 }, { wch: 20 }, { wch: 24 },
    { wch: 24 }, { wch: 18 }, { wch: 36 }, { wch: 42 },
  ];
  worksheet['!rows'] = [{ hpt: 30 }, { hpt: 28 }, { hpt: 24 }, { hpt: 34 }];
  worksheet['!pageSetup'] = { paperSize: '9', orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
  worksheet['!margins'] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: Math.max(3, rows.length - 1), c: lastColumn } }) };
  const titleStyle = { fill: { fgColor: { rgb: '0F766E' } }, font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 16 }, alignment: { horizontal: 'right', vertical: 'center' } };
  const subtitleStyle = { fill: { fgColor: { rgb: 'E2E8F0' } }, font: { color: { rgb: '334155' }, italic: true }, alignment: { horizontal: 'right', vertical: 'center', wrapText: true } };
  const headerStyle = { fill: { fgColor: { rgb: '1E293B' } }, font: { color: { rgb: 'FFFFFF' }, bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
  for (let column = 0; column <= lastColumn; column += 1) {
    const title = worksheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    const subtitle = worksheet[XLSX.utils.encode_cell({ r: 1, c: column })];
    const header = worksheet[XLSX.utils.encode_cell({ r: 3, c: column })];
    if (title) title.s = titleStyle;
    if (subtitle) subtitle.s = subtitleStyle;
    if (header) header.s = headerStyle;
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'الزيارات المعتمدة');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true });
}
