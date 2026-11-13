import { createHash, randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { lstat, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import { applyPhotoRotation } from './photo-images.js';
import { db } from '../../database/connection.js';
import { archiveMonth, addArchiveMonthFilter } from '../archive-period.js';
import { queueCardPhotoReview, reconcileCardPhotoReviewPaths } from './photo-review.js';
import { recordAudit } from '../audit.js';
import { assertCashAvailable, insertTreasuryEntry } from '../finance/treasury.service.js';
import {
  classifyMachinePhotos,
  matchMachineFolder,
  matchMachineFolderGroups,
  readTripZip,
  TRIP_PHOTO_EXTENSIONS,
} from './trip-folder.js';
import {
  allowOnlyKeys,
  HttpError,
  integerIdArray,
  nonNegativeInteger,
  optionalText,
  positiveId,
  requireObject,
  requireText,
} from '../http.js';
import {
  copyStorageFile,
  removeStorageFile,
  ensureStorageDirectory,
  listStorageFiles,
  resolveStorageDirectory,
  resolveStorageFile,
  storageDirectory,
  writeStorageFile,
} from '../storage.js';
import { withMachineStorageLock, withMaintenanceOrderStorageLock } from './deletion-lock.js';
import { compressFieldImage } from '../upload.js';
import { getMaintenanceThumbnail, invalidateMaintenanceThumbnail } from './thumbnails.js';
import { getMachineNotesHistory as listMachineNotesHistory } from './note-history.js';

const MAINTENANCE_STATUSES = ['in_progress', 'review', 'archived'];
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const MAX_MAINTENANCE_ORDER_AREAS = 50;
const AREA_DELIMITER = /[،,]/;
const MAX_TRIP_FOLDER_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_TRIP_PHOTO_BYTES = 200 * 1024 * 1024;
const MAX_TRIP_FOLDER_FILES = 50000;
const MAX_CARD_PHOTOS = 10000;
const MAX_MANUAL_CARD_PHASE_PHOTOS = 4;
const maintenanceTripProgress = new Map();
const TRIP_PROGRESS_RETENTION_MS = 30 * 60 * 1000;

function updateMaintenanceTripProgress(orderId, { totalFiles, processedFiles, percent, stage, active } = {}) {
  const id = Number(orderId);
  const now = Date.now();
  for (const [storedId, progress] of maintenanceTripProgress) {
    if (!progress.active && now - progress.updatedAt > TRIP_PROGRESS_RETENTION_MS) {
      maintenanceTripProgress.delete(storedId);
    }
  }

  const previous = maintenanceTripProgress.get(id);
  const nextTotal = Number.isFinite(totalFiles)
    ? Math.max(0, Math.floor(totalFiles))
    : (previous?.totalFiles ?? 0);
  const nextProcessed = Number.isFinite(processedFiles)
    ? Math.max(0, Math.floor(processedFiles))
    : (previous?.processedFiles ?? 0);
  const candidatePercent = Number.isFinite(percent)
    ? percent
    : (nextTotal ? (nextProcessed / nextTotal) * 100 : (previous?.percent ?? 0));
  const nextPercent = Math.max(previous?.percent ?? 0, Math.min(100, Math.max(0, Math.round(candidatePercent))));

  const progress = {
    totalFiles: nextTotal,
    processedFiles: nextProcessed,
    percent: nextPercent,
    stage: stage ?? previous?.stage ?? 'بانتظار بدء فحص مجلد الرحلة...',
    active: active ?? previous?.active ?? true,
    updatedAt: now,
  };
  maintenanceTripProgress.set(id, progress);
  return progress;
}

function safeMachineStorageSegment(value, fallback = 'unknown') {
  const cleaned = String(value ?? '').normalize('NFKC').trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function getTimeZone(database) {
  const configured = database.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()?.value;
  if (typeof configured === 'string' && configured.trim()) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());
      return configured;
    } catch {
      // Fall back to the established business-zone default if a setting is damaged.
    }
  }
  return 'Africa/Cairo';
}

export function beginMaintenanceTripProgress(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  const order = findMaintenanceOrder(id, database);
  if (order.status !== 'in_progress') {
    throw new HttpError(409, 'Trip photos can only be imported while the order is in progress.');
  }
  maintenanceTripProgress.set(id, {
    totalFiles: 0,
    processedFiles: 0,
    percent: 0,
    stage: 'جارٍ تجهيز ملفات الرحلة...',
    active: true,
    updatedAt: Date.now(),
  });
}

export function failMaintenanceTripProgress(orderId, stage = 'تعذر إكمال فحص مجلد الرحلة.') {
  const id = Number(orderId);
  if (!maintenanceTripProgress.has(id)) return;
  updateMaintenanceTripProgress(id, { stage, active: false });
}

export function getMaintenanceTripProgress(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  findMaintenanceOrder(id, database);
  let progress = maintenanceTripProgress.get(id);
  if (progress && !progress.active && Date.now() - progress.updatedAt > TRIP_PROGRESS_RETENTION_MS) {
    maintenanceTripProgress.delete(id);
    progress = null;
  }
  if (!progress) {
    return { percent: 0, processed: 0, total: 0, stage: 'بانتظار بدء فحص مجلد الرحلة...' };
  }
  return {
    percent: progress.percent,
    processed: progress.processedFiles,
    total: progress.totalFiles,
    stage: progress.stage,
  };
}

function normalizeMaintenanceAreaNames(values, label = 'area') {
  const input = Array.isArray(values) ? values : [values];
  const distinct = [];
  const seen = new Set();
  for (const value of input) {
    if (typeof value !== 'string') throw new HttpError(400, `${label} must contain text values.`);
    for (const part of value.split(AREA_DELIMITER)) {
      if (!part.trim()) continue;
      const area = requireText(part, label, { maxLength: 160 });
      const key = area.normalize('NFKC').toLocaleLowerCase('ar');
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push(area);
      if (distinct.length > MAX_MAINTENANCE_ORDER_AREAS) {
        throw new HttpError(400, `No more than ${MAX_MAINTENANCE_ORDER_AREAS} areas may be selected.`);
      }
    }
  }
  return distinct;
}

function parseMaintenanceOrderAreas(area) {
  if (area === null || area === undefined || area === '') return [];
  return normalizeMaintenanceAreaNames(area, 'area');
}

function includesMaintenanceArea(areas, area) {
  const key = String(area ?? '').normalize('NFKC').trim().toLocaleLowerCase('ar');
  return areas.some((candidate) => candidate.normalize('NFKC').trim().toLocaleLowerCase('ar') === key);
}

function findMaintenanceOrder(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  const order = database.prepare(`
    SELECT order_record.id, order_record.order_code, order_record.client_id,
      order_record.status, order_record.notes, order_record.area, order_record.warranty_period_months,
      order_record.petty_cash_disbursed_cents, order_record.actual_expenses_cents,
      order_record.petty_cash_refund_cents, order_record.archived_at, order_record.archive_month,
      order_record.archived_by, order_record.created_by, order_record.created_at,
      order_record.updated_at, order_record.deleted_at,
      client.code AS client_code, client.storage_code AS client_storage_code, client.name AS client_name
    FROM maintenance_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.id = ? AND order_record.deleted_at IS NULL
  `).get(id);
  if (!order) throw new HttpError(404, 'Maintenance order was not found.');
  return order;
}

function safeMachineCode(value) {
  const code = requireText(value, 'code', { maxLength: 64 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code)) {
    throw new HttpError(400, 'Machine code may contain only letters, numbers, dots, underscores, and hyphens.');
  }
  return code;
}

function parsePhotoJson(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validateStoredPhotoList(value, label) {
  if (!Array.isArray(value) || value.length > MAX_CARD_PHOTOS) {
    throw new HttpError(400, `${label} must be an array containing at most ${MAX_CARD_PHOTOS} stored file paths.`);
  }
  return value.map((photo, index) => requireText(photo, `${label}[${index}]`, { maxLength: 1024 }));
}

export function listMachines({ area, search, page = 1, limit = 100, locationStatus = 'all' } = {}, database = db) {
  const pageNumber = Number(page ?? 1);
  const pageSize = Number(limit ?? 100);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new HttpError(400, 'page must be a positive integer.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new HttpError(400, 'limit must be between 1 and 500.');
  if (!['all', 'located', 'unlocated', 'pending_correction'].includes(locationStatus)) {
    throw new HttpError(400, 'locationStatus must be all, located, unlocated, or pending_correction.');
  }
  const where = ['machine.active = 1', 'machine.deleted_at IS NULL'];
  const parameters = [];
  if (locationStatus === 'located') where.push('machine.is_location_locked = 1 AND machine.latitude IS NOT NULL AND machine.longitude IS NOT NULL');
  if (locationStatus === 'unlocated') where.push('(machine.is_location_locked != 1 OR machine.latitude IS NULL OR machine.longitude IS NULL)');
  if (locationStatus === 'pending_correction') where.push(`EXISTS (
    SELECT 1 FROM machine_correction_requests correction
    WHERE correction.machine_id = machine.id AND correction.status = 'pending'
  )`);
  if (area !== undefined && area !== '') {
    const selectedAreas = normalizeMaintenanceAreaNames(area, 'area');
    if (!selectedAreas.length) throw new HttpError(400, 'area must not be blank.');
    where.push(`machine.area COLLATE NOCASE IN (${selectedAreas.map(() => '?').join(',')})`);
    parameters.push(...selectedAreas);
  }
  const query = search ?? '';
  if (query !== '') {
    const term = `%${requireText(query, 'search', { maxLength: 160 })}%`;
    where.push(`(machine.code LIKE ? COLLATE NOCASE OR machine.name_ar LIKE ? OR machine.name_en LIKE ? COLLATE NOCASE
      OR machine.area LIKE ? COLLATE NOCASE OR EXISTS (
        SELECT 1 FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending'
          AND (correction.reported_code LIKE ? COLLATE NOCASE OR correction.reported_name LIKE ?)
      ))`);
    parameters.push(term, term, term, term, term, term);
  }
  const condition = where.join(' AND ');
  const total = database.prepare(`SELECT COUNT(*) AS total FROM machines machine WHERE ${condition}`).get(...parameters).total;
  const machines = database.prepare(`
    SELECT machine.id, machine.code, machine.name_ar, machine.name_en, machine.area,
       machine.area_name, machine.latitude, machine.longitude, machine.is_location_locked,
       machine.geofence_radius_meters, machine.active, machine.created_at,
        (SELECT COUNT(*) FROM maintenance_cards card WHERE card.machine_id = machine.id AND card.deleted_at IS NULL) AS order_count,
        (SELECT COUNT(*) FROM machine_correction_requests correction
          WHERE correction.machine_id = machine.id AND correction.status = 'pending') AS pending_correction_count
    FROM machines machine WHERE ${condition}
    ORDER BY machine.area COLLATE NOCASE, machine.name_ar COLLATE NOCASE, machine.id
    LIMIT ? OFFSET ?
  `).all(...parameters, pageSize, (pageNumber - 1) * pageSize);
  return { machines, total, areas: listAreas(database), page: pageNumber, limit: pageSize };
}

/** Return the active machine catalog with pending correction coordinates for the local Admin map. */
export function getMachineMap({ area, search, locationStatus = 'all' } = {}, database = db) {
  if (!['all', 'located', 'unlocated', 'pending_correction'].includes(locationStatus)) {
    throw new HttpError(400, 'locationStatus must be all, located, unlocated, or pending_correction.');
  }
  const where = ['machine.active = 1', 'machine.deleted_at IS NULL'];
  const parameters = [];
  if (area !== undefined && area !== '') {
    const selectedAreas = normalizeMaintenanceAreaNames(area, 'area');
    if (!selectedAreas.length) throw new HttpError(400, 'area must not be blank.');
    where.push(`machine.area COLLATE NOCASE IN (${selectedAreas.map(() => '?').join(',')})`);
    parameters.push(...selectedAreas);
  }
  if (search !== undefined && search !== '') {
    const term = `%${requireText(search, 'search', { maxLength: 160 })}%`;
    where.push(`(machine.code LIKE ? COLLATE NOCASE OR machine.name_ar LIKE ? OR machine.name_en LIKE ? COLLATE NOCASE
      OR machine.area LIKE ? COLLATE NOCASE OR EXISTS (
        SELECT 1 FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending'
          AND (correction.reported_code LIKE ? COLLATE NOCASE OR correction.reported_name LIKE ?)
      ))`);
    parameters.push(term, term, term, term, term, term);
  }
  if (locationStatus === 'located') where.push('machine.is_location_locked = 1 AND machine.latitude IS NOT NULL AND machine.longitude IS NOT NULL');
  if (locationStatus === 'unlocated') where.push('(machine.is_location_locked != 1 OR machine.latitude IS NULL OR machine.longitude IS NULL)');
  if (locationStatus === 'pending_correction') where.push(`EXISTS (
    SELECT 1 FROM machine_correction_requests correction
    WHERE correction.machine_id = machine.id AND correction.status = 'pending'
  )`);

  const machines = database.prepare(`
    SELECT machine.id, machine.code, machine.name_ar, machine.name_en, machine.area,
      machine.area_name, machine.latitude, machine.longitude, machine.is_location_locked,
      machine.geofence_radius_meters,
      (SELECT COUNT(*) FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending') AS pending_correction_count,
      (SELECT correction.reported_code FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending'
        ORDER BY datetime(correction.created_at) DESC, correction.id DESC LIMIT 1) AS correction_reported_code,
      (SELECT correction.reported_name FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending'
        ORDER BY datetime(correction.created_at) DESC, correction.id DESC LIMIT 1) AS correction_reported_name,
      (SELECT json_extract(correction.location_json, '$.latitude') FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending'
        ORDER BY datetime(correction.created_at) DESC, correction.id DESC LIMIT 1) AS correction_latitude,
       (SELECT json_extract(correction.location_json, '$.longitude') FROM machine_correction_requests correction
         WHERE correction.machine_id = machine.id AND correction.status = 'pending'
         ORDER BY datetime(correction.created_at) DESC, correction.id DESC LIMIT 1) AS correction_longitude
       ,(SELECT visit.captured_at FROM rep_visits visit
         WHERE visit.machine_id = machine.id AND visit.status = 'completed'
         ORDER BY datetime(visit.captured_at) DESC, visit.id DESC LIMIT 1) AS latest_visit_at
       ,(SELECT visit.order_code FROM rep_visits visit
         WHERE visit.machine_id = machine.id AND visit.status = 'completed'
         ORDER BY datetime(visit.captured_at) DESC, visit.id DESC LIMIT 1) AS latest_visit_order_code
       ,(SELECT representative.full_name FROM rep_visits visit
         JOIN users representative ON representative.id = visit.rep_user_id
         WHERE visit.machine_id = machine.id AND visit.status = 'completed'
         ORDER BY datetime(visit.captured_at) DESC, visit.id DESC LIMIT 1) AS latest_visit_representative
    FROM machines machine
    WHERE ${where.join(' AND ')}
    ORDER BY machine.area COLLATE NOCASE, machine.name_ar COLLATE NOCASE, machine.id
  `).all(...parameters).map((machine) => ({
    ...machine,
    latitude: machine.latitude === null ? null : Number(machine.latitude),
    longitude: machine.longitude === null ? null : Number(machine.longitude),
    correction_latitude: machine.correction_latitude === null ? null : Number(machine.correction_latitude),
    correction_longitude: machine.correction_longitude === null ? null : Number(machine.correction_longitude),
    is_location_locked: Number(machine.is_location_locked) === 1,
    geofence_radius_meters: Number(machine.geofence_radius_meters) || 50,
    pending_correction_count: Number(machine.pending_correction_count) || 0,
    latest_visit: machine.latest_visit_at ? {
      captured_at: machine.latest_visit_at,
      order_code: machine.latest_visit_order_code,
      representative_name: machine.latest_visit_representative,
    } : null,
  }));
  const countWhere = ['machine.active = 1', 'machine.deleted_at IS NULL'];
  const countParameters = [];
  if (area !== undefined && area !== '') {
    const selectedAreas = normalizeMaintenanceAreaNames(area, 'area');
    countWhere.push(`machine.area COLLATE NOCASE IN (${selectedAreas.map(() => '?').join(',')})`);
    countParameters.push(...selectedAreas);
  }
  if (search !== undefined && search !== '') {
    const term = `%${requireText(search, 'search', { maxLength: 160 })}%`;
    countWhere.push(`(machine.code LIKE ? COLLATE NOCASE OR machine.name_ar LIKE ? OR machine.name_en LIKE ? COLLATE NOCASE
      OR machine.area LIKE ? COLLATE NOCASE OR EXISTS (
        SELECT 1 FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending'
          AND (correction.reported_code LIKE ? COLLATE NOCASE OR correction.reported_name LIKE ?)
      ))`);
    countParameters.push(term, term, term, term, term, term);
  }
  const allCounts = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN machine.is_location_locked = 1 AND machine.latitude IS NOT NULL AND machine.longitude IS NOT NULL THEN 1 ELSE 0 END) AS located,
      SUM(CASE WHEN machine.is_location_locked != 1 OR machine.latitude IS NULL OR machine.longitude IS NULL THEN 1 ELSE 0 END) AS unlocated,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending') THEN 1 ELSE 0 END) AS pending_correction
    FROM machines machine
    WHERE ${countWhere.join(' AND ')}
  `).get(...countParameters);
  return { machines, areas: listAreas(database), counts: Object.fromEntries(Object.entries(allCounts).map(([key, value]) => [key, Number(value) || 0])), locationStatus };
}

export function listAreas(database = db) {
  return database.prepare(`
    SELECT DISTINCT area FROM machines
    WHERE active = 1 AND deleted_at IS NULL
    ORDER BY area COLLATE NOCASE
  `).all().map((row) => row.area);
}

function safeStorageFolderName(value) {
  const safe = String(value).normalize('NFKC').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.+$/g, '');
  if (!safe || safe === '.' || safe === '..') throw new HttpError(400, 'Area must be a valid folder name.');
  return safe.slice(0, 120);
}

async function ensureMachineDirectories(machine, { includeMachine = true } = {}) {
  if (includeMachine) await ensureStorageDirectory('Machines', machine.code);
  await ensureStorageDirectory('Areas', safeStorageFolderName(machine.area));
}

export async function createMachine(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['code', 'name_ar', 'name_en', 'area']);
  const machine = {
    code: safeMachineCode(body.code),
    nameAr: requireText(body.name_ar, 'name_ar', { maxLength: 200 }),
    nameEn: optionalText(body.name_en, 'name_en', { maxLength: 200 }),
    area: requireText(body.area, 'area', { maxLength: 160 }),
  };

  const findExistingByCode = () => database.prepare(`
    SELECT id, code, name_ar, name_en, area, active, deleted_at
    FROM machines
    WHERE code = ? COLLATE NOCASE
  `).get(machine.code);
  const throwActiveCollision = (existing) => {
    throw new HttpError(409, `الماكينة بكود (${machine.code}) مسجلة ونشطة بالفعل باسم "${existing.name_ar}". يمكنك تعديلها من الجدول.`);
  };

  const preexisting = findExistingByCode();
  if (preexisting && preexisting.deleted_at === null && preexisting.active === 1) {
    throwActiveCollision(preexisting);
  }

  await ensureMachineDirectories(machine);

  try {
    return database.transaction(() => {
      const existing = findExistingByCode();
      if (existing) {
        if (existing.deleted_at !== null || existing.active === 0) {
          database.prepare(`
            UPDATE machines
            SET name_ar = ?, name_en = ?, area = ?, active = 1, deleted_at = NULL
            WHERE id = ?
          `).run(machine.nameAr, machine.nameEn, machine.area, existing.id);

          recordAudit({
            database,
            actorId,
            action: 'restore_and_update',
            entityType: 'machine',
            entityId: existing.id,
            oldValues: existing,
            newValues: { ...machine, active: 1, deleted_at: null },
          });

          return database.prepare('SELECT id, code, name_ar, name_en, area, active, created_at FROM machines WHERE id = ?')
            .get(existing.id);
        }
        throwActiveCollision(existing);
      }

      const result = database.prepare(`
        INSERT INTO machines (code, name_ar, name_en, area) VALUES (?, ?, ?, ?)
      `).run(machine.code, machine.nameAr, machine.nameEn, machine.area);
      const id = Number(result.lastInsertRowid);
      recordAudit({
        database,
        actorId,
        action: 'create',
        entityType: 'machine',
        entityId: id,
        newValues: machine,
      });
      return database.prepare('SELECT id, code, name_ar, name_en, area, active, created_at FROM machines WHERE id = ?')
        .get(id);
    }).immediate();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'Machine code already exists.');
    throw error;
  }
}

export async function updateMachine(machineId, input, actorId = null, database = db) {
  const id = positiveId(machineId, 'machineId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['code', 'name_ar', 'name_en', 'area']);
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one machine field must be provided.');
  const current = database.prepare(`SELECT * FROM machines WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!current) throw new HttpError(404, 'Machine was not found.');
  const next = {
    code: body.code === undefined ? current.code : safeMachineCode(body.code),
    name_ar: body.name_ar === undefined ? current.name_ar : requireText(body.name_ar, 'name_ar', { maxLength: 200 }),
    name_en: body.name_en === undefined ? current.name_en : optionalText(body.name_en, 'name_en', { maxLength: 200 }),
    area: body.area === undefined ? current.area : requireText(body.area, 'area', { maxLength: 160 }),
  };
  await ensureMachineDirectories({ code: next.code, area: next.area });
  try {
    database.transaction(() => {
      database.prepare(`UPDATE machines SET code = ?, name_ar = ?, name_en = ?, area = ?, active = 1, deleted_at = NULL WHERE id = ?`)
        .run(next.code, next.name_ar, next.name_en, next.area, id);
      recordAudit({ database, actorId, action: 'update', entityType: 'machine', entityId: id,
        oldValues: { code: current.code, name_ar: current.name_ar, name_en: current.name_en, area: current.area }, newValues: next });
    }).immediate();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'Machine code already exists.');
    throw error;
  }
  return database.prepare('SELECT id, code, name_ar, name_en, area, active, created_at FROM machines WHERE id = ?').get(id);
}

export function setMachineGeofenceLocation(machineId, input, actorId = null, database = db) {
  const id = positiveId(machineId, 'machineId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['latitude', 'longitude', 'areaName']);
  if (typeof body.latitude !== 'number' || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90
      || typeof body.longitude !== 'number' || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) {
    throw new HttpError(400, 'latitude and longitude must be valid numeric GPS coordinates.');
  }
  const machine = database.prepare(`SELECT id, code, name_ar, area, area_name, latitude, longitude,
    is_location_locked, geofence_radius_meters FROM machines WHERE id = ? AND active = 1 AND deleted_at IS NULL`).get(id);
  if (!machine) throw new HttpError(404, 'Active machine was not found.');
  const areaName = body.areaName === undefined
    ? (machine.area_name || machine.area)
    : requireText(body.areaName, 'areaName', { maxLength: 160 });

  return database.transaction(() => {
    database.prepare(`UPDATE machines SET latitude = ?, longitude = ?, area_name = ?,
      is_location_locked = 1, geofence_radius_meters = 50 WHERE id = ?`)
      .run(body.latitude, body.longitude, areaName, id);
    const updated = database.prepare(`SELECT id, code, name_ar, area, area_name, latitude, longitude,
      is_location_locked, geofence_radius_meters FROM machines WHERE id = ?`).get(id);
    recordAudit({
      database,
      actorId,
      action: 'set_geofence_location',
      entityType: 'machine',
      entityId: id,
      oldValues: {
        area_name: machine.area_name,
        latitude: machine.latitude,
        longitude: machine.longitude,
        is_location_locked: machine.is_location_locked,
        geofence_radius_meters: machine.geofence_radius_meters,
      },
      newValues: {
        area_name: updated.area_name,
        latitude: updated.latitude,
        longitude: updated.longitude,
        is_location_locked: updated.is_location_locked,
        geofence_radius_meters: updated.geofence_radius_meters,
      },
    });
    return updated;
  }).immediate();
}

export function resetMachineGeofenceLocation(machineId, actorId = null, database = db) {
  const id = positiveId(machineId, 'machineId');
  return database.transaction(() => {
    const machine = database.prepare(`SELECT id, latitude, longitude, is_location_locked,
      geofence_radius_meters FROM machines WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!machine) throw new HttpError(404, 'Machine was not found.');
    database.prepare(`UPDATE machines SET latitude = NULL, longitude = NULL,
      is_location_locked = 0, geofence_radius_meters = 50, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(id);
    const updated = database.prepare(`SELECT id, code, latitude, longitude, is_location_locked,
      geofence_radius_meters FROM machines WHERE id = ?`).get(id);
    recordAudit({ database, actorId, action: 'reset_geofence_location', entityType: 'machine', entityId: id,
      oldValues: machine, newValues: updated });
    return updated;
  }).immediate();
}

function parseCorrectionLocation(value) {
  try {
    const location = JSON.parse(value ?? '{}');
    return location && typeof location === 'object' && !Array.isArray(location) ? location : {};
  } catch {
    return {};
  }
}

function machineCorrectionRenameTargets(operation) {
  let targets;
  try { targets = JSON.parse(operation.targets_json ?? '[]'); } catch { targets = null; }
  if (!Array.isArray(targets) || targets.length > 512) {
    throw new HttpError(500, 'Machine correction recovery contains invalid staged paths.');
  }
  const safeSegments = (path) => typeof path === 'string' && path.length <= 2048
    && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/')
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes(':'));
  const newMachineFolder = safeMachineStorageSegment(`${operation.new_code}_${operation.new_name_ar}`);
  const sources = new Set();
  const destinations = new Set();
  for (const target of targets) {
    if (!target || !safeSegments(target.sourcePath) || !safeSegments(target.destinationPath)) {
      throw new HttpError(500, 'Machine correction recovery contains an unsafe storage path.');
    }
    const source = target.sourcePath.split('/');
    const destination = target.destinationPath.split('/');
    let valid = false;
    if (source[0] === 'Machines' && destination[0] === 'Machines') {
      valid = source.length === 2 && destination.length === 2
        && source[1].toLocaleLowerCase('en') === operation.old_code.toLocaleLowerCase('en')
        && destination[1].toLocaleLowerCase('en') === operation.new_code.toLocaleLowerCase('en');
    } else if (source[0] === 'Areas' && destination[0] === 'Areas') {
      const oldFolderPrefix = `${safeMachineStorageSegment(operation.old_code)}_`.toLocaleLowerCase('en');
      const directAreaFolder = source.length === 3 && destination.length === 3
        && source[1] === destination[1]
        && source[2].toLocaleLowerCase('en').startsWith(oldFolderPrefix)
        && destination[2] === newMachineFolder;
      const yearMonthMachineFolder = source.length === 5 && destination.length === 5
        && source.slice(1, 4).every((segment, index) => segment === destination[index + 1])
        && /^\d{4}$/.test(source[2]) && /^(0[1-9]|1[0-2])$/.test(source[3])
        && source[4].toLocaleLowerCase('en').startsWith(oldFolderPrefix)
        && destination[4] === newMachineFolder;
      valid = directAreaFolder || yearMonthMachineFolder;
    } else if (source[0]?.toLocaleLowerCase('en') === 'clients'
      && destination[0]?.toLocaleLowerCase('en') === 'clients') {
      const section = source[2]?.toLocaleLowerCase('en');
      valid = source.length === 5 && destination.length === 5
        && ['maintenance', 'archived_orders'].includes(section)
        && source.slice(0, 4).every((segment, index) => segment === destination[index])
        && source[4].toLocaleLowerCase('en') === operation.old_code.toLocaleLowerCase('en')
        && destination[4].toLocaleLowerCase('en') === operation.new_code.toLocaleLowerCase('en');
    }
    if (!valid || target.sourcePath === target.destinationPath
        || sources.has(target.sourcePath) || destinations.has(target.destinationPath)) {
      throw new HttpError(500, 'Machine correction recovery contains a duplicate or mismatched rename target.');
    }
    sources.add(target.sourcePath);
    destinations.add(target.destinationPath);
  }
  return targets;
}

function machineCorrectionRenameStagePath(operationId, index) {
  return storageDirectory(...MACHINE_CORRECTION_RENAME_STAGE_ROOT, operationId, `item-${index}`);
}

function removeMachineCorrectionRenameOperation(operationId, database) {
  database.transaction(() => {
    database.prepare('DELETE FROM machine_correction_rename_operations WHERE operation_id = ?').run(operationId);
  }).immediate();
}

async function finishMachineCorrectionRename(operation, targets) {
  const stageDirectoryPath = storageDirectory(...MACHINE_CORRECTION_RENAME_STAGE_ROOT, operation.operation_id);
  const stageDirectory = await resolveStorageDirectoryIfPresent(stageDirectoryPath);
  const stagedNames = stageDirectory ? await readdir(stageDirectory) : [];
  const expectedNames = new Set(targets.map((_, index) => `item-${index}`));
  if (stagedNames.some((name) => !expectedNames.has(name))) {
    throw new HttpError(500, 'Machine correction recovery staging contains unexpected entries.');
  }
  for (const [index, target] of targets.entries()) {
    const source = await resolveStorageDirectoryIfPresent(target.sourcePath);
    const destination = await resolveStorageDirectoryIfPresent(target.destinationPath);
    const staged = await resolveStorageDirectoryIfPresent(machineCorrectionRenameStagePath(operation.operation_id, index));
    const caseOnlyRename = target.sourcePath !== target.destinationPath
      && target.sourcePath.toLocaleLowerCase('en') === target.destinationPath.toLocaleLowerCase('en');
    if (operation.state === 'prepared') {
      if (caseOnlyRename && source && destination && !staged && source.toLocaleLowerCase('en') === destination.toLocaleLowerCase('en')) {
        if (basename(source) !== basename(target.sourcePath)) {
          throw new HttpError(500, 'A prepared case-only machine rename found the destination spelling before commit.');
        }
        continue;
      }
      if (destination || (source && staged) || (!source && !staged)) {
        throw new HttpError(500, 'Prepared machine correction has conflicting source/stage folders; startup was stopped for safety.');
      }
      if (staged) {
        const segments = target.sourcePath.split('/');
        const parent = await ensureStorageDirectory(...segments.slice(0, -1));
        await rename(staged, join(parent, segments.at(-1)));
      }
    } else if (operation.state === 'committed') {
      if (caseOnlyRename && source && destination && !staged && source.toLocaleLowerCase('en') === destination.toLocaleLowerCase('en')) {
        if (basename(destination) !== basename(target.destinationPath)) {
          throw new HttpError(500, 'A committed case-only machine rename has not reached its destination spelling.');
        }
        continue;
      }
      if ((source && staged) || (source && destination) || (staged && destination) || (!staged && !destination)) {
        throw new HttpError(500, 'Committed machine correction has conflicting source/stage folders; startup was stopped for safety.');
      }
      if (staged) {
        const segments = target.destinationPath.split('/');
        const parent = await ensureStorageDirectory(...segments.slice(0, -1));
        await rename(staged, join(parent, segments.at(-1)));
      }
    } else {
      throw new HttpError(500, 'Machine correction recovery has an unknown state.');
    }
  }
  if (stageDirectory) await rm(stageDirectory, { recursive: true, force: true });
}

async function recoverMachineCorrectionRenameOperations(database) {
  const stageRoot = await ensureStorageDirectory(...MACHINE_CORRECTION_RENAME_STAGE_ROOT);
  const stageEntries = await readdir(stageRoot, { withFileTypes: true });
  const operations = database.prepare(`
    SELECT operation_id, correction_id, machine_id, old_code, old_name_ar, new_code, new_name_ar, targets_json, state
    FROM machine_correction_rename_operations ORDER BY created_at, operation_id
  `).all();
  const operationsById = new Map(operations.map((operation) => [operation.operation_id, operation]));
  if (stageEntries.some((entry) => !entry.isDirectory() || !UUID_PATTERN.test(entry.name) || !operationsById.has(entry.name))) {
    throw new HttpError(500, 'Machine correction recovery contains an unexpected staging entry; startup was stopped for safety.');
  }
  let recoveredCount = 0;
  for (const operation of operations) {
    if (!UUID_PATTERN.test(operation.operation_id)) throw new HttpError(500, 'Machine correction recovery contains an invalid operation ID.');
    const machine = database.prepare('SELECT code, name_ar FROM machines WHERE id = ?').get(operation.machine_id);
    const correction = database.prepare('SELECT status, resolved_machine_id FROM machine_correction_requests WHERE id = ?').get(operation.correction_id);
    const isOld = machine?.code === operation.old_code && machine?.name_ar === operation.old_name_ar;
    const isNew = machine?.code === operation.new_code && machine?.name_ar === operation.new_name_ar;
    if (!correction || !machine || (operation.state === 'prepared' && (!isOld || correction.status !== 'pending'))
        || (operation.state === 'committed' && (!isNew || correction.status !== 'approved'
          || Number(correction.resolved_machine_id) !== Number(operation.machine_id)))) {
      throw new HttpError(500, 'Machine correction recovery no longer matches its database records; startup was stopped for safety.');
    }
    const targets = machineCorrectionRenameTargets(operation);
    await finishMachineCorrectionRename(operation, targets);
    removeMachineCorrectionRenameOperation(operation.operation_id, database);
    recoveredCount += 1;
  }
  return recoveredCount;
}

function remapMachineCorrectionStoragePath(value, mappings) {
  if (typeof value !== 'string') return value;
  for (const mapping of mappings) {
    if (value === mapping.sourcePath || value.startsWith(`${mapping.sourcePath}/`)) {
      return `${mapping.destinationPath}${value.slice(mapping.sourcePath.length)}`;
    }
  }
  return value;
}

async function collectMachineCorrectionRenamePlan(machine, database) {
  const newMachineFolder = safeMachineStorageSegment(`${machine.new_code}_${machine.new_name_ar}`);
  const oldCodeFolder = safeMachineStorageSegment(machine.old_code);
  const mappings = new Map();
  const addMapping = (sourcePath, destinationPath) => {
    if (!sourcePath || !destinationPath || sourcePath === destinationPath) return;
    const existing = mappings.get(sourcePath);
    if (existing && existing.destinationPath !== destinationPath) {
      throw new HttpError(409, 'Several historical machine folders would converge on one path; resolve the storage paths before approval.');
    }
    mappings.set(sourcePath, { sourcePath, destinationPath });
  };
  const areaFolderMapping = (storedPath) => {
    if (typeof storedPath !== 'string' || storedPath.includes('\\')) return;
    const segments = storedPath.split('/');
    if (segments[0] !== 'Areas') return;
    if (segments.length >= 5 && /^\d{4}$/.test(segments[2]) && /^(0[1-9]|1[0-2])$/.test(segments[3])
        && segments[4].toLocaleLowerCase('en').startsWith(`${oldCodeFolder}_`.toLocaleLowerCase('en'))) {
      const sourcePath = segments.slice(0, 5).join('/');
      addMapping(sourcePath, storageDirectory('Areas', segments[1], segments[2], segments[3], newMachineFolder));
      return;
    }
    if (segments.length < 4
        || !segments[2].toLocaleLowerCase('en').startsWith(`${oldCodeFolder}_`.toLocaleLowerCase('en'))) return;
    addMapping(segments.slice(0, 3).join('/'), storageDirectory('Areas', segments[1], newMachineFolder));
  };

  addMapping(storageDirectory('Machines', machine.old_code), storageDirectory('Machines', machine.new_code));
  const cards = database.prepare(`
    SELECT card.id, card.machine_id, card.before_photos_json, card.after_photos_json,
      order_record.order_code, client.storage_code AS client_code, order_record.area AS order_area
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    WHERE card.machine_id = ?
    ORDER BY card.id
  `).all(machine.id);
  const areas = new Set([machine.area, ...cards.flatMap((card) => parseMaintenanceOrderAreas(card.order_area))]);
  for (const card of cards) {
    addMapping(
      storageDirectory('clients', card.client_code, 'maintenance', card.order_code, machine.old_code),
      storageDirectory('clients', card.client_code, 'maintenance', card.order_code, machine.new_code),
    );
    addMapping(
      storageDirectory('Clients', card.client_code, 'Archived_Orders', card.order_code, machine.old_code),
      storageDirectory('Clients', card.client_code, 'Archived_Orders', card.order_code, machine.new_code),
    );
    for (const photoPath of maintenanceCardPhotoPaths(card)) areaFolderMapping(photoPath);
  }
  const visits = database.prepare(`
    SELECT final_path, before_path, after_path FROM rep_visits WHERE machine_id = ? ORDER BY id
  `).all(machine.id);
  for (const visit of visits) {
    for (const path of [visit.final_path, visit.before_path, visit.after_path]) areaFolderMapping(path);
  }

  for (const area of areas) {
    if (!area) continue;
    const areaDirectory = storageDirectory('Areas', safeStorageFolderName(area));
    for (const sourcePath of await maintenanceMachineAreaDirectoryPaths(areaDirectory, area, machine.id, database)) {
      const segments = sourcePath.split('/');
      addMapping(sourcePath, storageDirectory(...segments.slice(0, -1), newMachineFolder));
    }
  }

  const pathMappings = [...mappings.values()];
  const destinationPaths = new Set();
  const targets = [];
  for (const mapping of pathMappings) {
    const normalizedDestinationPath = mapping.destinationPath.toLocaleLowerCase('en');
    if (destinationPaths.has(normalizedDestinationPath)) {
      throw new HttpError(409, 'Several machine folders share the corrected destination; resolve them before approval.');
    }
    destinationPaths.add(normalizedDestinationPath);
    const sourcePath = await resolveStorageDirectoryIfPresent(mapping.sourcePath);
    const destinationPath = await resolveStorageDirectoryIfPresent(mapping.destinationPath);
    const samePathIgnoringCase = mapping.sourcePath.toLocaleLowerCase('en') === mapping.destinationPath.toLocaleLowerCase('en');
    if (sourcePath && destinationPath && !samePathIgnoringCase) {
      throw new HttpError(409, `The corrected machine folder already exists: ${mapping.destinationPath}`);
    }
    if (!sourcePath && destinationPath) {
      throw new HttpError(409, `An unrelated folder already uses the corrected machine path: ${mapping.destinationPath}`);
    }
    if (sourcePath && mapping.sourcePath !== mapping.destinationPath) {
      targets.push(mapping);
    }
  }
  if (targets.length > 512) throw new HttpError(409, 'Too many machine folders require a rename; split the correction for review.');
  return { pathMappings, targets };
}

function remapMachineCorrectionHistory(machineId, pathMappings, database) {
  const cards = database.prepare(`SELECT id, before_photos_json, after_photos_json
    FROM maintenance_cards WHERE machine_id = ? ORDER BY id`).all(machineId);
  for (const card of cards) {
    let before;
    let after;
    try {
      before = JSON.parse(card.before_photos_json);
      after = JSON.parse(card.after_photos_json);
    } catch {
      throw new HttpError(409, 'An inspection card photo list is invalid and cannot be safely renamed.');
    }
    if (!Array.isArray(before) || !Array.isArray(after)
        || [...before, ...after].some((path) => typeof path !== 'string')) {
      throw new HttpError(409, 'An inspection card photo list is invalid and cannot be safely renamed.');
    }
    const nextBefore = before.map((path) => remapMachineCorrectionStoragePath(path, pathMappings));
    const nextAfter = after.map((path) => remapMachineCorrectionStoragePath(path, pathMappings));
    if (nextBefore.some((path, index) => path !== before[index])
        || nextAfter.some((path, index) => path !== after[index])) {
      database.prepare('UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ? WHERE id = ?')
        .run(JSON.stringify(nextBefore), JSON.stringify(nextAfter), card.id);
      reconcileCardPhotoReviewPaths(card.id, database);
    }
  }
  const visits = database.prepare(`SELECT id, final_path, before_path, after_path
    FROM rep_visits WHERE machine_id = ? ORDER BY id`).all(machineId);
  const updateVisit = database.prepare(`UPDATE rep_visits SET final_path = ?, before_path = ?, after_path = ? WHERE id = ?`);
  for (const visit of visits) {
    const next = [visit.final_path, visit.before_path, visit.after_path]
      .map((path) => remapMachineCorrectionStoragePath(path, pathMappings));
    if (next.some((path, index) => path !== [visit.final_path, visit.before_path, visit.after_path][index])) {
      updateVisit.run(...next, visit.id);
    }
  }
  const photos = database.prepare(`SELECT photo.id, photo.stored_path
    FROM rep_visit_photos photo JOIN rep_visits visit ON visit.id = photo.visit_id
    WHERE visit.machine_id = ? ORDER BY photo.id`).all(machineId);
  const updatePhoto = database.prepare('UPDATE rep_visit_photos SET stored_path = ? WHERE id = ?');
  for (const photo of photos) {
    const nextPath = remapMachineCorrectionStoragePath(photo.stored_path, pathMappings);
    if (nextPath !== photo.stored_path) updatePhoto.run(nextPath, photo.id);
  }
}

export function getMachineCorrectionRequests({ status = 'pending' } = {}, database = db) {
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
    throw new HttpError(400, 'status must be pending, approved, rejected, or all.');
  }
  const parameters = status === 'all' ? [] : [status];
  const where = status === 'all'
    ? "WHERE correction.request_type = 'machine_identity'"
    : "WHERE correction.request_type = 'machine_identity' AND correction.status = ?";
  const rows = database.prepare(`
    SELECT correction.id, correction.machine_id, correction.card_id, correction.rep_user_id,
      correction.reported_code, correction.reported_name, correction.note, correction.location_json,
      correction.captured_at, correction.status, correction.resolved_machine_id,
      correction.evidence_data IS NOT NULL AS has_evidence,
      correction.evidence_content_type, correction.created_at, correction.updated_at,
      rep.full_name AS representative_name, machine.code AS current_machine_code,
      machine.name_ar AS current_machine_name, machine.area AS current_machine_area,
      order_record.order_code,
       review.action AS review_action, review.review_note, review.approved_code, review.created_at AS reviewed_at,
      reviewer.full_name AS reviewer_name
    FROM machine_correction_requests correction
    JOIN users rep ON rep.id = correction.rep_user_id
    JOIN machines machine ON machine.id = correction.machine_id
    JOIN maintenance_cards card ON card.id = correction.card_id
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    LEFT JOIN machine_correction_reviews review ON review.id = (
      SELECT latest.id FROM machine_correction_reviews latest
      WHERE latest.correction_id = correction.id
      ORDER BY datetime(latest.created_at) DESC, latest.id DESC LIMIT 1
    )
    LEFT JOIN users reviewer ON reviewer.id = review.actor_user_id
    ${where}
    ORDER BY CASE correction.status WHEN 'pending' THEN 0 ELSE 1 END,
      datetime(correction.created_at) DESC, correction.id DESC
    LIMIT 500
  `).all(...parameters);
  const candidatesForCode = database.prepare(`SELECT id, code, name_ar, area, active, deleted_at
    FROM machines WHERE code = ? COLLATE NOCASE
    ORDER BY id`);
  const reportingMachineCandidates = database.prepare(`SELECT DISTINCT machine.id, machine.code, machine.name_ar, machine.area,
      machine.active, machine.deleted_at
    FROM machine_correction_requests correction
    JOIN machines machine ON machine.id = correction.machine_id
     WHERE correction.request_type = 'machine_identity'
       AND correction.reported_code = ? COLLATE NOCASE AND correction.status = 'pending'
    ORDER BY machine.id`);
  const pendingSameCode = database.prepare(`SELECT COUNT(DISTINCT machine_id) AS count
    FROM machine_correction_requests
     WHERE request_type = 'machine_identity' AND status = 'pending' AND reported_code = ? COLLATE NOCASE`);
  return rows.map((row) => {
    const candidateMap = new Map();
    for (const candidate of [...candidatesForCode.all(row.reported_code), ...reportingMachineCandidates.all(row.reported_code)]) {
      candidateMap.set(Number(candidate.id), {
        id: Number(candidate.id),
        code: candidate.code,
        name_ar: candidate.name_ar,
        area: candidate.area,
        active: candidate.active === 1 && candidate.deleted_at === null,
        matches_reported_code: candidate.code.toLocaleLowerCase('en') === row.reported_code.toLocaleLowerCase('en'),
      });
    }
    const duplicateCandidates = [...candidateMap.values()];
    const reportedByMachineCount = Number(pendingSameCode.get(row.reported_code)?.count) || 0;
    const codeConflict = duplicateCandidates.some((candidate) => candidate.id !== Number(row.machine_id))
      || reportedByMachineCount > 1;
    const { location_json: locationJson, ...rest } = row;
    return {
      ...rest,
      id: Number(row.id),
      machine_id: Number(row.machine_id),
      card_id: Number(row.card_id),
      rep_user_id: Number(row.rep_user_id),
      resolved_machine_id: row.resolved_machine_id === null ? null : Number(row.resolved_machine_id),
      has_evidence: Boolean(row.has_evidence),
      location: parseCorrectionLocation(locationJson),
      duplicateCandidates,
      reportedByMachineCount,
      codeConflict,
      evidenceUrl: row.has_evidence ? `/api/maintenance/machine-corrections/${Number(row.id)}/evidence` : null,
    };
  });
}

