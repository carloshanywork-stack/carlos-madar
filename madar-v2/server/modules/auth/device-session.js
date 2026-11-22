import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { HttpError } from '../http.js';
import { createSession } from './service.js';

const OFFLINE_LEASE_DAYS = 14;
const REFRESH_TOKEN_DAYS = 30;

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function issueOfflineLease(user, deviceId, serverOrigin = 'madar://server') {
  if (!deviceId || typeof deviceId !== 'string') {
    throw new HttpError(400, 'Device ID is required for offline authorization lease.');
  }
  const payload = {
    sub: Number(user.id),
    scope: Number(user.id),
    deviceId: String(deviceId).trim(),
    role: 'rep',
    fullName: user.full_name || user.fullName || '',
    username: user.username,
    type: 'offline_lease',
    serverOrigin: String(serverOrigin || 'madar://server'),
    policyVersion: 1,
  };
  return jwt.sign(payload, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${OFFLINE_LEASE_DAYS}d`,
    jwtid: randomUUID(),
  });
}

export function verifyOfflineLease(leaseToken, expectedDeviceId = null) {
  if (!leaseToken || typeof leaseToken !== 'string') return null;
  try {
    const claims = jwt.verify(leaseToken, env.jwtSecret, { algorithms: ['HS256'] });
    if (claims.type !== 'offline_lease') return null;
    if (expectedDeviceId && claims.deviceId !== expectedDeviceId) return null;
    return claims;
  } catch {
    return null;
  }
}

export function enrollNativeDeviceSession({
  user,
  deviceId,
  deviceName = null,
  appVersion = null,
  serverOrigin = 'madar://server',
  database = db,
}) {
  if (!user || !user.id) {
    throw new HttpError(400, 'User is required for device enrollment.');
  }
  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
    throw new HttpError(400, 'Device identifier is required.');
  }
  const cleanDeviceId = deviceId.trim().slice(0, 128);
  const cleanDeviceName = deviceName ? String(deviceName).trim().slice(0, 128) : null;
  const cleanAppVersion = appVersion ? String(appVersion).trim().slice(0, 64) : null;

  const deviceSessionId = randomUUID();
  const tokenFamilyId = randomUUID();
  const refreshToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(refreshToken);

  const now = Date.now();
  const offlineLeaseExpiresAt = new Date(now + OFFLINE_LEASE_DAYS * 24 * 3600 * 1000).toISOString();
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_DAYS * 24 * 3600 * 1000).toISOString();

  const accessToken = createSession(user, database);
  const offlineLease = issueOfflineLease(user, cleanDeviceId, serverOrigin);

  database.transaction(() => {
    database.prepare(`
      UPDATE native_device_sessions
      SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'new_device_enrollment'
      WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
    `).run(user.id, cleanDeviceId);

    database.prepare(`
      INSERT INTO native_device_sessions (
        id, user_id, device_id, device_name, app_version,
        refresh_token_hash, token_family_id, family_generation,
        offline_lease_expires_at, refresh_expires_at, last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      deviceSessionId,
      user.id,
      cleanDeviceId,
      cleanDeviceName,
      cleanAppVersion,
      tokenHash,
      tokenFamilyId,
      offlineLeaseExpiresAt,
      refreshExpiresAt
    );

    database.prepare(`
      INSERT INTO native_device_session_tokens (
        token_hash, session_id, family_id, generation, created_at
      ) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(tokenHash, deviceSessionId, tokenFamilyId);
  })();

  return {
    deviceSessionId,
    token: accessToken,
    refreshToken,
    offlineLease,
    policy: {
      offlineLeaseDurationDays: OFFLINE_LEASE_DAYS,
      refreshTokenDurationDays: REFRESH_TOKEN_DAYS,
      tokenType: 'Bearer',
    },
  };
}

export function rotateNativeDeviceSession({
  deviceId,
  refreshToken,
  serverOrigin = 'madar://server',
  database = db,
}) {
  if (!deviceId || typeof deviceId !== 'string' || !refreshToken || typeof refreshToken !== 'string') {
    throw new HttpError(400, 'Device ID and refresh token are required.');
  }
  const cleanDeviceId = deviceId.trim().slice(0, 128);
  const tokenHash = hashToken(refreshToken.trim());

  // 1. Look up active session matching this token hash and device
  const session = database.prepare(`
    SELECT s.*, u.username, u.full_name, u.role, u.active, u.deleted_at, u.locked_until
    FROM native_device_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.refresh_token_hash = ? AND s.device_id = ?
    LIMIT 1
  `).get(tokenHash, cleanDeviceId);

  if (!session) {
    // 2. Check if this token was already rotated in the token family (reuse detection!)
    const historical = database.prepare(`
      SELECT session_id, family_id, generation
      FROM native_device_session_tokens
      WHERE token_hash = ?
      LIMIT 1
    `).get(tokenHash);

    if (historical) {
      // Immediate durable update outside a rolling-back block
      database.prepare(`
        UPDATE native_device_sessions
        SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'token_reuse_detected'
        WHERE token_family_id = ? AND revoked_at IS NULL
      `).run(historical.family_id);

      throw new HttpError(401, 'تم اكتشاف محاولة إعادة استخدام رمز أمان. تم إلغاء جلسة الجهاز للحماية.');
    }

    throw new HttpError(401, 'رمز التحديث غير صالح أو انتهت صلاحيته.');
  }

  if (session.revoked_at) {
    throw new HttpError(401, 'تم إلغاء جلسة هذا الجهاز. يرجى تسجيل الدخول من جديد.');
  }

  if (new Date(session.refresh_expires_at).getTime() <= Date.now()) {
    database.prepare(`
      UPDATE native_device_sessions
      SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'refresh_token_expired'
      WHERE id = ?
    `).run(session.id);
    throw new HttpError(401, 'انتهت صلاحية جلسة الجهاز. يرجى تسجيل الدخول مجددًا بالخادم.');
  }

  if (session.deleted_at || Number(session.active) !== 1 || session.role !== 'rep') {
    database.prepare(`
      UPDATE native_device_sessions
      SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'user_disabled'
      WHERE id = ?
    `).run(session.id);
    throw new HttpError(403, 'حساب المندوب معطّل أو غير متاح.');
  }

  if (session.locked_until && Date.parse(session.locked_until) > Date.now()) {
    throw new HttpError(423, 'الحساب مقفل مؤقتاً بسبب تكرار المحاولات الخاطئة.');
  }

  const newRefreshToken = randomBytes(32).toString('hex');
  const newHash = hashToken(newRefreshToken);
  const nextGeneration = Number(session.family_generation) + 1;

  const now = Date.now();
  const offlineLeaseExpiresAt = new Date(now + OFFLINE_LEASE_DAYS * 24 * 3600 * 1000).toISOString();
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_DAYS * 24 * 3600 * 1000).toISOString();

  const user = {
    id: Number(session.user_id),
    username: session.username,
    full_name: session.full_name,
    role: session.role,
  };
  const accessToken = createSession(user, database);
  const offlineLease = issueOfflineLease(user, cleanDeviceId, serverOrigin);

  database.transaction(() => {
    database.prepare(`
      UPDATE native_device_sessions
      SET refresh_token_hash = ?,
          family_generation = ?,
          last_used_at = CURRENT_TIMESTAMP,
          offline_lease_expires_at = ?,
          refresh_expires_at = ?
      WHERE id = ?
    `).run(
      newHash,
      nextGeneration,
      offlineLeaseExpiresAt,
      refreshExpiresAt,
      session.id
    );

    database.prepare(`
      INSERT INTO native_device_session_tokens (
        token_hash, session_id, family_id, generation, created_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(newHash, session.id, session.token_family_id, nextGeneration);
  })();

  return {
    success: true,
    deviceSessionId: session.id,
    token: accessToken,
    refreshToken: newRefreshToken,
    offlineLease,
    policy: {
      offlineLeaseDurationDays: OFFLINE_LEASE_DAYS,
      refreshTokenDurationDays: REFRESH_TOKEN_DAYS,
      tokenType: 'Bearer',
    },
  };
}

export function revokeDeviceSession({ deviceSessionId, userId = null, reason = 'user_logout', database = db }) {
  if (!deviceSessionId) return false;
  const whereUser = userId ? ' AND user_id = ?' : '';
  const params = userId ? [reason, deviceSessionId, userId] : [reason, deviceSessionId];
  const res = database.prepare(`
    UPDATE native_device_sessions
    SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = ?
    WHERE id = ? AND revoked_at IS NULL ${whereUser}
  `).run(...params);
  return res.changes > 0;
}

export function revokeAllUserDeviceSessions({ userId, reason = 'password_change', database = db }) {
  if (!userId) return false;
  const res = database.prepare(`
    UPDATE native_device_sessions
    SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = ?
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(reason, userId);
  return res.changes > 0;
}
