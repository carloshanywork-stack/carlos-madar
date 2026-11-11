import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { publishOperationsEvent } from '../operations-events.js';
import { allowOnlyKeys, HttpError, optionalText, positiveId, requireObject, requireText } from '../http.js';
import { compressFieldImage } from '../upload.js';
import { withMachineStorageLock } from '../maintenance/deletion-lock.js';
import {
  ensureStorageDirectory,
  listStorageFiles,
  moveStorageFile,
  removeStorageFile,
  removeStorageDirectory,
  resolveStorageFile,
  storageDirectory,
  writeStorageFile,
} from '../storage.js';

const DEFAULT_TIME_ZONE = 'Africa/Cairo';
const MAX_TRACK_POINT_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_FIELD_CONFIRMATION_ACCURACY_METERS = 100;

function regionKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ar');
}

function hasUniversalAccess(assignedRegions) {
  if (!Array.isArray(assignedRegions) || assignedRegions.length === 0) return true;
  return assignedRegions.some((region) => ['*', 'all', 'الكل'].includes(regionKey(region)));
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

function actionUuid(value, label = 'actionUuid') {
  const uuid = requireText(value, label, { maxLength: 36 }).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new HttpError(400, `${label} must be a valid UUID.`);
  }
  return uuid;
}

function normalizeRepLocation(value, label = 'location') {
  const point = requireObject(value, label);
  allowOnlyKeys(point, ['latitude', 'longitude', 'accuracy', 'updatedAt']);
  const { latitude, longitude, accuracy } = point;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000) {
    throw new HttpError(400, `${label} must contain valid latitude, longitude, and accuracy values.`);
  }
  const updatedAt = requireText(point.updatedAt, `${label}.updatedAt`, { maxLength: 64 });
  const captured = new Date(updatedAt);
  if (Number.isNaN(captured.valueOf())) throw new HttpError(400, `${label}.updatedAt must be a valid date and time.`);
  return { latitude, longitude, accuracy, updatedAt: captured.toISOString() };
}

