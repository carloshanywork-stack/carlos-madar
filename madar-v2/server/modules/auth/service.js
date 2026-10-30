import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { HttpError, allowOnlyKeys, requireObject, requireText } from '../http.js';

const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const dummyPasswordHash = bcrypt.hashSync('MADAR-invalid-login-timing-only', 12);

function publicUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
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

export function authenticateUser(username, password, database = db) {
  if (typeof username !== 'string' || !username.trim() || username.length > 64) return null;
  if (typeof password !== 'string' || !password || password.length > 1024
      || Buffer.byteLength(password, 'utf8') > 72) return null;
  const row = database.prepare(`
    SELECT id, username, password_hash, full_name, role
    FROM users
    WHERE username = ? COLLATE NOCASE AND active = 1 AND deleted_at IS NULL
    LIMIT 1
  `).get(username.trim());
  const passwordMatches = bcrypt.compareSync(password, row?.password_hash ?? dummyPasswordHash);
  if (!row || !passwordMatches) return null;
  const user = publicUser(row);
  return { user, token: createSession(user, database) };
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
    SELECT user.id, user.username, user.full_name, user.role
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

export function revokeSession(token, database = db) {
  if (!token || typeof token !== 'string' || token.length > 8192) return;
  database.prepare(`
    UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(hashToken(token));
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
