import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-release-'));
const apkPath = join(temporaryDirectory, 'madar-rep-release.apk');
const SIGNER_SHA256 = 'c'.repeat(64);
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'release.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_OFFLINE_MAP_PATH = join(temporaryDirectory, 'local-map.mbtiles');
process.env.MADAR_V2_OFFLINE_MAPS_DIR = '';
process.env.MADAR_REP_APK_PATH = apkPath;
process.env.MADAR_REP_TRANSITION_APK_PATH = join(temporaryDirectory, 'madar-rep-transition.apk');
process.env.MADAR_REP_SIGNER_CERT_SHA256 = SIGNER_SHA256;
process.env.STORAGE_MOUNT_PATH = '';
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

function writeReleaseArtifact(bytes, { versionCode = 20, versionName = '2.4.0' } = {}) {
  writeFileSync(apkPath, bytes);
  writeFileSync(`${apkPath}.manifest.json`, JSON.stringify({
    sourceRevision: 'a'.repeat(40),
    sourceTreeDirty: false,
    builtAt: new Date().toISOString(),
    versionCode,
    versionName,
    buildType: 'release',
    apkSha256: createHash('sha256').update(bytes).digest('hex'),
    signerCertificateSha256: SIGNER_SHA256,
  }));
}

async function request(path, options = {}, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return {
    response,
    body: await response.json(),
    cookie: (response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '').split(';', 1)[0],
  };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('APK distribution is governed by the recorded release registry', async () => {
  const original = Buffer.from('synthetic-signed-release-apk-v20');
  writeReleaseArtifact(original);
  writeFileSync(process.env.MADAR_REP_TRANSITION_APK_PATH, Buffer.from('synthetic-transition-apk'));

  const setup = await request('/api/auth/setup', jsonOptions('POST', {
    username: 'release-admin',
    fullName: 'Release Administrator',
    password: 'Release-Administrator-2026!',
  }));
  assert.equal(setup.response.status, 201);
  const adminCookie = setup.cookie;
  assert.ok(adminCookie.startsWith('madar_token='));

  const unrecordedStatus = await request('/download/apk/status', {}, adminCookie);
  assert.equal(unrecordedStatus.response.status, 200);
  assert.equal(unrecordedStatus.body.available, false);
  assert.equal(unrecordedStatus.body.reason, 'release_not_recorded');
  assert.deepEqual(unrecordedStatus.body.releaseRegistry, {
    recorded: false,
    status: 'unrecorded',
    versionCode: 20,
    versionName: '2.4.0',
    publishedAt: null,
  });
  assert.equal(unrecordedStatus.body.releaseMetadata.versionName, '2.4.0');
  const unrecordedDownload = await fetch(`${baseUrl}/download/apk`, { headers: { cookie: adminCookie } });
  assert.equal(unrecordedDownload.status, 503, 'an unrecorded release artifact must not be distributed');

  const publish = await request('/api/system/rep-releases/publish', jsonOptions('POST', { notes: 'اختبار التوزيع' }), adminCookie);
  assert.equal(publish.response.status, 201);
  assert.equal(publish.body.release.versionCode, 20);
  assert.equal(publish.body.release.status, 'available');
  const releaseId = Number(publish.body.release.id);

  const recordedStatus = await request('/download/apk/status', {}, adminCookie);
  assert.equal(recordedStatus.body.available, true);
  assert.equal(recordedStatus.body.reason, undefined);
  assert.equal(recordedStatus.body.releaseRegistry.recorded, true);
  assert.equal(recordedStatus.body.releaseRegistry.status, 'available');
  const recordedDownload = await fetch(`${baseUrl}/download/apk`, { headers: { cookie: adminCookie } });
  assert.equal(recordedDownload.status, 200);
  assert.deepEqual(Buffer.from(await recordedDownload.arrayBuffer()), original);

  // Rebuilding the artifact bytes under the same version code invalidates the
  // recorded digest, so distribution must stop instead of trusting the version.
  const rebuilt = Buffer.from('rebuilt-release-apk-same-version-code');
  writeReleaseArtifact(rebuilt);
  const mismatchStatus = await request('/download/apk/status', {}, adminCookie);
  assert.equal(mismatchStatus.body.available, false);
  assert.equal(mismatchStatus.body.reason, 'release_artifact_mismatch');
  assert.equal(mismatchStatus.body.releaseRegistry.recorded, false);
  assert.equal(mismatchStatus.body.releaseRegistry.status, 'mismatch');
  const mismatchDownload = await fetch(`${baseUrl}/download/apk`, { headers: { cookie: adminCookie } });
  assert.equal(mismatchDownload.status, 503);

  writeReleaseArtifact(original);
  const restoredStatus = await request('/download/apk/status', {}, adminCookie);
  assert.equal(restoredStatus.body.available, true);

  const withdraw = await request(`/api/system/rep-releases/${releaseId}/withdraw`, jsonOptions('POST', {}), adminCookie);
  assert.equal(withdraw.response.status, 200);
  assert.equal(withdraw.body.release.status, 'withdrawn');
  const withdrawnStatus = await request('/download/apk/status', {}, adminCookie);
  assert.equal(withdrawnStatus.body.available, false);
  assert.equal(withdrawnStatus.body.reason, 'release_withdrawn');
  assert.equal(withdrawnStatus.body.releaseRegistry.status, 'withdrawn');
  const withdrawnDownload = await fetch(`${baseUrl}/download/apk`, { headers: { cookie: adminCookie } });
  assert.equal(withdrawnDownload.status, 410, 'a withdrawn release must not be downloadable');
  assert.equal((await withdrawnDownload.json()).code, 'RELEASE_WITHDRAWN');
});
