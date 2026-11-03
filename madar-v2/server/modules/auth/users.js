import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { requestActorId } from '../actor.js';
import { asyncHandler, allowOnlyKeys, HttpError, requireObject, requireText } from '../http.js';
import { syncEmployeeForUser } from '../employees/user-sync.js';

const router = Router();
const USER_ROLES = ['admin', 'sales', 'operations', 'purchasing', 'rep'];

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required.' });
    return;
  }
  next();
}

router.use(requireAdmin);

function normalizeAssignedRegions(value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'assignedRegions must be an array of region names.');
  if (value.length > 100) throw new HttpError(400, 'assignedRegions cannot contain more than 100 regions.');
  const regions = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const region = requireText(value[index], `assignedRegions[${index}]`, { maxLength: 160 });
    const key = region.normalize('NFKC').toLocaleLowerCase('ar');
    if (seen.has(key)) continue;
    seen.add(key);
    regions.push(region);
  }
  return regions;
}

function parseAssignedRegions(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((region) => typeof region === 'string') : [];
  } catch {
    return [];
  }
}

function serializeUser(row) {
  const user = {
    id: Number(row.id),
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    active: row.active,
    isActive: Number(row.active),
    created_at: row.created_at,
  };
  if (row.role !== 'rep') return user;
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
    assignedRegions: parseAssignedRegions(row.assigned_regions_json),
    isOnline: Boolean(row.is_online),
    lastLocation,
  };
}

function normalizeActive(value, label = 'isActive') {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new HttpError(400, `${label} must be true, false, 1, or 0.`);
}

function normalizeUsername(value) {
  const username = requireText(value, 'username', { minLength: 3, maxLength: 64 });
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(username)) {
    throw new HttpError(400, 'username contains unsupported characters.');
  }
  return username;
}

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT id, username, full_name, role, active, created_at,
      assigned_regions_json, is_online, last_location_json FROM users
    WHERE deleted_at IS NULL ORDER BY active DESC, username COLLATE NOCASE, id`).all().map(serializeUser));
});

router.post('/', asyncHandler(async (req, res) => {
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['username', 'full_name', 'fullName', 'role', 'password', 'assignedRegions', 'active', 'isActive']);
  if (body.active !== undefined && body.isActive !== undefined) throw new HttpError(400, 'Provide either active or isActive, not both.');
  const username = normalizeUsername(body.username);
  const fullName = requireText(body.full_name ?? body.fullName, 'full_name', { minLength: 2, maxLength: 120 });
  const role = body.role ?? (req.baseUrl === '/api/users' ? 'rep' : undefined);
  if (!USER_ROLES.includes(role)) throw new HttpError(400, `role must be one of: ${USER_ROLES.join(', ')}.`);
  const assignedRegions = normalizeAssignedRegions(body.assignedRegions ?? []);
  const active = body.isActive === undefined && body.active === undefined
    ? 1
    : normalizeActive(body.isActive ?? body.active);
  if (role !== 'rep' && assignedRegions.length) throw new HttpError(400, 'assignedRegions can only be set for rep users.');
  if (typeof body.password !== 'string' || body.password.length < 4 || Buffer.byteLength(body.password, 'utf8') > 72) {
    throw new HttpError(400, 'يجب أن تتكون كلمة المرور من 4 خانات على الأقل وألا تتجاوز 72 بايتاً.');
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  try {
    const created = db.transaction(() => {
      const result = db.prepare(`INSERT INTO users
        (username, password_hash, full_name, role, active, assigned_regions_json)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(username, passwordHash, fullName, role, active, JSON.stringify(assignedRegions));
      const id = Number(result.lastInsertRowid);
      const user = db.prepare(`SELECT id, full_name, role, active, deleted_at, created_at FROM users WHERE id = ?`).get(id);
      syncEmployeeForUser(db, user, { actorId: requestActorId(req), audit: true });
      recordAudit({ database: db, actorId: requestActorId(req), action: 'create', entityType: 'user', entityId: id,
        newValues: { username, full_name: fullName, role, active, assigned_regions: assignedRegions } });
      return db.prepare(`SELECT id, username, full_name, role, active, created_at,
        assigned_regions_json, is_online, last_location_json FROM users WHERE id = ?`).get(id);
    }).immediate();
    res.status(201).json(serializeUser(created));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That username is already in use.');
    throw error;
  }
}));

const updateUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'id must be a positive integer.');
  const body = requireObject(req.body);
  allowOnlyKeys(body, ['username', 'full_name', 'fullName', 'role', 'password', 'active', 'isActive', 'assignedRegions']);
  if (body.active !== undefined && body.isActive !== undefined) throw new HttpError(400, 'Provide either active or isActive, not both.');
  if (!Object.keys(body).length) throw new HttpError(400, 'At least one user field must be provided.');
  const current = db.prepare(`SELECT id, username, full_name, role, active, created_at,
    assigned_regions_json, is_online, last_location_json FROM users WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!current) throw new HttpError(404, 'User was not found.');
  if (body.role !== undefined && !USER_ROLES.includes(body.role)) throw new HttpError(400, `role must be one of: ${USER_ROLES.join(', ')}.`);
  const requestedRegions = body.assignedRegions === undefined ? null : normalizeAssignedRegions(body.assignedRegions);
  const requestedActive = body.isActive ?? body.active;
  const suppliedName = body.full_name ?? body.fullName;
  const nextUsername = body.username === undefined ? current.username : normalizeUsername(body.username);
  const nextFullName = suppliedName === undefined
    ? current.full_name
    : requireText(suppliedName, 'full_name', { minLength: 2, maxLength: 120 });
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length < 4 || Buffer.byteLength(body.password, 'utf8') > 72)) {
    throw new HttpError(400, 'يجب أن تتكون كلمة المرور من 4 خانات على الأقل وألا تتجاوز 72 بايتاً.');
  }
  const nextRole = body.role ?? current.role;
  const nextActive = requestedActive === undefined ? current.active : normalizeActive(requestedActive, body.isActive !== undefined ? 'isActive' : 'active');
  if (nextRole !== 'rep' && requestedRegions?.length) throw new HttpError(400, 'assignedRegions can only be set for rep users.');
  const nextRegions = nextRole === 'rep'
    ? (requestedRegions ?? parseAssignedRegions(current.assigned_regions_json))
    : [];
  const identityChanged = nextUsername !== current.username || nextRole !== current.role || body.password !== undefined;
  const nextOnline = nextRole === 'rep' && nextActive === 1 && !identityChanged
    ? current.is_online
    : 0;
  if (current.id === requestActorId(req) && (nextActive === 0 || nextRole !== 'admin')) {
    throw new HttpError(409, 'You cannot deactivate or demote your own administrator account.');
  }
  const remainingAdmin = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?`).get(id).count;
  if (current.role === 'admin' && current.active === 1 && (nextRole !== 'admin' || nextActive === 0) && remainingAdmin === 0) {
    throw new HttpError(409, 'At least one active administrator must remain.');
  }
  const passwordHash = body.password === undefined ? null : await bcrypt.hash(body.password, 12);
  db.transaction(() => {
    db.prepare(`UPDATE users SET username = ?, full_name = ?, role = ?, active = ?, password_hash = COALESCE(?, password_hash),
      assigned_regions_json = ?, is_online = ? WHERE id = ?`)
      .run(nextUsername, nextFullName, nextRole, nextActive, passwordHash, JSON.stringify(nextRegions), nextOnline, id);
    const updatedUser = db.prepare(`SELECT id, full_name, role, active, deleted_at, created_at FROM users WHERE id = ?`).get(id);
    syncEmployeeForUser(db, updatedUser, { actorId: requestActorId(req), audit: true });
    if (nextActive === 0 || identityChanged) {
      db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(id);
    }
    if (nextActive === 0) {
      db.prepare(`UPDATE rep_duty_sessions SET ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE rep_user_id = ? AND ended_at IS NULL`).run(id);
    }
    recordAudit({ database: db, actorId: requestActorId(req), action: 'update', entityType: 'user', entityId: id,
      oldValues: { username: current.username, full_name: current.full_name, role: current.role, active: current.active, assigned_regions: parseAssignedRegions(current.assigned_regions_json), is_online: Boolean(current.is_online) },
      newValues: { username: nextUsername, full_name: nextFullName, role: nextRole, active: nextActive, assigned_regions: nextRegions, is_online: Boolean(nextOnline), password_changed: Boolean(passwordHash) } });
  }).immediate();
  res.json(serializeUser(db.prepare(`SELECT id, username, full_name, role, active, created_at,
    assigned_regions_json, is_online, last_location_json FROM users WHERE id = ?`).get(id)));
});

router.patch('/:id', updateUser);
router.put('/:id', updateUser);

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'id must be a positive integer.');
  if (id === requestActorId(req)) throw new HttpError(409, 'You cannot deactivate your own account.');
  const current = db.prepare('SELECT id, username, full_name, role, active, deleted_at, created_at FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!current) throw new HttpError(404, 'User was not found.');
  const remainingAdmin = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?`).get(id).count;
  if (current.role === 'admin' && current.active === 1 && remainingAdmin === 0) throw new HttpError(409, 'At least one active administrator must remain.');
  db.transaction(() => {
    db.prepare('UPDATE users SET active = 0, is_online = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    const deletedUser = db.prepare('SELECT id, full_name, role, active, deleted_at, created_at FROM users WHERE id = ?').get(id);
    syncEmployeeForUser(db, deletedUser, { actorId: requestActorId(req), audit: true });
    db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(id);
    db.prepare(`UPDATE rep_duty_sessions SET ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE rep_user_id = ? AND ended_at IS NULL`).run(id);
    recordAudit({ database: db, actorId: requestActorId(req), action: 'deactivate', entityType: 'user', entityId: id,
      oldValues: current, newValues: { active: 0, deleted_at: 'CURRENT_TIMESTAMP' } });
  }).immediate();
  res.json({ id, active: 0 });
});

export default router;
