import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test, { after } from 'node:test';
import sharp from 'sharp';
import { applyPendingMachineLocations } from '../client/src/modules/rep/location-review.js';

const root = mkdtempSync(join(tmpdir(), 'madar-location-approval-'));
process.env.MADAR_V2_DATABASE_PATH = join(root, 'test.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(root, 'storage');
process.env.MADAR_V2_DATA_DIR = join(root, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
const { app } = await import('../server/app.js');
const { db } = await import('../server/database/connection.js');
const { initializeDatabase } = await import('../server/database/init.js');
initializeDatabase({ initialAdminPassword: 'Location-Admin-2026!' });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(root, { recursive: true, force: true });
});
async function request(path, cookie, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const admin = (await request('/api/auth/login', null, { username: 'admin', password: 'Location-Admin-2026!' })).cookie;
async function makeRep() {
  const username = `location-${randomUUID().slice(0, 8)}`;
  const password = 'Location-Rep-2026!';
  const created = await request('/api/users', admin, { username, password, full_name: username, role: 'rep', assignedRegions: ['Cairo'] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const login = await request('/api/rep/login', null, { username, password });
  assert.equal(login.status, 200);
  return { id: created.body.id, username, cookie: login.cookie };
}
const owner = await makeRep();
const other = await makeRep();
let sequence = 0;
function fixture() {
  const code = `LOC-${++sequence}`;
  const clientId = Number(db.prepare('INSERT INTO clients (code, name) VALUES (?, ?)').run(code, code).lastInsertRowid);
  const orderId = Number(db.prepare("INSERT INTO maintenance_orders (order_code, client_id, area, status) VALUES (?, ?, 'Cairo', 'in_progress')").run(code, clientId).lastInsertRowid);
  db.prepare('INSERT INTO maintenance_order_reps (order_id,user_id) VALUES (?,?)').run(orderId, owner.id);
  const machineId = Number(db.prepare("INSERT INTO machines (code,name_ar,area) VALUES (?,?,'Cairo')").run(code, code).lastInsertRowid);
  const cardId = Number(db.prepare('INSERT INTO maintenance_cards (order_id,machine_id) VALUES (?,?)').run(orderId, machineId).lastInsertRowid);
  const payload = { actionUuid: randomUUID(), cardId, location: { latitude: 30.0444, longitude: 31.2357, accuracy: 9, updatedAt: new Date().toISOString() } };
  return { code, machineId, cardId, orderId, payload,
    submit: (body = payload, cookie = owner.cookie) => request(`/api/rep/machines/${machineId}/confirm-location`, cookie, body),
  };
}
const decide = (id, decision, body = {}, cookie = admin) => request(`/api/supervisor/corrections/${id}/${decision}`, cookie, body);
const machine = (id) => db.prepare('SELECT latitude,longitude,is_location_locked FROM machines WHERE id=?').get(id);
async function routeCard(cardId) {
  const response = await request(`/api/rep/today-route?username=${owner.username}`, owner.cookie);
  assert.equal(response.status, 200);
  return response.body.regions.flatMap((region) => region.machines).find((item) => item.cardId === cardId);
}

test('location submission is pending, scoped, validated and idempotent', async () => {
  const f = fixture();
  for (const location of [null, { ...f.payload.location, latitude: null }, { ...f.payload.location, longitude: null }, { ...f.payload.location, accuracy: 101 }]) {
    assert.equal((await f.submit({ ...f.payload, location })).status, 400);
  }
  assert.equal((await f.submit(f.payload, other.cookie)).status, 403);
  db.prepare("UPDATE machines SET area='Outside' WHERE id=?").run(f.machineId);
  assert.equal((await f.submit()).status, 403);
  db.prepare("UPDATE machines SET area='Cairo' WHERE id=?").run(f.machineId);
  const first = await f.submit();
  assert.equal(first.status, 201);
  assert.equal(first.body.status, 'pending');
  assert.equal(first.body.machine.latitude, null);
  assert.deepEqual(machine(f.machineId), { latitude: null, longitude: null, is_location_locked: 0 });
  assert.equal((await f.submit()).body.correctionId, first.body.correctionId);
  assert.equal((await f.submit({ ...f.payload, location: { ...f.payload.location, latitude: 31 } })).status, 409);
  const own = await request('/api/rep/location-confirmations', owner.cookie);
  const proposal = own.body.requests.find((item) => item.id === first.body.correctionId);
  assert.equal(proposal.actionUuid, f.payload.actionUuid);
  assert.deepEqual(proposal.proposedLocation, f.payload.location);
  assert.equal(proposal.approvedLocation, null);
  assert.equal((await request('/api/rep/location-confirmations', other.cookie)).body.requests.some((item) => item.id === proposal.id), false);
  assert.equal((await request('/api/supervisor/location-confirmations', owner.cookie)).status, 403);
  assert.equal((await decide(proposal.id, 'approve', {}, owner.cookie)).status, 403);
  assert.equal((await decide(proposal.id, 'reject', {}, other.cookie)).status, 403);
  const card = await routeCard(f.cardId);
  assert.equal(card.canVisit, false);
  assert.equal(card.locationConfirmation.id, proposal.id);
  assert.equal(card.latitude, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM machine_correction_requests WHERE action_uuid=?').get(f.payload.actionUuid).n, 1);
});

test('location rejection preserves coordinates, retry history, and permits a new proposal', async () => {
  const f = fixture();
  const id = (await f.submit()).body.correctionId;
  const note = { note: 'Wrong entrance; submit corrected coordinates.' };
  assert.equal((await decide(id, 'reject', note)).status, 200);
  assert.equal((await decide(id, 'reject', note)).body.idempotent, true);
  assert.equal((await decide(id, 'approve')).status, 409);
  assert.equal((await decide(id, 'reject', { note: 'changed' })).status, 409);
  assert.equal((await f.submit()).body.status, 'rejected');
  const rejected = await routeCard(f.cardId);
  assert.equal(rejected.locationConfirmation.reviewNote, note.note);
  assert.equal(rejected.canVisit, true); // opens the proposal form, not photo capture
  assert.deepEqual(machine(f.machineId), { latitude: null, longitude: null, is_location_locked: 0 });
  const next = await f.submit({ ...f.payload, actionUuid: randomUUID(), location: { ...f.payload.location, latitude: 30.05 } });
  assert.equal(next.status, 201);
  assert.notEqual(next.body.correctionId, id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM machine_correction_reviews WHERE correction_id=?').get(id).n, 1);
});

test('location decisions serialize concurrent conflicts and publish only once', async () => {
  const f = fixture();
  const id = (await f.submit()).body.correctionId;
  const results = await Promise.all([decide(id, 'approve'), decide(id, 'reject')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const winner = results.find((r) => r.status === 200).body.status;
  assert.equal((await decide(id, winner === 'approved' ? 'approve' : 'reject')).body.idempotent, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM machine_correction_reviews WHERE correction_id=?').get(id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='machine_correction_request' AND entity_id=? AND action LIKE 'machine_location_confirmation_%'").get(id).n, 1);
  const events = db.prepare("SELECT payload_json FROM operations_events WHERE event_type='rep.machine.location-reviewed' AND json_extract(payload_json,'$.correctionId')=?").all(id);
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0].payload_json).userId, owner.id);
});

test('failed location audit rolls back coordinates and review without publishing a decision', async () => {
  const f = fixture();
  const id = (await f.submit()).body.correctionId;
  db.exec(`CREATE TRIGGER location_audit_failure BEFORE INSERT ON audit_log
    WHEN NEW.action = 'machine_location_confirmation_approved' AND NEW.entity_id = ${id}
    BEGIN SELECT RAISE(ABORT, 'isolated location audit failure'); END`);
  try { assert.equal((await decide(id, 'approve')).status, 500); }
  finally { db.exec('DROP TRIGGER location_audit_failure'); }
  assert.equal(machine(f.machineId).is_location_locked, 0);
  assert.equal(db.prepare('SELECT status FROM machine_correction_requests WHERE id=?').get(id).status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM machine_correction_reviews WHERE correction_id=?').get(id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM operations_events WHERE event_type='rep.machine.location-reviewed' AND json_extract(payload_json,'$.correctionId')=?").get(id).n, 0);
  assert.equal((await decide(id, 'approve')).status, 200);
});

test('client proposal states preserve approved coordinates and separate rejection from resubmission', () => {
  const request = { id: 1, actionUuid: 'old', status: 'rejected', reviewNote: 'Wrong site', proposedLocation: { latitude: 30, longitude: 31 } };
  const card = { machineId: 1, canVisit: true, latitude: null, longitude: null, approvedLocation: null, isLocationLocked: false, locationConfirmation: request };
  const route = { regions: [{ machines: [card] }] };
  const rejected = applyPendingMachineLocations(route).regions[0].machines[0];
  assert.equal(rejected.locationReviewState, 'rejected');
  assert.equal(rejected.latitude, null);
  assert.equal(rejected.canVisit, true);
  const pending = applyPendingMachineLocations(route, [{ machineId: 1, type: 'confirm_location', actionUuid: 'new', status: 'queued', payload: { location: { latitude: 32, longitude: 33 } } }]).regions[0].machines[0];
  assert.equal(pending.locationReviewState, 'queued');
  assert.equal(pending.latitude, null);
  assert.equal(pending.locationConfirmation.proposedLocation.latitude, 32);
  assert.equal(pending.canVisit, false);
  const serverPending = { ...card, locationConfirmation: { ...request, status: 'pending' } };
  assert.equal(applyPendingMachineLocations({ regions: [{ machines: [serverPending] }] }).regions[0].machines[0].locationReviewState, 'pending_approval');
  const oldCache = { ...card, latitude: 0, longitude: 0, isLocationLocked: true };
  delete oldCache.approvedLocation;
  assert.equal(applyPendingMachineLocations({ regions: [{ machines: [oldCache] }] }).regions[0].machines[0].latitude, null);
});

test('location approval survives application restart and reconciles a stale route snapshot', async () => {
  const f = fixture();
  const id = (await f.submit()).body.correctionId;
  assert.equal((await decide(id, 'approve')).status, 200);
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { getRepTodayRoute } = await import('./server/modules/rep/service.js');
    const { db } = await import('./server/database/connection.js');
    console.log(JSON.stringify(getRepTodayRoute({id:${owner.id}, assignedRegions:['Cairo']})));
    db.close();
  `], { cwd: new URL('..', import.meta.url), env: process.env, encoding: 'utf8' });
  const route = JSON.parse(output.trim());
  const action = { ...f, type: 'confirm_location', actionUuid: f.payload.actionUuid, status: 'queued' };
  const reconciled = applyPendingMachineLocations(route, [action]).regions.flatMap((r) => r.machines).find((m) => m.cardId === f.cardId);
  assert.equal(reconciled.locationReviewState, 'approved');
  assert.equal(reconciled.isLocationLocked, true);
  assert.equal(reconciled.canVisit, true);
  assert.equal(reconciled.latitude, f.payload.location.latitude);
  const legacyCache = { regions: [{ machines: [{ machineId: f.machineId, locationConfirmationPending: true, isLocationLocked: true, latitude: 0, longitude: 0 }] }] };
  const restored = applyPendingMachineLocations(JSON.parse(JSON.stringify(legacyCache)), [action]).regions[0].machines[0];
  assert.equal(restored.latitude, null);
  assert.equal(restored.isLocationLocked, false);
  assert.equal(restored.canVisit, false);
});

test('visit upload is rejected before location approval and succeeds after approval', async () => {
  const f = fixture();
  const id = (await f.submit()).body.correctionId;
  const photo = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer();
  const now = Date.now();
  const visitUuid = randomUUID();
  const visit = { visitUuid, cardId: f.cardId, machineCode: f.code, regionName: 'Cairo', machineCondition: 'working', reasonIds: [],
    capturedAt: new Date(now).toISOString(), location: f.payload.location,
    beforeCapturedAt: [8, 7, 6].map((m) => new Date(now - m * 60000).toISOString()),
    afterCapturedAt: [3, 2, 1].map((m) => new Date(now - m * 60000).toISOString()),
  };
  const send = async () => {
    const form = new FormData(); form.append('visit', JSON.stringify(visit));
    for (const phase of ['before', 'after']) for (let i = 0; i < 3; i++) form.append(`${phase}Photo`, new Blob([photo], { type: 'image/jpeg' }), `${phase}-${i}.jpg`);
    const response = await fetch(base + '/api/rep/sync-visit', { method: 'POST', headers: { cookie: owner.cookie }, body: form });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await send()).status, 409);
  assert.equal((await decide(id, 'approve')).status, 200);
  const uploaded = await send();
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.status, 'pending_review');
  assert.equal(db.prepare('SELECT status FROM rep_visits WHERE visit_uuid=?').get(visitUuid).status, 'completed');
});