function safeStorageSegment(value, fallback = 'unknown') {
  const cleaned = String(value ?? '').normalize('NFKC').trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

export function calculateDistanceMeters(latitude1, longitude1, latitude2, longitude2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDifference = radians(latitude2 - latitude1);
  const longitudeDifference = radians(longitude2 - longitude1);
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function validateMachineGeofence(machine, location) {
  if (!location) throw new HttpError(400, 'يلزم تفعيل GPS وإرسال الموقع الحالي قبل رفع صور الزيارة.');
  const radius = Math.max(1, Number(machine.geofence_radius_meters) || 50);
  if (Number(machine.is_location_locked) !== 1
      || !Number.isFinite(machine.latitude) || !Number.isFinite(machine.longitude)) {
    throw new HttpError(409, 'يلزم تثبيت موقع الماكينة من الإدارة قبل التصوير؛ لا يمكن اعتماد أول زيارة كمرجع جغرافي.');
  }
  const distance = calculateDistanceMeters(location.latitude, location.longitude, machine.latitude, machine.longitude);
  const effectiveDistance = Math.max(0, distance - location.accuracy);
  if (effectiveDistance > radius) {
    throw new HttpError(403, `أنت خارج نطاق الماكينة (المسافة الفعالة: ${Math.round(effectiveDistance)} متر، المسموح: ${radius} متر).`);
  }
  return { distanceMeters: distance, effectiveDistanceMeters: effectiveDistance, radiusMeters: radius };
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
  const locationRequests = listLocationConfirmations({ repId: rep.id, status: 'all' }, database);
  const latestLocationByCard = new Map();
  for (const request of locationRequests) {
    if (!latestLocationByCard.has(request.cardId)) latestLocationByCard.set(request.cardId, request);
  }
  const assignedRegions = Array.isArray(rep?.assignedRegions) ? rep.assignedRegions : [];
  const isUniversal = hasUniversalAccess(rep?.assignedRegions);
  const assignedByKey = new Map(assignedRegions.map((name) => [regionKey(name), name]));

  const { start: dayStart, end: dayEnd } = getBusinessDayRange(database);
  const cards = database.prepare(`
    SELECT order_record.id AS order_id, order_record.order_code, order_record.status AS order_status,
      card.id AS card_id, card.before_photos_json, card.after_photos_json,
      machine.id AS machine_id, machine.code AS machine_code,
      machine.name_ar AS machine_name_ar, machine.area AS region_name,
      machine.area_name, machine.latitude, machine.longitude, machine.is_location_locked,
      machine.geofence_radius_meters,
      client.name AS client_name, client.address AS client_address
    FROM maintenance_orders order_record
    JOIN maintenance_order_reps assignment
      ON assignment.order_id = order_record.id AND assignment.user_id = ?
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
  `).all(rep.id, dayStart, dayEnd);

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
  const correctionPendingMachineIds = new Set(database.prepare(`
    SELECT DISTINCT machine_id FROM machine_correction_requests WHERE status = 'pending'
  `).all().map((row) => Number(row.machine_id)));

  const regionsByKey = new Map();
  let totalMachines = 0;
  let completed = 0;
  let pendingReview = 0;
  for (const row of cards) {
    const machineRegionKey = regionKey(row.region_name);
    if (!isUniversal && !assignedByKey.has(machineRegionKey)) continue;
    const regionName = isUniversal
      ? (row.area_name || row.region_name || 'المنطقة العامة')
      : assignedByKey.get(machineRegionKey);
    const groupKey = regionKey(regionName) || regionKey('المنطقة العامة');
    const beforePhotos = parsePhotoList(row.before_photos_json);
    const afterPhotos = parsePhotoList(row.after_photos_json);
    const latestVisit = reviewByCard.get(Number(row.card_id));
    const correctionPending = correctionPendingMachineIds.has(Number(row.machine_id));
    const isCompleted = latestVisit
      ? latestVisit.review_status === 'approved'
      // Legacy card photo uploads have no visit/review record; keep those complete only when both phases exist.
      // New visits use the supervisor-approved review above, where After photos are optional.
      : uploadedToday.has(Number(row.card_id)) && beforePhotos.length > 0 && afterPhotos.length > 0;
    const isSubmitted = Boolean(latestVisit && latestVisit.review_status !== 'reshoot');
    if (!regionsByKey.has(groupKey)) regionsByKey.set(groupKey, { regionName, machines: [] });
    regionsByKey.get(groupKey).machines.push({
      machineCode: row.machine_code,
      machineId: Number(row.machine_id),
      arabicName: row.machine_name_ar,
      workOrderId: Number(row.order_id),
      workOrderCode: row.order_code,
      clientName: row.client_name,
      address: row.client_address ?? '',
      areaName: row.area_name || row.region_name || 'المنطقة العامة',
      isCompleted,
      isSubmitted,
      reviewStatus: latestVisit?.review_status ?? null,
      reviewNote: latestVisit?.review_status === 'reshoot' ? latestVisit.review_note : null,
      correctionPending,
      locationConfirmation: latestLocationByCard.get(Number(row.card_id)) ?? null,
      approvedLocation: row.is_location_locked === 1 && row.latitude !== null && row.longitude !== null
        ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null,
      cardId: Number(row.card_id),
      canVisit: row.order_status !== 'archived' && !isCompleted && !isSubmitted && !correctionPending,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      isLocationLocked: Number(row.is_location_locked) === 1,
      geofenceRadiusMeters: Number(row.geofence_radius_meters) || 50,
    });
    totalMachines += 1;
    if (isCompleted) completed += 1;
    if (latestVisit?.review_status === 'pending') pendingReview += 1;
  }

  const regions = [...regionsByKey.values()]
    .map((region) => ({
      ...region,
      machines: region.machines.sort((left, right) => compareArabic(left.machineCode, right.machineCode)
        || compareArabic(left.workOrderCode, right.workOrderCode)),
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
    'visitUuid', 'cardId', 'machineCode', 'regionName', 'machineCondition', 'reasonIds', 'notes',
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
  const machineCondition = body.machineCondition ?? 'working';
  if (!['working', 'faulty', 'preventive_maintenance'].includes(machineCondition)) {
    throw new HttpError(400, 'machineCondition must be working, faulty, or preventive_maintenance.');
  }
  if (!Array.isArray(body.reasonIds) || body.reasonIds.length > 50) {
    throw new HttpError(400, 'reasonIds must be an array containing at most 50 reason IDs.');
  }
  const reasonIds = [...new Set(body.reasonIds.map((id, index) => positiveId(id, `reasonIds[${index}]`)))];
  const notes = optionalText(body.notes, 'notes', { maxLength: 10000 });
  const capturedAt = requireText(body.capturedAt, 'capturedAt', { maxLength: 64 });
  const capturedDate = new Date(capturedAt);
  if (Number.isNaN(capturedDate.valueOf())) throw new HttpError(400, 'capturedAt must be a valid date and time.');

  const location = body.location === undefined || body.location === null
    ? null
    : normalizeRepLocation(body.location);

  return {
    visitUuid: visitUuid.toLowerCase(),
    cardId,
    machineCode,
    regionName,
    machineCondition,
    reasonIds,
    notes,
    capturedAt: capturedDate.toISOString(),
    beforeCapturedAt: parseCapturedTimestamps(body.beforeCapturedAt, capturedDate, 'beforeCapturedAt'),
    afterCapturedAt: parseCapturedTimestamps(body.afterCapturedAt, capturedDate, 'afterCapturedAt', { optional: true }),
    location,
  };
}

function parseCapturedTimestamps(value, fallback, field, { optional = false } = {}) {
  const values = value === undefined || value === null || value === ''
    ? (optional ? [] : [fallback.toISOString()])
    : Array.isArray(value) ? value : [value];
  if (!values.length && !optional) throw new HttpError(400, `${field} must include a timestamp for every photo.`);
  return values.map((item, index) => {
    const text = requireText(item, `${field}[${index}]`, { maxLength: 64 });
    const date = new Date(text);
    if (Number.isNaN(date.valueOf())) throw new HttpError(400, `${field}[${index}] must be a valid date and time.`);
    return date.toISOString();
  });
}

async function prepareVisitImage(file, label) {
  const imageBuffer = file?.buffer?.length ? file.buffer
    : typeof file?.path === 'string' ? await readFile(file.path) : null;
  if (!imageBuffer?.length) throw new HttpError(400, `A ${label} photo is required.`);
  try {
    const compressed = await compressFieldImage(imageBuffer);
    if (!['jpeg', 'webp'].includes(compressed.format)) {
      throw new HttpError(400, `${label} photo must be a valid JPEG or WebP image.`);
    }
    return compressed.buffer;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `${label} photo could not be decoded.`);
  }
}

function visitPhotoFiles(files, phase) {
  const plural = files?.[`${phase}Photos`];
  if (Array.isArray(plural)) return plural;
  const singular = files?.[`${phase}Photo`];
  if (Array.isArray(singular)) return singular;
  return singular ? [singular] : [];
}

async function visitPayloadHash(repId, visit, beforePhotos, afterPhotos) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ repId, ...visit }));
  for (const [phase, photos] of [['before', beforePhotos], ['after', afterPhotos]]) {
    hash.update(`\0${phase}:${photos.length}\0`);
    for (const [index, photo] of photos.entries()) {
      const size = Number(photo.size ?? photo.buffer?.length);
      if (!Number.isSafeInteger(size) || size < 1) throw new HttpError(400, `${phase} photo ${index + 1} is empty or invalid.`);
      hash.update(`\0${phase}:${index}:${size}\0`);
      if (photo.buffer?.length) {
        hash.update(photo.buffer);
      } else if (typeof photo.path === 'string') {
        for await (const chunk of createReadStream(photo.path)) hash.update(chunk);
      } else {
        throw new HttpError(400, `${phase} photo ${index + 1} is missing.`);
      }
    }
  }
  return hash.digest('hex');
}