export function getMachineCorrectionEvidence(correctionId, database = db) {
  const id = positiveId(correctionId, 'correctionId');
  const row = database.prepare(`SELECT evidence_data, evidence_content_type
     FROM machine_correction_requests WHERE id = ? AND request_type = 'machine_identity'`).get(id);
  if (!row) throw new HttpError(404, 'Machine correction request was not found.');
  if (!row.evidence_data || !row.evidence_content_type) throw new HttpError(404, 'This correction has no evidence photo.');
  return { data: row.evidence_data, contentType: row.evidence_content_type };
}

function correctionCodeCandidates(code, database) {
  const codeCandidates = database.prepare(`SELECT id, code, name_ar, area, active, deleted_at FROM machines
    WHERE code = ? COLLATE NOCASE`).all(code);
  const reportingCandidates = database.prepare(`SELECT DISTINCT machine.id, machine.code, machine.name_ar, machine.area,
      machine.active, machine.deleted_at
    FROM machine_correction_requests request
    JOIN machines machine ON machine.id = request.machine_id
     WHERE request.request_type = 'machine_identity'
       AND request.reported_code = ? COLLATE NOCASE AND request.status = 'pending'`).all(code);
  const all = new Map([...codeCandidates, ...reportingCandidates]
    .map((candidate) => [Number(candidate.id), candidate]));
  const active = new Map([...all].filter(([, candidate]) => candidate.active === 1 && candidate.deleted_at === null));
  return {
    all,
    active,
    hasConflict: [...all.keys()].length > 1,
  };
}

export function getMachineCorrectionCodeCandidates(correctionId, code, database = db) {
  const id = positiveId(correctionId, 'correctionId');
  const approvedCode = safeMachineCode(code);
  const correction = database.prepare(`SELECT machine_id FROM machine_correction_requests
    WHERE id = ? AND request_type = 'machine_identity'`).get(id);
  if (!correction) throw new HttpError(404, 'Machine correction request was not found.');
  const candidates = correctionCodeCandidates(approvedCode, database);
  const machineId = Number(correction.machine_id);
  const otherPendingReport = database.prepare(`SELECT 1 FROM machine_correction_requests
    WHERE id != ? AND request_type = 'machine_identity' AND status = 'pending'
      AND reported_code = ? COLLATE NOCASE AND machine_id != ? LIMIT 1`)
    .get(id, approvedCode, machineId);
  const candidateList = [...candidates.all.values()].map((candidate) => ({
    id: Number(candidate.id),
    code: candidate.code,
    name_ar: candidate.name_ar,
    area: candidate.area,
    active: candidate.active === 1 && candidate.deleted_at === null,
    matches_code: candidate.code.toLocaleLowerCase('en') === approvedCode.toLocaleLowerCase('en'),
  }));
  return {
    code: approvedCode,
    hasConflict: candidateList.some((candidate) => candidate.id !== machineId) || Boolean(otherPendingReport),
    candidates: candidateList,
  };
}

function saveMachineCorrectionReview({ correction, action, resolvedMachineId, approvedCode, reviewNote, actorId, database }) {
  database.prepare(`UPDATE machine_correction_requests SET status = ?, resolved_machine_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'`).run(action, resolvedMachineId, correction.id);
  database.prepare(`INSERT INTO machine_correction_reviews
    (correction_id, action, resolved_machine_id, review_note, actor_user_id, approved_code)
    VALUES (?, ?, ?, ?, ?, ?)`).run(correction.id, action, resolvedMachineId, reviewNote, actorId, approvedCode);
  recordAudit({
    database,
    actorId,
    action: `machine_correction_${action}`,
    entityType: 'machine_correction_request',
    entityId: correction.id,
    oldValues: {
      status: correction.status,
      resolved_machine_id: correction.resolved_machine_id,
    },
    newValues: {
      status: action,
      resolved_machine_id: resolvedMachineId,
      approved_code: approvedCode,
      review_note: reviewNote,
      machine_id: Number(correction.machine_id),
      reported_code: correction.reported_code,
      reported_name: correction.reported_name,
    },
  });
}

/** Rename only the reported machine for unique codes; duplicate codes remain link/reject decisions, never merges. */
export async function resolveMachineCorrection(correctionId, input, actorId, database = db) {
  const id = positiveId(correctionId, 'correctionId');
  const actor = positiveId(actorId, 'actorId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['action', 'resolvedMachineId', 'approvedCode', 'note']);
  if (!['approved', 'rejected'].includes(body.action)) throw new HttpError(400, 'action must be approved or rejected.');
  const reviewNote = optionalText(body.note, 'note', { maxLength: 2000 });
  const requestedMachineId = body.resolvedMachineId === undefined || body.resolvedMachineId === null || body.resolvedMachineId === ''
    ? null : positiveId(body.resolvedMachineId, 'resolvedMachineId');
  if (body.action === 'rejected' && (requestedMachineId !== null || body.approvedCode !== undefined)) {
    throw new HttpError(400, 'A rejected correction cannot be linked to a machine.');
  }
  if (hasPendingMaintenanceFileRecovery(database)) {
    throw new HttpError(409, 'A maintenance file recovery is pending. Restart the server before reviewing machine corrections.');
  }

  const lockMachineId = database.prepare(`SELECT machine_id FROM machine_correction_requests
    WHERE id = ? AND request_type = 'machine_identity'`).get(id)?.machine_id ?? id;
  return withMaintenanceOrderStorageLock(async () => withMachineStorageLock(lockMachineId, async () => {
    if (hasPendingMaintenanceFileRecovery(database)) {
      throw new HttpError(409, 'A maintenance file recovery is pending. Restart the server before reviewing machine corrections.');
    }
    const correction = database.prepare(`SELECT * FROM machine_correction_requests
      WHERE id = ? AND request_type = 'machine_identity'`).get(id);
    if (!correction) throw new HttpError(404, 'Machine correction request was not found.');
    if (correction.status !== 'pending') throw new HttpError(409, 'This machine correction has already been reviewed.');
    if (body.action === 'rejected') {
      database.transaction(() => saveMachineCorrectionReview({
        correction, action: 'rejected', resolvedMachineId: null, approvedCode: null,
        reviewNote, actorId: actor, database,
      })).immediate();
      return { success: true, id, status: 'rejected', resolvedMachineId: null };
    }

    const approvedCode = safeMachineCode(body.approvedCode === undefined ? correction.reported_code : body.approvedCode);
    const machineId = Number(correction.machine_id);
    const machine = database.prepare(`SELECT id, code, name_ar, name_en, area, area_name, active, deleted_at
      FROM machines WHERE id = ?`).get(machineId);
    if (!machine || machine.active !== 1 || machine.deleted_at !== null) {
      throw new HttpError(409, 'The machine attached to this report is no longer active.');
    }
    const candidates = correctionCodeCandidates(approvedCode, database);
    const conflictingMachine = [...candidates.all.keys()].some((candidateId) => candidateId !== machineId);
    const conflictsWithAnotherReport = database.prepare(`SELECT 1 FROM machine_correction_requests
      WHERE id != ? AND request_type = 'machine_identity' AND status = 'pending'
        AND reported_code = ? COLLATE NOCASE AND machine_id != ? LIMIT 1`)
      .get(id, approvedCode, machineId);
    const hasConflict = conflictingMachine || Boolean(conflictsWithAnotherReport);
    if (hasConflict) {
      if (requestedMachineId === null) {
        throw new HttpError(400, 'This code is already used. Select its active machine record or enter a different unique code. No records were merged.');
      }
      const selectedCandidate = candidates.active.get(requestedMachineId);
      if (requestedMachineId === machineId || !selectedCandidate
          || selectedCandidate.code.toLocaleLowerCase('en') !== approvedCode.toLocaleLowerCase('en')) {
        throw new HttpError(400, 'Select a different active machine record with this exact code. No machine records were merged.');
      }
      database.transaction(() => saveMachineCorrectionReview({
        correction, action: 'approved', resolvedMachineId: requestedMachineId, approvedCode,
        reviewNote, actorId: actor, database,
      })).immediate();
      return { success: true, id, status: 'approved', resolvedMachineId: requestedMachineId, approvedCode, merged: false };
    }
    if (requestedMachineId !== null && requestedMachineId !== machineId) {
      throw new HttpError(400, 'The corrected code is unique; it must be applied to the machine attached to this report.');
    }

    const plan = await collectMachineCorrectionRenamePlan({
      ...machine,
      id: machineId,
      old_code: machine.code,
      old_name_ar: machine.name_ar,
      new_code: approvedCode,
      new_name_ar: correction.reported_name,
    }, database);
    const operationId = plan.targets.length ? randomUUID() : null;
    const operation = operationId ? {
      operation_id: operationId,
      correction_id: id,
      machine_id: machineId,
      old_code: machine.code,
      old_name_ar: machine.name_ar,
      new_code: approvedCode,
      new_name_ar: correction.reported_name,
      targets_json: JSON.stringify(plan.targets),
      state: 'prepared',
    } : null;

    if (operation) {
      database.transaction(() => {
        database.prepare(`INSERT INTO machine_correction_rename_operations
          (operation_id, correction_id, machine_id, old_code, old_name_ar, new_code, new_name_ar, targets_json, state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared')`)
          .run(operation.operation_id, id, machineId, machine.code, machine.name_ar, approvedCode,
            correction.reported_name, operation.targets_json);
      }).immediate();
      const stageDirectory = await ensureStorageDirectory(...MACHINE_CORRECTION_RENAME_STAGE_ROOT, operationId);
      try {
        for (const [index, target] of plan.targets.entries()) {
          const source = await resolveStorageDirectory(target.sourcePath);
          await rename(source, join(stageDirectory, `item-${index}`));
        }
      } catch (error) {
        try {
          await finishMachineCorrectionRename(operation, machineCorrectionRenameTargets(operation));
          removeMachineCorrectionRenameOperation(operationId, database);
        } catch (restoreError) {
          console.error(`Machine correction folder rollback for ${machine.code} is pending: ${restoreError.message}`);
          throw new HttpError(500, 'The correction was not approved, but machine-folder recovery is pending. Restart the server before continuing.');
        }
        throw error;
      }
    }

    let committed = false;
    try {
      const result = database.transaction(() => {
        const currentCorrection = database.prepare(`SELECT * FROM machine_correction_requests
          WHERE id = ? AND request_type = 'machine_identity'`).get(id);
        const currentMachine = database.prepare(`SELECT id, code, name_ar, active, deleted_at FROM machines WHERE id = ?`).get(machineId);
        if (!currentCorrection || currentCorrection.status !== 'pending'
            || !currentMachine || currentMachine.code !== machine.code || currentMachine.name_ar !== machine.name_ar
            || currentMachine.active !== 1 || currentMachine.deleted_at !== null) {
          throw new HttpError(409, 'The correction or machine changed while its folders were being prepared.');
        }
        const currentCandidates = correctionCodeCandidates(approvedCode, database);
        if ([...currentCandidates.all.keys()].some((candidateId) => candidateId !== machineId)) {
          throw new HttpError(409, 'The corrected machine code was claimed by another record before approval.');
        }
        database.prepare(`UPDATE machines SET code = ?, name_ar = ? WHERE id = ? AND active = 1 AND deleted_at IS NULL`)
          .run(approvedCode, correction.reported_name, machineId);
        remapMachineCorrectionHistory(machineId, plan.pathMappings, database);
        saveMachineCorrectionReview({
          correction: currentCorrection, action: 'approved', resolvedMachineId: machineId,
          approvedCode, reviewNote, actorId: actor, database,
        });
        recordAudit({
          database,
          actorId: actor,
          action: 'rename_from_machine_correction',
          entityType: 'machine',
          entityId: machineId,
          oldValues: { code: machine.code, name_ar: machine.name_ar },
          newValues: {
            code: approvedCode,
            name_ar: correction.reported_name,
            correction_id: id,
            updated_folder_count: plan.targets.length,
            path_mappings: plan.pathMappings,
          },
        });
        if (operationId) {
          const changed = database.prepare(`UPDATE machine_correction_rename_operations SET state = 'committed'
            WHERE operation_id = ? AND state = 'prepared'`).run(operationId);
          if (changed.changes !== 1) throw new HttpError(500, 'Machine correction rename journal was not found.');
        }
        return { success: true, id, status: 'approved', resolvedMachineId: machineId, approvedCode, renamed: true };
      }).immediate();
      committed = true;
      if (operation) {
        try {
          await finishMachineCorrectionRename({ ...operation, state: 'committed' }, machineCorrectionRenameTargets(operation));
          removeMachineCorrectionRenameOperation(operationId, database);
        } catch (error) {
          console.error(`Machine correction folder publication for ${machine.code} is pending: ${error.message}`);
          throw new HttpError(500, 'The correction was saved, but folder recovery is pending. Restart the server before continuing.');
        }
      }
      return result;
    } catch (error) {
      if (committed) throw error;
      if (operation) {
        try {
          await finishMachineCorrectionRename(operation, machineCorrectionRenameTargets(operation));
          removeMachineCorrectionRenameOperation(operationId, database);
        } catch (restoreError) {
          console.error(`Machine correction folder rollback for ${machine.code} is pending: ${restoreError.message}`);
          throw new HttpError(500, 'The correction was not approved, but machine-folder recovery is pending. Restart the server before continuing.');
        }
      }
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'The corrected machine code already exists. No machine records were merged.');
      throw error;
    }
  }));
}

export async function recoverMachineCorrectionRenames(database = db) {
  return withMaintenanceOrderStorageLock(async () => ({
    recoveredCount: await recoverMachineCorrectionRenameOperations(database),
  }));
}

