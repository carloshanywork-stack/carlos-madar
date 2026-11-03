import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { allowOnlyKeys, HttpError, optionalText, positiveId, requireObject, requireText } from '../http.js';
import {
  ensureStorageDirectory,
  moveStorageDirectory,
  removeStorageDirectory,
  storageDirectory,
  writeStorageFile,
} from '../storage.js';

const DEFAULT_TIME_ZONE = 'Asia/Riyadh';

function regionKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ar');
}

function parsePhotoList(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function compareArabic(left, right) {
  return left.localeCompare(right, 'ar', { numeric: true, sensitivity: 'base' });
}

function getTimeZone(database) {
  const configured = database.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()?.value;
  if (typeof configured === 'string' && configured.trim()) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());
      return configured;
    } catch {
      // A damaged setting should not prevent route sync; use the ERP's default zone.
    }
  }
  return DEFAULT_TIME_ZONE;
}

function getLocalDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, Number(value)]));
}

function zonedMidnightUtc({ year, month, day }, timeZone) {
  const desiredUtc = Date.UTC(year, month - 1, day);
  let timestamp = desiredUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  // Correct the UTC guess by the offset observed in the selected business zone.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]));
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const correction = desiredUtc - representedUtc;
    timestamp += correction;
    if (correction === 0) break;
  }
  return new Date(timestamp);
}

function getBusinessDayRange(database, now = new Date()) {
  const timeZone = getTimeZone(database);
  const today = getLocalDateParts(now, timeZone);
  const tomorrowDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const tomorrow = {
    year: tomorrowDate.getUTCFullYear(),
    month: tomorrowDate.getUTCMonth() + 1,
    day: tomorrowDate.getUTCDate(),
  };
  return {
    start: zonedMidnightUtc(today, timeZone).toISOString(),
    end: zonedMidnightUtc(tomorrow, timeZone).toISOString(),
  };
}

export function getRepTodayRoute(rep, database = db) {
  const assignedRegions = Array.isArray(rep?.assignedRegions) ? rep.assignedRegions : [];
  const assignedByKey = new Map(assignedRegions.map((name) => [regionKey(name), name]));
  if (!assignedByKey.size) {
    return {
      success: true,
      summary: { totalMachines: 0, completed: 0, pending: 0, pendingReview: 0, progress: 0 },
      regions: [],
    };
  }

  const { start: dayStart, end: dayEnd } = getBusinessDayRange(database);
  const cards = database.prepare(`
    SELECT order_record.id AS order_id, order_record.order_code, order_record.status AS order_status,
      card.id AS card_id, card.before_photos_json, card.after_photos_json,
      machine.id AS machine_id, machine.code AS machine_code,
      machine.name_ar AS machine_name_ar, machine.area AS region_name,
      client.address AS client_address
    FROM maintenance_orders order_record
    JOIN clients client ON client.id = order_record.client_id
    JOIN maintenance_cards card ON card.order_id = order_record.id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.deleted_at IS NULL
      AND client.deleted_at IS NULL
      AND card.deleted_at IS NULL
      AND card.status != 'excluded'
      AND machine.active = 1 AND machine.deleted_at IS NULL
      AND (
        order_record.status IN ('in_progress', 'review')
        OR (order_record.status = 'archived'
          AND datetime(order_record.archived_at) >= datetime(?)
          AND datetime(order_record.archived_at) < datetime(?))
      )
    ORDER BY machine.area COLLATE NOCASE, machine.code COLLATE NOCASE,
      order_record.created_at DESC, order_record.id DESC, card.id DESC
  `).all(dayStart, dayEnd);

  const visitReviews = database.prepare(`
    SELECT visit.card_id, review.status AS review_status, review.review_note, visit.visit_uuid
    FROM rep_visits visit
    JOIN rep_visit_reviews review ON review.visit_id = visit.id
    WHERE visit.status = 'completed'
    ORDER BY datetime(visit.created_at) DESC, visit.id DESC
  `).all();
  const reviewByCard = new Map();
  for (const visit of visitReviews) {
    if (!reviewByCard.has(Number(visit.card_id))) reviewByCard.set(Number(visit.card_id), visit);
  }
  const uploadedToday = new Set(database.prepare(`
    SELECT DISTINCT entity_id FROM audit_log
    WHERE action = 'photo_upload' AND entity_type = 'maintenance_card'
      AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
  `).all(dayStart, dayEnd).map((row) => Number(row.entity_id)));

  const regionsByKey = new Map();
  const seenMachineIds = new Set();
  let totalMachines = 0;
  let completed = 0;
  let pendingReview = 0;
  for (const row of cards) {
    const key = regionKey(row.region_name);
    if (!assignedByKey.has(key)) continue;
    if (seenMachineIds.has(Number(row.machine_id))) continue;
    seenMachineIds.add(Number(row.machine_id));
    const beforePhotos = parsePhotoList(row.before_photos_json);
    const afterPhotos = parsePhotoList(row.after_photos_json);
    const latestVisit = reviewByCard.get(Number(row.card_id));
    const isCompleted = latestVisit
      ? latestVisit.review_status === 'approved'
      : uploadedToday.has(Number(row.card_id)) && beforePhotos.length > 0 && afterPhotos.length > 0;
    const isSubmitted = Boolean(latestVisit && latestVisit.review_status !== 'reshoot');
    const regionName = assignedByKey.get(key);
    if (!regionsByKey.has(key)) regionsByKey.set(key, { regionName, machines: [] });
    regionsByKey.get(key).machines.push({
      machineCode: row.machine_code,
      arabicName: row.machine_name_ar,
      address: row.client_address ?? '',
      isCompleted,
      isSubmitted,
      reviewStatus: latestVisit?.review_status ?? null,
      reviewNote: latestVisit?.review_status === 'reshoot' ? latestVisit.review_note : null,
      cardId: Number(row.card_id),
      canVisit: row.order_status !== 'archived' && !isCompleted && !isSubmitted,
    });
    totalMachines += 1;
    if (isCompleted) completed += 1;
    if (latestVisit?.review_status === 'pending') pendingReview += 1;
  }

  const regions = [...regionsByKey.values()]
    .map((region) => ({
      ...region,
      machines: region.machines.sort((left, right) => compareArabic(left.machineCode, right.machineCode)),
    }))
    .sort((left, right) => compareArabic(left.regionName, right.regionName));
  const pending = totalMachines - completed;

  return {
    success: true,
    summary: {
      totalMachines,
      completed,
      pending,
      pendingReview,
      progress: totalMachines ? Math.floor((completed / totalMachines) * 100) : 0,
    },
    regions,
  };
}

