import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-desktop-dist-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'dist.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_OFFLINE_MAP_PATH = join(temporaryDirectory, 'local-map.mbtiles');
process.env.MADAR_V2_OFFLINE_MAPS_DIR = '';
process.env.MADAR_V2_JWT_SECRET = 'desktop-dist-secret-with-more-than-32-bytes';
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
});

test('desktop status endpoint reports availability', async () => {
  const response = await fetch(`${baseUrl}/download/desktop/status`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof body.available, 'boolean');
  assert.equal(body.downloadUrl, '/download/desktop');
});

test('desktop download route handles missing and present artifacts gracefully', async () => {
  const response = await fetch(`${baseUrl}/download/desktop`);
  assert.ok([200, 404].includes(response.status));
  if (response.status === 200) {
    const contentType = response.headers.get('content-type');
    assert.ok(
      contentType.includes('application/vnd.microsoft.portable-executable') ||
      contentType.includes('application/zip')
    );
    assert.match(response.headers.get('content-disposition') || '', /attachment/);
  }
});

test('desktop download route redirects to CDN when configured', async () => {
  process.env.MADAR_DESKTOP_CDN_URL = 'https://madar-cdn.example/releases/MADAR-Setup.exe';
  try {
    const response = await fetch(`${baseUrl}/download/desktop`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://madar-cdn.example/releases/MADAR-Setup.exe');
  } finally {
    delete process.env.MADAR_DESKTOP_CDN_URL;
  }
});

test('desktop download route serves artifact by filename and rejects path traversal', async () => {
  const statusRes = await fetch(`${baseUrl}/download/desktop/status`);
  const status = await statusRes.json();
  if (status.available && status.filename) {
    const fileRes = await fetch(`${baseUrl}/download/desktop/${status.filename}`);
    assert.equal(fileRes.status, 200);
    assert.match(fileRes.headers.get('content-disposition') || '', new RegExp(status.filename));
  }

  const missingRes = await fetch(`${baseUrl}/download/desktop/non-existent-package.zip`);
  assert.equal(missingRes.status, 404);

  const traversalRes = await fetch(`${baseUrl}/download/desktop/%2e%2e%2fpackage.json`);
  assert.equal(traversalRes.status, 404);
});
