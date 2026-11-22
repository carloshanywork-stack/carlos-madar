import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-device-session-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'device-session.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY_HOPS = '1';

const [
  { app },
  { db },
  { initializeDatabase },
  { enrollNativeDeviceSession, rotateNativeDeviceSession, verifyOfflineLease, revokeDeviceSession },
  { verifyToken },
] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/auth/device-session.js'),
  import('../server/modules/auth/service.js'),
]);

initializeDatabase({ initialAdminPassword: '' });

// Insert a test representative user
const passwordHash = bcrypt.hashSync('Secret123!', 10);
const insertResult = db.prepare(`
  INSERT INTO users (username, password_hash, full_name, role, active)
  VALUES ('test_rep', ?, 'مندوب اختبار', 'rep', 1)
`).run(passwordHash);
const testRepId = Number(insertResult.lastInsertRowid);
const testUser = { id: testRepId, username: 'test_rep', full_name: 'مندوب اختبار', role: 'rep' };

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      connection: 'close',
      'Content-Type': 'application/json',
      'X-App-Version-Code': '38',
      ...(options.headers ?? {}),
    },
  });
  return {
    response,
    body: await response.json(),
  };
}

test('enrollNativeDeviceSession issues tokens and a signed offline lease bound to device', () => {
  const deviceId = 'android-test-device-uuid-1';
  const enrollment = enrollNativeDeviceSession({
    user: testUser,
    deviceId,
    deviceName: 'Oppo Reno 6',
    appVersion: '2.5.6',
    serverOrigin: 'https://madar.example.com',
    database: db,
  });

  assert.ok(enrollment.deviceSessionId);
  assert.ok(enrollment.token);
  assert.ok(enrollment.refreshToken);
  assert.ok(enrollment.offlineLease);
  assert.equal(enrollment.policy.offlineLeaseDurationDays, 14);

  // Validate the access token
  const verifiedUser = verifyToken(enrollment.token, db);
  assert.equal(verifiedUser.id, testRepId);

  // Validate the offline lease
  const claims = verifyOfflineLease(enrollment.offlineLease, deviceId);
  assert.ok(claims);
  assert.equal(claims.sub, testRepId);
  assert.equal(claims.deviceId, deviceId);
  assert.equal(claims.role, 'rep');
  assert.equal(claims.type, 'offline_lease');

  // Verify lease is rejected for a different device ID
  const wrongDeviceClaims = verifyOfflineLease(enrollment.offlineLease, 'wrong-device-id');
  assert.equal(wrongDeviceClaims, null);
});

test('HTTP POST /api/rep/login with deviceId enrolls native device session', async () => {
  const { response, body } = await request('/api/rep/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'test_rep',
      password: 'Secret123!',
      deviceId: 'android-phone-oppo-99',
      deviceName: 'Oppo Find X',
      appVersion: '2.5.6',
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.token);
  assert.ok(body.refreshToken);
  assert.ok(body.offlineLease);
  assert.ok(body.deviceSessionId);
  assert.equal(body.rep.id, testRepId);
});

test('rotateNativeDeviceSession rotates refresh token and issues new access token', () => {
  const deviceId = 'android-rotation-device-uuid';
  const enrollment = enrollNativeDeviceSession({
    user: testUser,
    deviceId,
    database: db,
  });

  const firstRefreshToken = enrollment.refreshToken;
  const rotation = rotateNativeDeviceSession({
    deviceId,
    refreshToken: firstRefreshToken,
    database: db,
  });

  assert.equal(rotation.success, true);
  assert.ok(rotation.token);
  assert.ok(rotation.refreshToken);
  assert.notEqual(rotation.refreshToken, firstRefreshToken);
  assert.ok(rotation.offlineLease);

  // Rotating again with new token succeeds
  const secondRotation = rotateNativeDeviceSession({
    deviceId,
    refreshToken: rotation.refreshToken,
    database: db,
  });
  assert.equal(secondRotation.success, true);
  assert.notEqual(secondRotation.refreshToken, rotation.refreshToken);
});

test('replay attack detection: using an already-used refresh token revokes the entire family', () => {
  const deviceId = 'android-theft-device-uuid';
  const enrollment = enrollNativeDeviceSession({
    user: testUser,
    deviceId,
    database: db,
  });

  const staleToken = enrollment.refreshToken;

  // Legitimate client rotates the token
  const rotation = rotateNativeDeviceSession({
    deviceId,
    refreshToken: staleToken,
    database: db,
  });
  assert.equal(rotation.success, true);

  // Attacker attempts to use staleToken
  assert.throws(
    () => {
      rotateNativeDeviceSession({
        deviceId,
        refreshToken: staleToken,
        database: db,
      });
    },
    (err) => err.status === 401 && err.message.includes('إعادة استخدام رمز أمان')
  );

  // Further attempts by legitimate client with latest token also fail because family was revoked
  assert.throws(
    () => {
      rotateNativeDeviceSession({
        deviceId,
        refreshToken: rotation.refreshToken,
        database: db,
      });
    },
    (err) => err.status === 401 && err.message.includes('تم إلغاء جلسة')
  );
});

test('HTTP POST /api/rep/refresh endpoint rotates credentials', async () => {
  // First enroll via login
  const loginRes = await request('/api/rep/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'test_rep',
      password: 'Secret123!',
      deviceId: 'android-http-refresh-device',
    }),
  });
  assert.equal(loginRes.response.status, 200);
  const { refreshToken } = loginRes.body;

  // Now refresh
  const refreshRes = await request('/api/rep/refresh', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: 'android-http-refresh-device',
      refreshToken,
    }),
  });

  assert.equal(refreshRes.response.status, 200);
  assert.equal(refreshRes.body.success, true);
  assert.ok(refreshRes.body.token);
  assert.ok(refreshRes.body.refreshToken);
  assert.notEqual(refreshRes.body.refreshToken, refreshToken);
});

test('revokeDeviceSession revokes the session preventing further refresh', () => {
  const deviceId = 'android-revoke-test-device';
  const enrollment = enrollNativeDeviceSession({
    user: testUser,
    deviceId,
    database: db,
  });

  const revoked = revokeDeviceSession({
    deviceSessionId: enrollment.deviceSessionId,
    userId: testRepId,
    reason: 'test_logout',
    database: db,
  });
  assert.equal(revoked, true);

  assert.throws(
    () => {
      rotateNativeDeviceSession({
        deviceId,
        refreshToken: enrollment.refreshToken,
        database: db,
      });
    },
    (err) => err.status === 401 && err.message.includes('تم إلغاء جلسة')
  );
});