function normalizeVisitInput(input) {
  const body = requireObject(input, 'visit');
  allowOnlyKeys(body, [
    'visitUuid', 'cardId', 'machineCode', 'regionName', 'reasonIds', 'notes',
    'capturedAt', 'beforeCapturedAt', 'afterCapturedAt', 'location',
  ]);
  const visitUuid = requireText(body.visitUuid, 'visitUuid', { maxLength: 36 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitUuid)) {
    throw new HttpError(400, 'visitUuid must be a valid UUID.');
  }
  const cardId = positiveId(body.cardId, 'cardId');
  const machineCode = requireText(body.machineCode, 'machineCode', { maxLength: 64 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(machineCode)) {
    throw new HttpError(400, 'machineCode contains unsupported characters.');
  }
  const regionName = requireText(body.regionName, 'regionName', { maxLength: 160 });
  if (!Array.isArray(body.reasonIds) || body.reasonIds.length > 50) {
    throw new HttpError(400, 'reasonIds must be an array containing at most 50 reason IDs.');
  }
  const reasonIds = [...new Set(body.reasonIds.map((id, index) => positiveId(id, `reasonIds[${index}]`)))];
  const notes = optionalText(body.notes, 'notes', { maxLength: 10000 });
  const capturedAt = requireText(body.capturedAt, 'capturedAt', { maxLength: 64 });
  const capturedDate = new Date(capturedAt);
  if (Number.isNaN(capturedDate.valueOf())) throw new HttpError(400, 'capturedAt must be a valid date and time.');

  let location = null;
  if (body.location !== undefined && body.location !== null) {
    const suppliedLocation = requireObject(body.location, 'location');
    allowOnlyKeys(suppliedLocation, ['latitude', 'longitude', 'accuracy', 'updatedAt']);
    const { latitude, longitude, accuracy } = suppliedLocation;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
        || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000) {
      throw new HttpError(400, 'location must contain valid latitude, longitude, and accuracy values.');
    }
    const updatedAt = requireText(suppliedLocation.updatedAt, 'location.updatedAt', { maxLength: 64 });
    if (Number.isNaN(new Date(updatedAt).valueOf())) throw new HttpError(400, 'location.updatedAt must be a valid date and time.');
    location = { latitude, longitude, accuracy, updatedAt };
  }

  return {
    visitUuid: visitUuid.toLowerCase(),
    cardId,
    machineCode,
    regionName,
    reasonIds,
    notes,
    capturedAt: capturedDate.toISOString(),
    beforeCapturedAt: parseCapturedTimestamp(body.beforeCapturedAt, capturedDate, 'beforeCapturedAt'),
    afterCapturedAt: parseCapturedTimestamp(body.afterCapturedAt, capturedDate, 'afterCapturedAt'),
    location,
  };
}