function visitResult(row, database = db, { idempotent = false, processing = false } = {}) {
  if (processing) {
    return { success: false, status: 'processing', visitUuid: row.visit_uuid, retryAfterMs: 1500 };
  }
  const reviewStatus = database.prepare('SELECT status FROM rep_visit_reviews WHERE visit_id = ?').get(row.id)?.status ?? 'pending';
  const photoCounts = database.prepare(`
    SELECT phase, COUNT(*) AS count FROM rep_visit_photos WHERE visit_id = ? GROUP BY phase
  `).all(row.id);
  const counts = Object.fromEntries(photoCounts.map((item) => [item.phase, Number(item.count)]));
  return {
    success: true,
    status: reviewStatus === 'approved' ? 'approved' : reviewStatus === 'reshoot' ? 'reshoot_requested' : 'pending_review',
    visitUuid: row.visit_uuid,
    machineCode: row.machine_code,
    beforePhotoCount: counts.before ?? 0,
    afterPhotoCount: counts.after ?? 0,
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

function assertNoPendingMachineCorrectionRename(database) {
  if (database.prepare('SELECT 1 FROM machine_correction_rename_operations LIMIT 1').get()) {
    throw new HttpError(409, 'A machine-folder recovery is pending. Restart the server before uploading field visits.');
  }
}

function findRepVisitCard(rep, visit, database) {
  const card = database.prepare(`
    SELECT card.id AS card_id, card.order_id, card.machine_id, card.before_photos_json,
      card.after_photos_json, card.reason_id, card.reason_ids_json, card.notes AS card_notes,
      card.status AS card_status, order_record.order_code, order_record.area AS order_area,
      order_record.status AS order_status,
      client.code AS client_code, client.deleted_at AS client_deleted_at,
       machine.code AS machine_code, machine.name_ar AS machine_name_ar, machine.area AS machine_area,
       machine.area_name, machine.latitude, machine.longitude, machine.is_location_locked,
       machine.geofence_radius_meters, machine.active AS machine_active,
       machine.deleted_at AS machine_deleted_at,
       EXISTS (SELECT 1 FROM machine_correction_requests correction
         WHERE correction.machine_id = machine.id AND correction.status = 'pending') AS correction_pending
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
  if (card.correction_pending) {
    throw new HttpError(409, 'A wrong-machine report is awaiting administrator review. Visits stay paused until it is resolved.');
  }
  if (!database.prepare(`
    SELECT 1 FROM maintenance_order_reps WHERE order_id = ? AND user_id = ?
  `).get(card.order_id, rep.id)) {
    throw new HttpError(403, 'This work order is not assigned to your account.');
  }
  if (!hasUniversalAccess(rep.assignedRegions)) {
    const assigned = new Set(rep.assignedRegions.map(regionKey));
    if (!assigned.has(regionKey(card.machine_area))) {
      throw new HttpError(403, 'This machine is outside your assigned regions.');
    }
  }
  const orderAreas = String(card.order_area ?? '').split(/[،,]/).map(regionKey).filter(Boolean);
  if (orderAreas.length && !orderAreas.includes(regionKey(card.machine_area))) {
    throw new HttpError(403, 'This machine is outside the work order regions.');
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
  validateMachineGeofence(card, visit.location);
  return card;
}

function findAssignedRepMachine(rep, machineId, cardId, database) {
  const id = positiveId(machineId, 'machineId');
  const selectedCardId = positiveId(cardId, 'cardId');
  const machine = database.prepare(`
    SELECT machine.id AS machine_id, machine.code AS machine_code, machine.name_ar AS machine_name_ar,
      machine.area AS machine_area, machine.area_name, machine.latitude, machine.longitude,
      machine.is_location_locked, machine.geofence_radius_meters, machine.active AS machine_active,
      machine.deleted_at AS machine_deleted_at,
      EXISTS (SELECT 1 FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending') AS correction_pending,
      card.id AS card_id, card.order_id,
      card.status AS card_status, card.deleted_at AS card_deleted_at,
      order_record.order_code, order_record.area AS order_area, order_record.status AS order_status,
      order_record.deleted_at AS order_deleted_at, client.deleted_at AS client_deleted_at
    FROM machines machine
    JOIN maintenance_cards card ON card.machine_id = machine.id
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    WHERE machine.id = ? AND card.id = ?
  `).get(id, selectedCardId);
  if (!machine || machine.machine_active !== 1 || machine.machine_deleted_at !== null
      || machine.card_deleted_at !== null || machine.card_status === 'excluded'
      || machine.order_deleted_at !== null || machine.order_status === 'archived' || machine.client_deleted_at !== null) {
    throw new HttpError(409, 'This machine is no longer available on the active route. Refresh the route and try again.');
  }
  if (machine.correction_pending) {
    throw new HttpError(409, 'A wrong-machine report is awaiting administrator review. This machine is paused until the review is complete.');
  }
  if (!database.prepare('SELECT 1 FROM maintenance_order_reps WHERE order_id = ? AND user_id = ?')
    .get(machine.order_id, rep.id)) {
    throw new HttpError(403, 'This work order is not assigned to your account.');
  }
  if (!hasUniversalAccess(rep.assignedRegions)) {
    const assigned = new Set(rep.assignedRegions.map(regionKey));
    if (!assigned.has(regionKey(machine.machine_area))) {
      throw new HttpError(403, 'This machine is outside your assigned regions.');
    }
  }
  const orderAreas = String(machine.order_area ?? '').split(/[،,]/).map(regionKey).filter(Boolean);
  if (orderAreas.length && !orderAreas.includes(regionKey(machine.machine_area))) {
    throw new HttpError(403, 'This machine is outside the work order regions.');
  }
  return machine;
}

function actionPayloadHash(payload, evidenceBuffer = null) {
  const hash = createHash('sha256').update(JSON.stringify(payload));
  if (evidenceBuffer?.length) hash.update('\0evidence\0').update(evidenceBuffer);
  return hash.digest('hex');
}

function requireSameAction(existing, repId, machineId, payloadHash) {
  if (Number(existing.rep_user_id) !== Number(repId)
      || Number(existing.machine_id) !== Number(machineId)
      || existing.payload_sha256 !== payloadHash) {
    throw new HttpError(409, 'This action UUID was already used with different content.');
  }
}

function mapConfirmedMachine(row) {
  return {
    id: Number(row.id),
    machine_id: Number(row.id),
    code: row.code,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    is_location_locked: Number(row.is_location_locked),
    geofence_radius_meters: Number(row.geofence_radius_meters) || 50,
    area_name: row.area_name,
  };
}

/** First field confirmation submits a location proposal for supervisor review. */
export function confirmRepMachineLocation(rep, machineId, input, database = db) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const body = requireObject(input);
  allowOnlyKeys(body, ['actionUuid', 'cardId', 'location']);
  const uuid = actionUuid(body.actionUuid);
  const cardId = positiveId(body.cardId, 'cardId');
  const location = normalizeRepLocation(body.location);
  if (location.accuracy > MAX_FIELD_CONFIRMATION_ACCURACY_METERS) {
    throw new HttpError(400, `GPS accuracy must be ${MAX_FIELD_CONFIRMATION_ACCURACY_METERS} metres or better before confirming a machine location.`);
  }
  const id = positiveId(machineId, 'machineId');
  const payloadHash = actionPayloadHash({ repId: Number(rep.id), machineId: id, cardId, location });
  const existing = database.prepare(`SELECT action_uuid, rep_user_id, machine_id, payload_sha256
    FROM machine_correction_requests WHERE action_uuid = ?`).get(uuid);
  if (existing) {
    const request = database.prepare(`SELECT id, request_type, status FROM machine_correction_requests WHERE action_uuid = ?`).get(uuid);
    if (request.request_type !== 'location_confirmation') {
      throw new HttpError(409, 'This action UUID was already used for a different machine correction.');
    }
    requireSameAction(existing, rep.id, id, payloadHash);
    const machine = database.prepare('SELECT id, code, latitude, longitude, is_location_locked, geofence_radius_meters, area_name FROM machines WHERE id = ?').get(id);
    if (!machine) throw new HttpError(404, 'Machine was not found.');
    return {
      success: true,
      idempotent: true,
      correctionId: Number(request.id),
      verificationId: Number(request.id),
      status: request.status,
      machine: mapConfirmedMachine(machine),
      proposedLocation: location,
      locationConfirmation: listLocationConfirmations({ repId: rep.id, status: 'all' }, database).find((item) => item.id === request.id),
    };
  }

  const assignedMachine = findAssignedRepMachine(rep, id, cardId, database);
  return database.transaction(() => {
    const current = database.prepare(`SELECT id, code, name_ar, area, area_name, latitude, longitude,
      is_location_locked, geofence_radius_meters, active, deleted_at FROM machines WHERE id = ?`).get(id);
    if (!current || current.active !== 1 || current.deleted_at !== null) throw new HttpError(404, 'Active machine was not found.');
    if (Number(current.is_location_locked) === 1) {
      throw new HttpError(409, 'This machine location has already been confirmed. Submit a correction for administrator review if it is wrong.');
    }
    const assigned = database.prepare(`SELECT 1 FROM maintenance_order_reps assignment
      JOIN maintenance_cards card ON card.order_id = assignment.order_id
      JOIN maintenance_orders order_record ON order_record.id = card.order_id
      WHERE assignment.order_id = ? AND assignment.user_id = ? AND card.id = ?
        AND card.machine_id = ? AND card.deleted_at IS NULL AND card.status != 'excluded'
        AND order_record.deleted_at IS NULL AND order_record.status != 'archived'`).get(
      assignedMachine.order_id,
      rep.id, cardId, id,
    );
    if (!assigned) throw new HttpError(409, 'The machine assignment changed. Refresh the route and try again.');
    const pendingLocation = database.prepare(`SELECT id FROM machine_correction_requests
      WHERE machine_id = ? AND request_type = 'location_confirmation' AND status = 'pending' LIMIT 1`).get(id);
    if (pendingLocation) throw new HttpError(409, 'A machine location confirmation is already awaiting supervisor review.');

    const result = database.prepare(`INSERT INTO machine_correction_requests
      (action_uuid, payload_sha256, rep_user_id, machine_id, card_id, request_type,
       reported_code, reported_name, location_json, captured_at, status)
      VALUES (?, ?, ?, ?, ?, 'location_confirmation', ?, ?, ?, ?, 'pending')`).run(
      uuid, payloadHash, rep.id, id, cardId, current.code, current.name_ar,
      JSON.stringify(location), location.updatedAt,
    );
    const correctionId = Number(result.lastInsertRowid);
    recordAudit({
      database,
      actorId: rep.id,
      action: 'location_confirmation_requested',
      entityType: 'machine_correction_request',
      entityId: correctionId,
      oldValues: {
        latitude: current.latitude,
        longitude: current.longitude,
        is_location_locked: current.is_location_locked,
      },
      newValues: {
        request_type: 'location_confirmation',
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        status: 'pending',
        card_id: cardId,
        captured_at: location.updatedAt,
      },
    });
    return {
      success: true,
      idempotent: false,
      correctionId,
      verificationId: correctionId,
      status: 'pending',
      machine: mapConfirmedMachine(current),
      proposedLocation: location,
      locationConfirmation: listLocationConfirmations({ repId: rep.id, status: 'all' }, database).find((item) => item.id === correctionId),
    };
  }).immediate();
}

export function listLocationConfirmations({ repId = null, status = 'pending' } = {}, database = db) {
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw new HttpError(400, 'Invalid review status.');
  const filters = ["request.request_type = 'location_confirmation'"];
  const params = [];
  if (repId !== null) { filters.push('request.rep_user_id = ?'); params.push(positiveId(repId, 'repId')); }
  if (status !== 'all') { filters.push('request.status = ?'); params.push(status); }
  return database.prepare(`SELECT request.id, request.action_uuid, request.machine_id, request.card_id,
      request.rep_user_id, request.location_json, request.status, machine.code, machine.name_ar,
      machine.latitude, machine.longitude, machine.is_location_locked,
      representative.full_name AS representative_name,
      review.review_note, review.created_at AS reviewed_at
    FROM machine_correction_requests request
    JOIN machines machine ON machine.id = request.machine_id
    JOIN users representative ON representative.id = request.rep_user_id
    LEFT JOIN machine_correction_reviews review ON review.id = (
      SELECT id FROM machine_correction_reviews WHERE correction_id = request.id ORDER BY id DESC LIMIT 1)
    WHERE ${filters.join(' AND ')} ORDER BY request.id DESC`).all(...params).map((row) => ({
    id: row.id, requestId: row.id, correctionId: row.id, actionUuid: row.action_uuid,
    machineId: row.machine_id, cardId: row.card_id, repId: row.rep_user_id,
    machineCode: row.code, machineName: row.name_ar, representativeName: row.representative_name,
    proposedLocation: JSON.parse(row.location_json), status: row.status,
    reviewNote: row.review_note ?? null, reviewedAt: row.reviewed_at ?? null,
    approvedLocation: row.is_location_locked === 1 && row.latitude !== null && row.longitude !== null
      ? { latitude: row.latitude, longitude: row.longitude } : null,
  }));
}

export function approveRepMachineLocationCorrection(correctionId, input, actorId, database = db) {
  return reviewRepMachineLocationCorrection(correctionId, input, actorId, 'approved', database);
}

export function rejectRepMachineLocationCorrection(correctionId, input, actorId, database = db) {
  return reviewRepMachineLocationCorrection(correctionId, input, actorId, 'rejected', database);
}

function reviewRepMachineLocationCorrection(correctionId, input, actorId, decision, database) {
  const id = positiveId(correctionId, 'correctionId');
  const actor = positiveId(actorId, 'actorId');
  const body = requireObject(input ?? {});
  allowOnlyKeys(body, ['note']);
  const reviewNote = optionalText(body.note, 'note', { maxLength: 2000 });
  const result = database.transaction(() => {
    const reviewer = database.prepare("SELECT role FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL").get(actor);
    if (reviewer?.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
    const correction = database.prepare(`SELECT id, machine_id, rep_user_id, location_json, status, request_type
      FROM machine_correction_requests WHERE id = ?`).get(id);
    if (!correction || correction.request_type !== 'location_confirmation') {
      throw new HttpError(404, 'Machine location confirmation was not found.');
    }
    if (correction.status !== 'pending') {
      const review = database.prepare('SELECT review_note FROM machine_correction_reviews WHERE correction_id = ? ORDER BY id DESC LIMIT 1').get(id);
      if (correction.status !== decision || (review?.review_note ?? null) !== (reviewNote ?? null)) {
        throw new HttpError(409, 'This location confirmation already has a different review decision.');
      }
      const machine = database.prepare('SELECT * FROM machines WHERE id = ?').get(correction.machine_id);
      return { success: true, idempotent: true, correctionId: id, status: decision, machine: mapConfirmedMachine(machine) };
    }
    const machine = database.prepare(`SELECT id, code, latitude, longitude, is_location_locked,
      geofence_radius_meters, area_name, active, deleted_at FROM machines WHERE id = ?`).get(correction.machine_id);
    if (!machine || machine.active !== 1 || machine.deleted_at !== null) {
      throw new HttpError(409, 'The machine attached to this location confirmation is no longer active.');
    }
    if (decision === 'approved' && Number(machine.is_location_locked) === 1) {
      throw new HttpError(409, 'The machine location was already locked by another approved action.');
    }
    let proposedLocation;
    try { proposedLocation = normalizeRepLocation(JSON.parse(correction.location_json)); }
    catch { throw new HttpError(409, 'The proposed machine location is invalid and cannot be approved.'); }
    if (proposedLocation.accuracy > MAX_FIELD_CONFIRMATION_ACCURACY_METERS) {
      throw new HttpError(409, 'The proposed machine location no longer meets the GPS accuracy requirement.');
    }
    if (decision === 'approved') {
    const changed = database.prepare(`UPDATE machines SET latitude = ?, longitude = ?, is_location_locked = 1,
      geofence_radius_meters = 50, area_name = COALESCE(NULLIF(trim(area_name), ''), area)
      WHERE id = ? AND is_location_locked = 0 AND active = 1 AND deleted_at IS NULL`).run(
      proposedLocation.latitude, proposedLocation.longitude, machine.id,
    );
    if (changed.changes !== 1) throw new HttpError(409, 'The machine location changed before the confirmation could be approved.');
    }
    database.prepare(`UPDATE machine_correction_requests SET status = ?, resolved_machine_id = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).run(decision, decision === 'approved' ? machine.id : null, id);
    database.prepare(`INSERT INTO machine_correction_reviews
      (correction_id, action, resolved_machine_id, review_note, actor_user_id, approved_code)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, decision, decision === 'approved' ? machine.id : null, reviewNote, actor, machine.code);
    const updated = database.prepare(`SELECT id, code, latitude, longitude, is_location_locked,
      geofence_radius_meters, area_name FROM machines WHERE id = ?`).get(machine.id);
    recordAudit({
      database,
      actorId: actor,
      action: `machine_location_confirmation_${decision}`,
      entityType: 'machine_correction_request',
      entityId: id,
      oldValues: {
        latitude: machine.latitude,
        longitude: machine.longitude,
        is_location_locked: machine.is_location_locked,
        status: correction.status,
      },
      newValues: {
        machine_id: machine.id,
        latitude: updated.latitude,
        longitude: updated.longitude,
        is_location_locked: updated.is_location_locked,
        geofence_radius_meters: updated.geofence_radius_meters,
        status: decision,
        review_note: reviewNote,
      },
    });
    return { success: true, idempotent: false, correctionId: id, status: decision, repId: correction.rep_user_id, machine: mapConfirmedMachine(updated) };
  }).immediate();
  if (!result.idempotent) publishOperationsEvent('rep.machine.location-reviewed', {
    userId: result.repId, machineId: result.machine.id, correctionId: id, status: decision,
  }, database);
  result.locationConfirmation = listLocationConfirmations({ status: 'all' }, database).find((item) => item.id === id);
  return result;
}

/** Store a wrong-machine claim and optional original evidence without changing machine/card history. */
export async function submitRepMachineCorrection(rep, machineId, input, evidenceFile, database = db) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const body = requireObject(input, 'correction');
  allowOnlyKeys(body, ['actionUuid', 'cardId', 'reportedCode', 'reportedName', 'note', 'location', 'capturedAt']);
  const uuid = actionUuid(body.actionUuid);
  const cardId = positiveId(body.cardId, 'cardId');
  const id = positiveId(machineId, 'machineId');
  const reportedCode = requireText(body.reportedCode, 'reportedCode', { maxLength: 64 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(reportedCode)) {
    throw new HttpError(400, 'reportedCode contains unsupported characters.');
  }
  const reportedName = requireText(body.reportedName, 'reportedName', { maxLength: 200 });
  const note = optionalText(body.note, 'note', { maxLength: 2000 });
  const location = normalizeRepLocation(body.location);
  const capturedAtText = body.capturedAt === undefined ? location.updatedAt : requireText(body.capturedAt, 'capturedAt', { maxLength: 64 });
  const capturedAt = new Date(capturedAtText);
  if (Number.isNaN(capturedAt.valueOf())) throw new HttpError(400, 'capturedAt must be a valid date and time.');

  let evidenceBuffer = null;
  let evidenceContentType = null;
  if (evidenceFile) {
    if (!Buffer.isBuffer(evidenceFile.buffer) || !evidenceFile.buffer.length) {
      throw new HttpError(400, 'The correction evidence photo is empty or invalid.');
    }
    let metadata;
    try {
      metadata = await sharp(evidenceFile.buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
    } catch {
      throw new HttpError(400, 'The correction evidence photo could not be decoded.');
    }
    const contentTypes = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    evidenceContentType = contentTypes[metadata.format];
    if (!evidenceContentType || !metadata.width || !metadata.height) {
      throw new HttpError(400, 'Correction evidence must be a valid JPEG, PNG, or WebP image.');
    }
    evidenceBuffer = evidenceFile.buffer;
  }

  const payload = {
    repId: Number(rep.id), machineId: id, cardId, reportedCode, reportedName, note,
    location, capturedAt: capturedAt.toISOString(), evidenceContentType,
  };
  const payloadHash = actionPayloadHash(payload, evidenceBuffer);
  const existing = database.prepare(`SELECT id, action_uuid, rep_user_id, machine_id, payload_sha256
    FROM machine_correction_requests WHERE action_uuid = ?`).get(uuid);
  if (existing) {
    requireSameAction(existing, rep.id, id, payloadHash);
    return { success: true, idempotent: true, correctionId: Number(existing.id), status: 'pending' };
  }

  const machine = findAssignedRepMachine(rep, id, cardId, database);
  return database.transaction(() => {
    const assignmentStillActive = database.prepare(`SELECT 1 FROM maintenance_order_reps assignment
      JOIN maintenance_cards card ON card.order_id = assignment.order_id
      JOIN maintenance_orders order_record ON order_record.id = card.order_id
      WHERE assignment.order_id = ? AND assignment.user_id = ? AND card.id = ?
        AND card.machine_id = ? AND card.deleted_at IS NULL AND card.status != 'excluded'
        AND order_record.deleted_at IS NULL AND order_record.status != 'archived'`).get(
      machine.order_id, rep.id, cardId, id,
    );
    if (!assignmentStillActive) throw new HttpError(409, 'The machine assignment changed. Refresh the route and try again.');
    const result = database.prepare(`INSERT INTO machine_correction_requests
      (action_uuid, payload_sha256, rep_user_id, machine_id, card_id, reported_code, reported_name,
       note, evidence_data, evidence_content_type, location_json, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      uuid, payloadHash, rep.id, id, cardId, reportedCode, reportedName, note,
      evidenceBuffer, evidenceContentType, JSON.stringify(location), capturedAt.toISOString(),
    );
    const correctionId = Number(result.lastInsertRowid);
    recordAudit({
      database,
      actorId: rep.id,
      action: 'create',
      entityType: 'machine_correction_request',
      entityId: correctionId,
      newValues: {
        machine_id: id,
        machine_code: machine.machine_code,
        card_id: cardId,
        order_code: machine.order_code,
        reported_code: reportedCode,
        reported_name: reportedName,
        note,
        location,
        captured_at: capturedAt.toISOString(),
        evidence_content_type: evidenceContentType,
        evidence_bytes: evidenceBuffer?.length ?? 0,
        status: 'pending',
      },
    });
    const candidates = database.prepare(`SELECT id FROM machines
      WHERE code = ? COLLATE NOCASE AND active = 1 AND deleted_at IS NULL`).all(reportedCode);
    return {
      success: true,
      idempotent: false,
      correctionId,
      status: 'pending',
      codeConflict: candidates.some((candidate) => Number(candidate.id) !== id),
    };
  }).immediate();
}

async function cleanupVisitFiles(row) {
  await removeStorageDirectory(row.staging_path);
  // Receiving rows created by the previous layout own a UUID-named directory.
  // Remove that isolated legacy directory, but never remove a shared order folder.
  if (row.final_path.split('/').at(-1)?.toLowerCase() === String(row.visit_uuid).toLowerCase()) {
    await removeStorageDirectory(row.final_path);
    return;
  }
  for (const [phase, directoryName] of [['before', 'Before'], ['after', 'After']]) {
    const phasePath = storageDirectory(row.final_path, directoryName);
    let storedFiles = [];
    try {
      storedFiles = await listStorageFiles(phasePath, { maxFiles: 10000 });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const expectedName = new RegExp(`^${row.visit_uuid}_\\d{4}\\.jpg$`, 'i');
    for (const storedPath of storedFiles) {
      if (!expectedName.test(storedPath.split('/').at(-1))) continue;
      const absolutePath = await resolveStorageFile(storedPath);
      await removeStorageFile(absolutePath);
    }
  }
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
        region_name, payload_sha256, status, machine_condition, reason_ids_json, notes, captured_at,
        before_captured_at, after_captured_at, location_json, staging_path, final_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'receiving', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      visit.visitUuid, rep.id, card.order_id, card.card_id, card.machine_id, card.order_code,
       card.machine_code, card.machine_area, payloadHash, visit.machineCondition, JSON.stringify(visit.reasonIds),
        visit.notes, visit.capturedAt, visit.beforeCapturedAt[0], visit.afterCapturedAt[0] ?? null,
      visit.location ? JSON.stringify(visit.location) : null,
      stagingPath, finalPath,
    );
    return { row: findVisit(visit.visitUuid, database), kind: 'reserved', id: Number(result.lastInsertRowid) };
  }).immediate();
}