export function deactivateMachine(machineId, actorId = null, database = db) {
  const id = positiveId(machineId, 'machineId');
  const machine = database.prepare('SELECT id, code, name_ar, name_en, area, active FROM machines WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!machine) throw new HttpError(404, 'Machine was not found.');
  database.transaction(() => {
    database.prepare('UPDATE machines SET active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    database.prepare('UPDATE client_machines SET active = 0 WHERE machine_id = ?').run(id);
    recordAudit({ database, actorId, action: 'deactivate', entityType: 'machine', entityId: id, oldValues: machine,
      newValues: { ...machine, active: 0, deleted_at: 'CURRENT_TIMESTAMP' } });
  }).immediate();
  return { id, active: 0 };
}

function appendMachineNoteHistory({ database, machineId, cardId = null, orderId = null, actorId = null, note }) {
  const text = String(note ?? '').trim();
  if (!text) return null;
  const actor = actorId === null ? null : database.prepare('SELECT full_name, role FROM users WHERE id = ?').get(actorId);
  const role = actor?.role === 'rep' ? 'rep' : actor?.role === 'admin' ? 'admin' : 'supervisor';
  const authorName = actor?.full_name ?? (role === 'rep' ? 'مندوب ميداني' : role === 'supervisor' ? 'مشرف' : 'إدارة');
  const result = database.prepare(`
    INSERT INTO machine_notes_history
      (machine_id, card_id, order_id, author_id, author_name, author_role, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(machineId, cardId, orderId, actorId, authorName, role, text);
  return Number(result.lastInsertRowid);
}

export function clearMachineMaintenanceNotes(machineId, actorId = null, database = db) {
  const id = positiveId(machineId, 'machineId');
  const machine = database.prepare('SELECT id, maintenance_note FROM machines WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!machine) throw new HttpError(404, 'Machine was not found.');

  return database.transaction(() => {
    const cards = database.prepare('SELECT id, notes FROM maintenance_cards WHERE machine_id = ? AND deleted_at IS NULL').all(id);
    database.prepare("UPDATE maintenance_cards SET notes = '' WHERE machine_id = ? AND deleted_at IS NULL").run(id);
    database.prepare("UPDATE machines SET maintenance_note = '' WHERE id = ?").run(id);

    for (const card of cards) {
      if (card.notes === null || card.notes === '') continue;
      recordAudit({
        database,
        actorId,
        action: 'clear_notes',
        entityType: 'maintenance_card',
        entityId: card.id,
        oldValues: { notes: card.notes },
        newValues: { notes: '' },
      });
    }

    const machineNote = String(machine.maintenance_note ?? '');
    if (machineNote.trim()) {
      recordAudit({
        database,
        actorId,
        action: 'clear_notes',
        entityType: 'machine',
        entityId: id,
        oldValues: { notes: machineNote },
        newValues: { notes: '' },
      });
    }

    return {
      id,
      clearedCount: cards.filter((card) => card.notes !== null && card.notes !== '').length + Number(Boolean(machineNote.trim())),
    };
  }).immediate();
}

export function recordMachineNote({ machineId, note, actorId = null }, database = db) {
  const id = positiveId(machineId, 'machineId');
  const machine = database.prepare(`
    SELECT id, maintenance_note
    FROM machines
    WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!machine) throw new HttpError(404, 'Machine was not found.');
  const text = requireText(note, 'notes', { maxLength: 2000 });

  return database.transaction(() => {
    const latestCard = database.prepare(`
      SELECT card.id, card.notes, card.order_id
      FROM maintenance_cards card
      JOIN maintenance_orders order_record ON order_record.id = card.order_id
      WHERE card.machine_id = ?
        AND order_record.deleted_at IS NULL
        AND card.deleted_at IS NULL
      ORDER BY COALESCE(order_record.archived_at, order_record.updated_at, order_record.created_at) DESC,
        order_record.id DESC, card.id DESC
      LIMIT 1
    `).get(id);

    if (latestCard) {
      database.prepare('UPDATE maintenance_cards SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(text, latestCard.id);
      // Card comments are authoritative when a card exists. Clear any prior
      // machine-level fallback so it cannot unexpectedly reappear later.
      database.prepare("UPDATE machines SET maintenance_note = '' WHERE id = ?").run(id);
      const historyId = appendMachineNoteHistory({
        database, machineId: id, cardId: latestCard.id, orderId: latestCard.order_id, actorId, note: text,
      });
      recordAudit({
        database,
        actorId,
        action: 'update_notes',
        entityType: 'maintenance_card',
        entityId: latestCard.id,
        oldValues: { notes: latestCard.notes ?? '' },
        newValues: { notes: text },
      });
      return { success: true, machineId: id, cardId: latestCard.id, notes: text, historyId };
    }

    database.prepare('UPDATE machines SET maintenance_note = ? WHERE id = ?').run(text, id);
    const historyId = appendMachineNoteHistory({ database, machineId: id, actorId, note: text });
    recordAudit({
      database,
      actorId,
      action: 'update_notes',
      entityType: 'machine',
      entityId: id,
      oldValues: { notes: machine.maintenance_note ?? '' },
      newValues: { notes: text },
    });
    return { success: true, machineId: id, cardId: null, notes: text, historyId };
  }).immediate();
}

export function getMachineNotesHistory(machineId, database = db) {
  return listMachineNotesHistory(machineId, database);
}

function normalizeImportHeader(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ar').replace(/[\s_\-./\\()[\]]+/g, '').replace(/[أإآ]/g, 'ا');
}

function machineImportValue(row, aliases) {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.has(normalizeImportHeader(key)) && value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

export async function importMachines(file, actorId = null, database = db) {
  if (!file?.buffer?.length) throw new HttpError(400, 'A machine workbook or CSV file is required.');
  const workbook = XLSX.read(file.buffer, { type: 'buffer', raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new HttpError(400, 'The uploaded workbook has no worksheets.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
  if (rows.length > 50000) throw new HttpError(413, 'Machine import is limited to 50,000 rows.');
  const addedMachines = [];
  const updatedMachines = [];
  let skipped = 0;
  const codeAliases = new Set(['code', 'machinecode', 'كود', 'كودالماكينة', 'كودالاله', 'الكود']);
  const arabicAliases = new Set(['namear', 'arabicname', 'namearabic', 'الاسمالعربي', 'اسمالماكينةبالعربي', 'اسمالماكينة', 'الاسم']);
  const englishAliases = new Set(['nameen', 'englishname', 'nameenglish', 'الاسمالانجليزي', 'الاسمبالانجليزية']);
  const areaAliases = new Set(['area', 'region', 'site', 'المنطقة', 'المنطقه', 'الموقع']);
  const seenCodes = new Set();

  for (const row of rows) {
    const code = machineImportValue(row, codeAliases);
    const nameAr = machineImportValue(row, arabicAliases);
    const nameEn = machineImportValue(row, englishAliases);
    const area = machineImportValue(row, areaAliases);
    try {
      if (!code || !nameAr || !area) throw new Error('required');
      const machine = { code: safeMachineCode(code), nameAr: requireText(nameAr, 'name_ar', { maxLength: 200 }),
        nameEn: optionalText(nameEn, 'name_en', { maxLength: 200 }), area: requireText(area, 'area', { maxLength: 160 }) };
      const normalizedCode = machine.code.toLocaleLowerCase('en');
      if (seenCodes.has(normalizedCode)) {
        skipped += 1;
        continue;
      }
      seenCodes.add(normalizedCode);
      const existing = database.prepare('SELECT id FROM machines WHERE code = ? COLLATE NOCASE').get(machine.code);
      if (existing) updatedMachines.push({ ...machine, id: existing.id });
      else addedMachines.push(machine);
    } catch {
      skipped += 1;
    }
  }

  const machinesToWrite = [...addedMachines, ...updatedMachines];
  for (const machine of machinesToWrite) await ensureMachineDirectories(machine);
  database.transaction(() => {
    const upsert = database.prepare(`
      INSERT INTO machines (code, name_ar, name_en, area, active, deleted_at) VALUES (?, ?, ?, ?, 1, NULL)
      ON CONFLICT(code) DO UPDATE SET name_ar = excluded.name_ar, name_en = excluded.name_en,
        area = excluded.area, active = 1, deleted_at = NULL
    `);
    for (const machine of machinesToWrite) {
      const id = machine.id ?? database.prepare('SELECT id FROM machines WHERE code = ? COLLATE NOCASE').get(machine.code)?.id ?? null;
      upsert.run(machine.code, machine.nameAr, machine.nameEn, machine.area);
      const resolvedId = id ?? database.prepare('SELECT id FROM machines WHERE code = ? COLLATE NOCASE').get(machine.code).id;
      recordAudit({ database, actorId, action: id ? 'import_update' : 'import_create', entityType: 'machine', entityId: resolvedId,
        newValues: { code: machine.code, name_ar: machine.nameAr, name_en: machine.nameEn, area: machine.area } });
    }
  }).immediate();
  return { added: addedMachines.length, updated: updatedMachines.length, skipped };
}

export function previewMachineImport(file) {
  if (!file?.buffer?.length) throw new HttpError(400, 'A machine workbook or CSV file is required.');
  const workbook = XLSX.read(file.buffer, { type: 'buffer', raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new HttpError(400, 'The uploaded workbook has no worksheets.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
  const fields = {
    code: new Set(['code', 'machinecode', 'كود', 'كودالماكينة', 'كودالاله', 'الكود']),
    name_ar: new Set(['namear', 'arabicname', 'namearabic', 'الاسمالعربي', 'اسمالماكينةبالعربي', 'اسمالماكينة', 'الاسم']),
    name_en: new Set(['nameen', 'englishname', 'nameenglish', 'الاسمالانجليزي', 'الاسمبالانجليزية']),
    area: new Set(['area', 'region', 'site', 'المنطقة', 'المنطقه', 'الموقع']),
  };
  const preview = rows.slice(0, 12).map((row) => Object.fromEntries(Object.entries(fields).map(([field, aliases]) => [field, machineImportValue(row, aliases)])));
  const validRows = preview.filter((row) => row.code && row.name_ar && row.area).length;
  return { totalRows: rows.length, preview, previewValidRows: validRows };
}

const MAINTENANCE_CATEGORIES = new Set([
  'electrical_lighting', 'spotlights_transformers', 'decoration_structural',
  'awnings_supports', 'kits_accessories', 'permits_access', 'general_observation',
]);
const MAINTENANCE_MEANINGS = new Set(['executed_work', 'required_work', 'assessment', 'blocker', 'observation']);
const MAINTENANCE_UNITS = new Set(['piece', 'set']);

function normalizeReasonConfiguration(input, current = null) {
  const category = input.category === undefined ? (current?.category ?? 'general_observation') : input.category;
  const actionMeaning = input.actionMeaning === undefined ? (current?.action_meaning ?? 'observation') : input.actionMeaning;
  const countable = input.countable === undefined ? Boolean(current?.is_countable ?? false) : input.countable;
  const unit = input.unit === undefined ? (current?.unit ?? null) : input.unit;
  if (!MAINTENANCE_CATEGORIES.has(category)) throw new HttpError(400, 'category is not supported.');
  if (!MAINTENANCE_MEANINGS.has(actionMeaning)) throw new HttpError(400, 'actionMeaning is not supported.');
  if (typeof countable !== 'boolean') throw new HttpError(400, 'countable must be a boolean.');
  if (countable && !MAINTENANCE_UNITS.has(unit)) throw new HttpError(400, 'A countable reason requires unit piece or set.');
  if (!countable && unit !== null && unit !== '') throw new HttpError(400, 'A non-countable reason cannot have a unit.');
  return { category, actionMeaning, countable: Number(countable), unit: countable ? unit : null };
}

export function listMaintenanceReasons({ includeInactive = false } = {}, database = db) {
  const condition = includeInactive ? '' : 'WHERE active = 1';
  return database.prepare(`
    SELECT id, name, active, category, action_meaning AS actionMeaning,
      is_countable AS countable, unit, created_at FROM maintenance_reasons ${condition}
    ORDER BY active DESC, name COLLATE NOCASE, id
  `).all();
}

export function createMaintenanceReason(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['name', 'category', 'actionMeaning', 'countable', 'unit']);
  const name = requireText(body.name, 'name', { maxLength: 200 });
  const config = normalizeReasonConfiguration(body);
  try {
    const result = database.prepare(`INSERT INTO maintenance_reasons
      (name, category, action_meaning, is_countable, unit) VALUES (?, ?, ?, ?, ?)`)
      .run(name, config.category, config.actionMeaning, config.countable, config.unit);
    const id = Number(result.lastInsertRowid);
    recordAudit({ database, actorId, action: 'create', entityType: 'maintenance_reason', entityId: id, newValues: { name, ...config } });
    return database.prepare(`SELECT id, name, active, category, action_meaning AS actionMeaning,
      is_countable AS countable, unit, created_at FROM maintenance_reasons WHERE id = ?`).get(id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That maintenance reason already exists.');
    throw error;
  }
}

export function updateMaintenanceReason(reasonId, input, actorId = null, database = db) {
  const id = positiveId(reasonId, 'reasonId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['name', 'active', 'category', 'actionMeaning', 'countable', 'unit']);
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one maintenance reason field must be provided.');
  const current = database.prepare(`SELECT id, name, active, category, action_meaning, is_countable, unit, created_at
    FROM maintenance_reasons WHERE id = ?`).get(id);
  if (!current) throw new HttpError(404, 'Maintenance reason was not found.');

  const name = body.name === undefined ? current.name : requireText(body.name, 'name', { maxLength: 200 });
  let active = current.active;
  if (body.active !== undefined) {
    if (![true, false, 0, 1].includes(body.active)) throw new HttpError(400, 'active must be a boolean or 0/1.');
    active = Number(body.active);
  }
  const config = normalizeReasonConfiguration(body, current);

  try {
    database.transaction(() => {
      const changedInterpretation = name !== current.name || config.category !== current.category
        || config.actionMeaning !== current.action_meaning || config.countable !== current.is_countable
        || config.unit !== current.unit;
      if (changedInterpretation) {
        database.prepare(`INSERT INTO maintenance_reason_versions
          (reason_id, name, category, action_meaning, is_countable, unit, changed_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(id, current.name, current.category, current.action_meaning, current.is_countable, current.unit, actorId);
      }
      database.prepare(`UPDATE maintenance_reasons SET name = ?, active = ?, category = ?,
        action_meaning = ?, is_countable = ?, unit = ? WHERE id = ?`)
        .run(name, active, config.category, config.actionMeaning, config.countable, config.unit, id);
      recordAudit({
        database,
        actorId,
        action: 'update',
        entityType: 'maintenance_reason',
        entityId: id,
        oldValues: { name: current.name, active: current.active, category: current.category,
          actionMeaning: current.action_meaning, countable: current.is_countable, unit: current.unit },
        newValues: { name, active, ...config },
      });
    }).immediate();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That maintenance reason already exists.');
    throw error;
  }
  return database.prepare(`SELECT id, name, active, category, action_meaning AS actionMeaning,
    is_countable AS countable, unit, created_at FROM maintenance_reasons WHERE id = ?`).get(id);
}

export function deactivateMaintenanceReason(reasonId, actorId = null, database = db) {
  const id = positiveId(reasonId, 'reasonId');
  const reason = database.prepare('SELECT id, name, active, created_at FROM maintenance_reasons WHERE id = ?').get(id);
  if (!reason) throw new HttpError(404, 'Maintenance reason was not found.');
  if (reason.active) {
    database.transaction(() => {
      database.prepare('UPDATE maintenance_reasons SET active = 0 WHERE id = ?').run(id);
      recordAudit({
        database,
        actorId,
        action: 'deactivate',
        entityType: 'maintenance_reason',
        entityId: id,
        oldValues: { name: reason.name, active: reason.active },
        newValues: { name: reason.name, active: 0 },
      });
    }).immediate();
  }
  return { ...reason, active: 0 };
}

export function listMaintenanceOrders(status, database = db, filters = {}) {
  if (!MAINTENANCE_STATUSES.includes(status)) {
    throw new HttpError(400, `status is required and must be one of: ${MAINTENANCE_STATUSES.join(', ')}.`);
  }
  const conditions = ['order_record.status = ?', 'order_record.deleted_at IS NULL'];
  const parameters = [status];
  addArchiveMonthFilter(conditions, parameters, filters.month);
  const orders = database.prepare(`
    SELECT order_record.id, order_record.order_code, order_record.client_id,
      client.code AS client_code, client.name AS client_name,
      order_record.status, order_record.notes, order_record.area, order_record.warranty_period_months,
      order_record.petty_cash_disbursed_cents, order_record.actual_expenses_cents,
      order_record.petty_cash_refund_cents, order_record.archived_at, order_record.archive_month,
      order_record.created_at, order_record.updated_at,
      (
        SELECT GROUP_CONCAT(DISTINCT m.area)
        FROM maintenance_cards card
        JOIN machines m ON m.id = card.machine_id
        WHERE card.order_id = order_record.id
          AND card.deleted_at IS NULL
          AND m.area IS NOT NULL
          AND m.area != ''
      ) AS card_areas,
       (SELECT COUNT(*) FROM maintenance_cards card WHERE card.order_id = order_record.id AND card.deleted_at IS NULL) AS card_count,
       (SELECT COUNT(*) FROM maintenance_order_technicians assigned WHERE assigned.order_id = order_record.id) AS technician_count,
       (SELECT COUNT(*) FROM maintenance_order_reps assigned WHERE assigned.order_id = order_record.id) AS representative_count,
       (SELECT GROUP_CONCAT(user.full_name, '، ')
         FROM maintenance_order_reps assigned JOIN users user ON user.id = assigned.user_id
         WHERE assigned.order_id = order_record.id) AS representative_names
    FROM maintenance_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY order_record.created_at DESC, order_record.id DESC
  `).all(...parameters);

  return orders.map((row) => {
    const { card_areas: cardAreas, ...order } = row;
    const areas = [...new Set([order.area, ...(cardAreas ?? '').split(',')]
      .map((area) => String(area ?? '').trim())
      .filter(Boolean))];
    return { ...order, areas, area_summary: areas.join(' • ') };
  });
}

const MAINTENANCE_ORDER_DELETION_STAGE_ROOT = ['.madar-recovery', 'maintenance-order-deletions'];
const MAINTENANCE_CARD_DELETION_STAGE_ROOT = ['.madar-recovery', 'maintenance-card-deletions'];
const MAINTENANCE_MACHINE_DECOMMISSION_STAGE_ROOT = ['.madar-recovery', 'maintenance-machine-decommissions'];
const MACHINE_CORRECTION_RENAME_STAGE_ROOT = ['.madar-recovery', 'machine-correction-renames'];
const MAINTENANCE_UNMATCHED_FOLDER_DELETION_STAGE_ROOT = ['.madar-recovery', 'maintenance-unmatched-folder-deletions'];
const TEST_MOCK_PURGE_STAGE_ROOT = ['.madar-recovery', 'test-mock-purges'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasPendingMaintenanceFileRecovery(database) {
  return Boolean(database.prepare(`
    SELECT 1 FROM maintenance_order_deletion_operations WHERE state = 'prepared'
    UNION ALL
    SELECT 1 FROM test_mock_purge_operations WHERE state = 'prepared'
    UNION ALL
    SELECT 1 FROM maintenance_card_deletion_operations WHERE state = 'prepared'
    UNION ALL
    SELECT 1 FROM maintenance_machine_decommission_operations WHERE state = 'prepared'
    UNION ALL
    SELECT 1 FROM machine_correction_rename_operations
    UNION ALL
    SELECT 1 FROM maintenance_unmatched_folder_deletion_operations
    LIMIT 1
  `).get());
}

function assertNoPendingMaintenanceFileRecovery(database) {
  if (hasPendingMaintenanceFileRecovery(database)) {
    throw new HttpError(409, 'A maintenance file recovery is pending. Restart the server before changing maintenance photos or folders.');
  }
}

async function resolveStorageDirectoryIfPresent(relativePath) {
  try {
    return await resolveStorageDirectory(relativePath);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function resolveStorageFileIfPresent(relativePath) {
  try {
    return await resolveStorageFile(relativePath);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function isSimpleStorageSegment(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !/[\\/:\u0000]/.test(value);
}

function unmatchedFolderArchiveDirectory({ client_code: clientCode, order_code: orderCode, folder_name: folderName }) {
  if (!isSimpleStorageSegment(clientCode) || !isSimpleStorageSegment(orderCode)
    || typeof folderName !== 'string' || !folderName.trim()) {
    throw new HttpError(409, 'Unmatched folder storage metadata is invalid and cannot be safely removed.');
  }
  return storageDirectory(
    'Clients', clientCode, 'Archived_Orders', orderCode, 'Unmatched', safeTripFolderSegment(folderName),
  );
}

function unmatchedFolderSourceDirectory(sourceName, folderName) {
  if (typeof sourceName !== 'string' || extname(sourceName).toLowerCase() === '.zip') return null;
  const sourceSegments = sourceName.split('/');
  if (sourceSegments.length < 2 || sourceSegments[0] !== 'Areas'
    || sourceSegments.some((segment) => !isSimpleStorageSegment(segment))
    || !isSimpleStorageSegment(folderName)) {
    return null;
  }
  return storageDirectory(...sourceSegments, folderName);
}

function normalizedStoragePathIdentity(relativePath) {
  return relativePath.split('/').map((segment) => (
    segment.normalize('NFKC').trim().toLocaleLowerCase('en')
  )).join('/');
}

async function findExistingUnmatchedFolderSourceDirectory(sourceName, folderName) {
  const expected = unmatchedFolderSourceDirectory(sourceName, folderName);
  if (!expected) return null;
  if (await resolveStorageDirectoryIfPresent(expected)) return expected;

  const sourceSegments = sourceName.split('/');
  const sourceDirectory = await resolveStorageDirectoryIfPresent(storageDirectory(...sourceSegments));
  if (!sourceDirectory) return null;
  const matchingEntries = (await readdir(sourceDirectory, { withFileTypes: true })).filter((entry) => (
    entry.isDirectory()
      && isSimpleStorageSegment(entry.name)
      && entry.name.trim() === folderName.trim()
  ));
  if (matchingEntries.length !== 1) return null;
  const actualPath = storageDirectory(...sourceSegments, matchingEntries[0].name);
  return await resolveStorageDirectoryIfPresent(actualPath) ? actualPath : null;
}

function parseUnmatchedFolderPhotoPaths(value, label) {
  let paths;
  try { paths = JSON.parse(value); } catch {
    throw new HttpError(409, 'Unmatched folder photo metadata is invalid and cannot be safely removed.');
  }
  if (!Array.isArray(paths) || paths.length > MAX_CARD_PHOTOS
    || paths.some((path) => typeof path !== 'string' || !path.trim() || path.length > 1024)) {
    throw new HttpError(409, `${label} contains invalid photo paths.`);
  }
  return [...new Set(paths)];
}

async function collectUnmatchedFolderDeletionTargets(order, folder, database) {
  const archiveDirectory = unmatchedFolderArchiveDirectory({
    client_code: order.client_storage_code,
    order_code: order.order_code,
    folder_name: folder.folder_name,
  });
  const beforePhotos = parseUnmatchedFolderPhotoPaths(folder.before_photos_json, 'before_photos_json');
  const afterPhotos = parseUnmatchedFolderPhotoPaths(folder.after_photos_json, 'after_photos_json');
  const photos = [...new Set([...beforePhotos, ...afterPhotos])];
  const photoTargets = [];
  for (const storedPath of photos) {
    if (!storedPath.startsWith(`${archiveDirectory}/`)) {
      throw new HttpError(409, 'An unmatched photo is outside its archive folder and cannot be safely removed.');
    }
    if (await resolveStorageFileIfPresent(storedPath)) photoTargets.push({ path: storedPath, kind: 'file' });
  }

  const archiveSegment = safeTripFolderSegment(folder.folder_name);
  const otherArchiveOwner = database.prepare(`
    SELECT folder_name FROM maintenance_unmatched_folders
    WHERE order_id = ? AND id != ?
  `).all(order.id, folder.id).some((candidate) => safeTripFolderSegment(candidate.folder_name) === archiveSegment);
  const targets = [];
  if (!otherArchiveOwner && await resolveStorageDirectoryIfPresent(archiveDirectory)) {
    targets.push({ path: archiveDirectory, kind: 'directory' });
  } else {
    targets.push(...photoTargets);
  }

  const sourceDirectory = await findExistingUnmatchedFolderSourceDirectory(folder.source_name, folder.folder_name);
  const sourceIdentity = sourceDirectory ? normalizedStoragePathIdentity(sourceDirectory) : null;
  const otherSourceOwner = sourceIdentity && database.prepare(`
    SELECT source_name, folder_name FROM maintenance_unmatched_folders WHERE id != ?
  `).all(folder.id).some((candidate) => {
    const candidatePath = unmatchedFolderSourceDirectory(candidate.source_name, candidate.folder_name);
    return candidatePath && normalizedStoragePathIdentity(candidatePath) === sourceIdentity;
  });
  if (sourceDirectory && !otherSourceOwner
    && await resolveStorageDirectoryIfPresent(sourceDirectory)) {
    targets.push({ path: sourceDirectory, kind: 'directory' });
  }

  const uniqueTargets = new Map(targets.map((target) => [`${target.kind}:${target.path}`, target]));
  const distinctTargets = [...uniqueTargets.values()];
  return distinctTargets.filter((target) => !distinctTargets.some((candidate) => (
    candidate.kind === 'directory'
      && candidate.path !== target.path
      && target.path.startsWith(`${candidate.path}/`)
  )));
}

function unmatchedFolderDeletionStageDirectory(operationId) {
  return storageDirectory(...MAINTENANCE_UNMATCHED_FOLDER_DELETION_STAGE_ROOT, operationId);
}

function unmatchedFolderDeletionStagedPath(operationId, index) {
  return storageDirectory(...MAINTENANCE_UNMATCHED_FOLDER_DELETION_STAGE_ROOT, operationId, `item-${index}`);
}

function parseUnmatchedFolderDeletionTargets(targetsJson, operation) {
  let targets;
  try { targets = JSON.parse(targetsJson); } catch { targets = null; }
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 202) {
    throw new HttpError(500, 'Unmatched-folder recovery contains invalid staged paths.');
  }
  const archiveDirectory = unmatchedFolderArchiveDirectory(operation);
  const sourceDirectory = unmatchedFolderSourceDirectory(operation.source_name, operation.folder_name);
  const sourceSegments = typeof operation.source_name === 'string' ? operation.source_name.split('/') : [];
  const unique = new Set();
  for (const target of targets) {
    if (!target || typeof target.path !== 'string' || !['file', 'directory'].includes(target.kind)
      || unique.has(`${target.kind}:${target.path}`)) {
      throw new HttpError(500, 'Unmatched-folder recovery contains invalid staged paths.');
    }
    const allowedDirectory = target.kind === 'directory'
      && (target.path === archiveDirectory || (sourceDirectory && (
        target.path === sourceDirectory
        || (target.path.split('/').length === sourceSegments.length + 1
          && target.path.split('/').slice(0, -1).every((segment, index) => segment === sourceSegments[index])
          && target.path.split('/').at(-1).trim() === operation.folder_name.trim())
      )));
    const allowedFile = target.kind === 'file' && target.path.startsWith(`${archiveDirectory}/`);
    if (!allowedDirectory && !allowedFile) {
      throw new HttpError(500, 'Unmatched-folder recovery contains an unsafe path.');
    }
    unique.add(`${target.kind}:${target.path}`);
  }
  return targets;
}

async function restoreUnmatchedFolderDeletion(operationId, targets) {
  const operationDirectoryPath = unmatchedFolderDeletionStageDirectory(operationId);
  const operationDirectory = await resolveStorageDirectoryIfPresent(operationDirectoryPath);
  const stagedNames = operationDirectory ? await readdir(operationDirectory) : [];
  const expectedNames = new Set(targets.map((_, index) => `item-${index}`));
  if (stagedNames.some((name) => !expectedNames.has(name))) {
    throw new HttpError(500, 'Unmatched-folder recovery staging contains unexpected files.');
  }

  for (const [index, target] of targets.entries()) {
    const resolveTarget = target.kind === 'directory' ? resolveStorageDirectoryIfPresent : resolveStorageFileIfPresent;
    const original = await resolveTarget(target.path);
    const staged = await resolveTarget(unmatchedFolderDeletionStagedPath(operationId, index));
    if (original && staged) {
      throw new HttpError(500, 'Both original and staged unmatched-folder files exist; recovery stopped for safety.');
    }
    if (!original && !staged) {
      throw new HttpError(500, 'Neither original nor staged unmatched-folder files exist; recovery stopped for safety.');
    }
    if (staged) {
      const originalSegments = target.path.split('/');
      const originalParent = await ensureStorageDirectory(...originalSegments.slice(0, -1));
      await rename(staged, join(originalParent, originalSegments.at(-1)));
    }
  }
  if (operationDirectory) await rm(operationDirectory, { recursive: true, force: true });
}

function removeUnmatchedFolderDeletionOperation(operationId, database) {
  database.transaction(() => {
    database.prepare(`
      DELETE FROM maintenance_unmatched_folder_deletion_operations WHERE operation_id = ?
    `).run(operationId);
  }).immediate();
}

async function recoverUnmatchedFolderDeletionOperations(database) {
  const stageRoot = await ensureStorageDirectory(...MAINTENANCE_UNMATCHED_FOLDER_DELETION_STAGE_ROOT);
  const stageEntries = await readdir(stageRoot, { withFileTypes: true });
  const operations = database.prepare(`
    SELECT * FROM maintenance_unmatched_folder_deletion_operations
    ORDER BY created_at, operation_id
  `).all();
  const operationsById = new Map(operations.map((operation) => [operation.operation_id, operation]));
  if (stageEntries.some((entry) => !entry.isDirectory() || !UUID_PATTERN.test(entry.name) || !operationsById.has(entry.name))) {
    throw new HttpError(500, 'Unmatched-folder recovery contains an unexpected staging entry; startup was stopped for safety.');
  }

  let recoveredCount = 0;
  for (const operation of operations) {
    if (!UUID_PATTERN.test(operation.operation_id)) {
      throw new HttpError(500, 'Unmatched-folder recovery contains an invalid operation ID.');
    }
    const targets = parseUnmatchedFolderDeletionTargets(operation.targets_json, operation);
    const folder = database.prepare(`
      SELECT id, order_id, folder_name, source_name, status
      FROM maintenance_unmatched_folders WHERE id = ? AND order_id = ?
    `).get(operation.folder_id, operation.order_id);
    const operationDirectory = await resolveStorageDirectoryIfPresent(
      unmatchedFolderDeletionStageDirectory(operation.operation_id),
    );
    const stagedNames = operationDirectory ? await readdir(operationDirectory) : [];
    const expectedNames = new Set(targets.map((_, index) => `item-${index}`));
    if (stagedNames.some((name) => !expectedNames.has(name))) {
      throw new HttpError(500, 'Unmatched-folder recovery staging contains unexpected files; startup was stopped for safety.');
    }

    if (operation.state === 'prepared') {
      if (!folder || folder.status !== 'pending' || folder.folder_name !== operation.folder_name
        || folder.source_name !== operation.source_name) {
        throw new HttpError(500, 'A prepared unmatched-folder purge conflicts with its database row; startup was stopped for safety.');
      }
      await restoreUnmatchedFolderDeletion(operation.operation_id, targets);
    } else if (operation.state === 'committed') {
      if (folder) {
        throw new HttpError(500, 'A committed unmatched-folder purge still has a database row; startup was stopped for safety.');
      }
      const audit = database.prepare(`
        SELECT 1 FROM audit_log
        WHERE action = 'delete_unmatched_folder' AND entity_type = 'maintenance_unmatched_folder' AND entity_id = ?
        LIMIT 1
      `).get(operation.folder_id);
      if (!audit) {
        throw new HttpError(500, 'A committed unmatched-folder purge has no audit record; startup was stopped for safety.');
      }
      for (const target of targets) {
        const resolveTarget = target.kind === 'directory' ? resolveStorageDirectoryIfPresent : resolveStorageFileIfPresent;
        if (await resolveTarget(target.path)) {
          throw new HttpError(500, 'A committed unmatched-folder purge conflicts with an original path; startup was stopped for safety.');
        }
      }
      if (operationDirectory) await rm(operationDirectory, { recursive: true, force: true });
    } else {
      throw new HttpError(500, 'Unmatched-folder recovery has an unknown state; startup was stopped for safety.');
    }
    removeUnmatchedFolderDeletionOperation(operation.operation_id, database);
    recoveredCount += 1;
  }
  return recoveredCount;
}

function maintenanceCardPhotoPaths(card) {
  const paths = [];
  for (const value of [card.before_photos_json, card.after_photos_json]) {
    let parsed;
    try { parsed = JSON.parse(value); } catch {
      throw new HttpError(409, 'The inspection card photo list is invalid and cannot be safely removed.');
    }
    if (!Array.isArray(parsed) || parsed.length > MAX_CARD_PHOTOS || parsed.some((path) => typeof path !== 'string' || !path.trim())) {
      throw new HttpError(409, 'The inspection card photo list is invalid and cannot be safely removed.');
    }
    paths.push(...parsed);
  }
  return [...new Set(paths)];
}

function maintenanceCardMachineDirectories(order, card) {
  return [
    storageDirectory('Machines', card.machine_code),
    storageDirectory('clients', order.client_storage_code, 'maintenance', order.order_code, card.machine_code),
    storageDirectory('Clients', order.client_storage_code, 'Archived_Orders', order.order_code, card.machine_code),
  ];
}

function findMachineForAreaFolder(folderName, area, machineId, database) {
  const machines = database.prepare(`
    SELECT id, code, name_ar, name_en, area
    FROM machines
    WHERE area = ? COLLATE NOCASE
    ORDER BY id
  `).all(area);
  return matchMachineFolder(folderName, machines)?.id === machineId;
}

async function maintenanceMachineAreaDirectoryPaths(relativeAreaDirectory, area, machineId, database) {
  const absoluteAreaDirectory = await resolveStorageDirectoryIfPresent(relativeAreaDirectory);
  if (!absoluteAreaDirectory) return [];
  const paths = [];
  for (const areaEntry of await readdir(absoluteAreaDirectory, { withFileTypes: true })) {
    if (!areaEntry.isDirectory() || areaEntry.name.startsWith('.')) continue;
    if (!/^\d{4}$/.test(areaEntry.name)) {
      if (findMachineForAreaFolder(areaEntry.name, area, machineId, database)) {
        paths.push(storageDirectory(relativeAreaDirectory, areaEntry.name));
      }
      continue;
    }

    const yearPath = storageDirectory(relativeAreaDirectory, areaEntry.name);
    const yearDirectory = await resolveStorageDirectoryIfPresent(yearPath);
    if (!yearDirectory) continue;
    for (const monthEntry of await readdir(yearDirectory, { withFileTypes: true })) {
      if (!monthEntry.isDirectory() || !/^(0[1-9]|1[0-2])$/.test(monthEntry.name)) continue;
      const monthPath = storageDirectory(yearPath, monthEntry.name);
      const monthDirectory = await resolveStorageDirectoryIfPresent(monthPath);
      if (!monthDirectory) continue;
      for (const machineEntry of await readdir(monthDirectory, { withFileTypes: true })) {
        if (!machineEntry.isDirectory() || machineEntry.name.startsWith('.')) continue;
        if (findMachineForAreaFolder(machineEntry.name, area, machineId, database)) {
          paths.push(storageDirectory(monthPath, machineEntry.name));
        }
      }
    }
  }
  return paths;
}

function isMaintenanceCardAreaPath(storedPath, order, card, database) {
  const segments = storedPath.split('/');
  if (segments.length < 4 || segments[0] !== 'Areas') return false;
  const area = parseMaintenanceOrderAreas(order.area)
    .find((candidate) => safeStorageFolderName(candidate) === segments[1]);
  const machineFolder = segments.length >= 5 && /^\d{4}$/.test(segments[2]) && /^\d{2}$/.test(segments[3])
    ? segments[4]
    : segments[2];
  return Boolean(area && findMachineForAreaFolder(machineFolder, area, card.machine_id, database));
}

function isMaintenanceMachineAreaDirectory(path, order, machine, database) {
  const segments = path.split('/');
  if (segments[0] !== 'Areas') return false;
  const area = parseMaintenanceOrderAreas(order.area)
    .find((candidate) => safeStorageFolderName(candidate) === segments[1]);
  const isNestedPath = segments.length === 5 && /^\d{4}$/.test(segments[2]) && /^(0[1-9]|1[0-2])$/.test(segments[3]);
  const machineFolder = segments.length === 3 ? segments[2] : isNestedPath ? segments[4] : null;
  return Boolean(area && machineFolder && findMachineForAreaFolder(machineFolder, area, machine.id, database));
}

function isMaintenanceCardPhotoPath(storedPath, order, card, database) {
  const [activeDirectory, archiveDirectory] = maintenanceCardMachineDirectories(order, card).slice(1);
  return storedPath.startsWith(`${activeDirectory}/`)
    || storedPath.startsWith(`${archiveDirectory}/`)
    || isMaintenanceCardAreaPath(storedPath, order, card, database);
}

async function collectMaintenanceMachineFolderTargets(order, machine, database) {
  const machineId = machine.machine_id ?? machine.id;
  const targets = maintenanceCardMachineDirectories(order, machine).map((path) => ({ path, kind: 'directory' }));
  for (const area of parseMaintenanceOrderAreas(order.area)) {
    const relativeAreaDirectory = storageDirectory('Areas', safeStorageFolderName(area));
    const areaMachineDirectories = await maintenanceMachineAreaDirectoryPaths(relativeAreaDirectory, area, machineId, database);
    for (const path of areaMachineDirectories) targets.push({ path, kind: 'directory' });
  }

  const uniqueTargets = new Map();
  for (const target of targets) {
    const absolutePath = await resolveStorageDirectoryIfPresent(target.path);
    if (absolutePath) uniqueTargets.set(`${target.kind}:${target.path}`, target);
  }
  const existingTargets = [...uniqueTargets.values()];
  return existingTargets.filter((target) => !existingTargets.some((candidate) => (
    candidate.kind === 'directory'
      && candidate.path !== target.path
      && target.path.startsWith(`${candidate.path}/`)
  )));
}

async function collectMaintenanceCardDeletionTargets(order, card, database) {
  const targets = await collectMaintenanceMachineFolderTargets(order, card, database);

  const directories = new Set(targets.map((target) => target.path));
  const photoTargets = [];
  for (const path of maintenanceCardPhotoPaths(card)) {
    if (!isMaintenanceCardPhotoPath(path, order, card, database)) {
      throw new HttpError(409, 'An inspection photo is outside the machine folders and cannot be safely removed.');
    }
    if (![...directories].some((directory) => path.startsWith(`${directory}/`))) {
      photoTargets.push({ path, kind: 'file' });
    }
  }

  const existingPhotos = [];
  for (const target of photoTargets) {
    if (await resolveStorageFileIfPresent(target.path)) existingPhotos.push(target);
  }
  const existingTargets = [...targets, ...existingPhotos];
  return existingTargets.filter((target) => !existingTargets.some((candidate) => (
    candidate.kind === 'directory'
      && candidate.path !== target.path
      && target.path.startsWith(`${candidate.path}/`)
  )));
}

function maintenanceCardDeletionStageDirectory(operationId) {
  return storageDirectory(...MAINTENANCE_CARD_DELETION_STAGE_ROOT, operationId);
}

function maintenanceCardDeletionStagedPath(operationId, index) {
  return storageDirectory(...MAINTENANCE_CARD_DELETION_STAGE_ROOT, operationId, `item-${index}`);
}

function parseMaintenanceCardDeletionTargets(targetsJson) {
  let targets;
  try { targets = JSON.parse(targetsJson); } catch { targets = null; }
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 2048) {
    throw new HttpError(500, 'Maintenance card recovery contains invalid staged paths.');
  }
  const unique = new Set();
  for (const target of targets) {
    if (!target || typeof target.path !== 'string' || !['file', 'directory'].includes(target.kind)
      || unique.has(`${target.kind}:${target.path}`)) {
      throw new HttpError(500, 'Maintenance card recovery contains invalid staged paths.');
    }
    unique.add(`${target.kind}:${target.path}`);
  }
  return targets;
}

function readMaintenanceCardDeletionContext(orderId, cardId, database) {
  return database.prepare(`
    SELECT card.*, machine.code AS machine_code, machine.name_ar AS machine_name_ar,
      machine.name_en AS machine_name_en, machine.area AS machine_area,
      machine.active AS machine_active, machine.deleted_at AS machine_deleted_at,
      order_record.order_code, order_record.area AS order_area, order_record.status AS order_status,
      order_record.deleted_at AS order_deleted_at, client.storage_code AS client_code
    FROM maintenance_cards card
    JOIN machines machine ON machine.id = card.machine_id
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    WHERE card.id = ? AND card.order_id = ?
  `).get(cardId, orderId);
}

function removeMaintenanceCardDeletionOperation(operationId, database) {
  database.transaction(() => {
    database.prepare('DELETE FROM maintenance_card_deletion_operations WHERE operation_id = ?').run(operationId);
  }).immediate();
}

async function restoreMaintenanceCardDeletion(operationId, targets) {
  const stageDirectoryPath = maintenanceCardDeletionStageDirectory(operationId);
  const stageDirectory = await resolveStorageDirectoryIfPresent(stageDirectoryPath);
  const stagedNames = stageDirectory ? await readdir(stageDirectory) : [];
  const expectedNames = new Set(targets.map((_, index) => `item-${index}`));
  if (stagedNames.some((name) => !expectedNames.has(name))) {
    throw new HttpError(500, 'Maintenance card recovery staging contains unexpected files.');
  }

  for (const [index, target] of targets.entries()) {
    const resolveTarget = target.kind === 'directory' ? resolveStorageDirectoryIfPresent : resolveStorageFileIfPresent;
    const original = await resolveTarget(target.path);
    const stagedPath = maintenanceCardDeletionStagedPath(operationId, index);
    const staged = await resolveTarget(stagedPath);
    if (original && staged) {
      throw new HttpError(500, 'Both original and staged maintenance card files exist; recovery stopped for safety.');
    }
    if (!original && !staged) {
      throw new HttpError(500, 'Neither original nor staged maintenance card files exist; recovery stopped for safety.');
    }
    if (staged) {
      const originalSegments = target.path.split('/');
      const originalParent = await ensureStorageDirectory(...originalSegments.slice(0, -1));
      await rename(staged, join(originalParent, originalSegments.at(-1)));
    }
  }
  if (stageDirectory) await rm(stageDirectory, { recursive: true, force: true });
}

async function recoverMaintenanceCardDeletionOperations(database) {
  const stageRoot = await ensureStorageDirectory(...MAINTENANCE_CARD_DELETION_STAGE_ROOT);
  const stageEntries = await readdir(stageRoot, { withFileTypes: true });
  const operations = database.prepare(`
    SELECT operation_id, card_id, order_id, targets_json, state
    FROM maintenance_card_deletion_operations
    ORDER BY created_at, operation_id
  `).all();
  const operationsById = new Map(operations.map((operation) => [operation.operation_id, operation]));
  if (stageEntries.some((entry) => !entry.isDirectory() || !UUID_PATTERN.test(entry.name) || !operationsById.has(entry.name))) {
    throw new HttpError(500, 'Maintenance card recovery contains an unexpected staging entry; startup was stopped for safety.');
  }

  let recoveredCount = 0;
  for (const operation of operations) {
    if (!UUID_PATTERN.test(operation.operation_id)) {
      throw new HttpError(500, 'Maintenance card recovery contains an invalid operation ID.');
    }
    const card = readMaintenanceCardDeletionContext(operation.order_id, operation.card_id, database);
    if (!card || card.order_deleted_at !== null) {
      throw new HttpError(500, 'Maintenance card recovery no longer matches its order record; startup was stopped for safety.');
    }
    const order = { ...card, area: card.order_area };
    const targets = parseMaintenanceCardDeletionTargets(operation.targets_json);
    if (targets.some((target) => {
      const allowedDirectory = target.kind === 'directory'
        && (maintenanceCardMachineDirectories(order, card).includes(target.path)
          || isMaintenanceCardAreaPath(`${target.path}/placeholder`, order, card, database));
      const allowedFile = target.kind === 'file' && isMaintenanceCardPhotoPath(target.path, order, card, database);
      return !allowedDirectory && !allowedFile;
    })) {
      throw new HttpError(500, 'Maintenance card recovery contains an unsafe path; startup was stopped for safety.');
    }

    const operationDirectoryPath = maintenanceCardDeletionStageDirectory(operation.operation_id);
    const operationDirectory = await resolveStorageDirectoryIfPresent(operationDirectoryPath);
    const stagedNames = operationDirectory ? await readdir(operationDirectory) : [];
    const expectedNames = new Set(targets.map((_, index) => `item-${index}`));
    if (stagedNames.some((name) => !expectedNames.has(name))) {
      throw new HttpError(500, 'Maintenance card recovery staging contains unexpected files; startup was stopped for safety.');
    }

    if (operation.state === 'prepared') {
      if (card.deleted_at !== null) {
        throw new HttpError(500, 'A prepared maintenance card deletion conflicts with its database record; startup was stopped for safety.');
      }
      await restoreMaintenanceCardDeletion(operation.operation_id, targets);
    } else if (operation.state === 'committed') {
      if (card.deleted_at === null || card.machine_deleted_at === null || card.machine_active !== 0) {
        throw new HttpError(500, 'A committed maintenance card deletion has an active card; startup was stopped for safety.');
      }
      for (const target of targets) {
        const resolveTarget = target.kind === 'directory' ? resolveStorageDirectoryIfPresent : resolveStorageFileIfPresent;
        if (await resolveTarget(target.path)) {
          throw new HttpError(500, 'A committed maintenance card deletion conflicts with an original file; startup was stopped for safety.');
        }
      }
      if (operationDirectory) await rm(operationDirectory, { recursive: true, force: true });
    } else {
      throw new HttpError(500, 'Maintenance card recovery has an unknown state; startup was stopped for safety.');
    }
    removeMaintenanceCardDeletionOperation(operation.operation_id, database);
    recoveredCount += 1;
  }
  return recoveredCount;
}

function maintenanceMachineDecommissionStageDirectory(operationId) {
  return storageDirectory(...MAINTENANCE_MACHINE_DECOMMISSION_STAGE_ROOT, operationId);
}

function maintenanceMachineDecommissionStagedPath(operationId, index) {
  return storageDirectory(...MAINTENANCE_MACHINE_DECOMMISSION_STAGE_ROOT, operationId, `item-${index}`);
}

function parseMaintenanceMachineDecommissionTargets(targetsJson) {
  let targets;
  try { targets = JSON.parse(targetsJson); } catch { targets = null; }
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 512
    || targets.some((target) => !target || typeof target.path !== 'string' || target.kind !== 'directory')) {
    throw new HttpError(500, 'Machine decommission recovery contains invalid staged paths.');
  }
  if (new Set(targets.map((target) => target.path)).size !== targets.length) {
    throw new HttpError(500, 'Machine decommission recovery contains duplicate staged paths.');
  }
  return targets;
}

function readMaintenanceMachineDecommissionContext(orderId, machineId, database) {
  return database.prepare(`
    SELECT machine.id, machine.code, machine.code AS machine_code, machine.name_ar, machine.name_en,
      machine.area AS machine_area, machine.active, machine.deleted_at,
      order_record.id AS order_id, order_record.order_code, order_record.area AS order_area,
      order_record.status AS order_status, order_record.deleted_at AS order_deleted_at,
      order_record.client_id, client.storage_code AS client_code
    FROM machines machine
    JOIN maintenance_orders order_record ON order_record.id = ?
    JOIN clients client ON client.id = order_record.client_id
    WHERE machine.id = ?
  `).get(orderId, machineId);
}

function removeMaintenanceMachineDecommissionOperation(operationId, database) {
  database.transaction(() => {
    database.prepare('DELETE FROM maintenance_machine_decommission_operations WHERE operation_id = ?').run(operationId);
  }).immediate();
}

async function restoreMaintenanceMachineDecommission(operationId, targets) {
  const stageDirectoryPath = maintenanceMachineDecommissionStageDirectory(operationId);
  const stageDirectory = await resolveStorageDirectoryIfPresent(stageDirectoryPath);
  const stagedNames = stageDirectory ? await readdir(stageDirectory) : [];
  const expectedNames = new Set(targets.map((_, index) => `item-${index}`));
  if (stagedNames.some((name) => !expectedNames.has(name))) {
    throw new HttpError(500, 'Machine decommission recovery staging contains unexpected files.');
  }
  for (const [index, target] of targets.entries()) {
    const original = await resolveStorageDirectoryIfPresent(target.path);
    const staged = await resolveStorageDirectoryIfPresent(maintenanceMachineDecommissionStagedPath(operationId, index));
    if (original && staged) {
      throw new HttpError(500, 'Both original and staged machine folders exist; recovery stopped for safety.');
    }
    if (!original && !staged) {
      throw new HttpError(500, 'Neither original nor staged machine folders exist; recovery stopped for safety.');
    }
    if (staged) {
      const originalSegments = target.path.split('/');
      const originalParent = await ensureStorageDirectory(...originalSegments.slice(0, -1));
      await rename(staged, join(originalParent, originalSegments.at(-1)));
    }
  }
  if (stageDirectory) await rm(stageDirectory, { recursive: true, force: true });
}

async function recoverMaintenanceMachineDecommissionOperations(database) {
  const stageRoot = await ensureStorageDirectory(...MAINTENANCE_MACHINE_DECOMMISSION_STAGE_ROOT);
  const stageEntries = await readdir(stageRoot, { withFileTypes: true });
  const operations = database.prepare(`
    SELECT operation_id, machine_id, order_id, targets_json, state
    FROM maintenance_machine_decommission_operations
    ORDER BY created_at, operation_id
  `).all();
  const operationsById = new Map(operations.map((operation) => [operation.operation_id, operation]));
  if (stageEntries.some((entry) => !entry.isDirectory() || !UUID_PATTERN.test(entry.name) || !operationsById.has(entry.name))) {
    throw new HttpError(500, 'Machine decommission recovery contains an unexpected staging entry; startup was stopped for safety.');
  }

  let recoveredCount = 0;
  for (const operation of operations) {
    if (!UUID_PATTERN.test(operation.operation_id)) {
      throw new HttpError(500, 'Machine decommission recovery contains an invalid operation ID.');
    }
    const context = readMaintenanceMachineDecommissionContext(operation.order_id, operation.machine_id, database);
    if (!context || context.order_deleted_at !== null) {
      throw new HttpError(500, 'Machine decommission recovery no longer matches its order record; startup was stopped for safety.');
    }
    const order = { ...context, area: context.order_area };
    const machine = { ...context, id: context.id, machine_code: context.code };
    const targets = parseMaintenanceMachineDecommissionTargets(operation.targets_json);
    if (targets.some((target) => !(
      maintenanceCardMachineDirectories(order, machine).includes(target.path)
      || isMaintenanceMachineAreaDirectory(target.path, order, machine, database)
    ))) {
      throw new HttpError(500, 'Machine decommission recovery contains an unsafe path; startup was stopped for safety.');
    }

    const operationDirectory = await resolveStorageDirectoryIfPresent(maintenanceMachineDecommissionStageDirectory(operation.operation_id));
    const stagedNames = operationDirectory ? await readdir(operationDirectory) : [];
    const expectedNames = new Set(targets.map((_, index) => `item-${index}`));
    if (stagedNames.some((name) => !expectedNames.has(name))) {
      throw new HttpError(500, 'Machine decommission recovery staging contains unexpected files; startup was stopped for safety.');
    }

    if (operation.state === 'prepared') {
      if (context.deleted_at !== null) {
        throw new HttpError(500, 'A prepared machine decommission conflicts with its database record; startup was stopped for safety.');
      }
      await restoreMaintenanceMachineDecommission(operation.operation_id, targets);
    } else if (operation.state === 'committed') {
      if (context.deleted_at === null) {
        throw new HttpError(500, 'A committed machine decommission has an active machine; startup was stopped for safety.');
      }
      for (const target of targets) {
        if (await resolveStorageDirectoryIfPresent(target.path)) {
          throw new HttpError(500, 'A committed machine decommission conflicts with an original folder; startup was stopped for safety.');
        }
      }
      if (operationDirectory) await rm(operationDirectory, { recursive: true, force: true });
    } else {
      throw new HttpError(500, 'Machine decommission recovery has an unknown state; startup was stopped for safety.');
    }
    removeMaintenanceMachineDecommissionOperation(operation.operation_id, database);
    recoveredCount += 1;
  }
  return recoveredCount;
}

function maintenanceOrderDeletionPaths(order, operationId) {
  const originalPath = storageDirectory('Clients', order.client_storage_code, 'Archived_Orders', order.order_code);
  const operationDirectoryPath = storageDirectory(...MAINTENANCE_ORDER_DELETION_STAGE_ROOT, operationId);
  return {
    originalPath,
    operationDirectoryPath,
    stagedPath: storageDirectory(...MAINTENANCE_ORDER_DELETION_STAGE_ROOT, operationId, 'payload'),
  };
}

function readActiveMaintenanceOrderForDeletion(orderId, database) {
  return database.prepare(`
    SELECT order_record.id, order_record.order_code, order_record.client_id,
      order_record.status, order_record.archived_at, order_record.deleted_at,
      client.code AS client_code, client.storage_code AS client_storage_code
    FROM maintenance_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.id = ? AND order_record.deleted_at IS NULL
  `).get(orderId);
}

function softDeleteMaintenanceOrder(order, actorId, database) {
  return database.transaction(() => {
    const current = readActiveMaintenanceOrderForDeletion(order.id, database);
    if (!current) throw new HttpError(404, 'Maintenance order was not found.');
    if (current.status !== 'review') throw new HttpError(409, 'Only maintenance orders awaiting review can be deleted.');
    if (current.order_code !== order.order_code || current.client_storage_code !== order.client_storage_code) {
      throw new HttpError(409, 'Maintenance order changed before it could be deleted.');
    }

    const result = database.prepare(`
      UPDATE maintenance_orders
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'review' AND deleted_at IS NULL
    `).run(order.id);
    if (result.changes !== 1) throw new HttpError(409, 'Maintenance order was already deleted or is no longer awaiting review.');
    const deleted = database.prepare('SELECT deleted_at FROM maintenance_orders WHERE id = ?').get(order.id);
    recordAudit({
      database,
      actorId,
      action: 'delete_maintenance_order',
      entityType: 'maintenance_order',
      entityId: order.id,
      oldValues: {
        order_code: current.order_code,
        client_code: current.client_code,
        status: current.status,
        archived_at: current.archived_at,
        card_count: database.prepare('SELECT COUNT(*) AS count FROM maintenance_cards WHERE order_id = ? AND deleted_at IS NULL').get(order.id).count,
      },
      newValues: {
        deleted_at: deleted.deleted_at,
        files_preserved: true,
      },
    });
    return deleted;
  }).immediate();
}

function removeMaintenanceOrderDeletionOperation(operationId, database) {
  database.transaction(() => {
    database.prepare('DELETE FROM maintenance_order_deletion_operations WHERE operation_id = ?').run(operationId);
  }).immediate();
}

export async function deleteMaintenanceOrder(orderId, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  return withMaintenanceOrderStorageLock(async () => {
    if (hasPendingMaintenanceFileRecovery(database)) {
      throw new HttpError(409, 'A maintenance photo-folder recovery is pending. Restart the server before trying again.');
    }

    const order = readActiveMaintenanceOrderForDeletion(id, database);
    if (!order) throw new HttpError(404, 'Maintenance order was not found.');
    if (order.status !== 'review') throw new HttpError(409, 'Only maintenance orders awaiting review can be deleted.');
    softDeleteMaintenanceOrder(order, actorId, database);
    return { ok: true, deletedOrderCode: order.order_code, filesPreserved: true };
  });
}

export async function recoverMaintenanceOrderDeletions(database = db) {
  return withMaintenanceOrderStorageLock(async () => {
    const stageRoot = await ensureStorageDirectory(...MAINTENANCE_ORDER_DELETION_STAGE_ROOT);
    const stagedEntries = await readdir(stageRoot, { withFileTypes: true });
    const operations = database.prepare(`
      SELECT operation_id, order_id, client_code, order_code, original_path, staged_path, state
      FROM maintenance_order_deletion_operations
      ORDER BY created_at, operation_id
    `).all();
    const operationsById = new Map(operations.map((operation) => [operation.operation_id, operation]));

    for (const entry of stagedEntries) {
      if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name) || !operationsById.has(entry.name)) {
        throw new HttpError(500, 'Maintenance photo recovery contains an unexpected staging entry; startup was stopped for safety.');
      }
    }

    let recoveredCount = 0;
    for (const operation of operations) {
      if (!UUID_PATTERN.test(operation.operation_id)) {
        throw new HttpError(500, 'Maintenance photo recovery contains an invalid operation ID.');
      }
      const current = database.prepare(`
        SELECT order_record.id, order_record.order_code, order_record.deleted_at,
          client.storage_code AS client_storage_code
        FROM maintenance_orders AS order_record
        JOIN clients AS client ON client.id = order_record.client_id
        WHERE order_record.id = ?
      `).get(operation.order_id);
      if (!current || current.order_code !== operation.order_code || current.client_storage_code !== operation.client_code) {
        throw new HttpError(500, 'Maintenance photo recovery no longer matches its order record; startup was stopped for safety.');
      }

      const expectedPaths = maintenanceOrderDeletionPaths(current, operation.operation_id);
      if (operation.original_path !== expectedPaths.originalPath || operation.staged_path !== expectedPaths.stagedPath) {
        throw new HttpError(500, 'Maintenance photo recovery contains an unsafe path; startup was stopped for safety.');
      }

      const sourceDirectory = await resolveStorageDirectoryIfPresent(operation.original_path);
      const operationDirectory = await resolveStorageDirectoryIfPresent(expectedPaths.operationDirectoryPath);
      const stagedDirectory = await resolveStorageDirectoryIfPresent(operation.staged_path);
      const operationContents = operationDirectory ? await readdir(operationDirectory) : [];
      if (operationContents.some((name) => name !== 'payload')
        || (stagedDirectory && !operationContents.includes('payload'))) {
        throw new HttpError(500, 'Maintenance photo recovery staging contains unexpected files; startup was stopped for safety.');
      }

      if (operation.state === 'prepared') {
        if (current.deleted_at !== null) {
          throw new HttpError(500, 'A prepared maintenance photo deletion has an already-deleted order; startup was stopped for safety.');
        }
        if (sourceDirectory && stagedDirectory) {
          throw new HttpError(500, 'Both original and staged maintenance photo folders exist; startup was stopped for safety.');
        }
        if (!sourceDirectory && !stagedDirectory) {
          throw new HttpError(500, 'Neither original nor staged maintenance photo folder exists; startup was stopped for safety.');
        }
        if (stagedDirectory) {
          const originalSegments = operation.original_path.split('/');
          const originalParent = await ensureStorageDirectory(...originalSegments.slice(0, -1));
          await rename(stagedDirectory, join(originalParent, originalSegments.at(-1)));
        }
        if (operationDirectory) await rm(operationDirectory, { recursive: true, force: true });
      } else if (operation.state === 'committed') {
        if (current.deleted_at === null || (sourceDirectory && stagedDirectory) || (!sourceDirectory && !stagedDirectory)) {
          throw new HttpError(500, 'A committed maintenance-order recovery conflicts with its retained files; startup was stopped for safety.');
        }
        if (stagedDirectory) {
          const originalSegments = operation.original_path.split('/');
          const originalParent = await ensureStorageDirectory(...originalSegments.slice(0, -1));
          await rename(stagedDirectory, join(originalParent, originalSegments.at(-1)));
        }
        if (operationDirectory) await rm(operationDirectory, { recursive: true, force: true });
      } else {
        throw new HttpError(500, 'Maintenance photo recovery has an unknown state; startup was stopped for safety.');
      }

      removeMaintenanceOrderDeletionOperation(operation.operation_id, database);
      recoveredCount += 1;
    }
    return { recoveredCount };
  });
}

export async function deleteMaintenanceCard(orderId, cardId, actorId = null, database = db) {
  const oId = positiveId(orderId, 'orderId');
  const cId = positiveId(cardId, 'cardId');
  return withMaintenanceOrderStorageLock(async () => {
    if (hasPendingMaintenanceFileRecovery(database)) {
      throw new HttpError(409, 'A maintenance card file recovery is pending. Restart the server before trying again.');
    }

    const order = findMaintenanceOrder(oId, database);
    if (order.status !== 'in_progress') {
      throw new HttpError(409, 'Inspection cards can only be deleted while the order is in progress.');
    }
    const card = readMaintenanceCardDeletionContext(oId, cId, database);
    if (!card || card.deleted_at !== null) throw new HttpError(404, 'Inspection card was not found.');

    const targets = await collectMaintenanceCardDeletionTargets(order, card, database);
    const operationId = targets.length ? randomUUID() : null;
    if (operationId) {
      database.transaction(() => {
        const currentOrder = findMaintenanceOrder(oId, database);
        const currentCard = readMaintenanceCardDeletionContext(oId, cId, database);
        if (currentOrder.status !== 'in_progress' || !currentCard || currentCard.deleted_at !== null) {
          throw new HttpError(409, 'The maintenance card changed while its files were being prepared.');
        }
        database.prepare(`
          INSERT INTO maintenance_card_deletion_operations
            (operation_id, card_id, order_id, targets_json, state)
          VALUES (?, ?, ?, ?, 'prepared')
        `).run(operationId, cId, oId, JSON.stringify(targets));
      }).immediate();
    }

    let stageDirectory = null;
    let committed = false;
    try {
      if (operationId) {
        stageDirectory = await ensureStorageDirectory(...MAINTENANCE_CARD_DELETION_STAGE_ROOT, operationId);
        for (const [index, target] of targets.entries()) {
          const source = target.kind === 'directory'
            ? await resolveStorageDirectoryIfPresent(target.path)
            : await resolveStorageFileIfPresent(target.path);
          if (!source) throw new HttpError(409, 'A machine folder changed while its files were being staged.');
          const stagedSegments = maintenanceCardDeletionStagedPath(operationId, index).split('/');
          const stagedParent = await ensureStorageDirectory(...stagedSegments.slice(0, -1));
          await rename(source, join(stagedParent, stagedSegments.at(-1)));
        }
      }

      const deletedAt = database.transaction(() => {
        const currentOrder = findMaintenanceOrder(oId, database);
        const currentCard = readMaintenanceCardDeletionContext(oId, cId, database);
        if (currentOrder.status !== 'in_progress') {
          throw new HttpError(409, 'Inspection cards can only be deleted while the order is in progress.');
        }
        if (!currentCard || currentCard.deleted_at !== null
          || currentCard.machine_id !== card.machine_id
          || currentCard.machine_code !== card.machine_code
          || currentOrder.order_code !== order.order_code
          || currentOrder.client_storage_code !== order.client_storage_code) {
          throw new HttpError(409, 'The maintenance card changed while its files were being staged.');
        }

        const update = database.prepare(`
          UPDATE maintenance_cards
          SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND order_id = ? AND deleted_at IS NULL
        `).run(cId, oId);
        if (update.changes !== 1) throw new HttpError(409, 'The inspection card was already removed.');
        const machineUpdate = database.prepare(`
          UPDATE machines
          SET active = 0, deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
          WHERE id = ?
        `).run(card.machine_id);
        if (machineUpdate.changes !== 1) throw new HttpError(409, 'The machine was not found while decommissioning its inspection card.');
        database.prepare('UPDATE client_machines SET active = 0 WHERE machine_id = ?').run(card.machine_id);
        if (operationId) {
          const journalUpdate = database.prepare(`
            UPDATE maintenance_card_deletion_operations
            SET state = 'committed'
            WHERE operation_id = ? AND card_id = ? AND state = 'prepared'
          `).run(operationId, cId);
          if (journalUpdate.changes !== 1) throw new HttpError(500, 'Maintenance card file recovery journal was not found.');
        }
        const deleted = database.prepare('SELECT deleted_at FROM maintenance_cards WHERE id = ?').get(cId);
        recordAudit({
          database,
          actorId,
          action: 'decommission',
          entityType: 'maintenance_card',
          entityId: cId,
          oldValues: card,
          newValues: { deleted_at: deleted.deleted_at, staged_file_and_folder_count: targets.length },
        });
        recordAudit({
          database,
          actorId,
          action: 'decommission',
          entityType: 'machine',
          entityId: card.machine_id,
          oldValues: {
            code: card.machine_code,
            name_ar: card.machine_name_ar,
            name_en: card.machine_name_en,
            area: card.machine_area,
            active: card.machine_active,
            deleted_at: card.machine_deleted_at,
          },
          newValues: {
            active: 0,
            deleted_at: database.prepare('SELECT deleted_at FROM machines WHERE id = ?').get(card.machine_id).deleted_at,
            maintenance_order_id: oId,
            inspection_card_id: cId,
            staged_folder_count: targets.length,
          },
        });
        return deleted.deleted_at;
      }).immediate();
      committed = true;

      let fileCleanupPending = false;
      if (operationId) {
        try {
          await rm(stageDirectory, { recursive: true, force: true });
          removeMaintenanceCardDeletionOperation(operationId, database);
        } catch (cleanupError) {
          fileCleanupPending = true;
          console.error(`Machine file cleanup for ${card.machine_code} remains staged for recovery: ${cleanupError.message}`);
        }
      }
      return {
        id: cId,
        machineId: card.machine_id,
        machineCode: card.machine_code,
        machineActive: 0,
        deleted: true,
        deletedAt,
        ...(fileCleanupPending ? { fileCleanupPending: true } : {}),
      };
    } catch (error) {
      if (committed) throw error;
      if (operationId) {
        try {
          await restoreMaintenanceCardDeletion(operationId, targets);
          removeMaintenanceCardDeletionOperation(operationId, database);
        } catch (restoreError) {
          console.error(`Machine file restoration for ${card.machine_code} is pending: ${restoreError.message}`);
          throw new HttpError(500, 'The inspection card was not removed, but machine-file recovery is pending. Restart the server before continuing.');
        }
      }
      throw error;
    }
  });
}

export async function decommissionMaintenanceMachineWithoutCard(orderId, machineId, actorId = null, database = db) {
  const oId = positiveId(orderId, 'orderId');
  const mId = positiveId(machineId, 'machineId');
  return withMaintenanceOrderStorageLock(async () => {
    if (hasPendingMaintenanceFileRecovery(database)) {
      throw new HttpError(409, 'A maintenance file recovery is pending. Restart the server before trying again.');
    }
    const order = findMaintenanceOrder(oId, database);
    if (order.status !== 'in_progress') {
      throw new HttpError(409, 'Machines can only be decommissioned while the order is in progress.');
    }
    const machine = readMaintenanceMachineDecommissionContext(oId, mId, database);
    if (!machine || machine.deleted_at !== null) throw new HttpError(404, 'Machine was not found.');
    if (machine.active !== 1) throw new HttpError(409, 'Only active machines can be decommissioned from this order.');
    if (!includesMaintenanceArea(parseMaintenanceOrderAreas(order.area), machine.machine_area)) {
      throw new HttpError(400, 'The machine does not belong to one of this order’s areas.');
    }
    if (database.prepare(`
      SELECT 1 FROM maintenance_cards
      WHERE order_id = ? AND machine_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(oId, mId)) {
      throw new HttpError(409, 'An active inspection card exists for this machine. Refresh the order before decommissioning it.');
    }

    const targets = await collectMaintenanceMachineFolderTargets(order, machine, database);
    const operationId = targets.length ? randomUUID() : null;
    if (operationId) {
      database.transaction(() => {
        const currentOrder = findMaintenanceOrder(oId, database);
        const currentMachine = readMaintenanceMachineDecommissionContext(oId, mId, database);
        if (currentOrder.status !== 'in_progress' || !currentMachine || currentMachine.deleted_at !== null
          || currentMachine.active !== 1 || currentMachine.code !== machine.code) {
          throw new HttpError(409, 'The machine changed while its folders were being prepared.');
        }
        database.prepare(`
          INSERT INTO maintenance_machine_decommission_operations
            (operation_id, machine_id, order_id, targets_json, state)
          VALUES (?, ?, ?, ?, 'prepared')
        `).run(operationId, mId, oId, JSON.stringify(targets));
      }).immediate();
    }

    let stageDirectory = null;
    let committed = false;
    try {
      if (operationId) {
        stageDirectory = await ensureStorageDirectory(...MAINTENANCE_MACHINE_DECOMMISSION_STAGE_ROOT, operationId);
        for (const [index, target] of targets.entries()) {
          const source = await resolveStorageDirectoryIfPresent(target.path);
          if (!source) throw new HttpError(409, 'A machine folder changed while its contents were being staged.');
          const stagedSegments = maintenanceMachineDecommissionStagedPath(operationId, index).split('/');
          const stagedParent = await ensureStorageDirectory(...stagedSegments.slice(0, -1));
          await rename(source, join(stagedParent, stagedSegments.at(-1)));
        }
      }

      const deletedAt = database.transaction(() => {
        const currentOrder = findMaintenanceOrder(oId, database);
        const currentMachine = readMaintenanceMachineDecommissionContext(oId, mId, database);
        if (currentOrder.status !== 'in_progress') {
          throw new HttpError(409, 'Machines can only be decommissioned while the order is in progress.');
        }
        if (!currentMachine || currentMachine.deleted_at !== null || currentMachine.active !== 1
          || currentMachine.code !== machine.code || currentMachine.machine_area !== machine.machine_area) {
          throw new HttpError(409, 'The machine changed while its folders were being staged.');
        }
        if (database.prepare(`
          SELECT 1 FROM maintenance_cards
          WHERE order_id = ? AND machine_id = ? AND deleted_at IS NULL
          LIMIT 1
        `).get(oId, mId)) {
          throw new HttpError(409, 'An inspection card was added while the machine folders were being staged.');
        }

        const update = database.prepare(`
          UPDATE machines
          SET active = 0, deleted_at = CURRENT_TIMESTAMP
          WHERE id = ? AND active = 1 AND deleted_at IS NULL
        `).run(mId);
        if (update.changes !== 1) throw new HttpError(409, 'The machine was already decommissioned.');
        database.prepare('UPDATE client_machines SET active = 0 WHERE machine_id = ?').run(mId);
        if (operationId) {
          const journalUpdate = database.prepare(`
            UPDATE maintenance_machine_decommission_operations
            SET state = 'committed'
            WHERE operation_id = ? AND machine_id = ? AND state = 'prepared'
          `).run(operationId, mId);
          if (journalUpdate.changes !== 1) throw new HttpError(500, 'Machine decommission recovery journal was not found.');
        }
        const deleted = database.prepare('SELECT deleted_at FROM machines WHERE id = ?').get(mId);
        recordAudit({
          database,
          actorId,
          action: 'decommission',
          entityType: 'machine',
          entityId: mId,
          oldValues: {
            code: machine.code,
            name_ar: machine.name_ar,
            name_en: machine.name_en,
            area: machine.machine_area,
            active: machine.active,
            deleted_at: machine.deleted_at,
          },
          newValues: {
            active: 0,
            deleted_at: deleted.deleted_at,
            maintenance_order_id: oId,
            staged_folder_count: targets.length,
          },
        });
        return deleted.deleted_at;
      }).immediate();
      committed = true;

      let fileCleanupPending = false;
      if (operationId) {
        try {
          await rm(stageDirectory, { recursive: true, force: true });
          removeMaintenanceMachineDecommissionOperation(operationId, database);
        } catch (cleanupError) {
          fileCleanupPending = true;
          console.error(`Machine folder cleanup for ${machine.code} remains staged for recovery: ${cleanupError.message}`);
        }
      }
      return {
        id: mId,
        code: machine.code,
        active: 0,
        deletedAt,
        ...(fileCleanupPending ? { fileCleanupPending: true } : {}),
      };
    } catch (error) {
      if (committed) throw error;
      if (operationId) {
        try {
          await restoreMaintenanceMachineDecommission(operationId, targets);
          removeMaintenanceMachineDecommissionOperation(operationId, database);
        } catch (restoreError) {
          console.error(`Machine folder restoration for ${machine.code} is pending: ${restoreError.message}`);
          throw new HttpError(500, 'The machine was not decommissioned, but folder recovery is pending. Restart the server before continuing.');
        }
      }
      throw error;
    }
  });
}

export async function recoverMaintenanceCardDeletions(database = db) {
  return withMaintenanceOrderStorageLock(async () => ({
    recoveredCount: await recoverMaintenanceCardDeletionOperations(database),
  }));
}

export async function recoverMaintenanceMachineDecommissions(database = db) {
  return withMaintenanceOrderStorageLock(async () => ({
    recoveredCount: await recoverMaintenanceMachineDecommissionOperations(database),
  }));
}

export async function recoverUnmatchedMaintenanceFolderDeletions(database = db) {
  return withMaintenanceOrderStorageLock(async () => ({
    recoveredCount: await recoverUnmatchedFolderDeletionOperations(database),
  }));
}

function assertActiveClient(clientId, database) {
  if (!database.prepare('SELECT 1 FROM clients WHERE id = ? AND deleted_at IS NULL').get(clientId)) {
    throw new HttpError(404, 'Active client was not found.');
  }
}

function assertActiveEmployees(employeeIds, department, database) {
  if (!employeeIds.length) return;
  const placeholders = employeeIds.map(() => '?').join(', ');
  const employees = database.prepare(`
    SELECT id, department FROM employees
    WHERE id IN (${placeholders}) AND active = 1 AND deleted_at IS NULL
  `).all(...employeeIds);
  if (employees.length !== employeeIds.length) {
    throw new HttpError(400, 'All assigned employees must exist and be active.');
  }
  if (employees.some((employee) => employee.department !== department)) {
    throw new HttpError(400, `Maintenance technicians must belong to the ${department} department.`);
  }
}

function assertActiveRepresentatives(repUserIds, database) {
  if (!repUserIds.length) return;
  const placeholders = repUserIds.map(() => '?').join(', ');
  const representatives = database.prepare(`
    SELECT id FROM users
    WHERE id IN (${placeholders}) AND role = 'rep' AND active = 1 AND deleted_at IS NULL
  `).all(...repUserIds);
  if (representatives.length !== repUserIds.length) {
    throw new HttpError(400, 'All assigned representatives must exist, be active, and have the rep role.');
  }
}

function nextOrderCode(database) {
  const orderCodes = database.prepare("SELECT order_code FROM maintenance_orders WHERE order_code GLOB 'MN-[0-9]*'").all();
  const largest = orderCodes.reduce((maximum, row) => {
    const match = /^MN-(\d+)$/.exec(row.order_code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 1000);
  return `MN-${String(largest + 1).padStart(4, '0')}`;
}

export function createMaintenanceOrder(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['clientId', 'area', 'areas', 'employeeIds', 'repUserIds', 'notes', 'pettyCashDisbursedCents', 'autoPopulateAreaMachines']);
  const clientId = positiveId(body.clientId, 'clientId');
  if (body.areas !== undefined && !Array.isArray(body.areas)) {
    throw new HttpError(400, 'areas must be an array of area names.');
  }
  const selectedAreas = normalizeMaintenanceAreaNames(body.areas ?? body.area, 'area');
  if (!selectedAreas.length) throw new HttpError(400, 'Select at least one maintenance area.');
  const area = selectedAreas.join('، ');
  if (body.autoPopulateAreaMachines !== undefined && typeof body.autoPopulateAreaMachines !== 'boolean') {
    throw new HttpError(400, 'autoPopulateAreaMachines must be a boolean.');
  }
  const autoPopulateAreaMachines = body.autoPopulateAreaMachines === true;
  const employeeIds = integerIdArray(body.employeeIds, 'employeeIds');
  const repUserIds = body.repUserIds === undefined ? [] : integerIdArray(body.repUserIds, 'repUserIds');
  const notes = optionalText(body.notes, 'notes', { maxLength: 10000 });
  const pettyCashDisbursedCents = body.pettyCashDisbursedCents === undefined
    ? 0
    : nonNegativeInteger(body.pettyCashDisbursedCents, 'pettyCashDisbursedCents');

  const orderId = database.transaction(() => {
    assertActiveClient(clientId, database);
    assertActiveEmployees(employeeIds, 'Maintenance', database);
    assertActiveRepresentatives(repUserIds, database);
    if (pettyCashDisbursedCents > 0) assertCashAvailable(pettyCashDisbursedCents, database);
    const orderCode = nextOrderCode(database);
    const result = database.prepare(`
      INSERT INTO maintenance_orders (order_code, client_id, area, notes, petty_cash_disbursed_cents, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orderCode, clientId, area, notes, pettyCashDisbursedCents, actorId);
    const id = Number(result.lastInsertRowid);
    let treasuryEntryId = null;
    if (pettyCashDisbursedCents > 0) {
      treasuryEntryId = insertTreasuryEntry({
        database,
        kind: 'expense',
        category: 'عهدة نقدية صيانة',
        amountCents: pettyCashDisbursedCents,
        maintenanceOrderId: id,
        reference: orderCode,
        notes: 'Maintenance petty cash custody advance',
        actorId,
      });
    }
    const assign = database.prepare(`
      INSERT INTO maintenance_order_technicians (order_id, employee_id) VALUES (?, ?)
    `);
    for (const employeeId of employeeIds) assign.run(id, employeeId);
    const assignRepresentative = database.prepare(`
      INSERT INTO maintenance_order_reps (order_id, user_id, assigned_by) VALUES (?, ?, ?)
    `);
    for (const userId of repUserIds) assignRepresentative.run(id, userId, actorId);
    let populatedMachineCount = 0;
    if (autoPopulateAreaMachines) {
      const areaMachines = database.prepare(`
        SELECT id FROM machines
        WHERE active = 1 AND deleted_at IS NULL
          AND area COLLATE NOCASE IN (${selectedAreas.map(() => '?').join(',')})
        ORDER BY area COLLATE NOCASE, code COLLATE NOCASE, id
      `).all(...selectedAreas);
      if (!areaMachines.length) throw new HttpError(400, 'No active machines were found in the selected areas.');
      const insertCard = database.prepare('INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)');
      const deployMachine = database.prepare(`
        INSERT INTO client_machines (client_id, machine_id, site_area) SELECT ?, id, area FROM machines WHERE id = ?
        ON CONFLICT(client_id, machine_id) DO UPDATE SET site_area = excluded.site_area, active = 1, last_seen_at = CURRENT_TIMESTAMP
      `);
      for (const machine of areaMachines) {
        insertCard.run(id, machine.id);
        deployMachine.run(clientId, machine.id);
      }
      populatedMachineCount = areaMachines.length;
    }
    recordAudit({
      database,
      actorId,
      action: 'create',
      entityType: 'maintenance_order',
      entityId: id,
      newValues: {
        order_code: orderCode,
        client_id: clientId,
        area,
        areas: selectedAreas,
        employee_ids: employeeIds,
        representative_user_ids: repUserIds,
        notes,
        auto_populated_machine_count: populatedMachineCount,
        petty_cash_disbursed_cents: pettyCashDisbursedCents,
        treasury_entry_id: treasuryEntryId,
      },
    });
    return id;
  }).immediate();

  return getMaintenanceOrder(orderId, database);
}

export function createTestMockMaintenanceOrder(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['representativeId', 'regionName']);
  const representativeId = positiveId(body.representativeId, 'representativeId');
  const region = optionalText(body.regionName, 'regionName', { maxLength: 160 }) || 'تجريبي';
  const fixtureId = randomUUID().replaceAll('-', '').toUpperCase();
  const machineCode = `TEST-ATM-${fixtureId}`;
  const orderCode = `MN-TEST-${fixtureId}`;
  const orderId = database.transaction(() => {
    const representative = database.prepare(`SELECT id FROM users
      WHERE id = ? AND role = 'rep' AND active = 1 AND deleted_at IS NULL`).get(representativeId);
    if (!representative) throw new HttpError(400, 'Select an active field representative.');
    const priorClient = database.prepare(`SELECT * FROM clients WHERE code = 'C-TEST'`).get() ?? null;
    database.prepare(`INSERT INTO clients (code, name, name_ar, storage_code)
      VALUES ('C-TEST', 'Test Client', 'عميل تجريبي', 'C-TEST')
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, name_ar = excluded.name_ar,
        storage_code = excluded.storage_code, deleted_at = NULL`).run();
    const client = database.prepare(`SELECT id FROM clients WHERE code = 'C-TEST' AND deleted_at IS NULL`).get();
    if (!client) throw new HttpError(409, 'The designated test client could not be initialized.');
    const currentClient = database.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    if (JSON.stringify(priorClient) !== JSON.stringify(currentClient)) {
      recordAudit({ database, actorId, action: priorClient ? 'update_test_fixture' : 'create_test_fixture',
        entityType: 'client', entityId: Number(client.id), oldValues: priorClient, newValues: currentClient });
    }
    database.prepare(`INSERT INTO machines (code, name_ar, name_en, area, is_location_locked)
      VALUES (?, 'ماكينة تجريبية لاختبار التطبيق', 'Test ATM', ?, 0)`).run(machineCode, region);
    const machine = database.prepare(`SELECT id FROM machines WHERE code = ?`).get(machineCode);
    const currentMachine = database.prepare('SELECT * FROM machines WHERE id = ?').get(machine.id);
    recordAudit({ database, actorId, action: 'create_test_fixture',
      entityType: 'machine', entityId: Number(machine.id), newValues: currentMachine });
    database.prepare(`INSERT INTO client_machines (client_id, machine_id, site_area, active)
      VALUES (?, ?, ?, 1) ON CONFLICT(client_id, machine_id) DO UPDATE SET site_area = excluded.site_area, active = 1`)
      .run(client.id, machine.id, region);
    const created = database.prepare(`INSERT INTO maintenance_orders (order_code, client_id, area, notes, created_by)
      VALUES (?, ?, ?, 'Test order for mobile representative workflow', ?)`).run(orderCode, client.id, region, actorId);
    const id = Number(created.lastInsertRowid);
    const card = database.prepare('INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)').run(id, machine.id);
    database.prepare(`INSERT INTO maintenance_order_reps (order_id, user_id, assigned_by) VALUES (?, ?, ?)`)
      .run(id, representativeId, actorId);
    recordAudit({ database, actorId, action: 'create_test_mock_order', entityType: 'maintenance_order', entityId: id,
      newValues: { order_code: orderCode, client_id: Number(client.id), machine_id: Number(machine.id), card_id: Number(card.lastInsertRowid), representative_user_id: representativeId, region } });
    return id;
  }).immediate();
  return getMaintenanceOrder(orderId, database);
}

function testMockPurgeStagePath(operationId) {
  return storageDirectory(...TEST_MOCK_PURGE_STAGE_ROOT, operationId);
}

function testMockPurgeItemPath(operationId, index) {
  return storageDirectory(...TEST_MOCK_PURGE_STAGE_ROOT, operationId, `item-${index}`);
}

function readTestMockPurgeContext(orderId, database) {
  const anchor = database.prepare(`SELECT order_record.id, order_record.order_code, order_record.client_id,
    order_record.status, order_record.archived_at, order_record.deleted_at,
    client.code AS client_code, client.storage_code AS client_storage_code
    FROM maintenance_orders order_record JOIN clients client ON client.id = order_record.client_id
    WHERE order_record.id = ?`).get(positiveId(orderId, 'orderId'));
  if (!anchor) throw new HttpError(404, 'Test maintenance order was not found.');
  const anchorCard = database.prepare(`SELECT card.id, card.order_id, card.machine_id,
    card.before_photos_json, card.after_photos_json, machine.code AS machine_code,
    machine.name_ar AS machine_name_ar, machine.area AS machine_area
    FROM maintenance_cards card JOIN machines machine ON machine.id = card.machine_id
    WHERE card.order_id = ?`).all(anchor.id);
  if (anchorCard.length !== 1) throw new HttpError(409, 'The test order is no longer a single-machine fixture.');
  const card = anchorCard[0];
  if (!/^TEST-ATM-[A-Z0-9-]{1,64}$/iu.test(card.machine_code)) {
    throw new HttpError(409, 'The test order contains a non-test machine.');
  }
  const linkedOrders = database.prepare(`SELECT DISTINCT order_record.id, order_record.order_code,
    order_record.client_id, order_record.notes, order_record.deleted_at,
    client.code AS client_code, client.storage_code AS client_storage_code, order_record.area
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    WHERE card.machine_id = ? ORDER BY CASE WHEN order_record.id = ? THEN 0 ELSE 1 END, order_record.id`)
    .all(card.machine_id, anchor.id);
  const contexts = linkedOrders.map((order) => {
    const cards = database.prepare(`SELECT card.id, card.order_id, card.machine_id,
      card.before_photos_json, card.after_photos_json, machine.code AS machine_code,
      machine.name_ar AS machine_name_ar, machine.area AS machine_area
      FROM maintenance_cards card JOIN machines machine ON machine.id = card.machine_id
      WHERE card.order_id = ?`).all(order.id);
    if (order.client_code !== 'C-TEST' || !/^MN-TEST-/u.test(order.order_code)
      || order.notes !== 'Test order for mobile representative workflow'
      || cards.length !== 1 || cards[0].machine_id !== card.machine_id) {
      throw new HttpError(409, 'The training machine is linked to non-test data.');
    }
    return { order, card: cards[0] };
  });
  const orderIds = contexts.map(({ order }) => order.id);
  const placeholders = orderIds.map(() => '?').join(', ');
  const crossReferences = [
    [`SELECT 1 FROM rep_visits WHERE machine_id = ? AND (order_id IS NULL OR order_id NOT IN (${placeholders})) LIMIT 1`, [card.machine_id, ...orderIds]],
    [`SELECT 1 FROM rep_visits WHERE order_id IN (${placeholders}) AND machine_id IS NOT NULL AND machine_id != ? LIMIT 1`, [...orderIds, card.machine_id]],
    ['SELECT 1 FROM client_machines WHERE machine_id = ? AND client_id != ? LIMIT 1', [card.machine_id, anchor.client_id]],
    [`SELECT 1 FROM maintenance_unmatched_folders WHERE (duplicate_machine_id = ? OR bound_machine_id = ?) AND order_id NOT IN (${placeholders}) LIMIT 1`, [card.machine_id, card.machine_id, ...orderIds]],
    [`SELECT 1 FROM maintenance_unmatched_folders WHERE order_id IN (${placeholders})
      AND ((duplicate_machine_id IS NOT NULL AND duplicate_machine_id != ?)
        OR (bound_machine_id IS NOT NULL AND bound_machine_id != ?)) LIMIT 1`, [...orderIds, card.machine_id, card.machine_id]],
    [`SELECT 1 FROM machine_notes_history WHERE machine_id = ? AND order_id IS NOT NULL
      AND order_id NOT IN (${placeholders}) LIMIT 1`, [card.machine_id, ...orderIds]],
    ['SELECT 1 FROM machine_correction_requests WHERE resolved_machine_id = ? AND machine_id != ? LIMIT 1', [card.machine_id, card.machine_id]],
    ['SELECT 1 FROM machine_correction_reviews review JOIN machine_correction_requests request ON request.id = review.correction_id WHERE review.resolved_machine_id = ? AND request.machine_id != ? LIMIT 1', [card.machine_id, card.machine_id]],
    [`SELECT 1 FROM treasury_entries WHERE maintenance_order_id IN (${placeholders}) LIMIT 1`, orderIds],
    [`SELECT 1 FROM maintenance_order_deletion_operations WHERE order_id IN (${placeholders}) LIMIT 1`, orderIds],
    [`SELECT 1 FROM maintenance_card_deletion_operations WHERE order_id IN (${placeholders}) LIMIT 1`, orderIds],
    [`SELECT 1 FROM maintenance_machine_decommission_operations WHERE order_id IN (${placeholders}) LIMIT 1`, orderIds],
    ['SELECT 1 FROM machine_correction_rename_operations WHERE machine_id = ? LIMIT 1', [card.machine_id]],
    [`SELECT 1 FROM rep_visits WHERE order_id IN (${placeholders}) AND status = 'receiving' LIMIT 1`, orderIds],
  ];
  if (crossReferences.some(([sql, parameters]) => database.prepare(sql).get(...parameters))) {
    throw new HttpError(409, 'The test machine has other references, an active upload, or financial history; permanent deletion was stopped.');
  }
  return { order: anchor, card, contexts };
}

async function collectTestMockPurgeTargets(order, card, database) {
  const candidates = [];
  const machineFolder = safeMachineStorageSegment(`${card.machine_code}_${card.machine_name_ar}`);
  const areaRoot = storageDirectory('Areas', safeMachineStorageSegment(card.machine_area));
  const testAreaFolder = (storedPath) => {
    const parts = storedPath.split('/');
    if (parts.length < 5 || parts[0] !== 'Areas' || parts[1] !== safeMachineStorageSegment(card.machine_area)
      || !/^\d{4}$/u.test(parts[2]) || !/^(0[1-9]|1[0-2])$/u.test(parts[3])
      || !/^TEST-ATM-[A-Z0-9-]+_.+/iu.test(parts[4])) {
      throw new HttpError(409, 'A test photo or visit file is outside a test machine folder.');
    }
    const folder = storageDirectory(...parts.slice(0, 5));
    if (database.prepare('SELECT 1 FROM rep_visits WHERE final_path = ? AND machine_id != ? LIMIT 1')
      .get(folder, card.machine_id)) throw new HttpError(409, 'The test photo folder is shared with another machine.');
    for (const other of database.prepare(`SELECT machine_id, before_photos_json, after_photos_json
      FROM maintenance_cards WHERE machine_id != ?`).iterate(card.machine_id)) {
      for (const value of [other.before_photos_json, other.after_photos_json]) {
        let paths;
        try { paths = JSON.parse(value); } catch { throw new HttpError(409, 'Other machine photo metadata is invalid.'); }
        if (!Array.isArray(paths) || paths.some((path) => typeof path === 'string' && path.startsWith(`${folder}/`))) {
          throw new HttpError(409, 'The test photo folder is referenced by another machine.');
        }
      }
    }
    return folder;
  };
  const orderDirectories = [
    storageDirectory('Machines', card.machine_code),
    storageDirectory('clients', order.client_storage_code, 'maintenance', order.order_code),
    storageDirectory('Clients', order.client_storage_code, 'Archived_Orders', order.order_code),
    storageDirectory(areaRoot, machineFolder),
  ];
  const areaDirectory = await resolveStorageDirectoryIfPresent(areaRoot);
  if (areaDirectory) {
    for (const year of await readdir(areaDirectory, { withFileTypes: true })) {
      if (!year.isDirectory() || !/^\d{4}$/u.test(year.name)) continue;
      const yearDirectory = await resolveStorageDirectoryIfPresent(storageDirectory(areaRoot, year.name));
      for (const month of await readdir(yearDirectory, { withFileTypes: true })) {
        if (!month.isDirectory() || !/^(0[1-9]|1[0-2])$/u.test(month.name)) continue;
        orderDirectories.push(storageDirectory(areaRoot, year.name, month.name, machineFolder));
      }
    }
  }
  for (const path of orderDirectories) {
    if (await resolveStorageDirectoryIfPresent(path)) candidates.push({ path, kind: 'directory' });
  }
  for (const path of maintenanceCardPhotoPaths(card)) {
    if (!orderDirectories.some((directory) => path.startsWith(`${directory}/`))) {
      if (!path.startsWith('Areas/')) throw new HttpError(409, 'A test inspection photo is outside its machine folder.');
      const folder = testAreaFolder(path);
      if (!orderDirectories.includes(folder)) orderDirectories.push(folder);
      if (await resolveStorageDirectoryIfPresent(folder)) candidates.push({ path: folder, kind: 'directory' });
    }
    if (!candidates.some((directory) => path.startsWith(`${directory.path}/`))
      && await resolveStorageFileIfPresent(path)) candidates.push({ path, kind: 'file' });
  }
  const visits = database.prepare(`SELECT visit_uuid, status, staging_path, final_path
    FROM rep_visits WHERE order_id = ?`).all(order.id);
  for (const visit of visits) {
    if (visit.status === 'receiving') throw new HttpError(409, 'A test visit upload is still in progress.');
    const visitSegments = visit.final_path.split('/');
    if (visitSegments.length !== 5 || testAreaFolder(visit.final_path) !== visit.final_path)
      throw new HttpError(409, 'A test visit file path is outside its machine folder.');
    if (await resolveStorageDirectoryIfPresent(visit.final_path)) {
      candidates.push({ path: visit.final_path, kind: 'directory' });
    }
    if (visit.staging_path !== storageDirectory('.madar-recovery', 'rep-visits', visit.visit_uuid)) {
      throw new HttpError(409, 'A test visit staging path is unexpected.');
    }
    if (await resolveStorageDirectoryIfPresent(visit.staging_path)) {
      candidates.push({ path: visit.staging_path, kind: 'directory' });
    }
  }
  const unique = [...new Map(candidates.map((target) => [`${target.kind}:${target.path}`, target])).values()];
  return unique.filter((target) => !unique.some((parent) => parent.kind === 'directory'
    && parent.path !== target.path && target.path.startsWith(`${parent.path}/`)));
}

async function recoverOneTestMockPurge(operation, database) {
  if (!UUID_PATTERN.test(operation.operation_id)) throw new HttpError(500, 'Invalid test purge recovery ID.');
  const manifest = JSON.parse(operation.targets_json);
  const { orders, targets } = manifest;
  if (!Array.isArray(orders) || !orders.length || orders.length > 2048
    || orders[0].id !== operation.order_id || orders[0].orderCode !== operation.order_code
    || orders.some((order) => !Number.isSafeInteger(order.id) || order.id < 1
      || typeof order.orderCode !== 'string' || !/^MN-TEST-/u.test(order.orderCode)
      || (order.deletedAt !== null && typeof order.deletedAt !== 'string'))
    || !Array.isArray(targets) || targets.length > 2048 || targets.some((target) =>
    !target || !['directory', 'file'].includes(target.kind) || typeof target.path !== 'string'
    || target.path.startsWith('.madar-recovery/test-mock-purges/'))) {
    throw new HttpError(500, 'Invalid test purge recovery paths.');
  }
  const stagePath = testMockPurgeStagePath(operation.operation_id);
  const stage = await resolveStorageDirectoryIfPresent(stagePath);
  const entries = stage ? await readdir(stage) : [];
  if (entries.some((name) => !/^item-\d+$/u.test(name) || Number(name.slice(5)) >= targets.length)) {
    throw new HttpError(500, 'Unexpected test purge recovery files.');
  }
  if (operation.state === 'prepared') {
    for (const saved of orders) {
      const order = database.prepare('SELECT id, order_code FROM maintenance_orders WHERE id = ?').get(saved.id);
      if (!order || order.order_code !== saved.orderCode) throw new HttpError(500, 'Test purge recovery order changed.');
    }
    for (const [index, target] of targets.entries()) {
      const resolver = target.kind === 'directory' ? resolveStorageDirectoryIfPresent : resolveStorageFileIfPresent;
      const original = await resolver(target.path);
      const staged = await resolver(testMockPurgeItemPath(operation.operation_id, index));
      if (original && staged) throw new HttpError(500, 'Both original and staged test files exist.');
      if (!original && !staged) throw new HttpError(500, 'A test purge file is missing from both locations.');
      if (staged) {
        const segments = target.path.split('/');
        const parent = await ensureStorageDirectory(...segments.slice(0, -1));
        await rename(staged, join(parent, segments.at(-1)));
      }
    }
    database.transaction(() => {
      for (const saved of orders) {
        database.prepare('UPDATE maintenance_orders SET deleted_at = ? WHERE id = ?').run(saved.deletedAt, saved.id);
      }
      database.prepare('DELETE FROM test_mock_purge_operations WHERE operation_id = ?').run(operation.operation_id);
    }).immediate();
  } else if (operation.state === 'committed') {
    if (orders.some((saved) => database.prepare('SELECT 1 FROM maintenance_orders WHERE id = ?').get(saved.id))) {
      throw new HttpError(500, 'Committed test purge still has an order.');
    }
  } else {
    throw new HttpError(500, 'Invalid test purge recovery state.');
  }
  if (stage) await rm(stage, { recursive: true });
  if (operation.state === 'committed') {
    database.prepare('DELETE FROM test_mock_purge_operations WHERE operation_id = ?').run(operation.operation_id);
  }
}

export async function recoverTestMockPurges(database = db) {
  return withMaintenanceOrderStorageLock(async () => {
    const operations = database.prepare('SELECT * FROM test_mock_purge_operations ORDER BY created_at, operation_id').all();
    const stageRoot = await ensureStorageDirectory(...TEST_MOCK_PURGE_STAGE_ROOT);
    const entries = await readdir(stageRoot, { withFileTypes: true });
    if (entries.some((entry) => !entry.isDirectory() || !operations.some((operation) => operation.operation_id === entry.name))) {
      throw new HttpError(500, 'Unrecognized test purge staging folder.');
    }
    for (const operation of operations) await recoverOneTestMockPurge(operation, database);
    return { recoveredCount: operations.length };
  });
}

export async function purgeTestMockMaintenanceOrder(orderId, actorId = null, database = db) {
  return withMaintenanceOrderStorageLock(async () => {
    assertNoPendingMaintenanceFileRecovery(database);
    const { order, card, contexts } = readTestMockPurgeContext(orderId, database);
    const candidates = [];
    for (const context of contexts) {
      candidates.push(...await collectTestMockPurgeTargets(context.order, context.card, database));
    }
    const unique = [...new Map(candidates.map((target) => [`${target.kind}:${target.path}`, target])).values()];
    const targets = unique.filter((target) => !unique.some((parent) => parent.kind === 'directory'
      && parent.path !== target.path && target.path.startsWith(`${parent.path}/`)));
    if (targets.length > 2048) throw new HttpError(409, 'Too many training files to delete safely in one operation.');
    const manifest = { orders: contexts.map((context) => ({
      id: context.order.id, orderCode: context.order.order_code, deletedAt: context.order.deleted_at,
    })), targets };
    const operationId = randomUUID();
    database.transaction(() => {
      readTestMockPurgeContext(order.id, database);
      for (const context of contexts) {
        database.prepare('UPDATE maintenance_orders SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL')
          .run(context.order.id);
      }
      database.prepare(`INSERT INTO test_mock_purge_operations (operation_id, order_id, order_code, targets_json, state)
        VALUES (?, ?, ?, ?, 'prepared')`).run(operationId, order.id, order.order_code, JSON.stringify(manifest));
    }).immediate();
    let committed = false;
    try {
      await ensureStorageDirectory(...TEST_MOCK_PURGE_STAGE_ROOT, operationId);
      for (const [index, target] of targets.entries()) {
        const resolver = target.kind === 'directory' ? resolveStorageDirectoryIfPresent : resolveStorageFileIfPresent;
        const original = await resolver(target.path);
        if (!original) throw new HttpError(409, 'A test file changed during deletion.');
        const stage = await ensureStorageDirectory(...TEST_MOCK_PURGE_STAGE_ROOT, operationId);
        await rename(original, join(stage, `item-${index}`));
      }
      database.transaction(() => {
        for (const context of contexts) {
          const current = database.prepare('SELECT order_code, deleted_at FROM maintenance_orders WHERE id = ?')
            .get(context.order.id);
          if (!current || current.order_code !== context.order.order_code || !current.deleted_at) {
            throw new HttpError(409, 'Test order changed during deletion.');
          }
        }
        database.prepare(`DELETE FROM machine_correction_reviews WHERE correction_id IN
          (SELECT id FROM machine_correction_requests WHERE machine_id = ?)`).run(card.machine_id);
        database.prepare('DELETE FROM machine_correction_requests WHERE machine_id = ?').run(card.machine_id);
        database.prepare('DELETE FROM rep_machine_location_verifications WHERE machine_id = ?').run(card.machine_id);
        for (const context of contexts) {
          database.prepare('DELETE FROM maintenance_card_photo_rotations WHERE card_id = ?').run(context.card.id);
          database.prepare('DELETE FROM maintenance_unmatched_folders WHERE order_id = ?').run(context.order.id);
          database.prepare('DELETE FROM rep_visits WHERE order_id = ?').run(context.order.id);
          database.prepare('DELETE FROM maintenance_cards WHERE order_id = ?').run(context.order.id);
          database.prepare('DELETE FROM maintenance_orders WHERE id = ?').run(context.order.id);
        }
        database.prepare('DELETE FROM client_machines WHERE machine_id = ?').run(card.machine_id);
        database.prepare('DELETE FROM machines WHERE id = ?').run(card.machine_id);
        recordAudit({ database, actorId, action: 'purge_test_mock_order', entityType: 'maintenance_order', entityId: order.id,
          oldValues: { order_code: order.order_code, machine_code: card.machine_code, machine_id: card.machine_id },
          newValues: { deleted: true, linked_test_orders_deleted: contexts.length, files_staged_for_removal: targets.length } });
        database.prepare(`UPDATE test_mock_purge_operations SET state = 'committed' WHERE operation_id = ?`).run(operationId);
      }).immediate();
      committed = true;
    } catch (error) {
      if (!committed) {
        const operation = database.prepare('SELECT * FROM test_mock_purge_operations WHERE operation_id = ?').get(operationId);
        if (operation) await recoverOneTestMockPurge(operation, database);
      }
      throw error;
    }
    let cleanupPending = false;
    try {
      await recoverOneTestMockPurge(database.prepare('SELECT * FROM test_mock_purge_operations WHERE operation_id = ?').get(operationId), database);
    } catch {
      cleanupPending = true;
    }
    return { ok: true, permanentlyDeleted: true, deletedOrderCode: order.order_code,
      deletedMachineCode: card.machine_code, deletedOrderCount: contexts.length, cleanupPending };
  });
}

export async function purgeTestMockMaintenanceMachine(machineId, actorId = null, database = db) {
  const id = positiveId(machineId, 'machineId');
  const linked = database.prepare(`SELECT card.order_id FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    WHERE card.machine_id = ? AND order_record.order_code LIKE 'MN-TEST-%'
    ORDER BY order_record.deleted_at IS NULL DESC, order_record.id LIMIT 1`).get(id);
  if (!linked) throw new HttpError(404, 'No training order is linked to this machine.');
  return purgeTestMockMaintenanceOrder(linked.order_id, actorId, database);
}

export function listMaintenanceRepresentatives(database = db) {
  return database.prepare(`
    SELECT id, username, full_name, assigned_regions_json
    FROM users WHERE role = 'rep' AND active = 1 AND deleted_at IS NULL
    ORDER BY full_name COLLATE NOCASE, id
  `).all().map((row) => {
    let assignedRegions = [];
    try {
      const parsed = JSON.parse(row.assigned_regions_json ?? '[]');
      if (Array.isArray(parsed)) assignedRegions = parsed.filter((region) => typeof region === 'string');
    } catch { /* Treat malformed legacy region data as unassigned. */ }
    return { id: Number(row.id), username: row.username, full_name: row.full_name, assignedRegions };
  });
}

export function replaceMaintenanceOrderRepresentatives(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['repUserIds']);
  const repUserIds = integerIdArray(body.repUserIds, 'repUserIds');
  const result = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status === 'archived') throw new HttpError(409, 'Archived maintenance orders cannot be reassigned.');
    assertActiveRepresentatives(repUserIds, database);
    const previous = database.prepare(`
      SELECT user_id FROM maintenance_order_reps WHERE order_id = ? ORDER BY user_id
    `).all(id).map((row) => Number(row.user_id));
    database.prepare('DELETE FROM maintenance_order_reps WHERE order_id = ?').run(id);
    const assign = database.prepare(`
      INSERT INTO maintenance_order_reps (order_id, user_id, assigned_by) VALUES (?, ?, ?)
    `);
    for (const userId of repUserIds) assign.run(id, userId, actorId);
    recordAudit({
      database,
      actorId,
      action: 'assign_representatives',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues: { representative_user_ids: previous },
      newValues: { representative_user_ids: repUserIds },
    });
    const sortedPrevious = [...previous].sort((left, right) => left - right);
    const sortedRequested = [...repUserIds].sort((left, right) => left - right);
    const changed = sortedPrevious.length !== sortedRequested.length
      || sortedPrevious.some((userId, index) => userId !== sortedRequested[index]);
    return { previous, repUserIds, changed };
  }).immediate();
  return {
    representatives: result.repUserIds.map((userId) => database.prepare(`
    SELECT id, username, full_name FROM users WHERE id = ?
    `).get(userId)),
    changed: result.changed,
    assignedRepUserIds: result.repUserIds,
    previousRepUserIds: result.previous,
    notifyRepUserIds: result.changed ? [...new Set([...result.previous, ...result.repUserIds])] : [],
  };
}

export function disburseMaintenanceCustody(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['amountCents', 'notes']);
  const amountCents = nonNegativeInteger(body.amountCents, 'amountCents');
  if (amountCents < 1) throw new HttpError(400, 'amountCents must be greater than zero.');
  const notes = optionalText(body.notes, 'notes', { maxLength: 2000 });

  database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'in_progress') {
      throw new HttpError(409, 'Maintenance custody can only be advanced while the order is in progress.');
    }
    if (!Number.isSafeInteger(order.petty_cash_disbursed_cents + amountCents)) {
      throw new HttpError(400, 'Maintenance custody exceeds the safe integer-cents range.');
    }
    assertCashAvailable(amountCents, database);
    const nextAmount = order.petty_cash_disbursed_cents + amountCents;
    const treasuryEntryId = insertTreasuryEntry({
      database,
      kind: 'expense',
      category: 'عهدة نقدية صيانة',
      amountCents,
      maintenanceOrderId: id,
      reference: order.order_code,
      notes,
      actorId,
    });
    database.prepare(`
      UPDATE maintenance_orders
      SET petty_cash_disbursed_cents = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextAmount, id);
    recordAudit({
      database,
      actorId,
      action: 'custody_advance',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues: { petty_cash_disbursed_cents: order.petty_cash_disbursed_cents },
      newValues: {
        petty_cash_disbursed_cents: nextAmount,
        advance_cents: amountCents,
        treasury_entry_id: treasuryEntryId,
      },
    });
  }).immediate();

  return getMaintenanceOrder(id, database);
}

export function getMaintenanceOrder(orderId, database = db) {
  const order = findMaintenanceOrder(orderId, database);
  const representatives = database.prepare(`
    SELECT user.id, user.username, user.full_name, user.active, assigned.assigned_at
    FROM maintenance_order_reps assigned
    JOIN users user ON user.id = assigned.user_id
    WHERE assigned.order_id = ?
    ORDER BY user.full_name COLLATE NOCASE, user.id
  `).all(order.id);
  const structuredLinesByCard = new Map();
  const structuredLines = database.prepare(`SELECT * FROM maintenance_card_lines
    WHERE card_id IN (SELECT id FROM maintenance_cards WHERE order_id = ? AND deleted_at IS NULL)
    ORDER BY card_id, id`).all(order.id);
  for (const line of structuredLines) {
    const cardId = Number(line.card_id);
    if (!structuredLinesByCard.has(cardId)) structuredLinesByCard.set(cardId, []);
    structuredLinesByCard.get(cardId).push({
      id: Number(line.id), reasonId: Number(line.reason_id), label: line.reason_label_snapshot,
      category: line.category_snapshot, actionMeaning: line.action_meaning_snapshot,
      quantity: Number(line.quantity), unit: line.unit_snapshot, quantityProvenance: line.quantity_provenance,
    });
  }
  const technicians = database.prepare(`
    SELECT employee.id, employee.name, employee.job_title, employee.department
    FROM maintenance_order_technicians assigned
    JOIN employees employee ON employee.id = assigned.employee_id
    WHERE assigned.order_id = ?
    ORDER BY employee.name COLLATE NOCASE, employee.id
  `).all(order.id);
  const allReasons = database.prepare('SELECT id, name FROM maintenance_reasons').all();
  const reasonMap = new Map(allReasons.map((r) => [r.id, r.name]));
  const repPhotosByCard = new Map();
  const repPhotoRows = database.prepare(`
    SELECT visit.card_id, visit.visit_uuid, photo.phase, photo.stored_path, photo.captured_at,
      user.full_name AS rep_name, review.status AS review_status
    FROM rep_visit_photos photo
    JOIN rep_visits visit ON visit.id = photo.visit_id AND visit.status = 'completed'
    JOIN users user ON user.id = visit.rep_user_id
    LEFT JOIN rep_visit_reviews review ON review.visit_id = visit.id
    WHERE visit.order_id = ? AND visit.card_id IS NOT NULL
    ORDER BY visit.id, photo.phase, photo.ordinal, photo.id
  `).all(order.id);
  for (const photo of repPhotoRows) {
    const cardId = Number(photo.card_id);
    if (!repPhotosByCard.has(cardId)) repPhotosByCard.set(cardId, []);
    repPhotosByCard.get(cardId).push(photo);
  }

  const cards = database.prepare(`
    SELECT card.*, reason.name AS single_reason_name, machine.code AS machine_code, machine.name_ar AS machine_name_ar,
      machine.name_en AS machine_name_en, machine.area AS machine_area, machine.latitude AS machine_latitude,
      machine.longitude AS machine_longitude, machine.is_location_locked AS machine_location_locked
    FROM maintenance_cards card
    JOIN machines machine ON machine.id = card.machine_id
    LEFT JOIN maintenance_reasons reason ON reason.id = card.reason_id
    WHERE card.order_id = ? AND card.deleted_at IS NULL
    ORDER BY card.id
  `).all(order.id);
  const rotationsByCard = new Map();
  const rotationRows = database.prepare(`
    SELECT rotation.card_id, rotation.phase, rotation.filename, rotation.angle
    FROM maintenance_card_photo_rotations rotation
    JOIN maintenance_cards card ON card.id = rotation.card_id
    WHERE card.order_id = ? AND card.deleted_at IS NULL
  `).all(order.id);
  for (const rotation of rotationRows) {
    const cardId = Number(rotation.card_id);
    if (!rotationsByCard.has(cardId)) rotationsByCard.set(cardId, new Map());
    rotationsByCard.get(cardId).set(`${rotation.phase}\0${rotation.filename}`, rotation.angle);
  }
  const mappedCards = cards.map((card) => {
    const beforePhotos = parsePhotoJson(card.before_photos_json);
    const afterPhotos = parsePhotoJson(card.after_photos_json);
    const photoRotations = rotationsByCard.get(Number(card.id)) ?? new Map();
    const repPhotoMetadata = {};
    for (const photo of repPhotosByCard.get(Number(card.id)) ?? []) {
      const list = photo.phase === 'before' ? beforePhotos : afterPhotos;
      if (!list.includes(photo.stored_path)) list.push(photo.stored_path);
      repPhotoMetadata[photo.stored_path.split('/').at(-1)] = {
        repName: photo.rep_name,
        capturedAt: photo.captured_at,
        visitUuid: photo.visit_uuid,
        reviewStatus: photo.review_status ?? 'pending',
        phase: photo.phase,
      };
    }
    const beforePhotoRotations = beforePhotos.map((storedPath) => (
      photoRotations.get(`before\0${storedPath.split('/').at(-1)}`) ?? 0
    ));
    const afterPhotoRotations = afterPhotos.map((storedPath) => (
      photoRotations.get(`after\0${storedPath.split('/').at(-1)}`) ?? 0
    ));
    let reasonIds = [];
    try {
      reasonIds = JSON.parse(card.reason_ids_json || '[]');
      if (!Array.isArray(reasonIds)) reasonIds = [];
    } catch {
      reasonIds = [];
    }
    if (!reasonIds.length && card.reason_id) {
      reasonIds = [card.reason_id];
    }
    const reasonNames = reasonIds.map((rid) => reasonMap.get(rid)).filter(Boolean);
    const primaryReasonName = card.single_reason_name ?? reasonNames[0] ?? null;
    const compositeReasonName = reasonNames.length ? reasonNames.join('، ') : primaryReasonName;

    return {
      ...card,
      reason_id: card.reason_id ?? (reasonIds[0] ?? null),
      reason_ids: reasonIds,
      reason_names: reasonNames,
      reason_name: compositeReasonName,
      maintenance_lines: structuredLinesByCard.get(Number(card.id)) ?? [],
      before_photos: beforePhotos,
      after_photos: afterPhotos,
      before_photo_rotations: beforePhotoRotations,
      after_photo_rotations: afterPhotoRotations,
      rep_photo_metadata: repPhotoMetadata,
      before_photo_urls: beforePhotos.map((storedPath) =>
        `/api/maintenance/orders/${order.id}/cards/${card.id}/photos/before/${encodeURIComponent(storedPath.split('/').at(-1))}`),
      after_photo_urls: afterPhotos.map((storedPath) =>
        `/api/maintenance/orders/${order.id}/cards/${card.id}/photos/after/${encodeURIComponent(storedPath.split('/').at(-1))}`),
      before_thumbnail_urls: beforePhotos.map((storedPath) =>
        `/api/maintenance/orders/${order.id}/cards/${card.id}/photos/before/${encodeURIComponent(storedPath.split('/').at(-1))}/thumbnail`),
      after_thumbnail_urls: afterPhotos.map((storedPath) =>
        `/api/maintenance/orders/${order.id}/cards/${card.id}/photos/after/${encodeURIComponent(storedPath.split('/').at(-1))}/thumbnail`),
    };
  });
  const cardsResult = mappedCards;
  const client = database.prepare(`
    SELECT id, code, name, contact_name, phone, email, address, primary_color, secondary_color, logo_path
    FROM clients WHERE id = ?
  `).get(order.client_id);
  const unmatchedFolders = database.prepare(`
    SELECT id, folder_name, source_name, before_photos_json, after_photos_json,
      is_duplicate, duplicate_of_folder, duplicate_machine_id, created_at
    FROM maintenance_unmatched_folders
    WHERE order_id = ? AND status = 'pending'
    ORDER BY id
  `).all(order.id).map((folder) => {
    const beforePhotos = parsePhotoJson(folder.before_photos_json);
    const afterPhotos = parsePhotoJson(folder.after_photos_json);
    const photoUrl = (phase, photoPath) =>
      `/api/maintenance/orders/${order.id}/unmatched/${folder.id}/photos/${encodeURIComponent(photoPath.split('/').at(-1))}?phase=${phase}`;
    return {
      id: folder.id,
      folder_name: folder.folder_name,
      source_name: folder.source_name,
      is_duplicate: Boolean(folder.is_duplicate),
      duplicate_of_folder: folder.duplicate_of_folder,
      duplicate_machine_id: folder.duplicate_machine_id,
      created_at: folder.created_at,
      before_photos: beforePhotos,
      after_photos: afterPhotos,
      before_photo_urls: beforePhotos.map((photoPath) => photoUrl('before', photoPath)),
      after_photo_urls: afterPhotos.map((photoPath) => photoUrl('after', photoPath)),
      photo_count: beforePhotos.length + afterPhotos.length,
    };
  });
  const orderAreas = parseMaintenanceOrderAreas(order.area);
  const unmatchedMachineCandidates = unmatchedFolders.length && orderAreas.length
    ? database.prepare(`
      SELECT machine.id, machine.code, machine.name_ar, machine.name_en, machine.area
      FROM machines machine
      WHERE machine.active = 1 AND machine.deleted_at IS NULL
        AND machine.area COLLATE NOCASE IN (${orderAreas.map(() => '?').join(',')})
        AND NOT EXISTS (
          SELECT 1 FROM maintenance_cards card
          WHERE card.order_id = ? AND card.machine_id = machine.id
            AND card.deleted_at IS NULL
            AND (card.before_photos_json != '[]' OR card.after_photos_json != '[]')
        )
        AND NOT EXISTS (
          SELECT 1 FROM maintenance_unmatched_folders folder
          WHERE folder.order_id = ? AND folder.status = 'bound' AND folder.bound_machine_id = machine.id
        )
      ORDER BY machine.code COLLATE NOCASE, machine.id
    `).all(...orderAreas, order.id, order.id)
    : [];
  const publicOrder = { ...order };
  delete publicOrder.client_storage_code;
  return {
    ...publicOrder,
    client,
    technicians,
    representatives,
    cards: cardsResult,
    unmatched_folders: unmatchedFolders,
    unmatched_machine_candidates: unmatchedMachineCandidates,
  };
}

function safeTripFolderSegment(value) {
  const safe = String(value ?? '').normalize('NFKC').trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.+$/g, '').slice(0, 120);
  if (!safe || safe === '.' || safe === '..') return 'Unknown folder';
  return safe;
}

function areaSourceRenamePlan(folder, machine) {
  const sourceSegments = typeof folder.source_name === 'string' ? folder.source_name.split('/') : [];
  const folderName = folder.folder_name;
  if (sourceSegments.length < 2 || sourceSegments[0] !== 'Areas'
    || sourceSegments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':') || segment.includes('\\') || segment.includes('\0'))
    || typeof folderName !== 'string' || !folderName || folderName === '.' || folderName === '..'
    || folderName.includes('/') || folderName.includes('\\') || folderName.includes('\0') || folderName.includes(':')) {
    return null;
  }

  const oldName = folderName;
  const newName = safeTripFolderSegment(`${machine.code} - ${folderName}`);
  if (newName === oldName) return null;
  return {
    oldStoredPath: storageDirectory(...sourceSegments, oldName),
    newStoredPath: storageDirectory(...sourceSegments, newName),
    newName,
  };
}

async function prepareAreaSourceRename(folder, machine) {
  const plan = areaSourceRenamePlan(folder, machine);
  if (!plan) return null;

  let sourceDirectory;
  try {
    sourceDirectory = await resolveStorageDirectory(plan.oldStoredPath);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
  const parentDirectory = await resolveStorageDirectory(folder.source_name);
  let destinationDirectory;
  try {
    destinationDirectory = await lstat(join(parentDirectory, plan.newName));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (destinationDirectory) {
    throw new HttpError(409, 'A folder with the standardized machine name already exists in this area.');
  }
  return { ...plan, sourceDirectory, destinationDirectory: join(parentDirectory, plan.newName) };
}

export async function renameAreaSourceDirectory(renamePlan, renameDirectory = rename) {
  if (!renamePlan) return;
  try {
    await renameDirectory(renamePlan.sourceDirectory, renamePlan.destinationDirectory);
  } catch (error) {
    if (error.code === 'EPERM') {
      throw new HttpError(409, 'يرجى إغلاق المجلد إذا كان مفتوحاً في برنامج آخر');
    }
    throw error;
  }
}

function remapOrderCardSourcePaths(database, orderId, oldPrefix, newPrefix) {
  const cards = database.prepare(`
    SELECT id, before_photos_json, after_photos_json
    FROM maintenance_cards WHERE order_id = ? AND deleted_at IS NULL
  `).all(orderId);
  for (const card of cards) {
    const remap = (storedPaths) => {
      let changed = false;
      const paths = storedPaths.map((storedPath) => {
        if (typeof storedPath !== 'string' || !storedPath.startsWith(`${oldPrefix}/`)) return storedPath;
        changed = true;
        return `${newPrefix}${storedPath.slice(oldPrefix.length)}`;
      });
      return { changed, paths };
    };
    const before = remap(parsePhotoJson(card.before_photos_json));
    const after = remap(parsePhotoJson(card.after_photos_json));
    if (before.changed || after.changed) {
      database.prepare(`
        UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify(before.paths), JSON.stringify(after.paths), card.id);
      reconcileCardPhotoReviewPaths(card.id, database);
    }
  }
}

function isPhotoFile(path) {
  return TRIP_PHOTO_EXTENSIONS.has(extname(path).toLowerCase());
}

async function readServerTripFolder(folderPath, { onScanProgress, onFileProgress } = {}) {
  const segments = folderPath.split('/');
  if (!['Areas', 'Uploads'].includes(segments[0]) || segments.length < 2
    || segments.some((segment) => segment.toLocaleLowerCase('en') === '.incoming')) {
    throw new HttpError(400, 'Choose a trip folder under storage/Areas or storage/Uploads.');
  }
  const sourceFiles = await listStorageFiles(folderPath, { maxFiles: MAX_TRIP_FOLDER_FILES, onProgress: onScanProgress });
  const files = [];
  let totalBytes = 0;
  let processedSourceFiles = 0;
  const reportFileProgress = (stage) => onFileProgress?.({
    totalFiles: sourceFiles.length,
    processedFiles: processedSourceFiles,
    stage,
  });
  reportFileProgress('جارٍ تجهيز قائمة ملفات الرحلة...');
  for (const sourcePath of sourceFiles) {
    const relativePath = sourcePath.slice(folderPath.length + 1);
    const parts = relativePath.split('/');
    if (parts.length < 2 || parts.some((segment) => segment.toLocaleLowerCase('en') === '.incoming') || !isPhotoFile(sourcePath)) {
      processedSourceFiles += 1;
      reportFileProgress(`جارٍ فحص الملفات (${processedSourceFiles}/${sourceFiles.length})...`);
      continue;
    }
    const absolutePath = await resolveStorageFile(sourcePath);
    const metadata = await stat(absolutePath);
    if (metadata.size > MAX_TRIP_PHOTO_BYTES) throw new HttpError(413, 'A trip photo exceeds the 200 MB processing limit.');
    totalBytes += metadata.size;
    if (totalBytes > MAX_TRIP_FOLDER_BYTES) {
      throw new HttpError(413, 'The trip folder exceeds the 20 GB processing limit.');
    }
    files.push({
      relativePath,
      name: parts.at(-1),
      machineRelativePath: parts.slice(1).join('/'),
      sourcePath,
      sourceAbsolutePath: absolutePath,
      modifiedAt: metadata.mtimeMs,
    });
    processedSourceFiles += 1;
    reportFileProgress(`جارٍ قراءة ملفات الرحلة (${processedSourceFiles}/${sourceFiles.length})...`);
  }
  return files;
}

function zipRootWrapper(files, machines) {
  const topFolders = new Set(files.map((file) => file.relativePath.split('/')[0]));
  if (topFolders.size !== 1) return null;
  const [wrapper] = topFolders;
  const matchingTop = matchMachineFolder(wrapper, machines);
  if (matchingTop) return null;
  const childNames = files.map((file) => file.relativePath.split('/')[1]).filter(Boolean);
  return childNames.some((name) => matchMachineFolder(name, machines)) ? wrapper : null;
}

function getTripFolderGroups(files, machines, wrapper = null) {
  const groups = new Map();
  for (const file of files) {
    const rawSegments = file.relativePath.split('/').filter(Boolean);
    const segments = wrapper && rawSegments[0] === wrapper ? rawSegments.slice(1) : rawSegments;
    if (segments.length < 2) continue;
    const folderName = segments[0];
    const photo = { ...file, name: segments.at(-1), machineRelativePath: segments.slice(1).join('/') };
    const group = groups.get(folderName) ?? [];
    group.push(photo);
    groups.set(folderName, group);
  }
  return groups;
}

async function processMaintenanceTripFolderUnlocked(orderId, { folderPath, file } = {}, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const order = findMaintenanceOrder(id, database);
  if (order.status !== 'in_progress') throw new HttpError(409, 'Trip photos can only be imported while the order is in progress.');
  const orderAreas = parseMaintenanceOrderAreas(order.area);
  if (!orderAreas.length) throw new HttpError(400, 'Set at least one order area before importing a trip folder.');
  if (Boolean(file) === Boolean(folderPath)) throw new HttpError(400, 'Provide either one ZIP file or a server-side folder path.');

  beginMaintenanceTripProgress(id, database);
  let tripExtractionDirectory = null;
  try {
    updateMaintenanceTripProgress(id, { percent: 2, stage: 'جارٍ تجهيز قائمة الماكينات ومصدر الرحلة...' });
    const machines = database.prepare(`
      SELECT DISTINCT machine.id, machine.code, machine.name_ar, machine.name_en, machine.area
      FROM machines machine
      WHERE machine.area COLLATE NOCASE IN (${orderAreas.map(() => '?').join(',')})
        AND machine.active = 1 AND machine.deleted_at IS NULL
      ORDER BY machine.code COLLATE NOCASE, machine.id
    `).all(...orderAreas);

    let sourceName;
    let files;
    let wrapper = null;
    if (file) {
      if (extname(file.originalname ?? '').toLowerCase() !== '.zip') throw new HttpError(400, 'Trip uploads must be ZIP files.');
      updateMaintenanceTripProgress(id, { percent: 3, stage: 'جارٍ فحص وفك ملفات ZIP...' });
      const incomingDirectory = await ensureStorageDirectory('.incoming');
      tripExtractionDirectory = await mkdtemp(join(incomingDirectory, 'trip-extract-'));
      files = await readTripZip(file.path, {
        tempDirectory: tripExtractionDirectory,
        onProgress: ({ totalFiles, processedFiles, stage }) => {
          const fraction = totalFiles ? processedFiles / totalFiles : 0;
          updateMaintenanceTripProgress(id, {
            totalFiles,
            processedFiles,
            percent: 3 + (fraction * 42),
            stage,
          });
        },
      });
      sourceName = String(file.originalname ?? 'trip.zip').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
      wrapper = zipRootWrapper(files, machines);
      for (const photo of files) photo.machineRelativePath = photo.relativePath.split('/').slice(wrapper ? 2 : 1).join('/');
      updateMaintenanceTripProgress(id, {
        totalFiles: files.length,
        processedFiles: files.length,
        percent: 45,
        stage: 'اكتمل فحص ملف ZIP؛ جارٍ تجهيز صور الرحلة...',
      });
    } else {
      sourceName = requireText(folderPath, 'folderPath', { maxLength: 1024 });
      files = await readServerTripFolder(sourceName, {
        onScanProgress: ({ processedFiles, stage }) => {
          const estimate = Math.min(20, 3 + Math.round(Math.log2(processedFiles + 1) * 3));
          updateMaintenanceTripProgress(id, { processedFiles, percent: estimate, stage });
        },
        onFileProgress: ({ totalFiles, processedFiles, stage }) => {
          const fraction = totalFiles ? processedFiles / totalFiles : 1;
          updateMaintenanceTripProgress(id, {
            totalFiles,
            processedFiles,
            percent: 23 + (fraction * 22),
            stage,
          });
        },
      });
    }
    if (!files.length) throw new HttpError(400, 'No supported photos were found in the selected trip folder.');

    const folderGroups = getTripFolderGroups(files, machines, wrapper);
    if (!folderGroups.size) throw new HttpError(400, 'The trip folder must contain first-level machine subfolders.');

    const totalGroupedPhotos = [...folderGroups.values()].reduce((count, photos) => count + photos.length, 0);
    updateMaintenanceTripProgress(id, {
      totalFiles: totalGroupedPhotos,
      processedFiles: 0,
      percent: 46,
      stage: 'جارٍ تصنيف الصور حسب الماكينة ومرحلة الصيانة...',
    });
    let classifiedFiles = 0;
    const matchedByMachine = new Map();
    const unmatchedPlans = [];
    const folderMatchResults = new Map(matchMachineFolderGroups([...folderGroups.keys()], machines)
      .map((result) => [result.folderName, result]));
    const duplicateWarnings = [];
    for (const [folderName, photos] of folderGroups) {
      const matchResult = folderMatchResults.get(folderName);
      const machine = matchResult?.machine ?? null;
      const classified = await classifyMachinePhotos(photos, () => {
        classifiedFiles += 1;
        updateMaintenanceTripProgress(id, {
          totalFiles: totalGroupedPhotos,
          processedFiles: classifiedFiles,
          percent: 46 + ((classifiedFiles / totalGroupedPhotos) * 25),
          stage: `جارٍ تصنيف صور المجلد ${folderName}...`,
        });
      });
      const plan = { folderName, before: classified.before, after: classified.after };
      if (machine) {
        matchedByMachine.set(machine.id, {
          machine,
          before: [...plan.before],
          after: [...plan.after],
          folders: [folderName],
        });
      } else if (matchResult?.duplicate) {
        const duplicateMachine = matchResult.duplicateMachine;
        unmatchedPlans.push({
          ...plan,
          isDuplicate: true,
          duplicateOfFolder: matchResult.duplicateOfFolder,
          duplicateMachineId: duplicateMachine.id,
        });
        duplicateWarnings.push({
          machineId: duplicateMachine.id,
          machineName: duplicateMachine.name_ar || duplicateMachine.code,
          originalFolder: matchResult.duplicateOfFolder,
          duplicateFolder: folderName,
        });
      } else {
        unmatchedPlans.push(plan);
      }
    }

    updateMaintenanceTripProgress(id, { percent: 72, stage: 'جارٍ التحقق من بطاقات الماكينات...' });
    const existingCards = new Map(database.prepare(`
      SELECT id, machine_id, before_photos_json, after_photos_json, status
      FROM maintenance_cards WHERE order_id = ? AND deleted_at IS NULL
    `).all(id).map((card) => [card.machine_id, card]));
    for (const [machineId, plan] of matchedByMachine) {
      const existing = existingCards.get(machineId);
      const beforeCount = parsePhotoJson(existing?.before_photos_json ?? '[]').length + plan.before.length;
      const afterCount = parsePhotoJson(existing?.after_photos_json ?? '[]').length + plan.after.length;
      if (beforeCount > MAX_CARD_PHOTOS || afterCount > MAX_CARD_PHOTOS) {
        throw new HttpError(400, `A maintenance card may contain at most ${MAX_CARD_PHOTOS} photos in each phase.`);
      }
    }
    for (const plan of unmatchedPlans) {
      if (plan.before.length > MAX_CARD_PHOTOS || plan.after.length > MAX_CARD_PHOTOS) {
        throw new HttpError(400, `An unmatched folder may contain at most ${MAX_CARD_PHOTOS} photos in each phase.`);
      }
    }

    updateMaintenanceTripProgress(id, { percent: 74, stage: 'جارٍ تجهيز مسارات حفظ الصور...' });
    const filePlans = [];
    for (const { machine, before, after } of matchedByMachine.values()) {
      for (const [phase, photos] of [['Before', before], ['After', after]]) {
        for (const photo of photos) {
          filePlans.push({ photo, storedPath: storageDirectory(
            'Clients', order.client_storage_code, 'Archived_Orders', order.order_code, machine.code, phase,
            `${randomUUID()}${extname(photo.name).toLowerCase()}`,
          ) });
        }
      }
    }
    for (const plan of unmatchedPlans) {
      for (const [phase, photos] of [['Before', plan.before], ['After', plan.after]]) {
        for (const photo of photos) {
          filePlans.push({ photo, storedPath: storageDirectory(
            'Clients', order.client_storage_code, 'Archived_Orders', order.order_code, 'Unmatched', safeTripFolderSegment(plan.folderName), phase,
            `${randomUUID()}${extname(photo.name).toLowerCase()}`,
          ) });
        }
      }
    }
    updateMaintenanceTripProgress(id, {
      totalFiles: filePlans.length,
      processedFiles: 0,
      percent: 76,
      stage: 'جارٍ حفظ صور الرحلة في أرشيف العميل...',
    });

    const writtenPaths = new Map();
    const savedFiles = [];
    try {
      let savedFileCount = 0;
      for (const item of filePlans) {
        const saved = await copyStorageFile(item.photo.sourceAbsolutePath, item.storedPath);
        writtenPaths.set(item.photo, saved.storedPath);
        savedFiles.push(saved.absolutePath);
        savedFileCount += 1;
        updateMaintenanceTripProgress(id, {
          totalFiles: filePlans.length,
          processedFiles: savedFileCount,
          percent: filePlans.length ? 76 + ((savedFileCount / filePlans.length) * 21) : 97,
          stage: `جارٍ حفظ الصور (${savedFileCount}/${filePlans.length})...`,
        });
      }

      updateMaintenanceTripProgress(id, { percent: 98, stage: 'جارٍ ربط الصور ببطاقات الصيانة وتسجيل العملية...' });
      const result = database.transaction(() => {
        const insertCard = database.prepare('INSERT INTO maintenance_cards (order_id, machine_id, status) VALUES (?, ?, ?)');
        const updateCard = database.prepare(`
          UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        const deployMachine = database.prepare(`
          INSERT INTO client_machines (client_id, machine_id, site_area)
          VALUES (?, ?, ?)
          ON CONFLICT(client_id, machine_id) DO UPDATE SET site_area = excluded.site_area, active = 1, last_seen_at = CURRENT_TIMESTAMP
        `);
        let attachedBefore = 0;
        let attachedAfter = 0;
        let cardsCreated = 0;

        for (const [machineId, plan] of matchedByMachine) {
          const existing = database.prepare(`
            SELECT id, before_photos_json, after_photos_json, status FROM maintenance_cards WHERE order_id = ? AND machine_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1
          `).get(id, machineId);
          const before = parsePhotoJson(existing?.before_photos_json ?? '[]');
          const after = parsePhotoJson(existing?.after_photos_json ?? '[]');
          for (const photo of plan.before) before.push(writtenPaths.get(photo));
          for (const photo of plan.after) after.push(writtenPaths.get(photo));
          const status = existing?.status === 'excluded' ? 'excluded' : 'pending';
          if (existing) {
            updateCard.run(JSON.stringify(before), JSON.stringify(after), status, existing.id);
            queueCardPhotoReview(existing.id, actorId, database);
          }
          else {
            const cardId = Number(insertCard.run(id, machineId, status).lastInsertRowid);
            updateCard.run(JSON.stringify(before), JSON.stringify(after), status, cardId);
            queueCardPhotoReview(cardId, actorId, database);
            cardsCreated += 1;
          }
          deployMachine.run(order.client_id, machineId, plan.machine.area);
          attachedBefore += plan.before.length;
          attachedAfter += plan.after.length;
        }

        const insertUnmatched = database.prepare(`
          INSERT INTO maintenance_unmatched_folders (
            order_id, folder_name, source_name, before_photos_json, after_photos_json,
            is_duplicate, duplicate_of_folder, duplicate_machine_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const plan of unmatchedPlans) {
          insertUnmatched.run(
            id,
            plan.folderName.slice(0, 200),
            sourceName,
            JSON.stringify(plan.before.map((photo) => writtenPaths.get(photo))),
            JSON.stringify(plan.after.map((photo) => writtenPaths.get(photo))),
            plan.isDuplicate ? 1 : 0,
            plan.duplicateOfFolder ?? null,
            plan.duplicateMachineId ?? null,
          );
        }

        recordAudit({
          database,
          actorId,
          action: 'process_trip_folder',
          entityType: 'maintenance_order',
          entityId: id,
          newValues: {
            source_name: sourceName,
            matched_machine_count: matchedByMachine.size,
            unmatched_folder_count: unmatchedPlans.length,
            duplicate_folder_count: duplicateWarnings.length,
            duplicate_warnings: duplicateWarnings,
            attached_before: attachedBefore,
            attached_after: attachedAfter,
            cards_created: cardsCreated,
          },
        });
        return {
          matchedMachineCount: matchedByMachine.size,
          unmatchedFolderCount: unmatchedPlans.length,
          duplicateWarnings,
          attachedBefore,
          attachedAfter,
          cardsCreated,
          order: getMaintenanceOrder(id, database),
        };
      }).immediate();
      updateMaintenanceTripProgress(id, {
        totalFiles: filePlans.length,
        processedFiles: filePlans.length,
        percent: 100,
        stage: 'اكتمل فحص وربط صور الرحلة.',
        active: false,
      });
      return result;
    } catch (error) {
      await Promise.all(savedFiles.map((absolutePath) => removeStorageFile(absolutePath)));
      throw error;
    }
  } catch (error) {
    updateMaintenanceTripProgress(id, { stage: 'تعذر إكمال فحص مجلد الرحلة.', active: false });
    throw error;
  } finally {
    if (tripExtractionDirectory) await rm(tripExtractionDirectory, { recursive: true, force: true });
  }
}

export async function processMaintenanceTripFolder(orderId, input = {}, actorId = null, database = db) {
  return withMaintenanceOrderStorageLock(() => {
    assertNoPendingMaintenanceFileRecovery(database);
    return processMaintenanceTripFolderUnlocked(orderId, input, actorId, database);
  });
}

async function bindUnmatchedMaintenanceFolderUnlocked(orderId, folderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const unmatchedId = positiveId(folderId, 'folderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['machineId']);
  const machineId = positiveId(body.machineId, 'machineId');
  const order = findMaintenanceOrder(id, database);
  if (order.status === 'archived') throw new HttpError(409, 'Archived maintenance orders are read-only.');
  const folder = database.prepare(`
    SELECT * FROM maintenance_unmatched_folders WHERE id = ? AND order_id = ? AND status = 'pending'
  `).get(unmatchedId, id);
  if (!folder) throw new HttpError(404, 'Unmatched folder was not found or has already been bound.');
  const machine = database.prepare(`
    SELECT id, code, area FROM machines WHERE id = ? AND active = 1 AND deleted_at IS NULL
  `).get(machineId);
  const orderAreas = parseMaintenanceOrderAreas(order.area);
  if (!machine || !includesMaintenanceArea(orderAreas, machine.area)) {
    throw new HttpError(400, 'Choose an active machine from one of the order areas.');
  }
  const areaRename = await prepareAreaSourceRename(folder, machine);

  const beforeSource = parsePhotoJson(folder.before_photos_json);
  const afterSource = parsePhotoJson(folder.after_photos_json);
  const destinationFiles = [];
  for (const [phase, photoPaths] of [['Before', beforeSource], ['After', afterSource]]) {
    for (const sourcePath of photoPaths) {
      const absolutePath = await resolveStorageFile(sourcePath);
      destinationFiles.push({ sourcePath, phase, contents: await readFile(absolutePath), storedPath: storageDirectory(
        'Clients', order.client_storage_code, 'Archived_Orders', order.order_code, machine.code, phase,
        `${randomUUID()}${extname(sourcePath).toLowerCase()}`,
      ) });
    }
  }

  const savedFiles = [];
  let areaSourceRenamed = false;
  try {
    for (const item of destinationFiles) {
      const saved = await writeStorageFile(item.storedPath, item.contents);
      item.storedPath = saved.storedPath;
      savedFiles.push(saved.absolutePath);
    }
    await renameAreaSourceDirectory(areaRename);
    areaSourceRenamed = Boolean(areaRename);

    const bound = database.transaction(() => {
      const currentFolder = database.prepare(`
        SELECT id FROM maintenance_unmatched_folders WHERE id = ? AND order_id = ? AND status = 'pending'
      `).get(unmatchedId, id);
      if (!currentFolder) throw new HttpError(409, 'This unmatched folder was already bound. Refresh the order and try again.');
      const existing = database.prepare(`
        SELECT id, before_photos_json, after_photos_json, status FROM maintenance_cards WHERE order_id = ? AND machine_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1
      `).get(id, machineId);
      const before = parsePhotoJson(existing?.before_photos_json ?? '[]');
      const after = parsePhotoJson(existing?.after_photos_json ?? '[]');
      const existingBound = database.prepare(`
        SELECT 1 FROM maintenance_unmatched_folders WHERE order_id = ? AND status = 'bound' AND bound_machine_id = ? AND id != ?
      `).get(id, machineId, unmatchedId);
      if (existingBound) throw new HttpError(409, 'This machine is already linked to another reviewed folder.');
      for (const item of destinationFiles) (item.phase === 'Before' ? before : after).push(item.storedPath);
      if (before.length > MAX_CARD_PHOTOS || after.length > MAX_CARD_PHOTOS) {
        throw new HttpError(400, `A maintenance card may contain at most ${MAX_CARD_PHOTOS} photos in each phase.`);
      }
      const status = existing?.status === 'excluded' ? 'excluded' : 'pending';
      let cardId = existing?.id;
      if (existing) {
        database.prepare(`UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(JSON.stringify(before), JSON.stringify(after), status, cardId);
      } else {
        cardId = Number(database.prepare(`INSERT INTO maintenance_cards (order_id, machine_id, before_photos_json, after_photos_json, status) VALUES (?, ?, ?, ?, ?)`)
          .run(id, machineId, JSON.stringify(before), JSON.stringify(after), status).lastInsertRowid);
      }
      queueCardPhotoReview(cardId, actorId, database);
      database.prepare(`
        INSERT INTO client_machines (client_id, machine_id, site_area)
        VALUES (?, ?, ?)
        ON CONFLICT(client_id,machine_id) DO UPDATE SET site_area = excluded.site_area, active = 1, last_seen_at = CURRENT_TIMESTAMP
      `).run(order.client_id, machineId, machine.area);
      database.prepare(`
        UPDATE maintenance_unmatched_folders SET status = 'bound', bound_machine_id = ?, bound_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(machineId, unmatchedId);
      if (areaRename) {
        remapOrderCardSourcePaths(database, id, areaRename.oldStoredPath, areaRename.newStoredPath);
      }
      recordAudit({ database, actorId, action: 'bind_unmatched_folder', entityType: 'maintenance_unmatched_folder', entityId: unmatchedId,
        oldValues: { status: 'pending', folder_name: folder.folder_name },
        newValues: {
          status: 'bound', machine_id: machineId, machine_code: machine.code, card_id: cardId,
          ...(areaRename ? { source_folder: areaRename.oldStoredPath, renamed_source_folder: areaRename.newStoredPath } : {}),
        } });
      return { cardId, machineCode: machine.code, order: getMaintenanceOrder(id, database) };
    }).immediate();
    return bound;
  } catch (error) {
    if (areaSourceRenamed) {
      try {
        await renameAreaSourceDirectory({
          sourceDirectory: areaRename.destinationDirectory,
          destinationDirectory: areaRename.sourceDirectory,
        });
      } catch (rollbackError) {
        const restoreError = new HttpError(500, 'Binding failed and the source folder could not be restored. Contact an administrator before retrying.');
        restoreError.cause = rollbackError;
        await Promise.all(savedFiles.map((absolutePath) => removeStorageFile(absolutePath)));
        throw restoreError;
      }
    }
    await Promise.all(savedFiles.map((absolutePath) => removeStorageFile(absolutePath)));
    throw error;
  }
}

export async function bindUnmatchedMaintenanceFolder(orderId, folderId, input, actorId = null, database = db) {
  return withMaintenanceOrderStorageLock(() => bindUnmatchedMaintenanceFolderUnlocked(orderId, folderId, input, actorId, database));
}

export async function deleteUnmatchedMaintenanceFolder(orderId, folderId, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const unmatchedId = positiveId(folderId, 'folderId');
  return withMaintenanceOrderStorageLock(async () => {
    if (hasPendingMaintenanceFileRecovery(database)) {
      throw new HttpError(409, 'A maintenance file recovery is pending. Restart the server before trying again.');
    }

    const order = findMaintenanceOrder(id, database);
    if (order.status === 'archived') throw new HttpError(409, 'Archived maintenance orders are read-only.');
    const folder = database.prepare(`
      SELECT * FROM maintenance_unmatched_folders
      WHERE id = ? AND order_id = ? AND status = 'pending'
    `).get(unmatchedId, id);
    if (!folder) throw new HttpError(404, 'Unmatched folder was not found.');

    const targets = await collectUnmatchedFolderDeletionTargets(order, folder, database);
    const archiveDirectory = unmatchedFolderArchiveDirectory({
      client_code: order.client_storage_code,
      order_code: order.order_code,
      folder_name: folder.folder_name,
    });
    const sourceDirectory = unmatchedFolderSourceDirectory(folder.source_name, folder.folder_name);
    const operationId = targets.length ? randomUUID() : null;

    const assertNoSharedFolderTargets = () => {
      if (targets.some((target) => target.kind === 'directory' && target.path === archiveDirectory)) {
        const otherArchiveOwner = database.prepare(`
          SELECT folder_name FROM maintenance_unmatched_folders
          WHERE order_id = ? AND id != ?
        `).all(id, unmatchedId).some((candidate) => (
          safeTripFolderSegment(candidate.folder_name) === safeTripFolderSegment(folder.folder_name)
        ));
        if (otherArchiveOwner) {
          throw new HttpError(409, 'Another unmatched folder shares this archive directory; refresh and try again.');
        }
      }
      if (sourceDirectory && targets.some((target) => target.kind === 'directory' && target.path === sourceDirectory)) {
        const sourceIdentity = normalizedStoragePathIdentity(sourceDirectory);
        const otherSourceOwner = database.prepare(`
          SELECT source_name, folder_name FROM maintenance_unmatched_folders WHERE id != ?
        `).all(unmatchedId).some((candidate) => {
          const candidatePath = unmatchedFolderSourceDirectory(candidate.source_name, candidate.folder_name);
          return candidatePath && normalizedStoragePathIdentity(candidatePath) === sourceIdentity;
        });
        if (otherSourceOwner) {
          throw new HttpError(409, 'Another unmatched folder references this source directory; refresh and try again.');
        }
      }
    };

    if (operationId) {
      database.transaction(() => {
        const currentOrder = findMaintenanceOrder(id, database);
        if (currentOrder.status === 'archived'
          || currentOrder.order_code !== order.order_code
          || currentOrder.client_storage_code !== order.client_storage_code) {
          throw new HttpError(409, 'The maintenance order changed while the folder was being prepared.');
        }
        const currentFolder = database.prepare(`
          SELECT * FROM maintenance_unmatched_folders
          WHERE id = ? AND order_id = ? AND status = 'pending'
        `).get(unmatchedId, id);
        if (!currentFolder
          || currentFolder.folder_name !== folder.folder_name
          || currentFolder.source_name !== folder.source_name
          || currentFolder.before_photos_json !== folder.before_photos_json
          || currentFolder.after_photos_json !== folder.after_photos_json) {
          throw new HttpError(409, 'The unmatched folder changed while its files were being prepared.');
        }
        assertNoSharedFolderTargets();
        database.prepare(`
          INSERT INTO maintenance_unmatched_folder_deletion_operations
            (operation_id, folder_id, order_id, client_code, order_code, folder_name, source_name, targets_json, state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared')
        `).run(
          operationId,
          unmatchedId,
          id,
          order.client_storage_code,
          order.order_code,
          folder.folder_name,
          folder.source_name,
          JSON.stringify(targets),
        );
      }).immediate();
    }

    let stageDirectory = null;
    let committed = false;
    try {
      if (operationId) {
        stageDirectory = await ensureStorageDirectory(...MAINTENANCE_UNMATCHED_FOLDER_DELETION_STAGE_ROOT, operationId);
        for (const [index, target] of targets.entries()) {
          const source = target.kind === 'directory'
            ? await resolveStorageDirectoryIfPresent(target.path)
            : await resolveStorageFileIfPresent(target.path);
          if (!source) throw new HttpError(409, 'An unmatched-folder source path changed while its files were being staged.');
          const stagedSegments = unmatchedFolderDeletionStagedPath(operationId, index).split('/');
          const stagedParent = await ensureStorageDirectory(...stagedSegments.slice(0, -1));
          await rename(source, join(stagedParent, stagedSegments.at(-1)));
        }
      }

      database.transaction(() => {
        const currentOrder = findMaintenanceOrder(id, database);
        if (currentOrder.status === 'archived') {
          throw new HttpError(409, 'Archived maintenance orders are read-only.');
        }
        if (currentOrder.order_code !== order.order_code || currentOrder.client_storage_code !== order.client_storage_code) {
          throw new HttpError(409, 'The maintenance order changed while its files were being staged.');
        }
        const currentFolder = database.prepare(`
          SELECT * FROM maintenance_unmatched_folders
          WHERE id = ? AND order_id = ? AND status = 'pending'
        `).get(unmatchedId, id);
        if (!currentFolder
          || currentFolder.folder_name !== folder.folder_name
          || currentFolder.source_name !== folder.source_name
          || currentFolder.before_photos_json !== folder.before_photos_json
          || currentFolder.after_photos_json !== folder.after_photos_json) {
          throw new HttpError(409, 'The unmatched folder changed while its files were being staged.');
        }
        assertNoSharedFolderTargets();

        const deletion = database.prepare(`
          DELETE FROM maintenance_unmatched_folders
          WHERE id = ? AND order_id = ? AND status = 'pending'
        `).run(unmatchedId, id);
        if (deletion.changes !== 1) throw new HttpError(409, 'The unmatched folder was already removed.');

        if (operationId) {
          const journalUpdate = database.prepare(`
            UPDATE maintenance_unmatched_folder_deletion_operations
            SET state = 'committed'
            WHERE operation_id = ? AND folder_id = ? AND state = 'prepared'
          `).run(operationId, unmatchedId);
          if (journalUpdate.changes !== 1) throw new HttpError(500, 'Unmatched-folder recovery journal was not found.');
        }

        recordAudit({
          database,
          actorId,
          action: 'delete_unmatched_folder',
          entityType: 'maintenance_unmatched_folder',
          entityId: unmatchedId,
          oldValues: {
            folder_name: folder.folder_name,
            source_name: folder.source_name,
            before_count: parseUnmatchedFolderPhotoPaths(folder.before_photos_json, 'before_photos_json').length,
            after_count: parseUnmatchedFolderPhotoPaths(folder.after_photos_json, 'after_photos_json').length,
          },
          newValues: null,
        });
      }).immediate();
      committed = true;

      let cleanupPending = false;
      if (operationId) {
        try {
          await rm(stageDirectory, { recursive: true, force: true });
          removeUnmatchedFolderDeletionOperation(operationId, database);
        } catch (cleanupError) {
          cleanupPending = true;
          console.error(`Unmatched-folder purge for ${folder.folder_name} remains staged for recovery: ${cleanupError.message}`);
        }
      }

      return {
        id: unmatchedId,
        folderName: folder.folder_name,
        deleted: true,
        ...(cleanupPending ? { cleanupPending: true } : {}),
      };
    } catch (error) {
      if (committed) throw error;
      if (operationId) {
        try {
          await restoreUnmatchedFolderDeletion(operationId, targets);
          removeUnmatchedFolderDeletionOperation(operationId, database);
        } catch (restoreError) {
          console.error(`Unmatched-folder restoration for ${folder.folder_name} is pending: ${restoreError.message}`);
          throw new HttpError(500, 'The unmatched folder was not deleted, but file recovery is pending. Restart the server before continuing.');
        }
      }
      throw error;
    }
  });
}

export async function getUnmatchedMaintenancePhoto(orderId, folderId, phase, filename, database = db) {
  const id = positiveId(orderId, 'orderId');
  const unmatchedId = positiveId(folderId, 'folderId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  const name = requireText(filename, 'filename', { maxLength: 200 });
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');
  const folder = database.prepare(`
    SELECT before_photos_json, after_photos_json FROM maintenance_unmatched_folders WHERE id = ? AND order_id = ? AND status = 'pending'
  `).get(unmatchedId, id);
  if (!folder) throw new HttpError(404, 'Unmatched folder was not found.');
  const photoPaths = parsePhotoJson(phase === 'before' ? folder.before_photos_json : folder.after_photos_json);
  const storedPath = photoPaths.find((photoPath) => photoPath.split('/').at(-1) === name);
  if (!storedPath || !TRIP_PHOTO_EXTENSIONS.has(extname(name).toLowerCase())) throw new HttpError(404, 'Photo is not attached to this unmatched folder.');
  return resolveStorageFile(storedPath);
}

export function addMaintenanceCard(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['machineId', 'notes']);
  const machineId = positiveId(body.machineId, 'machineId');
  const notes = optionalText(body.notes, 'notes', { maxLength: 10000 });

  const cardId = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'in_progress') throw new HttpError(409, 'Inspection cards can only be added while the order is in progress.');
    const orderAreas = parseMaintenanceOrderAreas(order.area);
    const machine = orderAreas.length
      ? database.prepare(`
        SELECT id FROM machines WHERE id = ? AND active = 1 AND deleted_at IS NULL
          AND area COLLATE NOCASE IN (${orderAreas.map(() => '?').join(',')})
      `).get(machineId, ...orderAreas)
      : database.prepare('SELECT id FROM machines WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(machineId);
    if (!machine) throw new HttpError(404, 'Active machine from one of the order areas was not found.');
    const result = database.prepare(`
      INSERT INTO maintenance_cards (order_id, machine_id, notes) VALUES (?, ?, ?)
    `).run(id, machineId, notes);
    const cardId = Number(result.lastInsertRowid);
    appendMachineNoteHistory({ database, machineId, cardId, orderId: id, actorId, note: notes });
    database.prepare(`
      INSERT INTO client_machines (client_id, machine_id, site_area)
      SELECT ?, id, area FROM machines WHERE id = ?
      ON CONFLICT(client_id, machine_id) DO UPDATE SET
        site_area = excluded.site_area,
        active = 1,
        last_seen_at = CURRENT_TIMESTAMP
    `).run(order.client_id, machineId);
    recordAudit({
      database,
      actorId,
      action: 'create',
      entityType: 'maintenance_card',
      entityId: cardId,
      newValues: { order_id: id, machine_id: machineId, notes },
    });
    return cardId;
  }).immediate();

  return getMaintenanceOrder(id, database).cards.find((card) => card.id === cardId);
}

export function populateMaintenanceOrderArea(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['area']);
  const area = requireText(body.area, 'area', { maxLength: 160 });
  const addedIds = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'in_progress') throw new HttpError(409, 'Machines can only be added while the order is in progress.');
    const orderAreas = parseMaintenanceOrderAreas(order.area);
    if (orderAreas.length && !includesMaintenanceArea(orderAreas, area)) {
      throw new HttpError(400, 'Machines can only be populated from one of the order areas.');
    }
    const machines = database.prepare(`
      SELECT machine.id FROM machines machine
      WHERE machine.active = 1 AND machine.deleted_at IS NULL AND machine.area = ? COLLATE NOCASE
        AND NOT EXISTS (SELECT 1 FROM maintenance_cards card WHERE card.order_id = ? AND card.machine_id = machine.id AND card.deleted_at IS NULL)
      ORDER BY machine.id
    `).all(area, id);
    const addCard = database.prepare('INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)');
    const deploy = database.prepare(`
      INSERT INTO client_machines (client_id, machine_id, site_area) SELECT ?, id, area FROM machines WHERE id = ?
      ON CONFLICT(client_id, machine_id) DO UPDATE SET site_area = excluded.site_area, active = 1, last_seen_at = CURRENT_TIMESTAMP
    `);
    const ids = [];
    for (const machine of machines) {
      ids.push(Number(addCard.run(id, machine.id).lastInsertRowid));
      deploy.run(order.client_id, machine.id);
    }
    if (!order.area) database.prepare('UPDATE maintenance_orders SET area = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(area, id);
    recordAudit({ database, actorId, action: 'populate_area', entityType: 'maintenance_order', entityId: id,
      newValues: { area, added_machine_ids: machines.map((machine) => machine.id), added_count: machines.length } });
    return ids;
  }).immediate();
  return { order: getMaintenanceOrder(id, database), addedCount: addedIds.length };
}

async function importMaintenanceServerFolderUnlocked(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['folderPath']);
  const folderPath = requireText(body.folderPath, 'folderPath', { maxLength: 1024 });
  const order = findMaintenanceOrder(id, database);
  if (order.status !== 'in_progress') throw new HttpError(409, 'Photos can only be imported while the order is in progress.');
  const orderAreas = parseMaintenanceOrderAreas(order.area);
  if (!orderAreas.length) throw new HttpError(400, 'Set at least one order area before importing a server folder.');
  const sourceFiles = await listStorageFiles(folderPath, { maxFiles: MAX_TRIP_FOLDER_FILES });
  const machines = database.prepare(`
    SELECT id, code FROM machines
    WHERE active = 1 AND deleted_at IS NULL
      AND area COLLATE NOCASE IN (${orderAreas.map(() => '?').join(',')})
    ORDER BY area COLLATE NOCASE, code COLLATE NOCASE, id
  `).all(...orderAreas);
  const byCode = new Map(machines.map((machine) => [machine.code.toLocaleLowerCase('en'), machine]));
  const planned = [];
  let skipped = 0;
  for (const sourcePath of sourceFiles) {
    const parts = sourcePath.split('/');
    const machineIndex = parts.findIndex((part) => byCode.has(part.toLocaleLowerCase('en')));
    if (machineIndex < 0) { skipped += 1; continue; }
    const phaseSegment = parts[machineIndex + 1]?.toLocaleLowerCase('en');
    const phase = ['before', 'قبل', 'قبلالصيانة'].includes(phaseSegment) ? 'before'
      : ['after', 'بعد', 'بعدالصيانة'].includes(phaseSegment) ? 'after' : null;
    if (!phase || !['.jpg', '.jpeg', '.png'].includes(extname(sourcePath).toLowerCase())) { skipped += 1; continue; }
    const machine = byCode.get(parts[machineIndex].toLocaleLowerCase('en'));
    const storedPath = `${storageDirectory('clients', order.client_storage_code, 'maintenance', order.order_code, machine.code, phase)}/${randomUUID()}${extname(sourcePath).toLowerCase()}`;
    planned.push({ machine, phase, sourcePath, storedPath });
  }
  const cardsByMachine = new Map(database.prepare(`
    SELECT id, machine_id, before_photos_json, after_photos_json FROM maintenance_cards WHERE order_id = ? AND deleted_at IS NULL
  `).all(id).map((card) => [card.machine_id, card]));
  const availableSlots = new Map();
  for (const item of planned) {
    let card = cardsByMachine.get(item.machine.id);
    if (!card) {
      card = { id: null, machine_id: item.machine.id, before_photos_json: '[]', after_photos_json: '[]' };
      cardsByMachine.set(item.machine.id, card);
    }
    const photos = parsePhotoJson(item.phase === 'before' ? card.before_photos_json : card.after_photos_json);
    const key = `${item.machine.id}:${item.phase}`;
    const used = availableSlots.get(key) ?? photos.length;
    if (used >= MAX_CARD_PHOTOS) {
      throw new HttpError(400, `A maintenance card may contain at most ${MAX_CARD_PHOTOS} photos in each phase.`);
    }
    availableSlots.set(key, used + 1);
  }
  const savedFiles = [];
  try {
    for (const item of planned) {
      if (item.skip) continue;
      const sourceAbsolute = await resolveStorageFile(item.sourcePath);
      const saved = await copyStorageFile(sourceAbsolute, item.storedPath);
      savedFiles.push(saved.absolutePath);
    }
    const result = database.transaction(() => {
      let attachedBefore = 0;
      let attachedAfter = 0;
      let cardsCreated = 0;
      const cardInsert = database.prepare('INSERT INTO maintenance_cards (order_id, machine_id) VALUES (?, ?)');
      const cardUpdate = database.prepare(`
        UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `);
      for (const [machineId, card] of cardsByMachine) {
        const items = planned.filter((item) => !item.skip && item.machine.id === machineId);
        if (!items.length) continue;
        const existing = database.prepare('SELECT id, before_photos_json, after_photos_json FROM maintenance_cards WHERE order_id = ? AND machine_id = ? AND deleted_at IS NULL').get(id, machineId);
        const cardId = existing?.id ?? Number(cardInsert.run(id, machineId).lastInsertRowid);
        if (!existing) cardsCreated += 1;
        const before = parsePhotoJson(existing?.before_photos_json ?? '[]');
        const after = parsePhotoJson(existing?.after_photos_json ?? '[]');
        for (const item of items) {
          (item.phase === 'before' ? before : after).push(item.storedPath);
          if (item.phase === 'before') attachedBefore += 1;
          else attachedAfter += 1;
        }
        cardUpdate.run(JSON.stringify(before), JSON.stringify(after), cardId);
        queueCardPhotoReview(cardId, actorId, database);
      }
      recordAudit({ database, actorId, action: 'import_server_folder', entityType: 'maintenance_order', entityId: id,
        newValues: { folder_path: folderPath, attached_before: attachedBefore, attached_after: attachedAfter, cards_created: cardsCreated, skipped } });
      return { attachedBefore, attachedAfter, cardsCreated, skipped };
    }).immediate();
    return result;
  } catch (error) {
    await Promise.all(savedFiles.map((filePath) => removeStorageFile(filePath)));
    throw error;
  }
}

export async function importMaintenanceServerFolder(orderId, input, actorId = null, database = db) {
  return withMaintenanceOrderStorageLock(() => {
    assertNoPendingMaintenanceFileRecovery(database);
    return importMaintenanceServerFolderUnlocked(orderId, input, actorId, database);
  });
}

async function updateMaintenanceCardUnlocked(orderId, cardId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['beforePhotos', 'afterPhotos', 'notes', 'reasonId', 'reasonIds', 'maintenanceLines', 'machineCode']);
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one card field must be provided.');

  const order = findMaintenanceOrder(id, database);
  if (order.status === 'archived') {
    const actor = actorId === null ? null : database.prepare(`
      SELECT role FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL
    `).get(actorId);
    if (actor?.role !== 'admin') {
      throw new HttpError(403, 'Administrator access is required to edit archived maintenance orders.');
    }
    const hasDisallowedFields = ['beforePhotos', 'afterPhotos'].some((key) => body[key] !== undefined);
    if (hasDisallowedFields) {
      throw new HttpError(409, 'Archived maintenance orders do not allow direct photo changes without unarchiving.');
    }
  }
  const card = database.prepare(`
    SELECT card.*, machine.code AS machine_code
    FROM maintenance_cards card JOIN machines machine ON machine.id = card.machine_id
    WHERE card.id = ? AND card.order_id = ? AND card.deleted_at IS NULL
  `).get(targetCardId, id);
  if (!card) throw new HttpError(404, 'Inspection card was not found on this order.');

  const requestedMachineCode = body.machineCode === undefined ? null : safeMachineCode(body.machineCode);
  const machineCodeChanged = requestedMachineCode !== null && requestedMachineCode !== card.machine_code;
  let replacementMachine = null;
  if (machineCodeChanged) {
    replacementMachine = database.prepare(`
      SELECT id, code, name_ar, name_en, area
      FROM machines
      WHERE code = ? COLLATE NOCASE AND active = 1 AND deleted_at IS NULL
    `).get(requestedMachineCode) ?? null;
    if (!replacementMachine) {
      const conflictingMachine = database.prepare(`
        SELECT id, active, deleted_at FROM machines
        WHERE code = ? COLLATE NOCASE AND id != ?
      `).get(requestedMachineCode, card.machine_id);
      if (conflictingMachine) {
        throw new HttpError(409, 'A machine with this code already exists but is not active.');
      }
    }
  }

  const beforePhotos = body.beforePhotos === undefined
    ? parsePhotoJson(card.before_photos_json)
    : validateStoredPhotoList(body.beforePhotos, 'beforePhotos');
  const afterPhotos = body.afterPhotos === undefined
    ? parsePhotoJson(card.after_photos_json)
    : validateStoredPhotoList(body.afterPhotos, 'afterPhotos');
  const isValidCardPhoto = (photoPath) => {
    const normalizedPath = String(photoPath).replace(/\\/g, '/');
    const segments = normalizedPath.split('/').map((part) => part.toLocaleLowerCase('en'));
    const expectedPrefixes = [
      ['clients', order.client_storage_code, 'maintenance', order.order_code, card.machine_code],
      ['clients', order.client_storage_code, 'archived_orders', order.order_code, card.machine_code],
    ].map((prefix) => prefix.map((part) => String(part).toLocaleLowerCase('en')));
    return expectedPrefixes.some((prefix) => prefix.every((part, index) => segments[index] === part))
      || isMaintenanceCardAreaPath(normalizedPath, order, card, database);
  };
  const submittedPhotoLists = [];
  if (body.beforePhotos !== undefined) submittedPhotoLists.push(['before', beforePhotos]);
  if (body.afterPhotos !== undefined) submittedPhotoLists.push(['after', afterPhotos]);
  for (const [phase, paths] of submittedPhotoLists) {
    for (const photoPath of paths) {
      if (!isValidCardPhoto(photoPath)) {
        throw new HttpError(400, `${phase} photo paths must belong to this client, order, and machine.`);
      }
      await resolveStorageFile(photoPath);
    }
  }
  const notes = body.notes === undefined ? card.notes : optionalText(body.notes, 'notes', { maxLength: 10000 });

  let reasonId = card.reason_id;
  let reasonIdsJson = card.reason_ids_json ?? '[]';
  let currentCardReasonIds = [];
  try {
    currentCardReasonIds = JSON.parse(card.reason_ids_json || '[]');
    if (!Array.isArray(currentCardReasonIds)) currentCardReasonIds = [];
  } catch {
    currentCardReasonIds = [];
  }
  if (!currentCardReasonIds.length && card.reason_id) {
    currentCardReasonIds = [card.reason_id];
  }

  if (body.reasonIds !== undefined) {
    if (!Array.isArray(body.reasonIds)) throw new HttpError(400, 'reasonIds must be an array of reason IDs.');
    const parsedIds = body.reasonIds.map((val) => positiveId(val, 'reasonId'));
    const uniqueIds = [...new Set(parsedIds)];
    if (uniqueIds.length > 0) {
      const placeholders = uniqueIds.map(() => '?').join(',');
      const rows = database.prepare(`SELECT id, active FROM maintenance_reasons WHERE id IN (${placeholders})`).all(...uniqueIds);
      const existingMap = new Map(rows.map((r) => [r.id, r.active]));
      const allowedInactive = new Set([...currentCardReasonIds, card.reason_id].filter(Boolean));
      for (const rid of uniqueIds) {
        if (!existingMap.has(rid)) {
          throw new HttpError(404, `Maintenance reason ${rid} was not found.`);
        }
        if (!existingMap.get(rid) && !allowedInactive.has(rid)) {
          throw new HttpError(404, `Active maintenance reason ${rid} was not found.`);
        }
      }
    }
    reasonId = uniqueIds[0] ?? null;
    reasonIdsJson = JSON.stringify(uniqueIds);
  } else if (body.reasonId !== undefined) {
    reasonId = body.reasonId === null || body.reasonId === '' ? null : positiveId(body.reasonId, 'reasonId');
    if (reasonId !== null && !database.prepare('SELECT 1 FROM maintenance_reasons WHERE id = ? AND (active = 1 OR id = ?)').get(reasonId, card.reason_id ?? 0)) {
      throw new HttpError(404, 'Active maintenance reason was not found.');
    }
    reasonIdsJson = JSON.stringify(reasonId === null ? [] : [reasonId]);
  }

  let submittedLines = null;
  if (body.maintenanceLines !== undefined) {
    if (!Array.isArray(body.maintenanceLines)) throw new HttpError(400, 'maintenanceLines must be an array.');
    submittedLines = new Map();
    for (const [index, rawLine] of body.maintenanceLines.entries()) {
      const line = requireObject(rawLine, `maintenanceLines[${index}]`);
      // Current clients include the catalog unit as display metadata. Persist
      // the server-owned reason unit, but accept it for compatibility with
      // already-built browser bundles and Android APKs.
      allowOnlyKeys(line, ['reasonId', 'quantity', 'unit', 'justification']);
      const lineReasonId = positiveId(line.reasonId, `maintenanceLines[${index}].reasonId`);
      if (submittedLines.has(lineReasonId)) throw new HttpError(400, `Duplicate maintenance line for reason ${lineReasonId}.`);
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw new HttpError(400, `maintenanceLines[${index}].quantity must be a positive whole number.`);
      }
      submittedLines.set(lineReasonId, {
        quantity: line.quantity,
        justification: line.justification === undefined ? null : requireText(line.justification, `maintenanceLines[${index}].justification`, { maxLength: 1000 }),
      });
    }
  }

  let selectedReasonIds = JSON.parse(reasonIdsJson);
  if (submittedLines && submittedLines.size > 0) {
    const combined = [...new Set([...selectedReasonIds, ...submittedLines.keys()])];
    if (combined.length !== selectedReasonIds.length) {
      selectedReasonIds = combined;
      reasonIdsJson = JSON.stringify(selectedReasonIds);
      if (reasonId === null) reasonId = selectedReasonIds[0] ?? null;
    }
  }

  const existingLines = database.prepare('SELECT * FROM maintenance_card_lines WHERE card_id = ?').all(targetCardId);
  const currentLinesByReason = new Map(existingLines.map((line) => [Number(line.reason_id), line]));
  const selectedCountable = selectedReasonIds.length
    ? database.prepare(`SELECT id, name, category, action_meaning, is_countable, unit
      FROM maintenance_reasons WHERE id IN (${selectedReasonIds.map(() => '?').join(',')})`).all(...selectedReasonIds)
      .filter((reason) => reason.is_countable)
    : [];
  for (const reason of selectedCountable) {
    const previous = currentLinesByReason.get(Number(reason.id));
    const quantity = submittedLines?.get(Number(reason.id))?.quantity;
    if (submittedLines && quantity === undefined) {
      throw new HttpError(400, `Enter a quantity for maintenance reason ${reason.id}.`, { apiCode: 'MAINTENANCE_QUANTITY_REQUIRED' });
    }
    if (!previous && quantity === undefined) {
      throw new HttpError(426, `This maintenance reason now requires a quantity. Update the application and submit the quantity for reason ${reason.id}.`, { apiCode: 'MAINTENANCE_STRUCTURED_LINES_REQUIRED' });
    }
  }
  if (submittedLines) {
    for (const lineReasonId of submittedLines.keys()) {
      if (!selectedCountable.some((reason) => Number(reason.id) === lineReasonId)) {
        throw new HttpError(400, `Reason ${lineReasonId} is not a selected countable maintenance item.`);
      }
    }
  }

  const update = database.transaction(() => {
    if (machineCodeChanged) {
      if (replacementMachine && replacementMachine.id !== card.machine_id) {
        database.prepare(`
          UPDATE maintenance_cards
          SET machine_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND order_id = ? AND deleted_at IS NULL
        `).run(replacementMachine.id, targetCardId, id);
      } else if (!replacementMachine || replacementMachine.id === card.machine_id) {
        database.prepare('UPDATE machines SET code = ? WHERE id = ?').run(requestedMachineCode, card.machine_id);
      }
      recordAudit({
        database,
        actorId,
        action: 'update_card_machine_code',
        entityType: 'maintenance_card',
        entityId: targetCardId,
        oldValues: { machine_code: card.machine_code },
        newValues: { machine_code: requestedMachineCode },
      });
    }
    database.prepare(`
      UPDATE maintenance_cards
      SET before_photos_json = ?, after_photos_json = ?, notes = ?, reason_id = ?, reason_ids_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND order_id = ? AND deleted_at IS NULL
    `).run(JSON.stringify(beforePhotos), JSON.stringify(afterPhotos), notes, reasonId, reasonIdsJson, targetCardId, id);
    if (JSON.stringify(beforePhotos) !== card.before_photos_json || JSON.stringify(afterPhotos) !== card.after_photos_json) {
      queueCardPhotoReview(targetCardId, actorId, database);
    }
    const selectedSet = new Set(selectedReasonIds.map(Number));
    for (const existingLine of existingLines) {
      if (!selectedSet.has(Number(existingLine.reason_id))) {
        database.prepare('DELETE FROM maintenance_card_lines WHERE id = ?').run(existingLine.id);
      }
    }
    for (const reason of selectedCountable) {
      const previous = currentLinesByReason.get(Number(reason.id));
      const submitted = submittedLines?.get(Number(reason.id));
      const quantity = submitted?.quantity ?? previous?.quantity;
      if (quantity === undefined || quantity === null) continue;
      const corrected = previous && Number(previous.quantity) !== Number(quantity);
      if (corrected) {
        if (!submitted?.justification) {
          throw new HttpError(400, `A correction justification is required for maintenance reason ${reason.id}.`, { apiCode: 'MAINTENANCE_QUANTITY_JUSTIFICATION_REQUIRED' });
        }
        recordAudit({ database, actorId, action: 'correct_quantity', entityType: 'maintenance_card_line',
          entityId: previous.id, oldValues: { quantity: previous.quantity, provenance: previous.quantity_provenance },
          newValues: { quantity, provenance: 'admin_correction', cardId: targetCardId, reasonId: reason.id,
            justification: submitted.justification } });
      }
      const provenance = corrected
        ? 'admin_correction'
        : (submitted !== undefined ? 'user_entered' : (previous?.quantity_provenance ?? 'user_entered'));
      database.prepare(`INSERT INTO maintenance_card_lines
        (card_id, reason_id, reason_label_snapshot, category_snapshot, action_meaning_snapshot,
         quantity, unit_snapshot, quantity_provenance, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(card_id, reason_id) DO UPDATE SET
          quantity = excluded.quantity,
          quantity_provenance = excluded.quantity_provenance,
          updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
        .run(targetCardId, reason.id, reason.name, reason.category, reason.action_meaning, quantity, reason.unit,
          provenance, actorId, actorId);
    }
    if (body.notes !== undefined && String(notes ?? '').trim()
        && String(notes).trim() !== String(card.notes ?? '').trim()) {
      appendMachineNoteHistory({
        database,
        machineId: replacementMachine?.id ?? card.machine_id,
        cardId: targetCardId,
        orderId: id,
        actorId,
        note: notes,
      });
    }
    recordAudit({
      database,
      actorId,
      action: 'update',
      entityType: 'maintenance_card',
      entityId: targetCardId,
      oldValues: {
        before_photos: parsePhotoJson(card.before_photos_json),
        after_photos: parsePhotoJson(card.after_photos_json),
        notes: card.notes,
        reason_id: card.reason_id,
        reason_ids: currentCardReasonIds,
      },
      newValues: {
        before_photos: beforePhotos,
        after_photos: afterPhotos,
        notes,
        reason_id: reasonId,
        reason_ids: JSON.parse(reasonIdsJson),
      },
    });
  });
  update();
  return getMaintenanceOrder(id, database).cards.find((item) => item.id === targetCardId);
}

export async function updateMaintenanceCard(orderId, cardId, input, actorId = null, database = db) {
  return withMaintenanceOrderStorageLock(() => {
    assertNoPendingMaintenanceFileRecovery(database);
    return updateMaintenanceCardUnlocked(orderId, cardId, input, actorId, database);
  });
}

async function uploadMaintenancePhotoUnlocked(orderId, cardId, phase, file, actorId = null, database = db) {
  assertNoPendingMaintenanceFileRecovery(database);
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  if (!file?.buffer?.length) throw new HttpError(400, 'A maintenance photo is required.');
  const extension = extname(file.originalname).toLowerCase();
  if (!PHOTO_EXTENSIONS.has(extension)) throw new HttpError(400, 'Unsupported maintenance photo extension.');

  let compressed;
  try {
    compressed = await compressFieldImage(file.buffer);
  } catch {
    throw new HttpError(400, 'Maintenance photo is not a supported, decodable image.');
  }

  const metadata = database.prepare(`
    SELECT order_record.id AS order_id,
      machine.code AS machine_code, machine.name_ar AS machine_name_ar, machine.area, machine.area_name,
      card.id AS card_id, card.before_photos_json, card.after_photos_json
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL
      AND order_record.status != 'archived' AND card.deleted_at IS NULL
  `).get(id, targetCardId);
  if (!metadata) throw new HttpError(404, 'Active inspection card was not found on this order.');

  const now = new Date();
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: getTimeZone(database), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  const workDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const areaSegment = safeMachineStorageSegment(metadata.area_name || metadata.area, 'Unassigned Area');
  const machineSegment = safeMachineStorageSegment(
    `${metadata.machine_code}_${metadata.machine_name_ar || ''}`, metadata.machine_code,
  );
  const orderSegment = `${workDate}_${metadata.order_id}`;
  const storedPath = storageDirectory(
    'Areas', areaSegment, machineSegment, orderSegment, phase, `${randomUUID()}.jpg`,
  );
  const savedFile = await writeStorageFile(storedPath, compressed.buffer);
  try {
    const update = database.transaction(() => {
      const current = database.prepare(`SELECT before_photos_json, after_photos_json FROM maintenance_cards
        WHERE id = ? AND order_id = ? AND deleted_at IS NULL`).get(targetCardId, id);
      if (!current) throw new HttpError(404, 'Active inspection card was not found on this order.');
      const oldPaths = parsePhotoJson(phase === 'before' ? current.before_photos_json : current.after_photos_json);
      if (oldPaths.length >= MAX_MANUAL_CARD_PHASE_PHOTOS) {
        throw new HttpError(400, `A maintenance card may contain at most ${MAX_MANUAL_CARD_PHASE_PHOTOS} manually uploaded photos in each phase.`);
      }
      const nextPaths = [...oldPaths, storedPath];
      const column = phase === 'before' ? 'before_photos_json' : 'after_photos_json';
      const result = database.prepare(`UPDATE maintenance_cards SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`)
        .run(JSON.stringify(nextPaths), targetCardId);
      if (result.changes !== 1) throw new HttpError(404, 'Active inspection card was not found on this order.');
      queueCardPhotoReview(targetCardId, actorId, database);
      recordAudit({
        database,
        actorId,
        action: 'photo_upload',
        entityType: 'maintenance_card',
        entityId: targetCardId,
        oldValues: { [phase]: oldPaths },
        newValues: { [phase]: nextPaths },
      });
      return nextPaths;
    });
    const photos = update();
    return {
      phase,
      path: storedPath,
      photos,
      url: `/api/maintenance/orders/${id}/cards/${targetCardId}/photos/${phase}/${encodeURIComponent(storedPath.split('/').at(-1))}`,
    };
  } catch (error) {
    await removeStorageFile(savedFile.absolutePath);
    throw error;
  }
}

export async function uploadMaintenancePhoto(orderId, cardId, phase, file, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  const card = database.prepare(`SELECT machine_id FROM maintenance_cards WHERE id = ? AND order_id = ?`).get(targetCardId, id);
  if (!card) return uploadMaintenancePhotoUnlocked(orderId, cardId, phase, file, actorId, database);
  return withMachineStorageLock(card.machine_id,
    () => uploadMaintenancePhotoUnlocked(orderId, cardId, phase, file, actorId, database));
}

export async function deleteCardPhoto(orderId, cardId, phase, filename, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  const name = requireText(filename, 'filename', { maxLength: 200 });
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');

  return withMaintenanceOrderStorageLock(async () => {
    assertNoPendingMaintenanceFileRecovery(database);
    const removedPhoto = database.transaction(() => {
      const card = database.prepare(`
        SELECT card.id, card.order_id, card.before_photos_json, card.after_photos_json, card.status,
          order_record.status AS order_status
        FROM maintenance_cards card
        JOIN maintenance_orders order_record ON order_record.id = card.order_id
        WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL AND card.deleted_at IS NULL
      `).get(id, targetCardId);

      if (!card) throw new HttpError(404, 'Active inspection card was not found.');
      if (card.order_status === 'archived') {
        throw new HttpError(409, 'Archived maintenance orders do not allow photo changes.');
      }

      const beforePaths = parsePhotoJson(card.before_photos_json);
      const afterPaths = parsePhotoJson(card.after_photos_json);
      const targetList = phase === 'before' ? beforePaths : afterPaths;
      const targetIndex = targetList.findIndex((photoPath) => photoPath.split('/').at(-1) === name);
      if (targetIndex === -1) throw new HttpError(404, 'Photo was not found in this card phase.');

      const [removedStoredPath] = targetList.splice(targetIndex, 1);
      const nextStatus = card.status === 'excluded'
        ? 'excluded'
        : 'pending';
      const update = database.prepare(`
        UPDATE maintenance_cards
        SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND order_id = ? AND deleted_at IS NULL
      `).run(JSON.stringify(beforePaths), JSON.stringify(afterPaths), nextStatus, targetCardId, id);
      if (update.changes !== 1) throw new HttpError(404, 'Active inspection card was not found.');
      queueCardPhotoReview(targetCardId, actorId, database);
      const previousRotation = database.prepare(`
        SELECT angle, rotated_path FROM maintenance_card_photo_rotations
        WHERE card_id = ? AND phase = ? AND filename = ?
      `).get(targetCardId, phase, name);
      database.prepare(`
        DELETE FROM maintenance_card_photo_rotations
        WHERE card_id = ? AND phase = ? AND filename = ?
      `).run(targetCardId, phase, name);

      recordAudit({
        database,
        actorId,
        action: 'photo_delete',
        entityType: 'maintenance_card',
        entityId: targetCardId,
          oldValues: { phase, photo: removedStoredPath, rotation: previousRotation?.angle ?? 0, previous_status: card.status },
        newValues: { status: nextStatus, remaining_before: beforePaths.length, remaining_after: afterPaths.length },
      });
      return {
        removedStoredPath,
        removedRotatedPath: previousRotation?.rotated_path ?? null,
        status: nextStatus,
        beforeCount: beforePaths.length,
        afterCount: afterPaths.length,
      };
    }).immediate();

    let fileCleanupPending = false;
    try {
      const absolutePath = await resolveStorageFile(removedPhoto.removedStoredPath);
      await removeStorageFile(absolutePath);
      if (removedPhoto.removedRotatedPath) {
        const rotatedAbsolutePath = await resolveStorageFile(removedPhoto.removedRotatedPath);
        await removeStorageFile(rotatedAbsolutePath);
      }
    } catch (error) {
      if (error.status !== 404 && error.code !== 'ENOENT') {
        fileCleanupPending = true;
        console.error(`Maintenance photo cleanup for card ${targetCardId} is pending: ${error.message}`);
      }
    }

    return {
      ok: true,
      cardId: targetCardId,
      status: removedPhoto.status,
      ...(fileCleanupPending ? { fileCleanupPending: true } : {}),
    };
  });
}

export async function moveCardPhoto(orderId, cardId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['fromPhase', 'toPhase', 'filename']);
  const { fromPhase, toPhase } = body;
  if (!['before', 'after'].includes(fromPhase) || !['before', 'after'].includes(toPhase)) {
    throw new HttpError(400, 'fromPhase and toPhase must be before or after.');
  }
  const name = requireText(body.filename, 'filename', { maxLength: 200 });
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');

  return withMaintenanceOrderStorageLock(async () => {
    assertNoPendingMaintenanceFileRecovery(database);
    const card = database.prepare(`
      SELECT card.id, card.order_id, card.before_photos_json, card.after_photos_json, card.status,
        order_record.status AS order_status, order_record.order_code,
        client.storage_code AS client_code, machine.code AS machine_code
      FROM maintenance_cards card
      JOIN maintenance_orders order_record ON order_record.id = card.order_id
      JOIN clients client ON client.id = order_record.client_id
      JOIN machines machine ON machine.id = card.machine_id
      WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL AND card.deleted_at IS NULL
    `).get(id, targetCardId);

    if (!card) throw new HttpError(404, 'Active inspection card was not found.');
    if (card.order_status === 'archived') {
      throw new HttpError(409, 'Archived maintenance orders do not allow photo changes.');
    }

    const beforePaths = parsePhotoJson(card.before_photos_json);
    const afterPaths = parsePhotoJson(card.after_photos_json);
    const sourceList = fromPhase === 'before' ? beforePaths : afterPaths;
    const destinationList = toPhase === 'before' ? beforePaths : afterPaths;
    const sourceIndex = sourceList.findIndex((photoPath) => photoPath.split('/').at(-1) === name);
    if (sourceIndex === -1) throw new HttpError(404, 'Photo was not found in source phase.');
    if (fromPhase === toPhase) return { ok: true, cardId: targetCardId, status: card.status };
    if (destinationList.length >= MAX_MANUAL_CARD_PHASE_PHOTOS) {
      throw new HttpError(400, `A maintenance card may contain at most ${MAX_MANUAL_CARD_PHASE_PHOTOS} manually uploaded photos in each phase.`);
    }
    const [sourceStoredPath] = sourceList.splice(sourceIndex, 1);
    const pathSegments = sourceStoredPath.replace(/\\/g, '/').split('/');
    const phaseDirectoryIndex = pathSegments.length - 2;
    if (pathSegments[phaseDirectoryIndex]?.toLocaleLowerCase('en') !== fromPhase) {
      throw new HttpError(400, 'Photo storage path does not match its source phase.');
    }
    const phaseDirectory = pathSegments[phaseDirectoryIndex];
    pathSegments[phaseDirectoryIndex] = phaseDirectory === phaseDirectory.toUpperCase()
      ? toPhase.toUpperCase()
      : phaseDirectory[0] === phaseDirectory[0].toUpperCase() && phaseDirectory.slice(1) === phaseDirectory.slice(1).toLowerCase()
        ? `${toPhase[0].toUpperCase()}${toPhase.slice(1)}`
        : toPhase;
    const movedStoredPath = pathSegments.join('/');
    destinationList.push(movedStoredPath);
    const nextStatus = card.status === 'excluded'
      ? 'excluded'
      : 'pending';
    const sourceAbsolutePath = await resolveStorageFile(sourceStoredPath);
    const destinationAbsoluteDirectory = await ensureStorageDirectory(...pathSegments.slice(0, -1));
    const destinationAbsolutePath = join(destinationAbsoluteDirectory, pathSegments.at(-1));
    const rotation = database.prepare(`
      SELECT angle, rotated_path FROM maintenance_card_photo_rotations
      WHERE card_id = ? AND phase = ? AND filename = ?
    `).get(targetCardId, fromPhase, name);
    const sourceRotatedPath = rotation?.rotated_path ?? null;
    const movedRotatedPath = sourceRotatedPath
      ? [...pathSegments.slice(0, -1), sourceRotatedPath.split('/').at(-1)].join('/')
      : null;
    const sourceRotatedAbsolutePath = sourceRotatedPath ? await resolveStorageFile(sourceRotatedPath) : null;
    const destinationRotatedAbsolutePath = movedRotatedPath
      ? join(destinationAbsoluteDirectory, movedRotatedPath.split('/').at(-1))
      : null;
    try {
      await lstat(destinationAbsolutePath);
      throw new HttpError(409, 'A photo with the same filename already exists in the destination phase.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (destinationRotatedAbsolutePath && movedRotatedPath !== sourceRotatedPath) {
      try {
        await lstat(destinationRotatedAbsolutePath);
        throw new HttpError(409, 'A rotated photo with the same filename already exists in the destination phase.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    await rename(sourceAbsolutePath, destinationAbsolutePath);
    try {
      if (sourceRotatedAbsolutePath && destinationRotatedAbsolutePath && movedRotatedPath !== sourceRotatedPath) {
        await rename(sourceRotatedAbsolutePath, destinationRotatedAbsolutePath);
      }
      const update = database.transaction(() => {
        const result = database.prepare(`
          UPDATE maintenance_cards
          SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND order_id = ? AND deleted_at IS NULL
        `).run(JSON.stringify(beforePaths), JSON.stringify(afterPaths), nextStatus, targetCardId, id);
        if (result.changes !== 1) throw new HttpError(404, 'Active inspection card was not found.');
        queueCardPhotoReview(targetCardId, actorId, database);
        if (rotation) {
          database.prepare(`
            UPDATE maintenance_card_photo_rotations
            SET phase = ?, rotated_path = ?, updated_at = CURRENT_TIMESTAMP
            WHERE card_id = ? AND phase = ? AND filename = ?
          `).run(toPhase, movedRotatedPath, targetCardId, fromPhase, name);
        }

        recordAudit({
          database,
          actorId,
          action: 'photo_move',
          entityType: 'maintenance_card',
          entityId: targetCardId,
          oldValues: { fromPhase, toPhase, photo: sourceStoredPath, rotation: rotation?.angle ?? 0, status: card.status },
          newValues: { photo: movedStoredPath, rotation: rotation?.angle ?? 0, status: nextStatus, before_count: beforePaths.length, after_count: afterPaths.length },
        });
      });
      update.immediate();
    } catch (error) {
      if (sourceRotatedAbsolutePath && destinationRotatedAbsolutePath && movedRotatedPath !== sourceRotatedPath) {
        await rename(destinationRotatedAbsolutePath, sourceRotatedAbsolutePath).catch(() => undefined);
      }
      await rename(destinationAbsolutePath, sourceAbsolutePath);
      throw error;
    }
    return { ok: true, cardId: targetCardId, status: nextStatus, path: movedStoredPath };
  });
}

export async function retagMaintenancePhoto(orderId, cardId, input, actorId = null, database = db) {
  const sourceOrderId = positiveId(orderId, 'orderId');
  const sourceCardId = positiveId(cardId, 'cardId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['fromPhase', 'toPhase', 'filename', 'targetOrderId', 'targetCardId']);
  const targetOrderId = body.targetOrderId === undefined ? sourceOrderId : positiveId(body.targetOrderId, 'targetOrderId');
  const targetCardId = body.targetCardId === undefined ? sourceCardId : positiveId(body.targetCardId, 'targetCardId');
  const moveInput = { fromPhase: body.fromPhase, toPhase: body.toPhase, filename: body.filename };
  if (sourceOrderId === targetOrderId && sourceCardId === targetCardId) {
    return moveCardPhoto(sourceOrderId, sourceCardId, moveInput, actorId, database);
  }
  const { fromPhase, toPhase } = moveInput;
  if (!['before', 'after'].includes(fromPhase) || !['before', 'after'].includes(toPhase)) {
    throw new HttpError(400, 'fromPhase and toPhase must be before or after.');
  }
  const filename = requireText(moveInput.filename, 'filename', { maxLength: 200 });
  if (filename.includes('/') || filename.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');

  return withMaintenanceOrderStorageLock(async () => {
    assertNoPendingMaintenanceFileRecovery(database);
    const cardQuery = `
      SELECT card.id, card.order_id, card.before_photos_json, card.after_photos_json, card.status,
        order_record.status AS order_status, order_record.order_code, order_record.client_id,
        client.storage_code AS client_code, machine.code AS machine_code
      FROM maintenance_cards card
      JOIN maintenance_orders order_record ON order_record.id = card.order_id
      JOIN clients client ON client.id = order_record.client_id
      JOIN machines machine ON machine.id = card.machine_id
      WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL AND card.deleted_at IS NULL
    `;
    const sourceCard = database.prepare(cardQuery).get(sourceOrderId, sourceCardId);
    const targetCard = database.prepare(cardQuery).get(targetOrderId, targetCardId);
    if (!sourceCard) throw new HttpError(404, 'Source inspection card was not found.');
    if (!targetCard) throw new HttpError(404, 'Target maintenance order or machine card was not found.');
    if (Number(sourceCard.client_id) !== Number(targetCard.client_id)) {
      throw new HttpError(403, 'A photo can only be reassigned to another order for the same client.');
    }
    if (sourceCard.order_status === 'archived' || targetCard.order_status === 'archived') {
      throw new HttpError(409, 'Archived maintenance orders do not allow photo changes.');
    }

    const sourceBefore = parsePhotoJson(sourceCard.before_photos_json);
    const sourceAfter = parsePhotoJson(sourceCard.after_photos_json);
    const targetBefore = parsePhotoJson(targetCard.before_photos_json);
    const targetAfter = parsePhotoJson(targetCard.after_photos_json);
    const sourceList = fromPhase === 'before' ? sourceBefore : sourceAfter;
    const targetList = toPhase === 'before' ? targetBefore : targetAfter;
    const index = sourceList.findIndex((path) => basename(path) === filename);
    if (index < 0) throw new HttpError(404, 'Photo was not found in the source card phase.');
    if (targetList.length >= MAX_MANUAL_CARD_PHASE_PHOTOS) {
      throw new HttpError(400, `A maintenance card may contain at most ${MAX_MANUAL_CARD_PHASE_PHOTOS} manually uploaded photos in each phase.`);
    }
    const [sourceStoredPath] = sourceList.splice(index, 1);
    const destinationDirectory = storageDirectory(
      'clients', targetCard.client_code, 'maintenance', targetCard.order_code, targetCard.machine_code, toPhase,
    );
    const destinationStoredPath = `${destinationDirectory}/${basename(sourceStoredPath)}`;
    targetList.push(destinationStoredPath);
    const sourceNextStatus = sourceCard.status === 'excluded'
      ? 'excluded'
      : 'pending';
    const targetNextStatus = targetCard.status === 'excluded'
      ? 'excluded'
      : 'pending';
    const rotation = database.prepare(`
      SELECT angle, rotated_path FROM maintenance_card_photo_rotations
      WHERE card_id = ? AND phase = ? AND filename = ?
    `).get(sourceCardId, fromPhase, filename);
    const destinationRotatedPath = rotation?.rotated_path
      ? `${destinationDirectory}/${basename(rotation.rotated_path)}`
      : null;
    const sourceAbsolutePath = await resolveStorageFile(sourceStoredPath);
    const sourceRotatedAbsolutePath = rotation?.rotated_path
      ? await resolveStorageFile(rotation.rotated_path)
      : null;
    const destinationAbsoluteDirectory = await ensureStorageDirectory(...destinationDirectory.split('/'));
    const destinationAbsolutePath = join(destinationAbsoluteDirectory, basename(destinationStoredPath));
    const destinationRotatedAbsolutePath = destinationRotatedPath
      ? join(destinationAbsoluteDirectory, basename(destinationRotatedPath))
      : null;
    for (const path of [destinationAbsolutePath, destinationRotatedAbsolutePath].filter(Boolean)) {
      try {
        await lstat(path);
        throw new HttpError(409, 'A photo with the same filename already exists in the target maintenance card.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    await rename(sourceAbsolutePath, destinationAbsolutePath);
    try {
      if (sourceRotatedAbsolutePath && destinationRotatedAbsolutePath) {
        await rename(sourceRotatedAbsolutePath, destinationRotatedAbsolutePath);
      }
      const update = database.transaction(() => {
        const sourceUpdate = database.prepare(`
          UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND order_id = ? AND deleted_at IS NULL
        `).run(JSON.stringify(sourceBefore), JSON.stringify(sourceAfter), sourceNextStatus, sourceCardId, sourceOrderId);
        if (sourceUpdate.changes !== 1) throw new HttpError(404, 'Source inspection card was not found.');
        const targetUpdate = database.prepare(`
          UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND order_id = ? AND deleted_at IS NULL
        `).run(JSON.stringify(targetBefore), JSON.stringify(targetAfter), targetNextStatus, targetCardId, targetOrderId);
        if (targetUpdate.changes !== 1) throw new HttpError(404, 'Target inspection card was not found.');
        queueCardPhotoReview(sourceCardId, actorId, database);
        queueCardPhotoReview(targetCardId, actorId, database);
        if (rotation) {
          database.prepare(`
            UPDATE maintenance_card_photo_rotations
            SET card_id = ?, phase = ?, rotated_path = ?, updated_at = CURRENT_TIMESTAMP
            WHERE card_id = ? AND phase = ? AND filename = ?
          `).run(targetCardId, toPhase, destinationRotatedPath, sourceCardId, fromPhase, filename);
        }
        recordAudit({
          database,
          actorId,
          action: 'photo_move',
          entityType: 'maintenance_card',
          entityId: sourceCardId,
          oldValues: {
            order_id: sourceOrderId, card_id: sourceCardId, phase: fromPhase,
            photo: sourceStoredPath, rotation: rotation?.angle ?? 0, status: sourceCard.status,
          },
          newValues: {
            order_id: targetOrderId, card_id: targetCardId, phase: toPhase,
            photo: destinationStoredPath, rotation: rotation?.angle ?? 0,
            source_status: sourceNextStatus, target_status: targetNextStatus,
          },
        });
        recordAudit({
          database,
          actorId,
          action: 'photo_receive',
          entityType: 'maintenance_card',
          entityId: targetCardId,
          newValues: { order_id: targetOrderId, source_order_id: sourceOrderId, source_card_id: sourceCardId, phase: toPhase, photo: destinationStoredPath },
        });
      });
      update.immediate();
    } catch (error) {
      if (sourceRotatedAbsolutePath && destinationRotatedAbsolutePath) {
        await rename(destinationRotatedAbsolutePath, sourceRotatedAbsolutePath).catch(() => undefined);
      }
      await rename(destinationAbsolutePath, sourceAbsolutePath);
      throw error;
    }
    return {
      ok: true,
      orderId: targetOrderId,
      cardId: targetCardId,
      phase: toPhase,
      status: targetNextStatus,
      sourceStatus: sourceNextStatus,
      path: destinationStoredPath,
    };
  });
}

function findMaintenancePhotoMetadata(orderId, cardId, phase, filename, database) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  const name = requireText(filename, 'filename', { maxLength: 200 });
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');
  const metadata = database.prepare(`
    SELECT order_record.order_code, client.storage_code AS client_code, machine.code AS machine_code,
      card.before_photos_json, card.after_photos_json
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL AND card.deleted_at IS NULL
  `).get(id, targetCardId);
  if (!metadata) throw new HttpError(404, 'Inspection card was not found on this order.');
  const photos = parsePhotoJson(phase === 'before' ? metadata.before_photos_json : metadata.after_photos_json);
  const prefix = `${storageDirectory(
    'clients', metadata.client_code, 'maintenance', metadata.order_code, metadata.machine_code, phase,
  )}/`;
  const storedPath = photos.includes(`${prefix}${name}`)
    ? `${prefix}${name}`
    : photos.find((photoPath) => typeof photoPath === 'string' && photoPath.split('/').at(-1) === name);
  const repPhotoPath = database.prepare(`
    SELECT photo.stored_path
    FROM rep_visit_photos photo
    JOIN rep_visits visit ON visit.id = photo.visit_id AND visit.status = 'completed'
    WHERE visit.order_id = ? AND visit.card_id = ? AND photo.phase = ?
    ORDER BY photo.id
  `).all(id, targetCardId, phase).find((photo) => photo.stored_path.split('/').at(-1) === name)?.stored_path;
  const attachedStoredPath = storedPath ?? repPhotoPath;
  if (!PHOTO_EXTENSIONS.has(extname(name).toLowerCase()) || !attachedStoredPath) {
    throw new HttpError(404, 'Photo is not attached to this inspection card.');
  }
  const rotationRow = database.prepare(`
    SELECT angle, rotated_path FROM maintenance_card_photo_rotations
    WHERE card_id = ? AND phase = ? AND filename = ?
  `).get(targetCardId, phase, name);
  const rotation = rotationRow?.angle ?? 0;
  const rotatedPath = rotationRow?.rotated_path ?? null;
  return {
    id,
    cardId: targetCardId,
    phase,
    filename: name,
    sourceStoredPath: attachedStoredPath,
    storedPath: rotatedPath || attachedStoredPath,
    rotatedPath,
    savedRotation: rotationRow?.angle ?? rotation,
    rotation: rotatedPath ? 0 : rotationRow?.angle ?? rotation,
  };
}

export async function getMaintenancePhotoDetails(orderId, cardId, phase, filename, database = db) {
  const photo = findMaintenancePhotoMetadata(orderId, cardId, phase, filename, database);
  return { ...photo, absolutePath: await resolveStorageFile(photo.storedPath) };
}

export async function getMaintenancePhoto(orderId, cardId, phase, filename, database = db) {
  return (await getMaintenancePhotoDetails(orderId, cardId, phase, filename, database)).absolutePath;
}

export function getMaintenancePhotoTagTargets(orderId, database = db) {
  const id = positiveId(orderId, 'orderId');
  const source = database.prepare(`
    SELECT id, client_id FROM maintenance_orders WHERE id = ? AND deleted_at IS NULL
  `).get(id);
  if (!source) throw new HttpError(404, 'Maintenance order was not found.');
  const rows = database.prepare(`
    SELECT order_record.id AS order_id, order_record.order_code, order_record.status AS order_status,
      card.id AS card_id, machine.code AS machine_code, machine.name_ar AS machine_name_ar,
      machine.area AS machine_area, card.before_photos_json, card.after_photos_json
    FROM maintenance_orders order_record
    JOIN maintenance_cards card ON card.order_id = order_record.id AND card.deleted_at IS NULL
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.client_id = ? AND order_record.deleted_at IS NULL
      AND order_record.status <> 'archived'
    ORDER BY CASE WHEN order_record.id = ? THEN 0 ELSE 1 END,
      order_record.updated_at DESC, order_record.id DESC, card.id
  `).all(source.client_id, id);
  const orders = new Map();
  for (const row of rows) {
    const orderIdValue = Number(row.order_id);
    let order = orders.get(orderIdValue);
    if (!order) {
      order = { id: orderIdValue, orderCode: row.order_code, status: row.order_status, cards: [] };
      orders.set(orderIdValue, order);
    }
    order.cards.push({
      id: Number(row.card_id),
      machineCode: row.machine_code,
      machineNameAr: row.machine_name_ar,
      area: row.machine_area,
      beforePhotoCount: parsePhotoJson(row.before_photos_json).length,
      afterPhotoCount: parsePhotoJson(row.after_photos_json).length,
    });
  }
  return [...orders.values()];
}

export async function rotateMaintenanceCardPhoto(orderId, cardId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['phase', 'filename', 'angle']);
  const phase = requireText(body.phase, 'phase');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'phase must be before or after.');
  const filename = requireText(body.filename, 'filename', { maxLength: 200 });
  if (filename.includes('/') || filename.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');
  const delta = Number(body.angle);
  if (![90, 180, 270, -90].includes(delta)) {
    throw new HttpError(400, 'angle must be 90, 180, 270, or -90.');
  }

  return withMaintenanceOrderStorageLock(async () => {
    assertNoPendingMaintenanceFileRecovery(database);
    const actor = actorId === null ? null : database.prepare(`
      SELECT role FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL
    `).get(actorId);
    if (!['admin', 'operations'].includes(actor?.role)) {
      throw new HttpError(403, 'Administrator or Operations access is required to rotate maintenance photos.');
    }

    const order = database.prepare(`
      SELECT status FROM maintenance_orders
      WHERE id = ? AND deleted_at IS NULL
    `).get(id);
    if (!order) throw new HttpError(404, 'Maintenance order was not found.');
    if (order.status === 'archived' && actor.role !== 'admin') {
      throw new HttpError(403, 'Administrator access is required to rotate archived maintenance photos.');
    }

    const photo = findMaintenancePhotoMetadata(id, targetCardId, phase, filename, database);
    const absolutePath = await resolveStorageFile(photo.storedPath);
    const sourceAbsolutePath = await resolveStorageFile(photo.sourceStoredPath);
    try {
      const metadata = await sharp(absolutePath, { failOn: 'none' }).metadata();
      if (!metadata.format) throw new Error('Image format could not be identified.');
    } catch {
      throw new HttpError(415, 'This photo could not be rotated as a supported image.');
    }

    const previousRotation = photo.savedRotation;
    const nextRotation = ((previousRotation + delta) % 360 + 360) % 360;
    const sourceParts = photo.sourceStoredPath.split('/');
    const sourceName = sourceParts.at(-1);
    const sourceExtension = extname(sourceName);
    const sourceStem = sourceName.slice(0, sourceName.length - sourceExtension.length);
    const derivativeName = `${sourceStem}.madar-rotated-${nextRotation}-${randomUUID()}.jpg`;
    const derivativePath = [...sourceParts.slice(0, -1), derivativeName].join('/');
    const rotatedBuffer = await applyPhotoRotation(await readFile(sourceAbsolutePath), nextRotation);
    const derivative = { ...await writeStorageFile(derivativePath, rotatedBuffer), storedPath: derivativePath };
    try {
      const save = database.transaction(() => {
        database.prepare(`
          INSERT INTO maintenance_card_photo_rotations
            (card_id, phase, filename, angle, updated_by, updated_at, rotated_path)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
          ON CONFLICT(card_id, phase, filename) DO UPDATE SET
            angle = excluded.angle,
            updated_by = excluded.updated_by,
            updated_at = CURRENT_TIMESTAMP,
            rotated_path = excluded.rotated_path
        `).run(targetCardId, phase, filename, nextRotation, actorId, derivative.storedPath);
        recordAudit({
          database,
          actorId,
          action: 'rotate_maintenance_photo',
          entityType: 'maintenance_card',
          entityId: targetCardId,
          oldValues: { phase, filename, rotation: previousRotation },
          newValues: {
            phase,
            filename,
            rotation: nextRotation,
            rotation_delta: delta,
            rotated_path: derivative.storedPath,
          },
        });
      });
      save.immediate();
    } catch (error) {
      if (derivative) await removeStorageFile(derivative.absolutePath).catch(() => undefined);
      throw error;
    }

    try {
      await invalidateMaintenanceThumbnail(absolutePath, photo.rotation);
      const nextAbsolutePath = derivative.absolutePath;
      await getMaintenanceThumbnail(nextAbsolutePath, 0);
    } catch (error) {
      // The stored derivative has its own cache key; a stale cache cannot replace it.
      console.warn(`Maintenance thumbnail cleanup for ${filename} is pending: ${error.message}`);
    }
    if (photo.rotatedPath && photo.rotatedPath !== derivative.storedPath) {
      await removeStorageFile(absolutePath).catch((error) => {
        console.warn(`Previous rotated photo cleanup for ${filename} is pending: ${error.message}`);
      });
    }

    return {
      success: true,
      filename,
      rotatedAt: Date.now(),
      angle: nextRotation,
      rotatedPath: derivative.storedPath,
    };
  });
}

export function transitionMaintenanceToReview(orderId, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const transition = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'in_progress') throw new HttpError(409, 'Only in-progress maintenance orders can move to review.');
    database.prepare(`
      UPDATE maintenance_orders SET status = 'review', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
    recordAudit({
      database,
      actorId,
      action: 'status_transition',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues: { status: order.status },
      newValues: { status: 'review' },
    });
  });
  transition();
  return getMaintenanceOrder(id, database);
}

export function archiveMaintenanceOrder(orderId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['warrantyPeriodMonths', 'actualExpensesCents', 'archiveMonth']);
  const requestedMonth = archiveMonth(body.archiveMonth);
  if (![3, 6].includes(body.warrantyPeriodMonths)) {
    throw new HttpError(400, 'warrantyPeriodMonths must be 3 or 6.');
  }
  const actualExpensesCents = nonNegativeInteger(body.actualExpensesCents, 'actualExpensesCents');

  const refundCents = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'review') throw new HttpError(409, 'Only maintenance orders in review can be archived.');
    const pendingPhotos = database.prepare(`SELECT 1 FROM maintenance_cards card
      WHERE card.order_id = ? AND card.deleted_at IS NULL AND card.status != 'excluded'
        AND (EXISTS (SELECT 1 FROM maintenance_card_photo_reviews review WHERE review.card_id = card.id AND review.status = 'pending')
          OR EXISTS (SELECT 1 FROM rep_visits visit LEFT JOIN rep_visit_reviews review ON review.visit_id = visit.id
            WHERE visit.card_id = card.id AND (visit.status = 'receiving' OR (visit.status = 'completed' AND review.status = 'pending'))))
      LIMIT 1`).get(id);
    if (pendingPhotos) throw new HttpError(409, 'يجب إنهاء رفع الصور واعتماد الصور المعلقة من رادار المشرف قبل أرشفة الأمر.');
    const selectedMonth = body.archiveMonth === undefined ? order.archive_month : requestedMonth;
    const refundCents = order.petty_cash_disbursed_cents - actualExpensesCents;
    if (refundCents < 0) {
      throw new HttpError(400, 'actualExpensesCents cannot exceed the petty cash disbursed to this order.');
    }
    const refundAdjustmentCents = refundCents - (order.petty_cash_refund_cents ?? 0);
    if (refundAdjustmentCents < 0) assertCashAvailable(-refundAdjustmentCents, database);
    const oldValues = {
      status: order.status,
      warranty_period_months: order.warranty_period_months,
      archive_month: order.archive_month,
      actual_expenses_cents: order.actual_expenses_cents,
      petty_cash_refund_cents: order.petty_cash_refund_cents,
    };
    database.prepare(`
      UPDATE maintenance_orders
      SET status = 'archived', warranty_period_months = ?, actual_expenses_cents = ?,
        petty_cash_refund_cents = ?, archived_at = CURRENT_TIMESTAMP, archived_by = ?, archive_month = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.warrantyPeriodMonths, actualExpensesCents, refundCents, actorId, selectedMonth, id);
    let treasuryEntryId = null;
    if (refundAdjustmentCents !== 0) {
      const isAdditionalRefund = refundAdjustmentCents > 0;
      treasuryEntryId = insertTreasuryEntry({
        database,
        kind: isAdditionalRefund ? 'income' : 'expense',
        category: isAdditionalRefund ? 'رد عهدة صيانة' : 'تسوية رد عهدة صيانة بعد إعادة الفتح',
        amountCents: Math.abs(refundAdjustmentCents),
        maintenanceOrderId: id,
        reference: order.order_code,
        notes: isAdditionalRefund
          ? 'Maintenance petty cash refund or post-reopen adjustment'
          : 'Reversal of excess maintenance petty cash refund after reopening',
        actorId,
      });
    }
    recordAudit({
      database,
      actorId,
      action: 'archive',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues,
      newValues: {
        status: 'archived',
        warranty_period_months: body.warrantyPeriodMonths,
        archive_month: selectedMonth,
        actual_expenses_cents: actualExpensesCents,
        petty_cash_refund_cents: refundCents,
        treasury_entry_id: treasuryEntryId,
        refund_adjustment_cents: refundAdjustmentCents,
      },
    });
    return refundCents;
  }).immediate();

  return { order: getMaintenanceOrder(id, database), refundCents };
}

export function unarchiveMaintenanceOrder(orderId, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const unarchive = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'archived') {
      throw new HttpError(409, 'Only archived maintenance orders can be unarchived.');
    }
    database.prepare(`
      UPDATE maintenance_orders
      SET status = 'in_progress', archived_at = NULL, archived_by = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(id);
    recordAudit({
      database,
      actorId,
      action: 'unarchive_order',
      entityType: 'maintenance_order',
      entityId: id,
      oldValues: {
        status: 'archived',
        archived_at: order.archived_at,
        archived_by: order.archived_by,
        petty_cash_refund_cents: order.petty_cash_refund_cents,
      },
      newValues: {
        status: 'in_progress',
        archived_at: null,
        archived_by: null,
        petty_cash_refund_cents: order.petty_cash_refund_cents,
      },
    });
  });
  unarchive.immediate();
  return getMaintenanceOrder(id, database);
}
