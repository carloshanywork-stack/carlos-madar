import assert from 'node:assert/strict';
import test from 'node:test';
import { extractUuidv7Timestamp, isUuidv7, uuidv7 } from '../src/ids.js';

test('uuidv7 produces a valid v7 UUID', () => {
  const id = uuidv7();
  assert.equal(id.length, 36);
  assert.ok(isUuidv7(id), `expected a UUIDv7, got ${id}`);
  assert.equal(id[14], '7');
  assert.ok(['8', '9', 'a', 'b'].includes(id[19]!.toLowerCase()));
});

test('uuidv7 is time-ordered', () => {
  const first = uuidv7(1_700_000_000_000);
  const second = uuidv7(1_700_000_001_000);
  assert.ok(first < second);
  assert.equal(extractUuidv7Timestamp(first), 1_700_000_000_000);
});

test('uuidv7 does not collide', () => {
  const ids = new Set(Array.from({ length: 5_000 }, () => uuidv7(1_700_000_000_000)));
  assert.equal(ids.size, 5_000);
});

test('extractUuidv7Timestamp rejects other UUID versions', () => {
  assert.equal(extractUuidv7Timestamp('00000000-0000-4000-8000-000000000000'), null);
});
