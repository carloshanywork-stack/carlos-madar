import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import yauzl from 'yauzl';

const root = mkdtempSync(join(tmpdir(), 'madar-archive-review-'));
process.env.MADAR_V2_DATABASE_PATH = join(root, 'test.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(root, 'storage');
process.env.MADAR_V2_DATA_DIR = join(root, 'data');
process.env.STORAGE_MOUNT_PATH = '';
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
const { app } = await import('../server/app.js');
const { db } = await import('../server/database/connection.js');
const { initializeDatabase, migrateOrderArchiveMonths, migrateMaintenanceCardPhotoReviews } = await import('../server/database/init.js');
const { getRepTodayRoute } = await import('../server/modules/rep/service.js');
initializeDatabase({ initialAdminPassword: 'Archive-Review-Admin-2026!' });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  db.close(); rmSync(root, { recursive: true, force: true });
});
async function request(path, cookie, body, method = body === undefined ? 'GET' : 'POST') {
  const form = body instanceof FormData;
  const response = await fetch(base + path, { method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined && !form ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : Buffer.from(await response.arrayBuffer()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const admin = (await request('/api/auth/login', null, { username: 'admin', password: 'Archive-Review-Admin-2026!' })).cookie;
const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
async function makeRep() {
  const username = 'archive-' + randomUUID().slice(0, 8), password = 'Archive-Review-Rep-2026!';
  const created = await request('/api/users', admin, { username, password, full_name: username, role: 'rep', assignedRegions: [] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { id: created.body.id, username, cookie: (await request('/api/rep/login', null, { username, password })).cookie };
}
const rep = await makeRep(), other = await makeRep();
const jpeg = await sharp({ create: { width: 60, height: 50, channels: 3, background: '#446688' } }).jpeg().toBuffer();
let sequence = 0;
function fixture() {
  const code = `AR-${++sequence}`;
  const clientId = Number(db.prepare('INSERT INTO clients (code,name) VALUES (?,?)').run(code, code).lastInsertRowid);
  const machineId = Number(db.prepare(`INSERT INTO machines (code,name_ar,area,latitude,longitude,is_location_locked)
    VALUES (?,?,'Cairo',30,31,1)`).run(code, code).lastInsertRowid);
  const orderId = Number(db.prepare("INSERT INTO maintenance_orders (order_code,client_id,area,status) VALUES (?,?,'Cairo','in_progress')").run(code, clientId).lastInsertRowid);
  const cardId = Number(db.prepare('INSERT INTO maintenance_cards (order_id,machine_id) VALUES (?,?)').run(orderId, machineId).lastInsertRowid);
  for (const owner of [rep, other]) db.prepare('INSERT INTO maintenance_order_reps (order_id,user_id) VALUES (?,?)').run(orderId, owner.id);
  return { code, clientId, orderId, machineId, cardId };
}
async function upload(f, phase = 'before') {
  const form = new FormData(); form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), phase + '.jpg');
  return request(`/api/maintenance/orders/${f.orderId}/cards/${f.cardId}/photos/${phase}`, admin, form);
}
async function routeCard(f, owner = rep) {
  const r = await request(`/api/rep/today-route?username=${owner.username}`, owner.cookie); assert.equal(r.status, 200);
  return r.body.regions.flatMap((region) => region.machines).find((card) => card.cardId === f.cardId);
}
const reviewRow = f => db.prepare('SELECT * FROM maintenance_card_photo_reviews WHERE card_id=?').get(f.cardId);
const decide = (f, action = 'approve', revision = reviewRow(f).revision, note = undefined, cookie = admin) =>
  request(`/api/supervisor/card-photos/${f.cardId}/review`, cookie, { action, revision, ...(note ? { note } : {}) });
function visitForm(f) {
  const now = new Date().toISOString(), form = new FormData();
  form.append('visit', JSON.stringify({ visitUuid: randomUUID(), cardId: f.cardId, machineCode: f.code,
    regionName: 'Cairo', machineCondition: 'working', reasonIds: [], notes: '', capturedAt: now,
    beforeCapturedAt: [now, now, now], afterCapturedAt: [], location: { latitude: 30, longitude: 31, accuracy: 5, updatedAt: now } }));
  for (let i = 0; i < 3; i++) form.append('beforePhoto', new Blob([jpeg], { type: 'image/jpeg' }), `before-${i}.jpg`);
  return form;
}
function zipXml(buffer) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error); const parts = []; zip.readEntry();
    zip.on('entry', entry => {
      if (!entry.fileName.endsWith('.xml')) return zip.readEntry();
      zip.openReadStream(entry, (e, stream) => { if (e) return reject(e); const chunks = [];
        stream.on('data', c => chunks.push(c)); stream.on('error', reject);
        stream.on('end', () => { parts.push(Buffer.concat(chunks).toString()); zip.readEntry(); }); });
    }); zip.on('end', () => resolve(parts.join('\n'))); zip.on('error', reject);
  }));
}

