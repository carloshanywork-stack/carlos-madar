import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { db } from '../../database/connection.js';
import { HttpError, allowOnlyKeys, positiveId, requireObject } from '../http.js';
import { moveStorageFile, removeStorageFile, resolveStorageFile, storageDirectory, writeStorageFile } from '../storage.js';

const operations = new Set([
  'visit_sync', 'attendance_sync', 'machine_sync', 'tracking_sync', 'camera_capture',
  'photo_processing', 'photo_gallery', 'route_refresh', 'visit_submit', 'app_crash',
]);
const failureCodes = new Set([
  'network', 'server', 'rejected', 'protocol', 'unexpected', 'capture_failed', 'render_failed',
  'gallery_failed', 'integrity_failed', 'retry_exhausted', 'uncaught_exception',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeDiagnostic(input) {
  const body = requireObject(input, 'diagnostic');
  allowOnlyKeys(body, ['reportUuid', 'operation', 'failureCode', 'httpStatus', 'occurredAt', 'appVersion', 'versionCode', 'androidVersion']);
  if (typeof body.reportUuid !== 'string' || !uuidPattern.test(body.reportUuid)) throw new HttpError(400, 'Invalid diagnostic UUID.');
  if (!operations.has(body.operation) || !failureCodes.has(body.failureCode)) throw new HttpError(400, 'Invalid diagnostic operation or failure code.');
  if (body.httpStatus !== undefined && (!Number.isInteger(body.httpStatus) || body.httpStatus < 100 || body.httpStatus > 599)) {
    throw new HttpError(400, 'Invalid diagnostic HTTP status.');
  }
  const occurredAt = typeof body.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(body.occurredAt)
    ? Date.parse(body.occurredAt) : NaN;
  if (!Number.isFinite(occurredAt)) throw new HttpError(400, 'Invalid diagnostic time.');
  if (typeof body.appVersion !== 'string' || !/^\d{1,5}(?:\.\d{1,5}){2}(?:-debug)?$/.test(body.appVersion)
      || !Number.isInteger(body.versionCode) || body.versionCode < 1 || body.versionCode > 2147483647
      || !Number.isInteger(body.androidVersion) || body.androidVersion < 1 || body.androidVersion > 200) {
    throw new HttpError(400, 'Invalid diagnostic version.');
  }
  return {
    reportUuid: body.reportUuid.toLowerCase(),
    operation: body.operation,
    failureCode: body.failureCode,
    ...(body.httpStatus === undefined ? {} : { httpStatus: body.httpStatus }),
    occurredAt: new Date(occurredAt).toISOString(),
    appVersion: body.appVersion,
    versionCode: body.versionCode,
    androidVersion: body.androidVersion,
  };
}

function view(row) {
  return {
    id: row.id,
    representativeId: row.rep_user_id,
    ...JSON.parse(row.payload_json),
    receivedAt: `${row.created_at.replace(' ', 'T')}Z`,
  };
}

function diagnosticPath(row) {
  return storageDirectory('rep-support', 'diagnostics', row.created_at.slice(0, 10), `report-${row.id}-${row.report_uuid}.json`);
}

async function readArchive(path, expected) {
  try {
    const contents = await readFile(await resolveStorageFile(path));
    if (!contents.equals(expected)) throw new Error('Diagnostic archive does not match its recorded contents.');
    return contents;
  } catch (error) {
    if (error.status === 404 || error.code === 'ENOENT') return null;
    throw error;
  }
}

function archiveBytes(row) {
  return Buffer.from(`${JSON.stringify(view(row), null, 2)}\n`);
}

async function archiveDiagnostic(row) {
  const path = diagnosticPath(row);
  const expected = archiveBytes(row);
  if (await readArchive(path, expected)) return;
  const stagingPath = storageDirectory('.madar-recovery', 'rep-diagnostics', `${randomUUID()}.json`);
  const staged = await writeStorageFile(stagingPath, expected);
  try {
    await moveStorageFile(stagingPath, path);
  } catch (error) {
    if (error.status !== 409 || !(await readArchive(path, expected))) throw error;
  } finally {
    await removeStorageFile(staged.absolutePath);
  }
}

export async function recordAutomaticDiagnostic(rep, input, database = db) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const payload = normalizeDiagnostic(input);
  const payloadJson = JSON.stringify(payload);
  const { row, idempotent } = database.transaction(() => {
    const find = database.prepare('SELECT * FROM rep_automatic_diagnostics WHERE report_uuid = ?');
    const existing = find.get(payload.reportUuid);
    if (existing) {
      if (existing.rep_user_id !== rep.id || existing.payload_json !== payloadJson) {
        throw new HttpError(409, 'This diagnostic UUID is already in use.');
      }
      return { row: existing, idempotent: true };
    }
    database.prepare(`INSERT INTO rep_automatic_diagnostics (report_uuid, rep_user_id, payload_json) VALUES (?, ?, ?)`)
      .run(payload.reportUuid, rep.id, payloadJson);
    return { row: find.get(payload.reportUuid), idempotent: false };
  }).immediate();

  try {
    await archiveDiagnostic(row);
  } catch {
    throw new HttpError(503, 'Diagnostic storage is temporarily unavailable.');
  }
  database.prepare(`UPDATE rep_automatic_diagnostics SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL`).run(row.id);
  return { id: row.id, reportUuid: row.report_uuid, status: 'received', idempotent };
}

export function listAutomaticDiagnostics(database = db) {
  return database.prepare(`SELECT * FROM rep_automatic_diagnostics WHERE archived_at IS NOT NULL ORDER BY id DESC LIMIT 100`)
    .all().map(view);
}

export async function downloadAutomaticDiagnostic(id, database = db) {
  const row = database.prepare('SELECT * FROM rep_automatic_diagnostics WHERE id = ? AND archived_at IS NOT NULL')
    .get(positiveId(id, 'reportId'));
  if (!row) throw new HttpError(404, 'Diagnostic report was not found.');
  const bytes = await readArchive(diagnosticPath(row), archiveBytes(row));
  if (!bytes) throw new HttpError(404, 'Diagnostic file was not found.');
  return { bytes, filename: `madar-diagnostic-${row.id}.json` };
}
