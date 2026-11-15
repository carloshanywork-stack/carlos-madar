import { createHash, randomUUID } from 'node:crypto';
import { db as defaultDb } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { HttpError, allowOnlyKeys, optionalText, positiveId, requireObject, requireText } from '../http.js';
import { compressFieldImage } from '../upload.js';
import { removeStorageFile, resolveStorageFile, storageDirectory, writeStorageFile } from '../storage.js';
import { env } from '../../config/env.js';

const categories = new Set(['bug', 'sync', 'location', 'camera', 'account', 'other']);
const severities = new Set(['low', 'normal', 'high', 'critical']);
const reportStatuses = new Set(['new', 'in_progress', 'resolved', 'closed']);
const ATTACHMENT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REDACTION_PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]'],
  [/((?:password|passwd|token|secret|authorization|cookie|session(?:_?id)?)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]'],
  [/([?&](?:token|key|secret|password|email|phone)=)[^&#\s]*/gi, '$1[REDACTED]'],
];

function sanitizeText(value, label, maxLength, { required = false } = {}) {
  const text = required ? requireText(value, label, { minLength: 1, maxLength }) : optionalText(value, label, { maxLength });
  if (!text) return '';
  return REDACTION_PATTERNS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

function reportUuid(value) {
  if (value === undefined) return randomUUID();
  const uuid = requireText(value, 'reportUuid', { maxLength: 36 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new HttpError(400, 'reportUuid must be a valid UUID.');
  }
  return uuid;
}

function normalizeReport(input) {
  const body = requireObject(input, 'report');
  allowOnlyKeys(body, [
    'reportUuid', 'category', 'severity', 'description', 'screenName', 'appVersion',
    'deviceModel', 'androidVersion', 'logs',
  ]);
  const category = body.category ?? 'other';
  const severity = body.severity ?? 'normal';
  if (!categories.has(category)) throw new HttpError(400, 'Invalid report category.');
  if (!severities.has(severity)) throw new HttpError(400, 'Invalid report severity.');
  return {
    reportUuid: reportUuid(body.reportUuid),
    category,
    severity,
    description: sanitizeText(body.description, 'description', 8000, { required: true }),
    screenName: sanitizeText(body.screenName ?? 'unknown', 'screenName', 120),
    appVersion: sanitizeText(body.appVersion ?? 'unknown', 'appVersion', 80),
    deviceModel: sanitizeText(body.deviceModel ?? 'unknown', 'deviceModel', 160),
    androidVersion: sanitizeText(body.androidVersion ?? 'unknown', 'androidVersion', 80),
    logs: sanitizeText(body.logs, 'logs', 24000),
  };
}

function addEvent(database, reportId, actorId, eventType, oldValues = null, newValues = null, note = null) {
  database.prepare(`INSERT INTO rep_bug_report_events
    (report_id, actor_user_id, event_type, old_values_json, new_values_json, note)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    reportId, actorId, eventType,
    oldValues === null ? null : JSON.stringify(oldValues),
    newValues === null ? null : JSON.stringify(newValues), note,
  );
}

function reportView(row, database, { representative = false } = {}) {
  const attachments = database.prepare(`SELECT id, original_name, content_type, byte_size, sha256, purged_at, created_at
    FROM rep_bug_report_attachments WHERE report_id = ? ORDER BY id`).all(row.id).map((attachment) => ({
    ...attachment,
    id: Number(attachment.id),
    byteSize: Number(attachment.byte_size),
    purged: Boolean(attachment.purged_at),
    downloadUrl: attachment.purged_at ? null : representative
      ? `/api/rep/support/reports/${row.id}/attachments/${attachment.id}`
      : `/api/system/rep-support/${row.id}/attachments/${attachment.id}`,
  }));
  return {
    id: Number(row.id),
    reportUuid: row.report_uuid,
    representativeId: Number(row.rep_user_id),
    representativeName: row.representative_name ?? null,
    username: row.username ?? null,
    category: row.category,
    severity: row.severity,
    description: row.description,
    screenName: row.screen_name,
    appVersion: row.app_version,
    deviceModel: row.device_model,
    androidVersion: row.android_version,
    sanitizedLogs: row.sanitized_logs,
    status: row.status,
    githubStatus: row.github_status,
    githubIssueUrl: row.github_issue_url,
    githubLastError: row.github_last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments,
  };
}

const REPORT_SELECT = `SELECT report.*, user.full_name AS representative_name, user.username
  FROM rep_bug_reports report JOIN users user ON user.id = report.rep_user_id`;

export async function createRepBugReport(rep, input, attachment, database = defaultDb) {
  if (rep?.role !== 'rep') throw new HttpError(403, 'Field representative access is required.');
  const report = normalizeReport(input);
  const existing = database.prepare('SELECT id, rep_user_id FROM rep_bug_reports WHERE report_uuid = ?').get(report.reportUuid);
  if (existing) {
    if (Number(existing.rep_user_id) !== Number(rep.id)) throw new HttpError(409, 'This report UUID belongs to another account.');
    return { ...reportView(database.prepare(`${REPORT_SELECT} WHERE report.id = ?`).get(existing.id), database, { representative: true }), idempotent: true };
  }

  let attachmentInfo = null;
  if (attachment) {
    if (!Buffer.isBuffer(attachment.buffer) || !attachment.buffer.length) throw new HttpError(400, 'Attachment is empty.');
    let compressed;
    try { compressed = await compressFieldImage(attachment.buffer, { width: 1600, height: 1600, quality: 78 }); }
    catch { throw new HttpError(400, 'Attachment must be a valid supported image.'); }
    const storedPath = storageDirectory('rep-support', 'attachments', `${report.reportUuid}-${randomUUID()}.jpg`);
    const written = await writeStorageFile(storedPath, compressed.buffer);
    attachmentInfo = {
      storedPath: written.storedPath,
      originalName: sanitizeText(attachment.originalname || 'attachment.jpg', 'attachment name', 180) || 'attachment.jpg',
      byteSize: compressed.buffer.length,
      sha256: createHash('sha256').update(compressed.buffer).digest('hex'),
    };
  }

  try {
    const result = database.transaction(() => {
      const inserted = database.prepare(`INSERT INTO rep_bug_reports
        (report_uuid, rep_user_id, category, severity, description, screen_name, app_version,
         device_model, android_version, sanitized_logs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        report.reportUuid, rep.id, report.category, report.severity, report.description,
        report.screenName, report.appVersion, report.deviceModel, report.androidVersion, report.logs,
      );
      const id = Number(inserted.lastInsertRowid);
      if (attachmentInfo) database.prepare(`INSERT INTO rep_bug_report_attachments
        (report_id, stored_path, original_name, content_type, byte_size, sha256)
        VALUES (?, ?, ?, 'image/jpeg', ?, ?)`).run(
        id, attachmentInfo.storedPath, attachmentInfo.originalName, attachmentInfo.byteSize, attachmentInfo.sha256,
      );
      addEvent(database, id, rep.id, 'created', null, {
        category: report.category, severity: report.severity, attachmentCount: attachmentInfo ? 1 : 0,
      });
      recordAudit({ database, actorId: rep.id, action: 'create', entityType: 'rep_bug_report', entityId: id,
        newValues: { report_uuid: report.reportUuid, category: report.category, severity: report.severity, attachment_count: attachmentInfo ? 1 : 0 } });
      return id;
    }).immediate();
    return { ...reportView(database.prepare(`${REPORT_SELECT} WHERE report.id = ?`).get(result), database, { representative: true }), idempotent: false };
  } catch (error) {
    if (attachmentInfo) {
      try { await removeStorageFile(await resolveStorageFile(attachmentInfo.storedPath)); } catch { /* A missing file needs no cleanup. */ }
    }
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'This report UUID has already been submitted.');
    throw error;
  }
}

export function listRepBugReports({ status = 'all', limit = 100 } = {}, database = defaultDb) {
  if (status !== 'all' && !reportStatuses.has(status)) throw new HttpError(400, 'Invalid report status.');
  const safeLimit = Math.min(200, Math.max(1, Number.isInteger(limit) ? limit : 100));
  const where = status === 'all' ? '' : 'WHERE report.status = ?';
  const rows = database.prepare(`${REPORT_SELECT} ${where} ORDER BY report.created_at DESC, report.id DESC LIMIT ?`)
    .all(...(status === 'all' ? [safeLimit] : [status, safeLimit]));
  return rows.map((row) => reportView(row, database));
}

export function listMyRepBugReports(repId, database = defaultDb) {
  const id = positiveId(repId, 'repId');
  return database.prepare(`${REPORT_SELECT} WHERE report.rep_user_id = ? ORDER BY report.created_at DESC, report.id DESC LIMIT 50`)
    .all(id).map((row) => reportView(row, database, { representative: true }));
}

export function getRepBugReport(reportId, database = defaultDb) {
  const id = positiveId(reportId, 'reportId');
  const row = database.prepare(`${REPORT_SELECT} WHERE report.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Bug report was not found.');
  return reportView(row, database);
}

export function updateRepBugReport(reportId, input, actorId, database = defaultDb) {
  const id = positiveId(reportId, 'reportId');
  const body = requireObject(input, 'report update');
  allowOnlyKeys(body, ['status', 'note']);
  const status = body.status;
  if (!reportStatuses.has(status)) throw new HttpError(400, 'Invalid report status.');
  const note = sanitizeText(body.note, 'note', 2000);
  const result = database.transaction(() => {
    const current = database.prepare('SELECT id, status FROM rep_bug_reports WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'Bug report was not found.');
    database.prepare('UPDATE rep_bug_reports SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
    addEvent(database, id, positiveId(actorId, 'actorId'), 'status_changed', { status: current.status }, { status }, note || null);
    recordAudit({ database, actorId, action: 'status_changed', entityType: 'rep_bug_report', entityId: id,
      oldValues: { status: current.status }, newValues: { status }, });
    return getRepBugReport(id, database);
  }).immediate();
  return result;
}

export async function createGitHubIssueForRepBugReport(reportId, actorId, database = defaultDb) {
  const id = positiveId(reportId, 'reportId');
  const actor = positiveId(actorId, 'actorId');
  const report = database.prepare(`${REPORT_SELECT} WHERE report.id = ?`).get(id);
  if (!report) throw new HttpError(404, 'Bug report was not found.');
  if (report.github_status === 'created' && report.github_issue_url) return getRepBugReport(id, database);
  const markQueued = database.transaction(() => {
    database.prepare(`UPDATE rep_bug_reports SET github_status = 'queued', github_last_error = NULL,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    addEvent(database, id, actor, 'github_requested', { github_status: report.github_status }, { github_status: 'queued' });
    recordAudit({ database, actorId: actor, action: 'github_issue_requested', entityType: 'rep_bug_report', entityId: id,
      oldValues: { github_status: report.github_status }, newValues: { github_status: 'queued' } });
  });
  markQueued.immediate();

  let failure = null;
  try {
    if (!env.githubToken || !env.githubRepository) throw new Error('GitHub issue integration is not configured on this server.');
    const title = `[Field report] ${report.category} · ${report.severity} · ${String(report.description).split('\n')[0].slice(0, 120)}`;
    const body = [
      'A representative submitted a sanitized field report. Do not treat client-provided environment information as verified.',
      '', `- Report ID: ${report.report_uuid}`, `- Category: ${report.category}`, `- Severity: ${report.severity}`,
      `- App version: ${report.app_version}`, `- Screen: ${report.screen_name}`,
      `- Device: ${report.device_model}; Android ${report.android_version}`,
      '', '## Description', report.description,
      report.sanitized_logs ? ['', '## Sanitized logs', '```text', report.sanitized_logs, '```'].join('\n') : '',
      '', 'Attachments remain in the local MADAR system and are not sent to GitHub.',
    ].filter(Boolean).join('\n');
    const response = await fetch(`https://api.github.com/repos/${env.githubRepository}/issues`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'MADAR-V2-Field-Report',
      },
      body: JSON.stringify({ title, body, labels: ['field-report'] }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.html_url !== 'string' || !/^https:\/\/github\.com\//.test(data.html_url)) {
      throw new Error(`GitHub API returned HTTP ${response.status}.`);
    }
    database.transaction(() => {
      database.prepare(`UPDATE rep_bug_reports SET github_status = 'created', github_issue_url = ?,
        github_last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(data.html_url, id);
      addEvent(database, id, actor, 'github_created', null, { github_issue_url: data.html_url });
      recordAudit({ database, actorId: actor, action: 'github_issue_created', entityType: 'rep_bug_report', entityId: id,
        newValues: { github_issue_url: data.html_url } });
    }).immediate();
  } catch (error) {
    failure = sanitizeText(error.message || 'GitHub issue creation failed.', 'githubError', 500);
    database.transaction(() => {
      database.prepare(`UPDATE rep_bug_reports SET github_status = 'failed', github_last_error = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(failure, id);
      addEvent(database, id, actor, 'github_failed', { github_status: 'queued' }, { github_status: 'failed' }, failure);
      recordAudit({ database, actorId: actor, action: 'github_issue_failed', entityType: 'rep_bug_report', entityId: id,
        newValues: { github_status: 'failed', error: failure } });
    }).immediate();
  }
  return getRepBugReport(id, database);
}

export async function downloadRepBugAttachment(reportId, attachmentId, database = defaultDb, repId = null) {
  const id = positiveId(reportId, 'reportId');
  const ownerFilter = repId === null ? '' : 'AND report.rep_user_id = ?';
  const parameters = repId === null
    ? [positiveId(attachmentId, 'attachmentId'), id]
    : [positiveId(attachmentId, 'attachmentId'), id, positiveId(repId, 'repId')];
  const attachment = database.prepare(`SELECT attachment.stored_path, attachment.original_name, attachment.content_type,
      attachment.byte_size, attachment.purged_at
    FROM rep_bug_report_attachments attachment JOIN rep_bug_reports report ON report.id = attachment.report_id
    WHERE attachment.id = ? AND attachment.report_id = ? ${ownerFilter}`)
    .get(...parameters);
  if (!attachment || attachment.purged_at) throw new HttpError(404, 'Attachment was not found.');
  return { absolutePath: await resolveStorageFile(attachment.stored_path), ...attachment };
}

export async function purgeExpiredRepBugAttachments(database = defaultDb, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new TypeError('A valid maintenance timestamp is required.');
  const cutoff = new Date(now.valueOf() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const rows = database.prepare(`SELECT attachment.id, attachment.report_id, attachment.stored_path
    FROM rep_bug_report_attachments attachment
    WHERE attachment.purged_at IS NULL AND datetime(attachment.created_at) < datetime(?)`).all(cutoff);
  let purged = 0;
  for (const row of rows) {
    try { await removeStorageFile(await resolveStorageFile(row.stored_path)); }
    catch (error) { if (error.status !== 404) continue; }
    database.transaction(() => {
      database.prepare(`UPDATE rep_bug_report_attachments SET purged_at = CURRENT_TIMESTAMP WHERE id = ? AND purged_at IS NULL`).run(row.id);
      addEvent(database, row.report_id, null, 'attachments_purged', null, { attachment_id: Number(row.id) });
      recordAudit({ database, action: 'attachments_purged', entityType: 'rep_bug_report', entityId: row.report_id,
        newValues: { attachment_id: Number(row.id), purged_at: now.toISOString() } });
    }).immediate();
    purged += 1;
  }
  return { purged };
}

let purgeTimer = null;
let purgeInProgress = null;

export function startRepSupportAttachmentPurgeScheduler({ database = defaultDb, intervalMs = ATTACHMENT_PURGE_INTERVAL_MS } = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) throw new TypeError('Purge interval must be at least one second.');
  if (purgeTimer) return stopRepSupportAttachmentPurgeScheduler;
  const run = () => {
    if (purgeInProgress) return purgeInProgress;
    purgeInProgress = purgeExpiredRepBugAttachments(database)
      .then((result) => {
        if (result.purged) console.log(`Purged ${result.purged} expired representative support attachment(s).`);
      })
      .catch((error) => console.error(`Representative support attachment retention failed: ${error.message}`))
      .finally(() => { purgeInProgress = null; });
    return purgeInProgress;
  };
  void run();
  purgeTimer = setInterval(() => { void run(); }, intervalMs);
  purgeTimer.unref?.();
  return stopRepSupportAttachmentPurgeScheduler;
}

export async function stopRepSupportAttachmentPurgeScheduler() {
  if (purgeTimer) clearInterval(purgeTimer);
  purgeTimer = null;
  await purgeInProgress;
}