test('manual photos become durable pending review, stale approvals conflict, approval and reshoot reconcile representative work', async () => {
  const f = fixture(); assert.equal((await routeCard(f)).canVisit, true);
  assert.equal((await upload(f)).status, 201);
  const first = reviewRow(f); assert.equal(first.status, 'pending');
  for (const owner of [rep, other]) {
    const card = await routeCard(f, owner); assert.equal(card.canVisit, false);
    assert.equal(card.isSubmitted, true); assert.equal(card.isCompleted, false); assert.equal(card.reviewStatus, 'pending');
  }
  const queue = await request('/api/supervisor/qa/queue', admin);
  const item = queue.body.visits.find(v => v.cardId === f.cardId);
  assert.equal(item.source, 'office'); assert.equal((await request(item.beforePhotos[0].url, admin)).status, 200);
  assert.equal((await request(item.beforePhotos[0].thumbnailUrl, admin)).status, 200);
  const rejectedVisit = await request('/api/rep/sync-visit', rep.cookie, visitForm(f));
  assert.equal(rejectedVisit.status, 409, JSON.stringify(rejectedVisit.body));
  assert.equal(db.prepare('SELECT count(*) AS n FROM rep_visits WHERE card_id=?').get(f.cardId).n, 0);
  assert.equal((await decide(f, 'approve', first.revision, undefined, rep.cookie)).status, 403);
  assert.equal((await upload(f, 'after')).status, 201);
  assert.equal((await decide(f, 'approve', first.revision)).status, 409);
  assert.equal(db.prepare('SELECT status FROM maintenance_cards WHERE id=?').get(f.cardId).status, 'pending');
  assert.equal((await decide(f)).status, 200);
  assert.equal((await decide(f)).body.idempotent, true);
  assert.equal((await routeCard(f)).isCompleted, true);
  db.prepare("UPDATE audit_log SET created_at=datetime('now','-3 days') WHERE entity_type='maintenance_card' AND entity_id=?").run(f.cardId);
  const fresh = new Database(join(root, 'test.sqlite'), { readonly: true });
  try { assert.equal(getRepTodayRoute({ id: rep.id, assignedRegions: [] }, fresh).regions.flatMap(r => r.machines).find(c => c.cardId === f.cardId).isCompleted, true); }
  finally { fresh.close(); }
  assert.equal((await upload(f)).status, 201); assert.equal((await routeCard(f)).isCompleted, false);
  assert.equal((await decide(f, 'reshoot')).status, 400);
  assert.equal((await decide(f, 'reshoot', reviewRow(f).revision, 'أعد التصوير بوضوح')).status, 200);
  assert.equal((await routeCard(f)).canVisit, true);
  assert.equal((await routeCard(f)).reviewNote, 'أعد التصوير بوضوح');
});

test('bulk approval is atomic across office cards and does not approve stale revisions', async () => {
  const a = fixture(), b = fixture(); await upload(a); await upload(b);
  const stale = reviewRow(b).revision; await upload(b, 'after');
  const first = await request('/api/supervisor/visits/approve-all', admin, { visitIds: [], cardReviews: [
    { cardId: a.cardId, revision: reviewRow(a).revision }, { cardId: b.cardId, revision: stale } ] });
  assert.equal(first.status, 409); assert.equal(reviewRow(a).status, 'pending'); assert.equal(reviewRow(b).status, 'pending');
  const body = { visitIds: [], cardReviews: [a,b].map(f => ({ cardId: f.cardId, revision: reviewRow(f).revision })) };
  const approved = await request('/api/supervisor/visits/approve-all', admin, body);
  assert.equal(approved.status, 200); assert.equal(approved.body.approvedCount, 2);
  const replay = await request('/api/supervisor/visits/approve-all', admin, body);
  assert.equal(replay.body.idempotent, true); assert.equal(replay.body.approvedCount, 0);
});

