import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-notifications-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'notifications.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [{ app }, { db }, { initializeDatabase }, operationsEvents, notificationService] = await Promise.all([
  import('../server/app.js'),
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/operations-events.js'),
  import('../server/modules/notifications/service.js'),
]);

initializeDatabase({ initialAdminPassword: '' });
const { backfillNotificationsFromEvents } = notificationService;
const { publishOperationsEvent } = operationsEvents;

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

function cookieValue(setCookie) {
  return (setCookie.split(';', 1)[0] ?? '').trim();
}

async function request(path, options = {}, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      connection: 'close',
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  const contentType = response.headers.get('content-type') ?? '';
  return {
    response,
    body: contentType.includes('application/json') ? await response.json() : await response.text(),
    cookie: cookieValue(response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? ''),
  };
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function login(username, password) {
  const result = await request('/api/auth/login', jsonOptions('POST', { username, password }));
  assert.equal(result.response.status, 200, `login failed for ${username}`);
  return result.cookie;
}

async function inbox(cookie) {
  const result = await request('/api/notifications', {}, cookie);
  assert.equal(result.response.status, 200);
  return result.body;
}

async function readSseFrame(response, expectedType) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Operations stream closed before ${expectedType} arrived.`);
    buffer += decoder.decode(value, { stream: true });
    while (buffer.includes('\n\n')) {
      const separator = buffer.indexOf('\n\n');
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(6));
      if (event.type === expectedType) {
        await reader.cancel().catch(() => undefined);
        return event;
      }
    }
  }
}

const state = {
  adminCookie: '',
  adminId: 0,
  salesCookie: '',
  sales2Cookie: '',
  repCookie: '',
  salesId: 0,
  sales2Id: 0,
  repId: 0,
  events: {},
};

test('the inbox exposes unread counts and newest-first notifications per recipient', async () => {
  const anonymous = await request('/api/notifications');
  assert.equal(anonymous.response.status, 401);

  const setup = await request('/api/auth/setup', jsonOptions('POST', {
    fullName: 'Root Administrator',
    username: 'root',
    password: 'Admin-pass-1',
  }));
  assert.equal(setup.response.status, 201);
  state.adminCookie = setup.cookie;
  state.adminId = Number(setup.body.user.id);

  async function createUser(username, fullName, role, password) {
    const created = await request('/api/users', jsonOptions('POST', { username, full_name: fullName, role, password }), state.adminCookie);
    assert.equal(created.response.status, 201, `could not create ${username}`);
    return Number(created.body.id);
  }

  state.salesId = await createUser('sales1', 'Sales One', 'sales', 'Sales-pass-1');
  state.sales2Id = await createUser('sales2', 'Sales Two', 'sales', 'Sales-pass-2');
  state.repId = await createUser('rep1', 'Field Rep', 'rep', 'Rep-pass-1');

  state.salesCookie = await login('sales1', 'Sales-pass-1');
  state.sales2Cookie = await login('sales2', 'Sales-pass-2');
  state.repCookie = await login('rep1', 'Rep-pass-1');

  state.events.visit = publishOperationsEvent('rep.visit.submitted', { userId: state.salesId, repName: 'سالم' });
  state.events.overtime = publishOperationsEvent('overtime.pending', { employeeName: 'أحمد' });
  state.events.attendance = publishOperationsEvent('attendance.changed', { userId: state.sales2Id, action: 'out', repName: 'خالد' });
  state.events.location = publishOperationsEvent('rep.machine.location-reviewed', { userId: state.repId, status: 'approved' });

  const adminInbox = await inbox(state.adminCookie);
  assert.deepEqual(
    adminInbox.notifications.map((item) => item.eventId),
    [state.events.location.id, state.events.attendance.id, state.events.overtime.id, state.events.visit.id],
    'administrators receive every business event, newest first',
  );
  assert.equal(adminInbox.unreadCount, 4);
  for (const notification of adminInbox.notifications) {
    assert.ok(notification.message.length > 0);
    assert.ok(notification.occurredAt);
    assert.equal(notification.read, false);
  }

  const salesInbox = await inbox(state.salesCookie);
  assert.deepEqual(salesInbox.notifications.map((item) => item.eventId), [state.events.visit.id]);
  assert.equal(salesInbox.unreadCount, 1);

  const sales2Inbox = await inbox(state.sales2Cookie);
  assert.deepEqual(sales2Inbox.notifications.map((item) => item.eventId), [state.events.attendance.id]);
  assert.equal(sales2Inbox.unreadCount, 1);

  const repInbox = await inbox(state.repCookie);
  assert.deepEqual(repInbox.notifications.map((item) => item.eventId), [state.events.location.id]);
  assert.equal(repInbox.unreadCount, 1);

  // Repeated reads are stable: a browser refresh sees the same inbox.
  const refreshed = await inbox(state.salesCookie);
  assert.deepEqual(refreshed.notifications, salesInbox.notifications);
  assert.equal(refreshed.unreadCount, salesInbox.unreadCount);
});

test('read and dismiss persist across re-login and stay scoped to their owner', async () => {
  const salesInbox = await inbox(state.salesCookie);
  const own = salesInbox.notifications[0];

  const otherUserRows = await inbox(state.sales2Cookie);
  const other = otherUserRows.notifications[0];

  const foreignRead = await request(`/api/notifications/${other.id}/read`, jsonOptions('POST', {}), state.salesCookie);
  assert.equal(foreignRead.response.status, 404, 'another user cannot mark a notification read');
  const foreignDismiss = await request(`/api/notifications/${other.id}`, { method: 'DELETE' }, state.salesCookie);
  assert.equal(foreignDismiss.response.status, 404, 'another user cannot dismiss a notification');
  const otherStillUnread = await inbox(state.sales2Cookie);
  assert.equal(otherStillUnread.unreadCount, 1);
  assert.equal(otherStillUnread.notifications[0].read, false);

  const read = await request(`/api/notifications/${own.id}/read`, jsonOptions('POST', {}), state.salesCookie);
  assert.equal(read.response.status, 200);
  assert.equal(read.body.unreadCount, 0);
  assert.equal(read.body.notification.read, true);

  const beforeLogout = await inbox(state.salesCookie);
  assert.equal(beforeLogout.unreadCount, 0);
  assert.equal(beforeLogout.notifications[0].read, true);

  await request('/api/auth/logout', jsonOptions('POST', {}), state.salesCookie);
  state.salesCookie = await login('sales1', 'Sales-pass-1');
  const afterLogin = await inbox(state.salesCookie);
  assert.equal(afterLogin.unreadCount, 0);
  assert.equal(afterLogin.notifications[0].read, true, 'read state survives logout/login');

  const dismissed = await request(`/api/notifications/${own.id}`, { method: 'DELETE' }, state.salesCookie);
  assert.equal(dismissed.response.status, 200);
  assert.equal(dismissed.body.dismissed, true);
  assert.equal(dismissed.body.unreadCount, 0);

  const empty = await inbox(state.salesCookie);
  assert.deepEqual(empty.notifications, []);
  assert.equal(empty.unreadCount, 0);

  await request('/api/auth/logout', jsonOptions('POST', {}), state.salesCookie);
  state.salesCookie = await login('sales1', 'Sales-pass-1');
  const afterRestart = await inbox(state.salesCookie);
  assert.deepEqual(afterRestart.notifications, [], 'dismissal survives logout/login and a fresh inbox read');

  const storedRow = db.prepare('SELECT user_id, read_at, dismissed_at FROM user_notifications WHERE id = ?').get(own.id);
  assert.equal(Number(storedRow.user_id), state.salesId);
  assert.ok(storedRow.read_at);
  assert.ok(storedRow.dismissed_at);

  // Re-running the one-time backfill must not resurrect a dismissed row.
  backfillNotificationsFromEvents(db);
  const afterBackfill = await inbox(state.salesCookie);
  assert.deepEqual(afterBackfill.notifications, []);
  const duplicateCount = db.prepare('SELECT COUNT(*) AS count FROM user_notifications WHERE user_id = ? AND event_id = ?')
    .get(state.salesId, own.eventId).count;
  assert.equal(duplicateCount, 1);

  // Dismissing an unread notification also clears it from the unread count.
  const sales2Row = (await inbox(state.sales2Cookie)).notifications[0];
  const dismissUnread = await request(`/api/notifications/${sales2Row.id}`, { method: 'DELETE' }, state.sales2Cookie);
  assert.equal(dismissUnread.response.status, 200);
  assert.equal(dismissUnread.body.unreadCount, 0);
  assert.deepEqual((await inbox(state.sales2Cookie)).notifications, []);

  const readAll = await request('/api/notifications/read-all', jsonOptions('POST', {}), state.adminCookie);
  assert.equal(readAll.response.status, 200);
  assert.equal(readAll.body.unreadCount, 0);
  const adminInbox = await inbox(state.adminCookie);
  assert.equal(adminInbox.unreadCount, 0);
  assert.equal(adminInbox.notifications.every((item) => item.read), true);

  // GPS and system events must never appear in the inbox.
  publishOperationsEvent('rep.tracking.updated', { userId: state.salesId, latitude: 24.8, longitude: 46.7 });
  publishOperationsEvent('system.shutdown', { reason: 'test' });
  assert.deepEqual((await inbox(state.salesCookie)).notifications, []);
});

test('reconnect replays the missed event and the inbox includes it', async () => {
  const cursor = db.prepare('SELECT COALESCE(MAX(event_id), 0) AS cursor FROM operations_events').get().cursor;
  const controller = new AbortController();
  const stream = await fetch(`${baseUrl}/api/supervisor/events?lastEventId=${cursor}`, {
    headers: { cookie: state.adminCookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  const published = publishOperationsEvent('rep.visit.reviewed', { status: 'approved' });
  try {
    const replayed = await readSseFrame(stream, 'rep.visit.reviewed');
    assert.equal(Number(replayed.id), published.id, 'reconnect replays the event the client missed');
  } finally {
    controller.abort();
  }

  const adminInbox = await inbox(state.adminCookie);
  assert.equal(adminInbox.notifications[0].eventId, published.id, 'the replayed event is at the top of the inbox');
  assert.equal(adminInbox.notifications[0].read, false);
  assert.equal(adminInbox.unreadCount, 1);
});

test('the migration backlog is bounded and opens as already read', async () => {
  const occurredAt = new Date().toISOString();
  const insert = db.prepare('INSERT INTO operations_events(event_type, payload_json, occurred_at) VALUES (?, ?, ?)');
  const older = Number(insert.run('rep.machine.location-requested', JSON.stringify({ repName: 'أ' }), occurredAt).lastInsertRowid);
  const newer = Number(insert.run('rep.machine.location-requested', JSON.stringify({ repName: 'ب' }), occurredAt).lastInsertRowid);

  const before = await inbox(state.adminCookie);
  const inserted = backfillNotificationsFromEvents(db, { limit: 1, markRead: true });
  assert.equal(inserted, 1, 'only the newest event inside the bound is materialized');

  const newerRow = db.prepare('SELECT read_at FROM user_notifications WHERE user_id = ? AND event_id = ?')
    .get(state.adminId, newer);
  assert.ok(newerRow?.read_at, 'backfilled history is marked read');
  const olderRow = db.prepare('SELECT id FROM user_notifications WHERE user_id = ? AND event_id = ?')
    .get(state.adminId, older);
  assert.equal(olderRow, undefined, 'events outside the bound are not materialized');

  const after = await inbox(state.adminCookie);
  assert.equal(after.unreadCount, before.unreadCount, 'backfilled history does not add unread items');
});
