const assert = require('node:assert/strict')
const test = require('node:test')
const { createLoginThrottle } = require('../src/login-throttle')

test('progressively delays repeated requests by client IP and has no permanent lockout', () => {
  let now = 1000
  const throttle = createLoginThrottle({ baseDelayMs: 100, maxDelayMs: 500, windowMs: 1000, now: () => now })
  assert.equal(throttle.beforeAttempt('127.0.0.1'), 0)
  assert.equal(throttle.beforeAttempt('127.0.0.1'), 100)
  assert.equal(throttle.beforeAttempt('127.0.0.1'), 200)
  assert.equal(throttle.beforeAttempt('127.0.0.1'), 400)
  assert.equal(throttle.beforeAttempt('127.0.0.1'), 500)
  throttle.recordSuccess('127.0.0.1')
  assert.equal(throttle.beforeAttempt('127.0.0.1'), 0)
  assert.equal(throttle.beforeAttempt('192.0.2.1'), 0)
  now += 1001
  assert.equal(throttle.beforeAttempt('127.0.0.1'), 0)
})

test('rejects invalid throttle configuration', () => {
  assert.throws(() => createLoginThrottle({ baseDelayMs: 500, maxDelayMs: 100 }), /settings are invalid/)
  assert.throws(() => createLoginThrottle({ windowMs: 10 }), /settings are invalid/)
})