test('system uploads cannot overwrite a representative visit pending review and failed uploads leave no orphan JPEG', async () => {
  const f = fixture();
  const visit = db.prepare(`INSERT INTO rep_visits (visit_uuid,rep_user_id,order_id,card_id,machine_id,order_code,machine_code,
    region_name,payload_sha256,status,captured_at,staging_path,final_path) VALUES (?,?,?,?,?,?,?,'Cairo',?,'completed',CURRENT_TIMESTAMP,'staging','final')`)
    .run(randomUUID(), rep.id, f.orderId, f.cardId, f.machineId, f.code, f.code, 'a'.repeat(64));
  db.prepare("INSERT INTO rep_visit_reviews (visit_id,status) VALUES (?,'pending')").run(visit.lastInsertRowid);
  const files = () => readdirSync(join(root, 'storage'), { recursive: true }).filter(p => p.endsWith('.jpg')).sort();
  const before = files(); assert.equal((await upload(f)).status, 409); assert.deepEqual(files(), before);
  assert.equal(db.prepare('SELECT before_photos_json FROM maintenance_cards WHERE id=?').get(f.cardId).before_photos_json, '[]');
});

test('archive month is owner-selected, changes are audited without cash effects, and monthly archive/analysis/exports use the selected month', async () => {
  const f = fixture(); await upload(f);
  db.prepare("UPDATE maintenance_orders SET status='review' WHERE id=?").run(f.orderId);
  const deniedArchive = await request(`/api/maintenance/orders/${f.orderId}/archive`, admin, { warrantyPeriodMonths: 3, actualExpensesCents: 0, archiveMonth: '2026-02' });
  assert.equal(deniedArchive.status, 409);
  assert.equal(db.prepare('SELECT status FROM maintenance_orders WHERE id=?').get(f.orderId).status, 'review');
  await decide(f);
  const archived = await request(`/api/maintenance/orders/${f.orderId}/archive`, admin, { warrantyPeriodMonths: 3, actualExpensesCents: 0, archiveMonth: '2026-02' });
  assert.equal(archived.status, 200, JSON.stringify(archived.body)); assert.equal(archived.body.order.archive_month, '2026-02');
  const old = fixture(); db.prepare("UPDATE maintenance_orders SET status='archived',archived_at='2025-12-05 10:00:00' WHERE id=?").run(old.orderId);
  assert.equal(db.prepare('SELECT archive_month FROM maintenance_orders WHERE id=?').get(old.orderId).archive_month, null);
  const unassigned = await request('/api/maintenance/orders?status=archived&month=unassigned', admin);
  assert.equal(unassigned.body.some(o => o.id === old.orderId), true); assert.equal(unassigned.body.some(o => o.id === f.orderId), false);
  const selected = await request('/api/maintenance/orders?status=archived&month=2026-02', admin);
  assert.deepEqual(selected.body.map(o => o.id), [f.orderId]);
  const analysis = await request('/api/maintenance/analysis/areas?month=2026-02', admin);
  assert.equal(analysis.body.find(a => a.area === 'Cairo').completed_count, 1);
  const excel = await request('/api/maintenance/analysis/export.xlsx?month=2026-02', admin);
  const sheet = XLSX.utils.sheet_to_json(XLSX.read(excel.body, { type: 'buffer' }).Sheets['تحليل الصيانة'], { header: 1 });
  assert.equal(sheet[0].includes('شهر الأرشيف'), true); assert.equal(sheet.length, 2); assert.equal(sheet[1].at(-1), '2026-02');
  const pptx = await request('/api/maintenance/export/pptx', admin, { orderIds: [f.orderId, old.orderId], archiveMonth: '2026-02', groupBy: 'area' });
  assert.equal(pptx.status, 200, Buffer.isBuffer(pptx.body) ? '' : JSON.stringify(pptx.body));
  const xml = await zipXml(pptx.body); assert.match(xml, /فبراير 2026/); assert.equal(xml.includes(old.code), false);
  const before = db.prepare('SELECT archived_at,petty_cash_refund_cents,actual_expenses_cents FROM maintenance_orders WHERE id=?').get(f.orderId);
  const cashRows = db.prepare('SELECT count(*) AS n FROM treasury_entries').get().n;
  for (const invalid of ['2026-13','2026-00','2026-02-12','0000-01']) assert.equal((await request(`/api/maintenance/orders/${f.orderId}/archive-month`, admin, { archiveMonth: invalid }, 'PATCH')).status, 400);
  assert.equal((await request(`/api/maintenance/orders/${f.orderId}/archive-month`, rep.cookie, { archiveMonth: '2026-03' }, 'PATCH')).status, 403);
  assert.equal((await request(`/api/maintenance/orders/${f.orderId}/archive-month`, admin, { archiveMonth: '2026-03' }, 'PATCH')).status, 200);
  assert.deepEqual(db.prepare('SELECT archived_at,petty_cash_refund_cents,actual_expenses_cents FROM maintenance_orders WHERE id=?').get(f.orderId), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM treasury_entries').get().n, cashRows);
  assert.equal((await request('/api/maintenance/orders?status=archived&month=2026-02', admin)).body.length, 0);
  const audit = db.prepare("SELECT actor_id,old_values_json,new_values_json FROM audit_log WHERE action='set_archive_month' AND entity_id=? ORDER BY id DESC LIMIT 1").get(f.orderId);
  assert.equal(audit.actor_id, adminId); assert.equal(JSON.parse(audit.old_values_json).archive_month, '2026-02'); assert.equal(JSON.parse(audit.new_values_json).archive_month, '2026-03');
  assert.equal((await request(`/api/maintenance/orders/${f.orderId}/archive-month`, admin, { archiveMonth: null }, 'PATCH')).status, 200);
  await request(`/api/maintenance/orders/${f.orderId}/archive-month`, admin, { archiveMonth: '2026-03' }, 'PATCH');
  assert.equal((await request(`/api/maintenance/orders/${f.orderId}/unarchive`, admin, {})).status, 200);
  await request(`/api/maintenance/orders/${f.orderId}/status`, admin, {}, 'PATCH');
  const rearchived = await request(`/api/maintenance/orders/${f.orderId}/archive`, admin, { warrantyPeriodMonths: 3, actualExpensesCents: 0 });
  assert.equal(rearchived.status, 200, JSON.stringify(rearchived.body)); assert.equal(rearchived.body.order.archive_month, '2026-03');
});

test('archive-month migration is additive, repeatable and leaves historical records unassigned', () => {
  const legacy = new Database(':memory:');
  try {
    legacy.exec(`CREATE TABLE schema_migrations(version TEXT PRIMARY KEY);
      CREATE TABLE maintenance_orders(id INTEGER PRIMARY KEY,status TEXT,deleted_at TEXT,archived_at TEXT);
      CREATE TABLE workshop_orders(id INTEGER PRIMARY KEY,status TEXT,deleted_at TEXT,delivered_at TEXT);
      INSERT INTO maintenance_orders VALUES(77,'archived',NULL,'2020-01-01');
      INSERT INTO workshop_orders VALUES(88,'delivered_archived',NULL,'2020-02-01');`);
    migrateOrderArchiveMonths(legacy);
    assert.equal(legacy.prepare('SELECT archive_month FROM maintenance_orders WHERE id=77').get().archive_month, null);
    assert.equal(legacy.prepare('SELECT archive_month FROM workshop_orders WHERE id=88').get().archive_month, null);
    legacy.prepare("UPDATE maintenance_orders SET archive_month='2026-04' WHERE id=77").run(); migrateOrderArchiveMonths(legacy);
    assert.equal(legacy.prepare('SELECT archive_month FROM maintenance_orders WHERE id=77').get().archive_month, '2026-04');
    assert.throws(() => legacy.exec("UPDATE maintenance_orders SET archive_month='2026-13' WHERE id=77"), /CHECK/);
    assert.equal(legacy.prepare('SELECT archived_at FROM maintenance_orders WHERE id=77').get().archived_at, '2020-01-01');
  } finally { legacy.close(); }
});

test('an office reshoot after an approved field visit allows exactly a new pending field submission', async () => {
  const f = fixture();
  const first = await request('/api/rep/sync-visit', rep.cookie, visitForm(f));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const visitId = db.prepare('SELECT id FROM rep_visits WHERE card_id=? ORDER BY id DESC LIMIT 1').get(f.cardId).id;
  assert.equal((await request(`/api/supervisor/visits/${visitId}/review`, admin, { action: 'approve' })).status, 200);
  assert.equal((await upload(f)).status, 201);
  assert.equal((await decide(f, 'reshoot', reviewRow(f).revision, 'صور إضافية أوضح')).status, 200);
  const next = await request('/api/rep/sync-visit', rep.cookie, visitForm(f));
  assert.equal(next.status, 200, JSON.stringify(next.body)); assert.equal(next.body.status, 'pending_review');
  assert.equal(reviewRow(f).status, 'superseded');
  assert.equal((await request('/api/rep/sync-visit', other.cookie, visitForm(f))).status, 409);
});

test('workshop delivery and historical month corrections filter archive without posting receipts or changing invoice balances', async () => {
  const f = fixture();
  const id = Number(db.prepare(`INSERT INTO workshop_orders (order_code,client_id,product_name,machine_type,status,sale_price_cents)
    VALUES (?,?,'Test Product','manual','ready',1500)`).run('WS-'+f.code, f.clientId).lastInsertRowid);
  const cashBefore = db.prepare('SELECT count(*) AS n FROM treasury_entries').get().n;
  const delivered = await request(`/api/workshop/orders/${id}/deliver`, admin, { archiveMonth: '2026-02' });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body)); assert.equal(delivered.body.order.archive_month, '2026-02');
  const before = await request(`/api/workshop/orders/${id}`, admin);
  const corrected = await request(`/api/workshop/orders/${id}/archive-month`, admin, { archiveMonth: '2026-04' }, 'PATCH');
  assert.equal(corrected.status, 200);
  const after = await request(`/api/workshop/orders/${id}`, admin);
  assert.equal(after.body.delivered_at, before.body.delivered_at);
  assert.deepEqual(after.body.salesInvoice, before.body.salesInvoice);
  assert.equal(db.prepare('SELECT count(*) AS n FROM treasury_entries').get().n, cashBefore);
  assert.equal((await request('/api/workshop/orders?status=delivered_archived&month=2026-02', admin)).body.length, 0);
  assert.equal((await request('/api/workshop/orders?status=delivered_archived&month=2026-04', admin)).body[0].id, id);
});