function parseCapturedTimestamp(value, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback.toISOString();
  const text = requireText(value, field, { maxLength: 64 });
  const date = new Date(text);
  if (Number.isNaN(date.valueOf())) throw new HttpError(400, `${field} must be a valid date and time.`);
  return date.toISOString();
}

async function prepareVisitImage(file, label) {
  if (!file?.buffer?.length) throw new HttpError(400, `A ${label} photo is required.`);
  try {
    const metadata = await sharp(file.buffer, { limitInputPixels: 40000000 }).metadata();
    if (!['jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height) {
      throw new HttpError(400, `${label} photo must be a valid JPEG or WebP image.`);
    }
    return await sharp(file.buffer, { limitInputPixels: 40000000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `${label} photo could not be decoded.`);
  }
}

function visitPayloadHash(repId, visit, beforeBuffer, afterBuffer) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ repId, ...visit }));
  hash.update(`\0${beforeBuffer.length}\0`).update(beforeBuffer);
  hash.update(`\0${afterBuffer.length}\0`).update(afterBuffer);
  return hash.digest('hex');
}

function visitResult(row, database = db, { idempotent = false, processing = false } = {}) {
  if (processing) {
    return { success: false, status: 'processing', visitUuid: row.visit_uuid, retryAfterMs: 1500 };
  }
  const reviewStatus = database.prepare('SELECT status FROM rep_visit_reviews WHERE visit_id = ?').get(row.id)?.status ?? 'pending';
  return {
    success: true,
    status: reviewStatus === 'approved' ? 'approved' : reviewStatus === 'reshoot' ? 'reshoot_requested' : 'pending_review',
    visitUuid: row.visit_uuid,
    machineCode: row.machine_code,
    idempotent,
  };
}

function findVisit(visitUuid, database) {
  return database.prepare('SELECT * FROM rep_visits WHERE visit_uuid = ?').get(visitUuid);
}

function requireVisitOwner(existing, repId, payloadHash) {
  if (Number(existing.rep_user_id) !== Number(repId) || existing.payload_sha256 !== payloadHash) {
    throw new HttpError(409, 'This visit UUID was already used with different content.');
  }
}

function findRepVisitCard(rep, visit, database) {
  const card = database.prepare(`
    SELECT card.id AS card_id, card.order_id, card.machine_id, card.before_photos_json,
      card.after_photos_json, card.reason_id, card.reason_ids_json, card.notes AS card_notes,
      card.status AS card_status, order_record.order_code, order_record.status AS order_status,
      client.code AS client_code, client.deleted_at AS client_deleted_at,
      machine.code AS machine_code, machine.area AS machine_area, machine.active AS machine_active,
      machine.deleted_at AS machine_deleted_at
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE card.id = ? AND card.deleted_at IS NULL AND order_record.deleted_at IS NULL
  `).get(visit.cardId);
  if (!card || card.client_deleted_at || card.machine_deleted_at || !card.machine_active
      || card.card_status === 'excluded' || card.order_status === 'archived') {
    throw new HttpError(409, 'This machine visit is no longer available on the active route.');
  }
  const assigned = new Set((rep.assignedRegions ?? []).map(regionKey));
  if (!assigned.has(regionKey(card.machine_area))) {
    throw new HttpError(403, 'This machine is outside your assigned regions.');
  }
  if (regionKey(visit.regionName) !== regionKey(card.machine_area)
      || visit.machineCode.normalize('NFKC').toLocaleLowerCase('en-US')
        !== card.machine_code.normalize('NFKC').toLocaleLowerCase('en-US')) {
    throw new HttpError(409, 'The selected machine changed since this route was downloaded. Refresh the route and try again.');
  }
  if (visit.reasonIds.length) {
    const placeholders = visit.reasonIds.map(() => '?').join(',');
    const rows = database.prepare(`SELECT id, active FROM maintenance_reasons WHERE id IN (${placeholders})`)
      .all(...visit.reasonIds);
    const activeIds = new Set(rows.filter((row) => row.active).map((row) => Number(row.id)));
    if (visit.reasonIds.some((id) => !activeIds.has(id))) {
      throw new HttpError(409, 'One or more selected maintenance reasons are no longer active. Refresh the reasons and try again.');
    }
  }
  return card;
}

