import assert from 'node:assert/strict';
import test from 'node:test';
import { publishOperationsEvent, subscribeOperationsEvents } from '../server/modules/operations-events.js';

test('operations events fan out after publication and unsubscribe cleanly', () => {
  const received = [];
  const unsubscribe = subscribeOperationsEvents((event) => received.push(event));
  const published = publishOperationsEvent('rep.tracking.updated', {
    userId: 42,
    acceptedPoints: 3,
    type: 'attempted-override',
  });
  unsubscribe();
  publishOperationsEvent('rep.visit.submitted', { visitUuid: 'test-visit' });

  assert.equal(received.length, 1);
  assert.equal(received[0], published);
  assert.equal(published.type, 'rep.tracking.updated');
  assert.equal(published.userId, 42);
  assert.equal(published.acceptedPoints, 3);
  assert.ok(published.id);
  assert.ok(Number.isFinite(Date.parse(published.occurredAt)));
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