test('legacy manual photo review migration preserves approved status, pending evidence and stable identifiers without reapplying', () => {
  const legacy = new Database(':memory:');
  try {
    initializeDatabase({ database: legacy, initialAdminPassword: '' });
    legacy.exec(`DROP TABLE maintenance_card_photo_reviews;
      DELETE FROM schema_migrations WHERE version='20261113-manual-card-photo-review';
      INSERT INTO clients(id,code,name) VALUES(51,'LEG-P','Legacy');
      INSERT INTO maintenance_orders(id,order_code,client_id,status) VALUES(61,'LEG-ORDER',51,'in_progress');
      INSERT INTO machines(id,code,name_ar,area) VALUES(71,'LEG-M','Legacy','Cairo');
      INSERT INTO machines(id,code,name_ar,area) VALUES(72,'LEG-M2','Legacy Pending','Cairo');
      INSERT INTO maintenance_cards(id,order_id,machine_id,status,before_photos_json) VALUES(81,61,71,'completed','["legacy/source.jpg"]');
      INSERT INTO maintenance_cards(id,order_id,machine_id,status,before_photos_json) VALUES(82,61,72,'pending','["legacy/pending.jpg"]');`);
    migrateMaintenanceCardPhotoReviews(legacy);
    assert.equal(legacy.prepare('SELECT status FROM maintenance_card_photo_reviews WHERE card_id=81').get().status, 'approved');
    assert.equal(legacy.prepare('SELECT status FROM maintenance_card_photo_reviews WHERE card_id=82').get().status, 'pending');
    legacy.prepare("UPDATE maintenance_card_photo_reviews SET status='approved',revision=7 WHERE card_id=82").run();
    migrateMaintenanceCardPhotoReviews(legacy);
    assert.equal(legacy.prepare('SELECT revision FROM maintenance_card_photo_reviews WHERE card_id=82').get().revision, 7);
    assert.equal(legacy.prepare('SELECT before_photos_json FROM maintenance_cards WHERE id=81').get().before_photos_json, '["legacy/source.jpg"]');
    assert.equal(legacy.pragma('foreign_key_check').length, 0);
  } finally { legacy.close(); }
});
