import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-auto-diagnostics-'));
const storage = join(temporaryDirectory, 'storage');
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'diagnostics.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = storage;
process.env.MADAR_V2_JWT_SECRET = 'automatic-diagnostic-integration-test-secret';
process.env.MADAR_REP_MIN_SUPPORTED_VERSION_CODE = '0';
process.env.STORAGE_MOUNT_PATH = '';
process.env.MADAR_V2_BACKUP_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';

const [{ app }, { db }, { initializeDatabase }, { createSession }] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/auth/service.js'),
]);
initializeDatabase({ initialAdminPassword: '' });

function account(username, role) {
  const saved = db.prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, 'fixture', ?, ?)`)
    .run(username, username, role);
  return createSession({ id: Number(saved.lastInsertRowid), role });
}

const rep = account('diagnostic-test-rep', 'rep');
const otherRep = account('diagnostic-test-other-rep', 'rep');
const admin = account('diagnostic-test-admin', 'admin');
// The support router recognizes supervisor sessions, including on databases provisioned with that role.
db.pragma('ignore_check_constraints = ON');
const supervisor = account('diagnostic-test-supervisor', 'supervisor');
db.pragma('ignore_check_constraints = OFF');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const repPath = '/api/rep/support/diagnostics';
const adminPath = '/api/system/rep-support/diagnostics';

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function request(path, token, payload) {
  return fetch(`${origin}${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

function diagnostic() {
  return {
    reportUuid: randomUUID(),
    operation: 'visit_sync',
    failureCode: 'server',
    httpStatus: 503,
    occurredAt: '2026-11-24T12:02:58.123456Z',
    appVersion: '2.5.11',
    versionCode: 43,
    androidVersion: 34,
  };
}

test('automatic diagnostics accept structured incidents, deduplicate retries, and protect the local JSON archive', async () => {
  const payload = { ...diagnostic(), failureCode: 'rejected', httpStatus: 409 };
  assert.equal((await request(repPath, null, payload)).status, 401);
  assert.equal((await request(repPath, rep, { ...payload, logs: 'password=fixture' })).status, 400);
  assert.equal((await request(repPath, rep, { ...payload, failureCode: 'password=fixture' })).status, 400);

  const responses = await Promise.all([request(repPath, rep, payload), request(repPath, rep, payload)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const reports = await Promise.all(responses.map((response) => response.json().then((body) => body.report)));
  assert.equal(reports[0].id, reports[1].id);
  assert.deepEqual(reports.map((report) => report.idempotent).sort(), [false, true]);
  assert.equal(reports[0].status, 'received');
  assert.equal((await request(repPath, otherRep, payload)).status, 409);
  assert.equal((await request(repPath, rep, { ...payload, failureCode: 'network' })).status, 409);

  const downloadPath = `${adminPath}/${reports[0].id}/report.json`;
  for (const restrictedUser of [rep, supervisor]) {
    assert.equal((await request(adminPath, restrictedUser)).status, 403);
    assert.equal((await request(downloadPath, restrictedUser)).status, 403);
  }
  const list = await (await request(adminPath, admin)).json();
  assert.equal(list.reports.length, 1);
  const archivedReport = list.reports[0];
  assert.equal(archivedReport.occurredAt, '2026-11-24T12:02:58.123Z');
  const folder = join(storage, 'rep-support', 'diagnostics', archivedReport.receivedAt.slice(0, 10));
  const files = readdirSync(folder);
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, files[0]), 'utf8')), archivedReport);
  const download = await request(downloadPath, admin);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment; filename="madar-diagnostic-\d+\.json"$/);
  assert.deepEqual(await download.json(), archivedReport);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rep_bug_reports').get().count, 0);
});

test('a filesystem failure keeps the incident hidden until a safe retry archives it', async () => {
  const diagnostics = join(storage, 'rep-support', 'diagnostics');
  const saved = `${diagnostics}-saved`;
  const unrelated = join(temporaryDirectory, 'unrelated');
  mkdirSync(unrelated);
  mkdirSync(diagnostics, { recursive: true });
  renameSync(diagnostics, saved);
  symlinkSync(unrelated, diagnostics, 'dir');
  const payload = diagnostic();
  try {
    assert.equal((await request(repPath, rep, payload)).status, 503);
    assert.deepEqual(readdirSync(unrelated), []);
    const list = await (await request(adminPath, admin)).json();
    assert.equal(list.reports.some((report) => report.reportUuid === payload.reportUuid), false);
  } finally {
    unlinkSync(diagnostics);
    renameSync(saved, diagnostics);
  }
  const retry = await request(repPath, rep, payload);
  assert.equal(retry.status, 200);
  const { report } = await retry.json();
  assert.equal((await request(`${adminPath}/${report.id}/report.json`, admin)).status, 200);
});
