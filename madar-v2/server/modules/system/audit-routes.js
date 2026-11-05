import { Router } from 'express';
import { db } from '../../database/connection.js';
import { requireAdmin } from '../auth/authorization.js';
import { HttpError } from '../http.js';

const router = Router();
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CAIRO_DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function positiveInteger(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HttpError(400, `${label} must be a positive integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new HttpError(400, `${label} must be a positive integer.`);
  }
  return number;
}

function validatedDate(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    throw new HttpError(400, `${label} must be a valid YYYY-MM-DD date.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new HttpError(400, `${label} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function cairoDateBoundary(date, dayOffset = 0) {
  const [year, month, day] = date.split('-').map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day + dayOffset);
  let timestamp = localMidnightAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(CAIRO_DATE_PARTS.formatToParts(new Date(timestamp))
      .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
    const cairoWallTimeAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    timestamp += localMidnightAsUtc - cairoWallTimeAsUtc;
  }
  return new Date(timestamp).toISOString();
}

function parseJson(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { invalidJson: true, raw: value };
  }
}

function timestampIso(value) {
  if (!value) return null;
  const normalized = value.includes('T')
    ? (/([zZ]|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`)
    : `${value.replace(' ', 'T')}Z`;
  const timestamp = new Date(normalized);
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}

router.get('/audit-log', requireAdmin, (req, res) => {
  const page = positiveInteger(req.query.page, 'page', 1);
  const requestedLimit = positiveInteger(req.query.limit, 'limit', 50);
  const limit = Math.min(requestedLimit, 200);
  const startDate = validatedDate(req.query.startDate, 'startDate');
  const endDate = validatedDate(req.query.endDate, 'endDate');
  if (startDate && endDate && startDate > endDate) {
    throw new HttpError(400, 'startDate must not be after endDate.');
  }

  const clauses = [];
  const parameters = [];
  if (req.query.entityType !== undefined) {
    if (typeof req.query.entityType !== 'string' || !/^[\p{L}\p{N}_:-]{1,100}$/u.test(req.query.entityType)) {
      throw new HttpError(400, 'entityType must be a valid entity name of at most 100 characters.');
    }
    clauses.push('log.entity_type = ?');
    parameters.push(req.query.entityType);
  }
  if (req.query.action !== undefined) {
    if (typeof req.query.action !== 'string' || !/^[\p{L}\p{N}_:-]{1,100}$/u.test(req.query.action)) {
      throw new HttpError(400, 'action must be a valid action name of at most 100 characters.');
    }
    clauses.push('log.action = ?');
    parameters.push(req.query.action);
  }
  if (req.query.actorId !== undefined) {
    const actorId = positiveInteger(req.query.actorId, 'actorId');
    clauses.push('log.actor_id = ?');
    parameters.push(actorId);
  }
  if (startDate) {
    clauses.push("datetime(log.created_at) >= datetime(?)");
    parameters.push(cairoDateBoundary(startDate));
  }
  if (endDate) {
    clauses.push("datetime(log.created_at) < datetime(?)");
    parameters.push(cairoDateBoundary(endDate, 1));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new HttpError(400, 'page is too large.');

  const total = db.prepare(`SELECT COUNT(*) AS total FROM audit_log log ${where}`).get(...parameters).total;
  const rows = db.prepare(`
    SELECT log.id, log.actor_id, actor.username AS actor_username,
      actor.full_name AS actor_name, actor.role AS actor_role,
      log.action, log.entity_type, log.entity_id,
      log.old_values_json, log.new_values_json, log.created_at
    FROM audit_log log
    LEFT JOIN users actor ON actor.id = log.actor_id
    ${where}
    ORDER BY log.created_at DESC, log.id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset);

  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' }).json({
    items: rows.map((row) => ({
      id: Number(row.id),
      actorId: row.actor_id === null ? null : Number(row.actor_id),
      actorUsername: row.actor_username,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      oldValues: parseJson(row.old_values_json),
      newValues: parseJson(row.new_values_json),
      timestamp: timestampIso(row.created_at),
    })),
    total,
    page,
    limit,
    pages: total ? Math.ceil(total / limit) : 0,
  });
});

export default router;
