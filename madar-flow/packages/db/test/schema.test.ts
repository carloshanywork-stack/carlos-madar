import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('initial migration contains the locked schema decisions', async () => {
  const sql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');

  assert.match(sql, /CREATE UNIQUE INDEX workflow_versions_prod_uq[\s\S]*WHERE kind = 'production'/);
  assert.match(sql, /execution_steps \(execution_id, node_id, iteration, attempt\)/);
  assert.match(sql, /CREATE TABLE outbox_archive/);
  assert.match(sql, /current_version_id uuid/);
  assert.doesNotMatch(sql, /current_version_id uuid NOT NULL/);
});

test('business tables have no time-based deletion trigger', async () => {
  const sql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /DELETE FROM/i);
  assert.doesNotMatch(sql, /pg_cron/i);
});
