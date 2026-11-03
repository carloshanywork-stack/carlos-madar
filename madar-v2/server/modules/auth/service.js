import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { HttpError, allowOnlyKeys, requireObject, requireText } from '../http.js';

const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const dummyPasswordHash = bcrypt.hashSync('MADAR-invalid-login-timing-only', 12);
export const REP_ACCOUNT_DISABLED_MESSAGE = 'تم تعطيل حسابك من قبل الإدارة';

function publicUser(row) {
  const user = {
    id: Number(row.id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
  };
  if (row.role !== 'rep') return user;

  let assignedRegions = [];
  try {
    const parsed = JSON.parse(row.assigned_regions_json ?? '[]');
    if (Array.isArray(parsed)) assignedRegions = parsed.filter((region) => typeof region === 'string');
  } catch {
    assignedRegions = [];
  }

  let lastLocation = null;
  try {
    const parsed = row.last_location_json ? JSON.parse(row.last_location_json) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) {
      lastLocation = {
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        accuracy: Number.isFinite(parsed.accuracy) ? parsed.accuracy : null,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      };
    }
  } catch {
    lastLocation = null;
  }

  return {
    ...user,
    assignedRegions,
    isOnline: Boolean(row.is_online),
    lastLocation,
  };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readPassword(value, { setup = false } = {}) {
  if (typeof value !== 'string' || value.length < (setup ? 12 : 1) || value.length > 1024) {
    throw new HttpError(400, setup
      ? 'Password must contain at least 12 characters.'
      : 'Username and password are required.');
  }
  if (Buffer.byteLength(value, 'utf8') > 72) {
    throw new HttpError(400, 'Password must be no more than 72 UTF-8 bytes.');
  }
  return value;
}

export function isSetupRequired(database = db) {
  return database.prepare('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL').get().count === 0;
}

export async function createFirstAdmin(input, database = db) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['username', 'fullName', 'password']);
  const username = requireText(body.username, 'Username', { minLength: 3, maxLength: 64 });
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(username)) {
    throw new HttpError(400, 'Username may contain letters, numbers, dots, underscores, and hyphens.');
  }
  const fullName = requireText(body.fullName, 'Full name', { minLength: 2, maxLength: 120 });
  const password = readPassword(body.password, { setup: true });

  if (!isSetupRequired(database)) {
    throw new HttpError(409, 'Administrator setup has already been completed.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const create = database.transaction(() => {
      if (!isSetupRequired(database)) {
        throw new HttpError(409, 'Administrator setup has already been completed.');
      }
      const result = database.prepare(`
        INSERT INTO users (username, password_hash, full_name, role)
        VALUES (?, ?, ?, 'admin')
      `).run(username, passwordHash, fullName);
      return publicUser(database.prepare(`
        SELECT id, username, full_name, role FROM users WHERE id = ?
      `).get(result.lastInsertRowid));
    });
    return create.immediate();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new HttpError(409, 'That username is already in use.');
    }
    throw error;
  }
}

export function authenticateUser(username, password, database = db, { allowedRoles } = {}) {
  if (typeof username !== 'string' || !username.trim() || username.length > 64) return null;
  if (typeof password !== 'string' || !password || password.length > 1024
      || Buffer.byteLength(password, 'utf8') > 72) return null;
  const roles = allowedRoles === undefined ? null : [...new Set(allowedRoles)];
  const roleClause = roles === null ? '' : `AND role IN (${roles.map(() => '?').join(', ')})`;
  const row = database.prepare(`
    SELECT id, username, password_hash, full_name, role,
      assigned_regions_json, is_online, last_location_json
    FROM users
    WHERE username = ? COLLATE NOCASE AND active = 1 AND deleted_at IS NULL
      ${roleClause}
    LIMIT 1
  `).get(username.trim(), ...(roles ?? []));
  const passwordMatches = bcrypt.compareSync(password, row?.password_hash ?? dummyPasswordHash);
  if (!row || !passwordMatches) return null;
  const token = createSession(row, database);
  const refreshedRow = row.role === 'rep'
    ? database.prepare(`SELECT id, username, full_name, role, assigned_regions_json, is_online, last_location_json
      FROM users WHERE id = ?`).get(row.id)
    : row;
  return { user: publicUser(refreshedRow), token };
}

