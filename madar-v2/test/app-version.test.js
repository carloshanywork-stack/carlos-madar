import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-app-version-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'app-version.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_OFFLINE_MAP_PATH = join(temporaryDirectory, 'local-map.mbtiles');
process.env.MADAR_V2_OFFLINE_MAPS_DIR = '';
process.env.MADAR_REP_APK_PATH = join(temporaryDirectory, 'missing.apk');
process.env.STORAGE_MOUNT_PATH = '';
process.env.MADAR_V2_BACKUP_MOUNT_PATH = '';
process.env.MADAR_V2_JWT_SECRET = 'version-gate-test-secret-with-more-than-32-bytes';
process.env.MADAR_REP_MIN_SUPPORTED_VERSION_CODE = '19';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [{ app }, { db }, { initializeDatabase }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
]);
initializeDatabase({ initialAdminPassword: '' });

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (db.open) db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
  process.env.MADAR_REP_MIN_SUPPORTED_VERSION_CODE = '0';
});

test('app version endpoint is public and reports the configured minimum', async () => {
  const response = await fetch(`${baseUrl}/api/app-version`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.minSupportedVersionCode, 19);
  assert.equal(body.latestVersionCode, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('outdated and missing client versions are rejected with HTTP 426', async () => {
  for (const version of [undefined, '18', 'not-a-version']) {
    const response = await fetch(`${baseUrl}/api/rep/today-route`, {
      headers: version ? { 'X-App-Version-Code': version } : {},
    });
    const body = await response.json();
    assert.equal(response.status, 426);
    assert.equal(response.headers.get('upgrade'), 'MADAR/19');
    assert.equal(body.code, 'APP_UPDATE_REQUIRED');
    assert.equal(body.minSupportedVersionCode, 19);
    assert.equal(body.apkUrl, '/download/apk');
    assert.equal(body.sha256, null);
    assert.equal(body.releaseNotes, '');
  }
});

test('current client passes the version gate and reaches normal authentication', async () => {
  const response = await fetch(`${baseUrl}/api/rep/today-route`, {
    headers: { 'X-App-Version-Code': '19' },
  });
  assert.equal(response.status, 401);
});

test('login remains available to obsolete clients so they can authenticate and install the update', async () => {
  const response = await fetch(`${baseUrl}/api/rep/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'unknown', password: 'invalid' }),
  });
  assert.equal(response.status, 401);
  assert.notEqual(response.status, 426);
});

test('version enforcement is scoped to representative APIs, not admin/browser APIs', async () => {
  const response = await fetch(`${baseUrl}/api/auth/status`);
  assert.equal(response.status, 200);
});

test('unauthenticated client can access download route without 401 or 403', async () => {
  const response = await fetch(`${baseUrl}/download/apk`);
  // Since missing.apk does not exist in temporaryDirectory, it returns 404 instead of 401/403
  assert.equal(response.status, 404);
  assert.notEqual(response.status, 401);
  assert.notEqual(response.status, 403);
});
