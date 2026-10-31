import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { requestActorId } from '../actor.js';
import { asyncHandler, allowOnlyKeys, HttpError, requireObject, requireText } from '../http.js';

const router = Router();
const USER_ROLES = ['admin', 'operations'];

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required.' });
    return;
  }
  next();
}

router.use(requireAdmin);

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT id, username, full_name, role, active, created_at FROM users
    WHERE deleted_at IS NULL ORDER BY active DESC, username COLLATE NOCASE, id`).all());
});

router.post('/', asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['username', 'full_name', 'fullName', 'role', 'password']);
  const username = requireText(body.username, 'username', { minLength: 3, maxLength: 64 });
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(username)) throw new HttpError(400, 'username contains unsupported characters.');
  const fullName = requireText(body.full_name ?? body.fullName, 'full_name', { minLength: 2, maxLength: 120 });
  if (!USER_ROLES.includes(body.role)) throw new HttpError(400, `role must be one of: ${USER_ROLES.join(', ')}.`);
  if (typeof body.password !== 'string' || body.password.length < 12 || Buffer.byteLength(body.password, 'utf8') > 72) {
    throw new HttpError(400, 'Password must contain at least 12 characters and no more than 72 UTF-8 bytes.');
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  try {
    const created = db.transaction(() => {
      const result = db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
        .run(username, passwordHash, fullName, body.role);
      const id = Number(result.lastInsertRowid);
      recordAudit({ database: db, actorId: requestActorId(req), action: 'create', entityType: 'user', entityId: id,
        newValues: { username, full_name: fullName, role: body.role, active: 1 } });
      return db.prepare('SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?').get(id);
    }).immediate();
    res.status(201).json(created);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That username is already in use.');
    throw error;
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'id must be a positive integer.');
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['role', 'password', 'active']);
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one user field must be provided.');
  const current = db.prepare('SELECT id, username, full_name, role, active FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!current) throw new HttpError(404, 'User was not found.');
  if (body.role !== undefined && !USER_ROLES.includes(body.role)) throw new HttpError(400, `role must be one of: ${USER_ROLES.join(', ')}.`);
  if (body.active !== undefined && typeof body.active !== 'boolean') throw new HttpError(400, 'active must be a boolean.');
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length < 12 || Buffer.byteLength(body.password, 'utf8') > 72)) {
    throw new HttpError(400, 'Password must contain at least 12 characters and no more than 72 UTF-8 bytes.');
  }
  const nextRole = body.role ?? current.role;
  const nextActive = body.active === undefined ? current.active : Number(body.active);
  if (current.id === requestActorId(req) && (nextActive === 0 || nextRole !== 'admin')) {
    throw new HttpError(409, 'You cannot deactivate or demote your own administrator account.');
  }
  const remainingAdmin = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?`).get(id).count;
  if (current.role === 'admin' && current.active === 1 && (nextRole !== 'admin' || nextActive === 0) && remainingAdmin === 0) {
    throw new HttpError(409, 'At least one active administrator must remain.');
  }
  const passwordHash = body.password === undefined ? null : await bcrypt.hash(body.password, 12);
  db.transaction(() => {
    db.prepare('UPDATE users SET role = ?, active = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?')
      .run(nextRole, nextActive, passwordHash, id);
    if (nextActive === 0 || passwordHash) db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(id);
    recordAudit({ database: db, actorId: requestActorId(req), action: 'update', entityType: 'user', entityId: id,
      oldValues: { role: current.role, active: current.active },
      newValues: { role: nextRole, active: nextActive, password_changed: Boolean(passwordHash) } });
  }).immediate();
  res.json(db.prepare('SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?').get(id));
}));

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'id must be a positive integer.');
  if (id === requestActorId(req)) throw new HttpError(409, 'You cannot deactivate your own account.');
  const current = db.prepare('SELECT id, username, role, active FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!current) throw new HttpError(404, 'User was not found.');
  const remainingAdmin = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?`).get(id).count;
  if (current.role === 'admin' && current.active === 1 && remainingAdmin === 0) throw new HttpError(409, 'At least one active administrator must remain.');
  db.transaction(() => {
    db.prepare('UPDATE users SET active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(id);
    recordAudit({ database: db, actorId: requestActorId(req), action: 'deactivate', entityType: 'user', entityId: id,
      oldValues: current, newValues: { active: 0, deleted_at: 'CURRENT_TIMESTAMP' } });
  }).immediate();
  res.json({ id, active: 0 });
});

export default router;