async function cleanupVisitFiles(row) {
  await removeStorageDirectory(row.staging_path);
  await removeStorageDirectory(row.final_path);
}

function createVisitReservation(rep, visit, payloadHash, card, stagingPath, finalPath, database) {
  return database.transaction(() => {
    const existing = findVisit(visit.visitUuid, database);
    if (existing) {
      requireVisitOwner(existing, rep.id, payloadHash);
      if (existing.status === 'completed') return { row: existing, kind: 'completed' };
      if (existing.status === 'receiving') return { row: existing, kind: 'processing' };
      database.prepare(`
        UPDATE rep_visits SET status = 'receiving', failure_message = NULL,
          staging_path = ?, final_path = ?, before_path = NULL, after_path = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'failed'
      `).run(stagingPath, finalPath, existing.id);
      return { row: findVisit(visit.visitUuid, database), kind: 'reserved' };
    }

    const result = database.prepare(`
      INSERT INTO rep_visits (
        visit_uuid, rep_user_id, order_id, card_id, machine_id, order_code, machine_code,
        region_name, payload_sha256, status, reason_ids_json, notes, captured_at,
        before_captured_at, after_captured_at, location_json, staging_path, final_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'receiving', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      visit.visitUuid, rep.id, card.order_id, card.card_id, card.machine_id, card.order_code,
      card.machine_code, card.machine_area, payloadHash, JSON.stringify(visit.reasonIds),
      visit.notes, visit.capturedAt, visit.beforeCapturedAt, visit.afterCapturedAt,
      visit.location ? JSON.stringify(visit.location) : null,
      stagingPath, finalPath,
    );
    return { row: findVisit(visit.visitUuid, database), kind: 'reserved', id: Number(result.lastInsertRowid) };
  }).immediate();
}

function recordReceivedVisit(rep, visit, visitId, beforePath, afterPath, database) {
  return database.transaction(() => {
    database.prepare(`
      UPDATE rep_visits SET status = 'completed', before_path = ?, after_path = ?,
        failure_message = NULL, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'receiving'
    `).run(beforePath, afterPath, visitId);
    database.prepare(`
      INSERT INTO rep_visit_reviews (visit_id, status)
      VALUES (?, 'pending')
      ON CONFLICT(visit_id) DO UPDATE SET status = 'pending', review_note = NULL,
        reviewed_by = NULL, reviewed_at = NULL
    `).run(visitId);
    recordAudit({
      database,
      actorId: rep.id,
      action: 'create',
      entityType: 'rep_visit',
      entityId: visitId,
      newValues: {
        visit_uuid: visit.visitUuid,
        machine_code: visit.machineCode,
        region_name: visit.regionName,
        card_id: visit.cardId,
        reason_ids: visit.reasonIds,
        captured_at: visit.capturedAt,
        before_captured_at: visit.beforeCapturedAt,
        after_captured_at: visit.afterCapturedAt,
        location: visit.location,
        review_status: 'pending',
      },
    });
    return findVisit(visit.visitUuid, database);
  }).immediate();
}

/** Receive one immutable visit bundle; UUID + content hash makes retries safe. */
export async function syncRepVisit(rep, input, files, database = db) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const visit = normalizeVisitInput(input);
  const beforeBuffer = await prepareVisitImage(files?.beforePhoto, 'before');
  const afterBuffer = await prepareVisitImage(files?.afterPhoto, 'after');
  const payloadHash = visitPayloadHash(rep.id, visit, beforeBuffer, afterBuffer);

  let existing = findVisit(visit.visitUuid, database);
  if (existing) {
    requireVisitOwner(existing, rep.id, payloadHash);
    if (existing.status === 'completed') return visitResult(existing, database, { idempotent: true });
    if (existing.status === 'receiving') return visitResult(existing, database, { processing: true });
    await cleanupVisitFiles(existing);
  }

  const card = findRepVisitCard(rep, visit, database);
  const stagingPath = storageDirectory('.madar-recovery', 'rep-visits', visit.visitUuid);
  const finalPath = storageDirectory(
    'clients', card.client_code, 'maintenance', card.order_code, card.machine_code, 'visits', visit.visitUuid,
  );
  const reservation = createVisitReservation(rep, visit, payloadHash, card, stagingPath, finalPath, database);
  if (reservation.kind === 'completed') return visitResult(reservation.row, database, { idempotent: true });
  if (reservation.kind === 'processing') return visitResult(reservation.row, database, { processing: true });

  const beforePath = storageDirectory(finalPath, `${visit.visitUuid}-before.jpg`);
  const afterPath = storageDirectory(finalPath, `${visit.visitUuid}-after.jpg`);
  let finalDirectoryMoved = false;
  try {
    await ensureStorageDirectory('.madar-recovery', 'rep-visits', visit.visitUuid);
    await writeStorageFile(storageDirectory(stagingPath, `${visit.visitUuid}-before.jpg`), beforeBuffer);
    await writeStorageFile(storageDirectory(stagingPath, `${visit.visitUuid}-after.jpg`), afterBuffer);
    await ensureStorageDirectory('clients', card.client_code, 'maintenance', card.order_code, card.machine_code, 'visits');
    await moveStorageDirectory(stagingPath, finalPath);
    finalDirectoryMoved = true;

    const completedVisit = recordReceivedVisit(rep, visit, reservation.row.id, beforePath, afterPath, database);
    return visitResult(completedVisit, database);
  } catch (error) {
    try {
      await cleanupVisitFiles(reservation.row);
      database.prepare(`
        UPDATE rep_visits SET status = 'failed', failure_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'receiving'
      `).run(String(error.message ?? 'Visit ingestion failed').slice(0, 500), reservation.row.id);
    } catch (cleanupError) {
      // Keep the row in 'receiving'; startup recovery will finish cleanup before serving requests.
      console.error(`Rep visit ${visit.visitUuid} cleanup is pending: ${cleanupError.message}`);
    }
    throw error;
  } finally {
    if (finalDirectoryMoved) {
      // The final directory is retained only after the completion transaction succeeds.
      const completed = database.prepare('SELECT status FROM rep_visits WHERE id = ?').get(reservation.row.id);
      if (completed?.status !== 'completed') {
        try { await removeStorageDirectory(finalPath); } catch (error) {
          console.error(`Rep visit ${visit.visitUuid} final-file cleanup is pending: ${error.message}`);
        }
      }
    }
  }
}

/** Roll back interrupted file/DB handoffs before the API starts accepting requests. */
function normalizeTrackPoint(value, label = 'location') {
  const point = requireObject(value, label);
  allowOnlyKeys(point, ['latitude', 'longitude', 'accuracy', 'updatedAt', 'timestamp', 'mocked', 'is_mock']);
  for (const flag of ['mocked', 'is_mock']) {
    if (point[flag] !== undefined && typeof point[flag] !== 'boolean') {
      throw new HttpError(400, `${label}.${flag} must be a boolean.`);
    }
  }
  const { latitude, longitude, accuracy } = point;
  const rawTimestamp = point.updatedAt ?? (Number.isFinite(point.timestamp) ? new Date(point.timestamp).toISOString() : null);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000) {
    throw new HttpError(400, `${label} must contain valid latitude, longitude, and accuracy values.`);
  }
  const updatedAt = requireText(rawTimestamp, `${label}.updatedAt`, { maxLength: 64 });
  const timestamp = new Date(updatedAt);
  if (Number.isNaN(timestamp.valueOf())) throw new HttpError(400, `${label}.updatedAt must be a valid date and time.`);
  if (point.mocked === true || point.is_mock === true) {
    throw new HttpError(400, 'Mock GPS locations cannot be synchronized.');
  }
  return { latitude, longitude, accuracy, updatedAt: timestamp.toISOString() };
}

/** Persist duty state and idempotent GPS breadcrumbs reported by a representative device. */
export function syncRepTracking(rep, input, database = db) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const body = requireObject(input);
  allowOnlyKeys(body, ['onDuty', 'location', 'trail', 'is_mock']);
  if (typeof body.onDuty !== 'boolean') throw new HttpError(400, 'onDuty must be a boolean.');
  if (body.is_mock !== undefined && typeof body.is_mock !== 'boolean') {
    throw new HttpError(400, 'is_mock must be a boolean.');
  }
  if (body.is_mock === true) throw new HttpError(400, 'Mock GPS locations cannot be synchronized.');
  const location = body.location == null ? null : normalizeTrackPoint(body.location);
  if (body.trail !== undefined && (!Array.isArray(body.trail) || body.trail.length > 500)) {
    throw new HttpError(400, 'trail must contain no more than 500 GPS points.');
  }
  const trail = (body.trail ?? []).map((point, index) => normalizeTrackPoint(point, `trail[${index}]`));
  const now = new Date().toISOString();
  const create = database.transaction(() => {
    let session = database.prepare(`
      SELECT id, started_at FROM rep_duty_sessions WHERE rep_user_id = ? AND ended_at IS NULL
    `).get(rep.id);
    if (body.onDuty && !session) {
      const startedAt = location?.updatedAt ?? now;
      const result = database.prepare(`
        INSERT INTO rep_duty_sessions (rep_user_id, started_at, start_location_json)
        VALUES (?, ?, ?)
      `).run(rep.id, startedAt, location ? JSON.stringify(location) : null);
      session = { id: Number(result.lastInsertRowid), started_at: startedAt };
      recordAudit({ database, actorId: rep.id, action: 'start_duty', entityType: 'rep_duty_session', entityId: session.id,
        newValues: { started_at: startedAt, location } });
    }
    let pointSessionId = session?.id ?? null;
    if (!body.onDuty && session) {
      database.prepare(`
        UPDATE rep_duty_sessions SET ended_at = ?, end_location_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND ended_at IS NULL
      `).run(now, location ? JSON.stringify(location) : null, session.id);
      pointSessionId = session.id;
      recordAudit({ database, actorId: rep.id, action: 'stop_duty', entityType: 'rep_duty_session', entityId: session.id,
        oldValues: { started_at: session.started_at }, newValues: { ended_at: now, location } });
      session = null;
    }

    const points = [...trail, ...(location ? [location] : [])];
    const insertPoint = database.prepare(`
      INSERT OR IGNORE INTO rep_location_points
        (rep_user_id, duty_session_id, latitude, longitude, accuracy, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let acceptedPoints = 0;
    for (const point of points) {
      const ageMs = Date.now() - new Date(point.updatedAt).valueOf();
      if (ageMs > 24 * 60 * 60 * 1000 || ageMs < -5 * 60 * 1000) continue;
      if (pointSessionId !== null) {
        acceptedPoints += insertPoint.run(rep.id, pointSessionId, point.latitude, point.longitude, point.accuracy, point.updatedAt).changes;
      }
    }
    if (location) {
      database.prepare(`
        UPDATE users SET is_online = 1,
          last_location_json = CASE
            WHEN last_location_json IS NULL OR datetime(json_extract(last_location_json, '$.updatedAt')) <= datetime(?)
              THEN ? ELSE last_location_json END
        WHERE id = ? AND role = 'rep' AND active = 1 AND deleted_at IS NULL
      `).run(location.updatedAt, JSON.stringify(location), rep.id);
    }
    return { onDuty: Boolean(session), acceptedPoints, sessionId: session ? Number(session.id) : null };
  });
  return create.immediate();
}

export async function recoverRepVisitUploads(database = db) {
  const interrupted = database.prepare(`
    SELECT id, visit_uuid, staging_path, final_path
    FROM rep_visits WHERE status = 'receiving'
    ORDER BY id
  `).all();
  let recoveredCount = 0;
  for (const row of interrupted) {
    await cleanupVisitFiles(row);
    database.prepare(`
      UPDATE rep_visits SET status = 'failed', failure_message = 'Interrupted visit upload recovered at startup.',
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'receiving'
    `).run(row.id);
    recoveredCount += 1;
  }
  return { recoveredCount };
}

export function getRepFaultReasons(database = db) {
  const reasons = database.prepare(`
    SELECT id, name
    FROM maintenance_reasons
    WHERE active = 1
    ORDER BY name COLLATE NOCASE, id
  `).all();
  return { success: true, reasons };
}

export function requireRepUsername(queryValue, authenticatedUsername) {
  const username = requireText(queryValue, 'username', { maxLength: 64 });
  if (username.normalize('NFKC').toLocaleLowerCase('en-US')
      !== String(authenticatedUsername).normalize('NFKC').toLocaleLowerCase('en-US')) {
    throw new HttpError(403, 'A field representative may only request their own route.');
  }
  return username;
}