/** Authenticate a representative while preserving a distinct response for a valid but disabled account. */
export function authenticateRepUser(username, password, database = db) {
  if (typeof username !== 'string' || !username.trim() || username.length > 64) return null;
  if (typeof password !== 'string' || !password || password.length > 1024
      || Buffer.byteLength(password, 'utf8') > 72) return null;
  const row = database.prepare(`
    SELECT id, username, password_hash, full_name, role, active,
      assigned_regions_json, is_online, last_location_json
    FROM users
    WHERE username = ? COLLATE NOCASE AND role = 'rep' AND deleted_at IS NULL
    LIMIT 1
  `).get(username.trim());
  const passwordMatches = bcrypt.compareSync(password, row?.password_hash ?? dummyPasswordHash);
  if (!row || !passwordMatches) return null;
  if (Number(row.active) !== 1) return { disabled: true };
  const token = createSession(row, database);
  const refreshedRow = database.prepare(`
    SELECT id, username, full_name, role, assigned_regions_json, is_online, last_location_json
    FROM users WHERE id = ?
  `).get(row.id);
  return { user: publicUser(refreshedRow), token };
}

export function createSession(user, database = db) {
  const token = jwt.sign(
    { sub: String(user.id) },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: sessionLifetimeSeconds, jwtid: randomUUID() },
  );
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();
  const create = database.transaction(() => {
    database.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
    database.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(hashToken(token), user.id, expiresAt);
    if (user.role === 'rep') {
      database.prepare('UPDATE users SET is_online = 1 WHERE id = ? AND role = \'rep\' AND active = 1 AND deleted_at IS NULL')
        .run(user.id);
    }
  });
  create();
  return token;
}

export function getTokenFromRequest(req) {
  const authorization = req.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match?.[1]) return match[1];

  const cookieHeader = req.headers.cookie ?? '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== env.authCookieName) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function verifyToken(token, database = db) {
  if (!token || typeof token !== 'string' || token.length > 8192) return null;
  let claims;
  try {
    claims = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const userId = Number(claims.sub);
  if (!Number.isSafeInteger(userId) || userId < 1) return null;

  const row = database.prepare(`
    SELECT user.id, user.username, user.full_name, user.role,
      user.assigned_regions_json, user.is_online, user.last_location_json
    FROM sessions session
    JOIN users user ON user.id = session.user_id
    WHERE session.token_hash = ? AND session.user_id = ?
      AND session.revoked_at IS NULL
      AND datetime(session.expires_at) > datetime('now')
      AND user.active = 1 AND user.deleted_at IS NULL
    LIMIT 1
  `).get(hashToken(token), userId);
  return row ? publicUser(row) : null;
}

export const getSessionUser = verifyToken;

export function getSessionUserFromRequest(req, database = db) {
  return getSessionUser(getTokenFromRequest(req), database);
}

function getRepSessionState(token, database = db) {
  if (!token || typeof token !== 'string' || token.length > 8192) return null;
  let claims;
  try {
    claims = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const userId = Number(claims.sub);
  if (!Number.isSafeInteger(userId) || userId < 1) return null;
  const row = database.prepare(`
    SELECT user.id, user.username, user.full_name, user.role, user.active, user.deleted_at,
      user.assigned_regions_json, user.is_online, user.last_location_json,
      session.revoked_at
    FROM sessions session
    JOIN users user ON user.id = session.user_id
    WHERE session.token_hash = ? AND session.user_id = ?
      AND datetime(session.expires_at) > datetime('now')
    LIMIT 1
  `).get(hashToken(token), userId);
  if (!row) return null;
  return {
    user: publicUser(row),
    role: row.role,
    active: Number(row.active),
    deletedAt: row.deleted_at,
    revokedAt: row.revoked_at,
  };
}

export function getRepSessionStateFromRequest(req, database = db) {
  return getRepSessionState(getTokenFromRequest(req), database);
}

/** Check role and current account state from SQLite on every representative API request. */
export function requireActiveRep(req, res, next) {
  const session = getRepSessionStateFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (session.role !== 'rep') {
    res.status(403).json({ error: 'Field representative access is required.' });
    return;
  }
  if (session.active !== 1 || session.deletedAt) {
    res.clearCookie(env.authCookieName, authCookieOptions());
    res.status(403).json({ success: false, message: REP_ACCOUNT_DISABLED_MESSAGE });
    return;
  }
  if (session.revokedAt) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  req.user = session.user;
  next();
}

export function isDisabledRepSessionFromRequest(req, database = db) {
  const session = getRepSessionStateFromRequest(req, database);
  return Boolean(session?.role === 'rep' && (session.active !== 1 || session.deletedAt));
}

export function revokeSession(token, database = db) {
  if (!token || typeof token !== 'string' || token.length > 8192) return;
  database.prepare(`
    UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(hashToken(token));
}

export function refreshRepPresence(userId, database = db) {
  database.prepare(`
    UPDATE users
    SET is_online = CASE WHEN active = 1 AND deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.user_id = users.id
        AND sessions.revoked_at IS NULL
        AND datetime(sessions.expires_at) > datetime('now')
    ) THEN 1 ELSE 0 END
    WHERE id = ? AND role = 'rep'
  `).run(userId);
}

export function requireAuthentication(req, res, next) {
  const user = getSessionUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  req.user = user;
  next();
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'strict',
    path: '/',
  };
}
