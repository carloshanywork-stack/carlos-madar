import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { lstat, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { db } from '../../database/connection.js';
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
import { withMaintenanceOrderStorageLock } from './deletion-lock.js';

const MAINTENANCE_STATUSES = ['in_progress', 'review', 'archived'];
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const MAX_MAINTENANCE_ORDER_AREAS = 50;
const AREA_DELIMITER = /[،,]/;
const MAX_TRIP_FOLDER_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_TRIP_PHOTO_BYTES = 200 * 1024 * 1024;
const MAX_TRIP_FOLDER_FILES = 50000;
const MAX_CARD_PHOTOS = 10000;
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
      order_record.petty_cash_refund_cents, order_record.archived_at,
      order_record.archived_by, order_record.created_by, order_record.created_at,
      order_record.updated_at, order_record.deleted_at,
      client.code AS client_code, client.name AS client_name
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

export function listMachines({ area, search, page = 1, limit = 100 } = {}, database = db) {
  const pageNumber = Number(page ?? 1);
  const pageSize = Number(limit ?? 100);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new HttpError(400, 'page must be a positive integer.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new HttpError(400, 'limit must be between 1 and 500.');
  const where = ['machine.active = 1', 'machine.deleted_at IS NULL'];
  const parameters = [];
  if (area !== undefined && area !== '') {
    const selectedAreas = normalizeMaintenanceAreaNames(area, 'area');
    if (!selectedAreas.length) throw new HttpError(400, 'area must not be blank.');
    where.push(`machine.area COLLATE NOCASE IN (${selectedAreas.map(() => '?').join(',')})`);
    parameters.push(...selectedAreas);
  }
  const query = search ?? '';
  if (query !== '') {
    const term = `%${requireText(query, 'search', { maxLength: 160 })}%`;
    where.push('(machine.code LIKE ? COLLATE NOCASE OR machine.name_ar LIKE ? OR machine.name_en LIKE ? COLLATE NOCASE OR machine.area LIKE ? COLLATE NOCASE)');
    parameters.push(term, term, term, term);
  }
  const condition = where.join(' AND ');
  const total = database.prepare(`SELECT COUNT(*) AS total FROM machines machine WHERE ${condition}`).get(...parameters).total;
  const machines = database.prepare(`
    SELECT machine.id, machine.code, machine.name_ar, machine.name_en, machine.area,
      machine.active, machine.created_at,
       (SELECT COUNT(*) FROM maintenance_cards card WHERE card.machine_id = machine.id AND card.deleted_at IS NULL) AS order_count
    FROM machines machine WHERE ${condition}
    ORDER BY machine.area COLLATE NOCASE, machine.name_ar COLLATE NOCASE, machine.id
    LIMIT ? OFFSET ?
  `).all(...parameters, pageSize, (pageNumber - 1) * pageSize);
  return { machines, total, areas: listAreas(database), page: pageNumber, limit: pageSize };
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

export function clearMachineMaintenanceNotes(machineId, actorId = null, database = db) {
  const id = positiveId(machineId, 'machineId');
  const machine = database.prepare('SELECT id FROM machines WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!machine) throw new HttpError(404, 'Machine was not found.');

  return database.transaction(() => {
    const cards = database.prepare('SELECT id, notes FROM maintenance_cards WHERE machine_id = ? AND deleted_at IS NULL').all(id);
    database.prepare("UPDATE maintenance_cards SET notes = '' WHERE machine_id = ? AND deleted_at IS NULL").run(id);

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

    return {
      id,
      clearedCount: cards.filter((card) => card.notes !== null && card.notes !== '').length,
    };
  }).immediate();
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

export function listMaintenanceReasons({ includeInactive = false } = {}, database = db) {
  const condition = includeInactive ? '' : 'WHERE active = 1';
  return database.prepare(`
    SELECT id, name, active, created_at FROM maintenance_reasons ${condition}
    ORDER BY active DESC, name COLLATE NOCASE, id
  `).all();
}

export function createMaintenanceReason(input, actorId = null, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['name']);
  const name = requireText(body.name, 'name', { maxLength: 200 });
  try {
    const result = database.prepare('INSERT INTO maintenance_reasons (name) VALUES (?)').run(name);
    const id = Number(result.lastInsertRowid);
    recordAudit({ database, actorId, action: 'create', entityType: 'maintenance_reason', entityId: id, newValues: { name } });
    return database.prepare('SELECT id, name, active, created_at FROM maintenance_reasons WHERE id = ?').get(id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That maintenance reason already exists.');
    throw error;
  }
}

export function updateMaintenanceReason(reasonId, input, actorId = null, database = db) {
  const id = positiveId(reasonId, 'reasonId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['name', 'active']);
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one maintenance reason field must be provided.');
  const current = database.prepare('SELECT id, name, active, created_at FROM maintenance_reasons WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Maintenance reason was not found.');

  const name = body.name === undefined ? current.name : requireText(body.name, 'name', { maxLength: 200 });
  let active = current.active;
  if (body.active !== undefined) {
    if (![true, false, 0, 1].includes(body.active)) throw new HttpError(400, 'active must be a boolean or 0/1.');
    active = Number(body.active);
  }

  try {
    database.transaction(() => {
      database.prepare('UPDATE maintenance_reasons SET name = ?, active = ? WHERE id = ?').run(name, active, id);
      recordAudit({
        database,
        actorId,
        action: 'update',
        entityType: 'maintenance_reason',
        entityId: id,
        oldValues: { name: current.name, active: current.active },
        newValues: { name, active },
      });
    }).immediate();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That maintenance reason already exists.');
    throw error;
  }
  return database.prepare('SELECT id, name, active, created_at FROM maintenance_reasons WHERE id = ?').get(id);
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

export function listMaintenanceOrders(status, database = db) {
  if (!MAINTENANCE_STATUSES.includes(status)) {
    throw new HttpError(400, `status is required and must be one of: ${MAINTENANCE_STATUSES.join(', ')}.`);
  }
  const orders = database.prepare(`
    SELECT order_record.id, order_record.order_code, order_record.client_id,
      client.code AS client_code, client.name AS client_name,
      order_record.status, order_record.notes, order_record.area, order_record.warranty_period_months,
      order_record.petty_cash_disbursed_cents, order_record.actual_expenses_cents,
      order_record.petty_cash_refund_cents, order_record.archived_at,
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
      (SELECT COUNT(*) FROM maintenance_order_technicians assigned WHERE assigned.order_id = order_record.id) AS technician_count
    FROM maintenance_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.status = ? AND order_record.deleted_at IS NULL
    ORDER BY order_record.created_at DESC, order_record.id DESC
  `).all(status);

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
const MAINTENANCE_UNMATCHED_FOLDER_DELETION_STAGE_ROOT = ['.madar-recovery', 'maintenance-unmatched-folder-deletions'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasPendingMaintenanceFileRecovery(database) {
  return Boolean(database.prepare(`
    SELECT 1 FROM maintenance_order_deletion_operations WHERE state = 'prepared'
    UNION ALL
    SELECT 1 FROM maintenance_card_deletion_operations WHERE state = 'prepared'
    UNION ALL
    SELECT 1 FROM maintenance_machine_decommission_operations WHERE state = 'prepared'
    UNION ALL
    SELECT 1 FROM maintenance_unmatched_folder_deletion_operations
    LIMIT 1
  `).get());
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
    client_code: order.client_code,
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
    storageDirectory('clients', order.client_code, 'maintenance', order.order_code, card.machine_code),
    storageDirectory('Clients', order.client_code, 'Archived_Orders', order.order_code, card.machine_code),
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

function isMaintenanceCardAreaPath(storedPath, order, card, database) {
  const segments = storedPath.split('/');
  if (segments.length < 4 || segments[0] !== 'Areas') return false;
  const area = parseMaintenanceOrderAreas(order.area)
    .find((candidate) => safeStorageFolderName(candidate) === segments[1]);
  return Boolean(area && findMachineForAreaFolder(segments[2], area, card.machine_id, database));
}

function isMaintenanceMachineAreaDirectory(path, order, machine, database) {
  const segments = path.split('/');
  if (segments.length !== 3 || segments[0] !== 'Areas') return false;
  const area = parseMaintenanceOrderAreas(order.area)
    .find((candidate) => safeStorageFolderName(candidate) === segments[1]);
  return Boolean(area && findMachineForAreaFolder(segments[2], area, machine.id, database));
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
    const absoluteAreaDirectory = await resolveStorageDirectoryIfPresent(relativeAreaDirectory);
    if (!absoluteAreaDirectory) continue;
    const entries = await readdir(absoluteAreaDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (!findMachineForAreaFolder(entry.name, area, machineId, database)) continue;
      targets.push({ path: storageDirectory(relativeAreaDirectory, entry.name), kind: 'directory' });
    }
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
      order_record.deleted_at AS order_deleted_at, client.code AS client_code
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
      order_record.client_id, client.code AS client_code
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
  const originalPath = storageDirectory('Clients', order.client_code, 'Archived_Orders', order.order_code);
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
      client.code AS client_code
    FROM maintenance_orders AS order_record
    JOIN clients AS client ON client.id = order_record.client_id
    WHERE order_record.id = ? AND order_record.deleted_at IS NULL
  `).get(orderId);
}

function softDeleteMaintenanceOrder(order, actorId, operationId, database) {
  return database.transaction(() => {
    const current = readActiveMaintenanceOrderForDeletion(order.id, database);
    if (!current) throw new HttpError(404, 'Maintenance order was not found.');
    if (current.status !== 'archived') throw new HttpError(409, 'Only archived maintenance orders can be removed from the archive.');
    if (current.order_code !== order.order_code || current.client_code !== order.client_code) {
      throw new HttpError(409, 'Maintenance order changed while its archived files were being staged.');
    }

    const result = database.prepare(`
      UPDATE maintenance_orders
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(order.id);
    if (result.changes !== 1) throw new HttpError(409, 'Maintenance order was already removed from the archive.');
    if (operationId) {
      const journalUpdate = database.prepare(`
        UPDATE maintenance_order_deletion_operations
        SET state = 'committed'
        WHERE operation_id = ? AND order_id = ? AND state = 'prepared'
      `).run(operationId, order.id);
      if (journalUpdate.changes !== 1) throw new HttpError(500, 'Maintenance photo recovery journal was not found.');
    }
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
        archived_photo_folder_staged: Boolean(operationId),
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
    if (order.status !== 'archived') throw new HttpError(409, 'Only archived maintenance orders can be removed from the archive.');
    const operationId = randomUUID();
    const paths = maintenanceOrderDeletionPaths(order, operationId);
    const sourceDirectory = await resolveStorageDirectoryIfPresent(paths.originalPath);
    if (!sourceDirectory) {
      softDeleteMaintenanceOrder(order, actorId, null, database);
      return { ok: true, deletedOrderCode: order.order_code };
    }

    database.transaction(() => {
      const current = readActiveMaintenanceOrderForDeletion(id, database);
      if (!current) throw new HttpError(404, 'Maintenance order was not found.');
      if (current.status !== 'archived') throw new HttpError(409, 'Only archived maintenance orders can be removed from the archive.');
      database.prepare(`
        INSERT INTO maintenance_order_deletion_operations
          (operation_id, order_id, client_code, order_code, original_path, staged_path, state)
        VALUES (?, ?, ?, ?, ?, ?, 'prepared')
      `).run(operationId, id, order.client_code, order.order_code, paths.originalPath, paths.stagedPath);
    }).immediate();

    let stageDirectory = null;
    let folderStaged = false;
    try {
      stageDirectory = await ensureStorageDirectory(...MAINTENANCE_ORDER_DELETION_STAGE_ROOT, operationId);
      const stagedPath = join(stageDirectory, 'payload');
      await rename(sourceDirectory, stagedPath);
      folderStaged = true;

      softDeleteMaintenanceOrder(order, actorId, operationId, database);

      let cleanupPending = false;
      try {
        await rm(stageDirectory, { recursive: true, force: true });
        removeMaintenanceOrderDeletionOperation(operationId, database);
      } catch (error) {
        cleanupPending = true;
        console.error(`Archived photo cleanup for ${order.order_code} remains staged for recovery: ${error.message}`);
      }
      return {
        ok: true,
        deletedOrderCode: order.order_code,
        ...(cleanupPending ? { photoCleanupPending: true } : {}),
      };
    } catch (error) {
      if (folderStaged) {
        try {
          const originalSegments = paths.originalPath.split('/');
          await ensureStorageDirectory(...originalSegments.slice(0, -1));
          await rename(join(stageDirectory, 'payload'), sourceDirectory);
          folderStaged = false;
        } catch (restoreError) {
          console.error(`Archived photo restoration for ${order.order_code} is pending: ${restoreError.message}`);
          throw new HttpError(500, 'The order was not removed, but photo-folder recovery is pending. Restart the server before continuing.');
        }
      }

      let stageCleaned = !stageDirectory;
      if (stageDirectory) {
        try {
          await rm(stageDirectory, { recursive: true, force: true });
          stageCleaned = true;
        } catch (cleanupError) {
          console.error(`Archived photo staging cleanup for ${order.order_code} is pending: ${cleanupError.message}`);
        }
      }
      if (stageCleaned) {
        try { removeMaintenanceOrderDeletionOperation(operationId, database); }
        catch (cleanupError) {
          console.error(`Archived photo recovery journal cleanup for ${order.order_code} is pending: ${cleanupError.message}`);
        }
      }
      throw error;
    }
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
          client.code AS client_code
        FROM maintenance_orders AS order_record
        JOIN clients AS client ON client.id = order_record.client_id
        WHERE order_record.id = ?
      `).get(operation.order_id);
      if (!current || current.order_code !== operation.order_code || current.client_code !== operation.client_code) {
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
        if (current.deleted_at === null || sourceDirectory) {
          throw new HttpError(500, 'A committed maintenance photo deletion conflicts with the active archive; startup was stopped for safety.');
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
          || currentOrder.client_code !== order.client_code) {
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
  allowOnlyKeys(body, ['clientId', 'area', 'areas', 'employeeIds', 'notes', 'pettyCashDisbursedCents', 'autoPopulateAreaMachines']);
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
  const notes = optionalText(body.notes, 'notes', { maxLength: 10000 });
  const pettyCashDisbursedCents = body.pettyCashDisbursedCents === undefined
    ? 0
    : nonNegativeInteger(body.pettyCashDisbursedCents, 'pettyCashDisbursedCents');

  const orderId = database.transaction(() => {
    assertActiveClient(clientId, database);
    assertActiveEmployees(employeeIds, 'Maintenance', database);
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
  const technicians = database.prepare(`
    SELECT employee.id, employee.name, employee.job_title, employee.department
    FROM maintenance_order_technicians assigned
    JOIN employees employee ON employee.id = assigned.employee_id
    WHERE assigned.order_id = ?
    ORDER BY employee.name COLLATE NOCASE, employee.id
  `).all(order.id);
  const allReasons = database.prepare('SELECT id, name FROM maintenance_reasons').all();
  const reasonMap = new Map(allReasons.map((r) => [r.id, r.name]));

  const cards = database.prepare(`
    SELECT card.*, reason.name AS single_reason_name, machine.code AS machine_code, machine.name_ar AS machine_name_ar,
      machine.name_en AS machine_name_en, machine.area AS machine_area
    FROM maintenance_cards card
    JOIN machines machine ON machine.id = card.machine_id
    LEFT JOIN maintenance_reasons reason ON reason.id = card.reason_id
    WHERE card.order_id = ? AND card.deleted_at IS NULL
    ORDER BY card.id
  `).all(order.id).map((card) => {
    const beforePhotos = parsePhotoJson(card.before_photos_json);
    const afterPhotos = parsePhotoJson(card.after_photos_json);
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
      before_photos: beforePhotos,
      after_photos: afterPhotos,
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
  return { ...order, client, technicians, cards, unmatched_folders: unmatchedFolders, unmatched_machine_candidates: unmatchedMachineCandidates };
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

export async function processMaintenanceTripFolder(orderId, { folderPath, file } = {}, actorId = null, database = db) {
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
            'Clients', order.client_code, 'Archived_Orders', order.order_code, machine.code, phase,
            `${randomUUID()}${extname(photo.name).toLowerCase()}`,
          ) });
        }
      }
    }
    for (const plan of unmatchedPlans) {
      for (const [phase, photos] of [['Before', plan.before], ['After', plan.after]]) {
        for (const photo of photos) {
          filePlans.push({ photo, storedPath: storageDirectory(
            'Clients', order.client_code, 'Archived_Orders', order.order_code, 'Unmatched', safeTripFolderSegment(plan.folderName), phase,
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
          const status = existing?.status === 'excluded' ? 'excluded' : before.length && after.length ? 'completed' : (existing?.status ?? 'pending');
          if (existing) updateCard.run(JSON.stringify(before), JSON.stringify(after), status, existing.id);
          else {
            const cardId = Number(insertCard.run(id, machineId, status).lastInsertRowid);
            updateCard.run(JSON.stringify(before), JSON.stringify(after), status, cardId);
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

export async function bindUnmatchedMaintenanceFolder(orderId, folderId, input, actorId = null, database = db) {
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
        'Clients', order.client_code, 'Archived_Orders', order.order_code, machine.code, phase,
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
      const status = existing?.status === 'excluded' ? 'excluded' : before.length && after.length ? 'completed' : (existing?.status ?? 'pending');
      let cardId = existing?.id;
      if (existing) {
        database.prepare(`UPDATE maintenance_cards SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(JSON.stringify(before), JSON.stringify(after), status, cardId);
      } else {
        cardId = Number(database.prepare(`INSERT INTO maintenance_cards (order_id, machine_id, before_photos_json, after_photos_json, status) VALUES (?, ?, ?, ?, ?)`)
          .run(id, machineId, JSON.stringify(before), JSON.stringify(after), status).lastInsertRowid);
      }
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
      client_code: order.client_code,
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
          || currentOrder.client_code !== order.client_code) {
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
          order.client_code,
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
        if (currentOrder.order_code !== order.order_code || currentOrder.client_code !== order.client_code) {
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

export async function importMaintenanceServerFolder(orderId, input, actorId = null, database = db) {
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
    const storedPath = `${storageDirectory('clients', order.client_code, 'maintenance', order.order_code, machine.code, phase)}/${randomUUID()}${extname(sourcePath).toLowerCase()}`;
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

export async function updateMaintenanceCard(orderId, cardId, input, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['beforePhotos', 'afterPhotos', 'notes', 'reasonId', 'reasonIds', 'machineCode']);
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one card field must be provided.');

  const order = findMaintenanceOrder(id, database);
  if (order.status === 'archived') throw new HttpError(409, 'Archived maintenance orders are read-only.');
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
    const segments = String(photoPath).replace(/\\/g, '/').split('/').map((part) => part.toLocaleLowerCase('en'));
    const expectedPrefixes = [
      ['clients', order.client_code, 'maintenance', order.order_code, card.machine_code],
      ['clients', order.client_code, 'archived_orders', order.order_code, card.machine_code],
    ].map((prefix) => prefix.map((part) => String(part).toLocaleLowerCase('en')));
    return expectedPrefixes.some((prefix) => prefix.every((part, index) => segments[index] === part));
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

export async function uploadMaintenancePhoto(orderId, cardId, phase, file, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  if (!file?.buffer?.length) throw new HttpError(400, 'A maintenance photo is required.');
  const extension = extname(file.originalname).toLowerCase();
  if (!PHOTO_EXTENSIONS.has(extension)) throw new HttpError(400, 'Unsupported maintenance photo extension.');

  const metadata = database.prepare(`
    SELECT order_record.order_code, client.code AS client_code, machine.code AS machine_code,
      card.id AS card_id, card.order_id, card.before_photos_json, card.after_photos_json
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN clients client ON client.id = order_record.client_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL
      AND order_record.status != 'archived' AND card.deleted_at IS NULL
  `).get(id, targetCardId);
  if (!metadata) throw new HttpError(404, 'Active inspection card was not found on this order.');

  const storedPath = `${storageDirectory(
    'clients', metadata.client_code, 'maintenance', metadata.order_code, metadata.machine_code, phase,
  )}/${randomUUID()}${extension}`;
  const savedFile = await writeStorageFile(storedPath, file.buffer);
  try {
    const update = database.transaction(() => {
      const oldPaths = parsePhotoJson(phase === 'before' ? metadata.before_photos_json : metadata.after_photos_json);
      const nextPaths = [...oldPaths, storedPath];
      const column = phase === 'before' ? 'before_photos_json' : 'after_photos_json';
      const result = database.prepare(`UPDATE maintenance_cards SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`)
        .run(JSON.stringify(nextPaths), targetCardId);
      if (result.changes !== 1) throw new HttpError(404, 'Active inspection card was not found on this order.');
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

export async function deleteCardPhoto(orderId, cardId, phase, filename, actorId = null, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  const name = requireText(filename, 'filename', { maxLength: 200 });
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');

  return withMaintenanceOrderStorageLock(async () => {
    const removedPhoto = database.transaction(() => {
      const card = database.prepare(`
        SELECT card.id, card.order_id, card.before_photos_json, card.after_photos_json, card.status,
          order_record.status AS order_status
        FROM maintenance_cards card
        JOIN maintenance_orders order_record ON order_record.id = card.order_id
        WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL AND card.deleted_at IS NULL
      `).get(id, targetCardId);

      if (!card) throw new HttpError(404, 'Active inspection card was not found.');

      const beforePaths = parsePhotoJson(card.before_photos_json);
      const afterPaths = parsePhotoJson(card.after_photos_json);
      const targetList = phase === 'before' ? beforePaths : afterPaths;
      const targetIndex = targetList.findIndex((photoPath) => photoPath.split('/').at(-1) === name);
      if (targetIndex === -1) throw new HttpError(404, 'Photo was not found in this card phase.');

      const [removedStoredPath] = targetList.splice(targetIndex, 1);
      const nextStatus = card.status === 'excluded'
        ? 'excluded'
        : beforePaths.length > 0 && afterPaths.length > 0 ? 'completed' : 'pending';
      const update = database.prepare(`
        UPDATE maintenance_cards
        SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND order_id = ? AND deleted_at IS NULL
      `).run(JSON.stringify(beforePaths), JSON.stringify(afterPaths), nextStatus, targetCardId, id);
      if (update.changes !== 1) throw new HttpError(404, 'Active inspection card was not found.');

      recordAudit({
        database,
        actorId,
        action: 'photo_delete',
        entityType: 'maintenance_card',
        entityId: targetCardId,
        oldValues: { phase, photo: removedStoredPath, previous_status: card.status },
        newValues: { status: nextStatus, remaining_before: beforePaths.length, remaining_after: afterPaths.length },
      });
      return { removedStoredPath, status: nextStatus, beforeCount: beforePaths.length, afterCount: afterPaths.length };
    }).immediate();

    let fileCleanupPending = false;
    try {
      const absolutePath = await resolveStorageFile(removedPhoto.removedStoredPath);
      await removeStorageFile(absolutePath);
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
    const card = database.prepare(`
      SELECT card.id, card.order_id, card.before_photos_json, card.after_photos_json, card.status,
        order_record.status AS order_status, order_record.order_code,
        client.code AS client_code, machine.code AS machine_code
      FROM maintenance_cards card
      JOIN maintenance_orders order_record ON order_record.id = card.order_id
      JOIN clients client ON client.id = order_record.client_id
      JOIN machines machine ON machine.id = card.machine_id
      WHERE order_record.id = ? AND card.id = ? AND order_record.deleted_at IS NULL AND card.deleted_at IS NULL
    `).get(id, targetCardId);

    if (!card) throw new HttpError(404, 'Active inspection card was not found.');

    const beforePaths = parsePhotoJson(card.before_photos_json);
    const afterPaths = parsePhotoJson(card.after_photos_json);
    const sourceList = fromPhase === 'before' ? beforePaths : afterPaths;
    const destinationList = toPhase === 'before' ? beforePaths : afterPaths;
    const sourceIndex = sourceList.findIndex((photoPath) => photoPath.split('/').at(-1) === name);
    if (sourceIndex === -1) throw new HttpError(404, 'Photo was not found in source phase.');
    if (fromPhase === toPhase) return { ok: true, cardId: targetCardId, status: card.status };
    if (destinationList.length >= 4) {
      throw new HttpError(400, `لا يمكن نقل الصورة، مرحلة ${toPhase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'} تحتوي على الحد الأقصى (4 صور).`);
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
      : beforePaths.length > 0 && afterPaths.length > 0 ? 'completed' : 'pending';
    const sourceAbsolutePath = await resolveStorageFile(sourceStoredPath);
    const destinationAbsoluteDirectory = await ensureStorageDirectory(...pathSegments.slice(0, -1));
    const destinationAbsolutePath = join(destinationAbsoluteDirectory, pathSegments.at(-1));
    try {
      await lstat(destinationAbsolutePath);
      throw new HttpError(409, 'A photo with the same filename already exists in the destination phase.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await rename(sourceAbsolutePath, destinationAbsolutePath);
    try {
      const update = database.transaction(() => {
        const result = database.prepare(`
          UPDATE maintenance_cards
          SET before_photos_json = ?, after_photos_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND order_id = ? AND deleted_at IS NULL
        `).run(JSON.stringify(beforePaths), JSON.stringify(afterPaths), nextStatus, targetCardId, id);
        if (result.changes !== 1) throw new HttpError(404, 'Active inspection card was not found.');

        recordAudit({
          database,
          actorId,
          action: 'photo_move',
          entityType: 'maintenance_card',
          entityId: targetCardId,
          oldValues: { fromPhase, toPhase, photo: sourceStoredPath, status: card.status },
          newValues: { photo: movedStoredPath, status: nextStatus, before_count: beforePaths.length, after_count: afterPaths.length },
        });
      });
      update.immediate();
    } catch (error) {
      await rename(destinationAbsolutePath, sourceAbsolutePath);
      throw error;
    }
    return { ok: true, cardId: targetCardId, status: nextStatus, path: movedStoredPath };
  });
}

export async function getMaintenancePhoto(orderId, cardId, phase, filename, database = db) {
  const id = positiveId(orderId, 'orderId');
  const targetCardId = positiveId(cardId, 'cardId');
  if (!['before', 'after'].includes(phase)) throw new HttpError(400, 'Photo phase must be before or after.');
  const name = requireText(filename, 'filename', { maxLength: 200 });
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Invalid photo filename.');
  const metadata = database.prepare(`
    SELECT order_record.order_code, client.code AS client_code, machine.code AS machine_code,
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
  if (!PHOTO_EXTENSIONS.has(extname(name).toLowerCase()) || !storedPath) {
    throw new HttpError(404, 'Photo is not attached to this inspection card.');
  }
  return resolveStorageFile(storedPath);
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
  allowOnlyKeys(body, ['warrantyPeriodMonths', 'actualExpensesCents']);
  if (![3, 6].includes(body.warrantyPeriodMonths)) {
    throw new HttpError(400, 'warrantyPeriodMonths must be 3 or 6.');
  }
  const actualExpensesCents = nonNegativeInteger(body.actualExpensesCents, 'actualExpensesCents');

  const refundCents = database.transaction(() => {
    const order = findMaintenanceOrder(id, database);
    if (order.status !== 'review') throw new HttpError(409, 'Only maintenance orders in review can be archived.');
    const refundCents = order.petty_cash_disbursed_cents - actualExpensesCents;
    if (refundCents < 0) {
      throw new HttpError(400, 'actualExpensesCents cannot exceed the petty cash disbursed to this order.');
    }
    const oldValues = {
      status: order.status,
      warranty_period_months: order.warranty_period_months,
      actual_expenses_cents: order.actual_expenses_cents,
      petty_cash_refund_cents: order.petty_cash_refund_cents,
    };
    database.prepare(`
      UPDATE maintenance_orders
      SET status = 'archived', warranty_period_months = ?, actual_expenses_cents = ?,
        petty_cash_refund_cents = ?, archived_at = CURRENT_TIMESTAMP, archived_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.warrantyPeriodMonths, actualExpensesCents, refundCents, actorId, id);
    let treasuryEntryId = null;
    if (refundCents > 0) {
      treasuryEntryId = insertTreasuryEntry({
        database,
        kind: 'income',
        category: 'رد عهدة صيانة',
        amountCents: refundCents,
        maintenanceOrderId: id,
        reference: order.order_code,
        notes: 'Refund from maintenance petty cash custody',
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
        actual_expenses_cents: actualExpensesCents,
        petty_cash_refund_cents: refundCents,
        treasury_entry_id: treasuryEntryId,
      },
    });
    return refundCents;
  }).immediate();

  return { order: getMaintenanceOrder(id, database), refundCents };
}
