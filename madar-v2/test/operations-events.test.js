import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'madar-v2-operations-events-'));
process.env.MADAR_V2_DATABASE_PATH = join(temporaryDirectory, 'events.sqlite');
process.env.MADAR_V2_STORAGE_ROOT = join(temporaryDirectory, 'storage');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const [{ db }, { initializeDatabase }, operationsEvents] = await Promise.all([
  import('../server/database/connection.js'),
  import('../server/database/init.js'),
  import('../server/modules/operations-events.js'),
]);
initializeDatabase({ initialAdminPassword: 'Operations-events-test-password!' });
const { getOperationsEventsAfter, publishOperationsEvent, subscribeOperationsEvents } = operationsEvents;

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('operations events fan out after publication and unsubscribe cleanly', () => {
  const existingEvents = getOperationsEventsAfter(0, { limit: 10_000 });
  const cursor = existingEvents.at(-1)?.id ?? 0;
  const received = [];
  const unsubscribe = subscribeOperationsEvents((event) => received.push(event));
  const published = publishOperationsEvent('rep.tracking.updated', {
    userId: 42,
    acceptedPoints: 3,
    type: 'attempted-override',
  });
  assert.deepEqual(getOperationsEventsAfter(cursor), [published]);
  unsubscribe();
  const publishedAfterUnsubscribe = publishOperationsEvent('rep.visit.submitted', { visitUuid: 'test-visit' });

  assert.equal(received.length, 1);
  assert.equal(received[0], published);
  assert.equal(published.type, 'rep.tracking.updated');
  assert.equal(published.userId, 42);
  assert.equal(published.acceptedPoints, 3);
  assert.ok(published.id);
  assert.ok(Number.isFinite(Date.parse(published.occurredAt)));
  assert.deepEqual(getOperationsEventsAfter(cursor), [published, publishedAfterUnsubscribe]);
});

test('a failed event subscriber cannot prevent delivery to other subscribers', () => {
  let delivered = false;
  const unsubscribe = subscribeOperationsEvents(() => { throw new Error('synthetic closed connection'); });
  const unsubscribeHealthy = subscribeOperationsEvents(() => { delivered = true; });

  assert.doesNotThrow(() => publishOperationsEvent('attendance.changed', { employeeId: 8 }));
  unsubscribe();
  unsubscribeHealthy();
  assert.equal(delivered, true);
});

test('failed SQLite publication is durably retried with a numeric cursor and no invented replay ID',()=>{
 const delivered=[];const unsubscribe=subscribeOperationsEvents(event=>delivered.push(event));
 db.exec("CREATE TRIGGER fail_operations_insert BEFORE INSERT ON operations_events BEGIN SELECT RAISE(ABORT,'isolated event write failure'); END");
 const control=publishOperationsEvent('rep.visit.submitted',{userId:77,visitUuid:'outbox-fixture'});
 assert.equal(control.id,null);assert.equal(control.type,'system.reconcile-required');
 db.exec('DROP TRIGGER fail_operations_insert');
 assert.equal(operationsEvents.flushPendingOperationsEvents().delivered,1);
 const event=delivered.find(item=>item.type==='rep.visit.submitted');assert.ok(Number.isSafeInteger(event.id));
 assert.equal(operationsEvents.flushPendingOperationsEvents().delivered,0);
 assert.equal(delivered.filter(item=>item.type==='rep.visit.submitted').length,1);
 unsubscribe();
});
test('cursor reconciliation resets a cursor from a future or restored database',()=>{
 assert.deepEqual(operationsEvents.getOperationsReplayCursor(Number.MAX_SAFE_INTEGER),{cursor:0,reconcile:true});
 assert.deepEqual(operationsEvents.getOperationsReplayCursor(0),{cursor:0,reconcile:false});
});
