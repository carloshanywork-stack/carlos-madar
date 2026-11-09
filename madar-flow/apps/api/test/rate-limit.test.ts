import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestContext, hasTestDatabase } from './helpers/app.js';

test('rate limiting: auth endpoints return RFC 9457 problem details', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    let response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@test.local', password: 'wrong-password' },
    });

    for (let attempt = 1; attempt <= 15; attempt += 1) {
      response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@test.local', password: 'wrong-password' },
      });
    }

    assert.equal(response.statusCode, 429, response.body);
    assert.match(String(response.headers['content-type']), /application\/problem\+json/);
    const body = response.json() as { status: number; code: string; detail: string };
    assert.equal(body.status, 429);
    assert.equal(body.code, 'rate_limited');
    assert.match(body.detail, /retry/);
    assert.ok(response.headers['retry-after']);
  } finally {
    await ctx.close();
  }
});
