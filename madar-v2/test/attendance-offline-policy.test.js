import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readRepAttendanceMaxOfflineAgeHours } from '../server/config/env.js';

test('offline attendance age configuration defaults to 24 hours and accepts only positive finite numbers', () => {
  assert.equal(readRepAttendanceMaxOfflineAgeHours(undefined), 24);
  assert.equal(readRepAttendanceMaxOfflineAgeHours('24'), 24);
  assert.equal(readRepAttendanceMaxOfflineAgeHours('0.5'), 0.5);
  for (const invalid of ['', '0', '-1', 'NaN', 'Infinity', '1e308', 'not-a-number']) {
    assert.throws(
      () => readRepAttendanceMaxOfflineAgeHours(invalid),
      /REP_ATTENDANCE_MAX_OFFLINE_AGE_HOURS must be a positive finite number/,
      `expected ${JSON.stringify(invalid)} to be rejected`,
    );
  }
});

test('invalid offline-age settings fail application configuration at startup', () => {
  const configUrl = new URL('../server/config/env.js', import.meta.url).href;
  for (const value of [' ', '0', '-24', 'Infinity', '1e308']) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)})`], {
      env: { ...process.env, NODE_ENV: 'test', REP_ATTENDANCE_MAX_OFFLINE_AGE_HOURS: value },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(run.error, undefined);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /REP_ATTENDANCE_MAX_OFFLINE_AGE_HOURS must be a positive finite number/);
  }
});