function recordReceivedVisit(rep, visit, visitId, photoRows, database) {
  return database.transaction(() => {
    const machine = database.prepare(`SELECT id, code, name_ar, area, area_name, latitude, longitude,
      is_location_locked, geofence_radius_meters FROM machines WHERE id = ?`).get(
      database.prepare('SELECT machine_id FROM rep_visits WHERE id = ?').get(visitId)?.machine_id,
    );
    if (!machine) throw new HttpError(409, 'The machine was removed while the visit was uploading.');
    validateMachineGeofence(machine, visit.location);
    const beforePhotos = photoRows.filter((photo) => photo.phase === 'before');
    const afterPhotos = photoRows.filter((photo) => photo.phase === 'after');
    const beforePath = beforePhotos[0]?.storedPath ?? null;
    const afterPath = afterPhotos[0]?.storedPath ?? null;
    database.prepare(`
      UPDATE rep_visits SET status = 'completed', before_path = ?, after_path = ?,
        before_captured_at = ?, after_captured_at = ?,
        failure_message = NULL, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'receiving'
    `).run(beforePath, afterPath, beforePhotos[0]?.capturedAt ?? null, afterPhotos[0]?.capturedAt ?? null, visitId);
    const insertPhoto = database.prepare(`
      INSERT INTO rep_visit_photos (visit_id, phase, ordinal, stored_path, captured_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const photo of photoRows) {
      insertPhoto.run(visitId, photo.phase, photo.ordinal, photo.storedPath, photo.capturedAt);
    }
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
        machine_condition: visit.machineCondition,
        card_id: visit.cardId,
        reason_ids: visit.reasonIds,
        notes: visit.notes,
        captured_at: visit.capturedAt,
        before_captured_at: visit.beforeCapturedAt,
        after_captured_at: visit.afterCapturedAt,
        before_photo_count: beforePhotos.length,
        after_photo_count: afterPhotos.length,
        location: visit.location,
        review_status: 'pending',
      },
    });
    const receivedVisit = findVisit(visit.visitUuid, database);
    const card = database.prepare(`
      SELECT before_photos_json, after_photos_json, notes FROM maintenance_cards
      WHERE id = ? AND order_id = ? AND machine_id = ? AND deleted_at IS NULL
    `).get(receivedVisit.card_id, receivedVisit.order_id, receivedVisit.machine_id);
    if (!card) throw new HttpError(409, 'The maintenance card was removed while the visit was uploading.');
    const submittedNote = String(visit.notes ?? '').trim();
    if (submittedNote) {
      const user = database.prepare('SELECT full_name FROM users WHERE id = ? AND role = \'rep\'').get(rep.id);
      const noteUpdate = database.prepare(`
        UPDATE maintenance_cards SET notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND order_id = ? AND machine_id = ? AND deleted_at IS NULL
      `).run(submittedNote, receivedVisit.card_id, receivedVisit.order_id, receivedVisit.machine_id);
      if (noteUpdate.changes !== 1) throw new HttpError(409, 'The maintenance card changed while the visit was uploading.');
      database.prepare(`
        INSERT INTO machine_notes_history
          (machine_id, card_id, order_id, author_id, author_name, author_role, note)
        VALUES (?, ?, ?, ?, ?, 'rep', ?)
      `).run(receivedVisit.machine_id, receivedVisit.card_id, receivedVisit.order_id, rep.id,
        user?.full_name ?? 'مندوب ميداني', submittedNote);
      recordAudit({
        database,
        actorId: rep.id,
        action: 'update_notes',
        entityType: 'maintenance_card',
        entityId: receivedVisit.card_id,
        oldValues: { notes: card.notes ?? '' },
        newValues: { notes: submittedNote, visit_uuid: visit.visitUuid },
      });
    } else {
      database.prepare('UPDATE maintenance_cards SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(receivedVisit.card_id);
    }
    recordAudit({
      database,
      actorId: rep.id,
      action: 'rep_photos_attached',
      entityType: 'maintenance_card',
      entityId: receivedVisit.card_id,
      oldValues: {
        before_photo_count: parsePhotoList(card.before_photos_json).length,
        after_photo_count: parsePhotoList(card.after_photos_json).length,
      },
      newValues: {
        visit_uuid: visit.visitUuid,
        rep_user_id: rep.id,
        before: beforePhotos.map(({ storedPath, capturedAt }) => ({ path: storedPath, captured_at: capturedAt })),
        after: afterPhotos.map(({ storedPath, capturedAt }) => ({ path: storedPath, captured_at: capturedAt })),
        review_status: 'pending',
      },
    });
    return findVisit(visit.visitUuid, database);
  }).immediate();
}

/** Receive one immutable bundle with three required Before photos and optional After photos. */
export async function syncRepVisit(rep, input, files, database = db) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const visit = normalizeVisitInput(input);
  const beforeFiles = visitPhotoFiles(files, 'before');
  const afterFiles = visitPhotoFiles(files, 'after');
  if (beforeFiles.length !== 3 || afterFiles.length > 3) {
    throw new HttpError(400, 'A visit must contain exactly three before photos and no more than three optional after photos.');
  }
  if (visit.beforeCapturedAt.length !== beforeFiles.length || visit.afterCapturedAt.length !== afterFiles.length) {
    throw new HttpError(400, 'Each uploaded photo must have a matching capture timestamp.');
  }
  const payloadHash = await visitPayloadHash(rep.id, visit, beforeFiles, afterFiles);
  assertNoPendingMachineCorrectionRename(database);

  let existing = findVisit(visit.visitUuid, database);
  if (existing) {
    requireVisitOwner(existing, rep.id, payloadHash);
    if (existing.status === 'completed') return visitResult(existing, database, { idempotent: true });
    if (existing.status === 'receiving') return visitResult(existing, database, { processing: true });
  }

  const initialCard = findRepVisitCard(rep, visit, database);
  return withMachineStorageLock(initialCard.machine_id, async () => {
    assertNoPendingMachineCorrectionRename(database);
    existing = findVisit(visit.visitUuid, database);
    if (existing) {
      requireVisitOwner(existing, rep.id, payloadHash);
      if (existing.status === 'completed') return visitResult(existing, database, { idempotent: true });
      if (existing.status === 'receiving') return visitResult(existing, database, { processing: true });
      await cleanupVisitFiles(existing);
    }

    const card = findRepVisitCard(rep, visit, database);
    const workDay = getLocalDateParts(new Date(visit.capturedAt), getTimeZone(database));
    const workDate = `${workDay.year}-${String(workDay.month).padStart(2, '0')}-${String(workDay.day).padStart(2, '0')}`;
    const machineArea = safeStorageSegment(card.machine_area);
    const machineFolder = safeStorageSegment(`${card.machine_code}_${card.machine_name_ar}`);
    const yearFolder = workDate.slice(0, 4);
    const monthFolder = workDate.slice(5, 7);
    const stagingPath = storageDirectory('.madar-recovery', 'rep-visits', visit.visitUuid);
    // UUID-based names keep each visit immutable while the hierarchy is area/year/month/machine/phase.
    const finalPath = storageDirectory('Areas', machineArea, yearFolder, monthFolder, machineFolder);
    const reservation = createVisitReservation(rep, visit, payloadHash, card, stagingPath, finalPath, database);
    if (reservation.kind === 'completed') return visitResult(reservation.row, database, { idempotent: true });
    if (reservation.kind === 'processing') return visitResult(reservation.row, database, { processing: true });

    try {
      await ensureStorageDirectory('.madar-recovery', 'rep-visits', visit.visitUuid);
      const photoRows = [];
      for (const [phase, phaseFiles, capturedAtList] of [
        ['before', beforeFiles, visit.beforeCapturedAt],
        ['after', afterFiles, visit.afterCapturedAt],
      ]) {
        for (const [ordinal, file] of phaseFiles.entries()) {
          const buffer = await prepareVisitImage(file, `${phase} ${ordinal + 1}`);
          const filename = `${visit.visitUuid}_${String(ordinal + 1).padStart(4, '0')}.jpg`;
          const stagedPath = storageDirectory(stagingPath, phase, filename);
          const phaseDirectory = phase === 'before' ? 'Before' : 'After';
          const storedPath = storageDirectory(finalPath, phaseDirectory, filename);
          await writeStorageFile(stagedPath, buffer);
          photoRows.push({ phase, ordinal, stagedPath, storedPath, capturedAt: capturedAtList[ordinal] });
        }
      }
      await ensureStorageDirectory(finalPath, 'Before');
      if (afterFiles.length) await ensureStorageDirectory(finalPath, 'After');
      for (const photo of photoRows) await moveStorageFile(photo.stagedPath, photo.storedPath);
      await removeStorageDirectory(stagingPath);

      const completedVisit = recordReceivedVisit(rep, visit, reservation.row.id, photoRows, database);
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
    }
  });
}

/** Roll back interrupted file/DB handoffs before the API starts accepting requests. */
function normalizeTrackPoint(value, label = 'location') {
  const point = requireObject(value, label);
  allowOnlyKeys(point, ['clientPointId', 'latitude', 'longitude', 'accuracy', 'speed', 'updatedAt', 'timestamp', 'mocked', 'is_mock', 'mock_flag']);
  for (const flag of ['mocked', 'is_mock', 'mock_flag']) {
    if (point[flag] !== undefined && typeof point[flag] !== 'boolean') {
      throw new HttpError(400, `${label}.${flag} must be a boolean.`);
    }
  }
  let clientPointId = null;
  if (point.clientPointId !== undefined && point.clientPointId !== null) {
    clientPointId = requireText(point.clientPointId, `${label}.clientPointId`, { maxLength: 120 });
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(clientPointId)) {
      throw new HttpError(400, `${label}.clientPointId contains unsupported characters.`);
    }
  }
  const { latitude, longitude, accuracy } = point;
  const speed = point.speed === undefined || point.speed === null ? 0 : point.speed;
  const rawTimestamp = point.updatedAt ?? (Number.isFinite(point.timestamp) ? new Date(point.timestamp).toISOString() : null);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000
      || !Number.isFinite(speed) || speed < 0 || speed > 200) {
    throw new HttpError(400, `${label} must contain valid latitude, longitude, and accuracy values.`);
  }
  const updatedAt = requireText(rawTimestamp, `${label}.updatedAt`, { maxLength: 64 });
  const timestamp = new Date(updatedAt);
  if (Number.isNaN(timestamp.valueOf())) throw new HttpError(400, `${label}.updatedAt must be a valid date and time.`);
  if (point.mocked === true || point.is_mock === true || point.mock_flag === true) {
    throw new HttpError(400, 'Mock GPS locations cannot be synchronized.');
  }
  return { clientPointId, latitude, longitude, accuracy, speed, updatedAt: timestamp.toISOString() };
}

function businessDate(timestamp, database) {
  const parts = getLocalDateParts(new Date(timestamp), getTimeZone(database));
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function refreshRepStops(userId, workDate, database) {
  const points = database.prepare(`SELECT id, latitude, longitude, accuracy, recorded_at
    FROM rep_location_breadcrumbs WHERE user_id = ? AND work_date = ?
    ORDER BY datetime(recorded_at), id`).all(userId, workDate);
  database.prepare(`UPDATE rep_location_breadcrumbs SET is_stop = 0, stop_duration_minutes = 0,
    stop_arrived_at = NULL, stop_departed_at = NULL WHERE user_id = ? AND work_date = ?`)
    .run(userId, workDate);

  const segments = [];
  let segment = [];
  const finishSegment = () => {
    if (segment.length < 2) return;
    const first = segment[0];
    const last = segment.at(-1);
    const durationMinutes = Math.floor((Date.parse(last.recorded_at) - Date.parse(first.recorded_at)) / 60000);
    if (durationMinutes >= 5) segments.push({ ids: segment.map((point) => point.id), first, last, durationMinutes });
  };

  for (const point of points) {
    const anchor = segment[0];
    const previous = segment.at(-1);
    const gap = previous ? Date.parse(point.recorded_at) - Date.parse(previous.recorded_at) : 0;
    const distance = anchor ? calculateDistanceMeters(
      anchor.latitude, anchor.longitude, point.latitude, point.longitude,
    ) : 0;
    const accuracyMargin = Math.max(Number(anchor?.accuracy ?? 0), Number(point.accuracy ?? 0));
    if (segment.length && (gap > 10 * 60 * 1000 || Math.max(0, distance - accuracyMargin) > 50)) {
      finishSegment();
      segment = [];
    }
    segment.push(point);
  }
  finishSegment();

  const markStop = database.prepare(`UPDATE rep_location_breadcrumbs SET is_stop = 1,
    stop_duration_minutes = ?, stop_arrived_at = ?, stop_departed_at = ? WHERE id = ?`);
  for (const stop of segments) {
    for (const id of stop.ids) {
      markStop.run(stop.durationMinutes, stop.first.recorded_at, stop.last.recorded_at, id);
    }
  }
  return segments.length;
}

/** Persist duty state and idempotent GPS breadcrumbs reported by a representative device. */
export function syncRepTracking(rep, input, database = db) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const body = requireObject(input);
  allowOnlyKeys(body, ['onDuty', 'location', 'trail', 'is_mock', 'mock_flag']);
  if (typeof body.onDuty !== 'boolean') throw new HttpError(400, 'onDuty must be a boolean.');
  for (const flag of ['is_mock', 'mock_flag']) {
    if (body[flag] !== undefined && typeof body[flag] !== 'boolean') {
      throw new HttpError(400, `${flag} must be a boolean.`);
    }
  }
  const mockedPoint = [body.location, ...(Array.isArray(body.trail) ? body.trail : [])]
    .some((point) => point && (point.mocked === true || point.is_mock === true || point.mock_flag === true));
  if (body.is_mock === true || body.mock_flag === true || mockedPoint) {
    recordAudit({
      database,
      actorId: rep.id,
      action: 'mock_location_attempt',
      entityType: 'rep_tracking_security',
      entityId: rep.id,
      newValues: {
        is_mock: 1,
        mock_flag: 1,
        action: 'tracking',
        detected_at: new Date().toISOString(),
      },
    });
    throw new HttpError(400, 'Mock GPS locations cannot be synchronized. The attempt was recorded for review.');
  }
  const location = body.location == null ? null : normalizeTrackPoint(body.location);
  if (body.trail !== undefined && (!Array.isArray(body.trail) || body.trail.length > 500)) {
    throw new HttpError(400, 'trail must contain no more than 500 GPS points.');
  }
  const trail = (body.trail ?? []).map((point, index) => {
    try {
      return { point: normalizeTrackPoint(point, `trail[${index}]`), index };
    } catch (error) {
      const candidate = point && typeof point === 'object' && typeof point.clientPointId === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/.test(point.clientPointId)
        ? point.clientPointId : null;
      return { error, index, clientPointId: candidate };
    }
  });
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

  const insertPoint = database.prepare(`
      INSERT OR IGNORE INTO rep_location_points
        (rep_user_id, duty_session_id, latitude, longitude, accuracy, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
  `);
    const insertBreadcrumb = database.prepare(`INSERT OR IGNORE INTO rep_location_breadcrumbs
      (user_id, duty_session_id, work_date, latitude, longitude, accuracy, speed, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    let acceptedPoints = 0;
    let duplicatePoints = 0;
    let rejectedPoints = 0;
    const pointResults = [];
    const changedDates = new Set();

    const recordResult = (clientPointId, status, reason, index = null) => {
      const result = {
        clientPointId: clientPointId ?? null,
        status,
        ...(index === null ? {} : { index }),
        ...(reason ? { reason } : {}),
      };
      pointResults.push(result);
      if (status === 'accepted') acceptedPoints += 1;
      else if (status === 'duplicate') duplicatePoints += 1;
      else rejectedPoints += 1;
      return result;
    };

    const storePoint = (point, clientPointId, index = null) => {
      const ageMs = Date.now() - new Date(point.updatedAt).valueOf();
      if (ageMs > MAX_TRACK_POINT_AGE_MS) {
        return recordResult(clientPointId, 'rejected', 'older_than_retention', index);
      }
      if (ageMs < -5 * 60 * 1000) {
        return recordResult(clientPointId, 'rejected', 'future_timestamp', index);
      }
      if (pointSessionId === null) {
        return recordResult(clientPointId, 'rejected', 'no_duty_session', index);
      }
      const pointDate = businessDate(point.updatedAt, database);
      const legacyInsert = insertPoint.run(rep.id, pointSessionId, point.latitude, point.longitude,
        point.accuracy, point.updatedAt);
      const breadcrumbInsert = insertBreadcrumb.run(rep.id, pointSessionId, pointDate,
        point.latitude, point.longitude, point.accuracy, point.speed, point.updatedAt);
      if (legacyInsert.changes || breadcrumbInsert.changes) {
        changedDates.add(pointDate);
        return recordResult(clientPointId, 'accepted', null, index);
      }
      return recordResult(clientPointId, 'duplicate', null, index);
    };

    for (const entry of trail) {
      if (entry.error) {
        recordResult(entry.clientPointId, 'rejected', 'invalid_point', entry.index);
        continue;
      }
      storePoint(entry.point, entry.point.clientPointId, entry.index);
    }

    let locationResult = null;
    if (location) {
      locationResult = storePoint(location, location.clientPointId ?? 'location');
      if (locationResult.status !== 'rejected') {
        database.prepare(`
          UPDATE users SET is_online = 1,
            last_location_json = CASE
              WHEN last_location_json IS NULL OR datetime(json_extract(last_location_json, '$.updatedAt')) <= datetime(?)
                THEN ? ELSE last_location_json END
          WHERE id = ? AND role = 'rep' AND active = 1 AND deleted_at IS NULL
        `).run(location.updatedAt, JSON.stringify(location), rep.id);
      }
    }
    for (const workDate of changedDates) refreshRepStops(rep.id, workDate, database);
    return {
      onDuty: Boolean(session),
      acceptedPoints,
      duplicatePoints,
      rejectedPoints,
      points: pointResults,
      locationResult,
      sessionId: session ? Number(session.id) : null,
    };
  });
  return create.immediate();
}

/** Compatibility endpoint for a live location or a locally buffered trail batch. */
export function syncRepLocationPing(rep, input, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['onDuty', 'location', 'trail', 'is_mock', 'mock_flag']);
  const session = database.prepare(`SELECT 1 FROM rep_duty_sessions
    WHERE rep_user_id = ? AND ended_at IS NULL`).get(rep?.id);
  return syncRepTracking(rep, { ...body, onDuty: body.onDuty ?? Boolean(session) }, database);
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
