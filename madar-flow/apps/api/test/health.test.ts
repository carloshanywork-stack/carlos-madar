import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env } from '@madar/shared';
import { buildApp } from '../src/app.js';
import type { AppDeps } from '../src/deps.js';

const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL: 'postgres://unused',
  VALKEY_URL: 'redis://unused',
  JWT_ACCESS_SECRET: 'test-secret-that-is-long-enough-for-hs256',
  JWT_ACCESS_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
  REFRESH_GRACE_SECONDS: 10,
  COOKIE_SECURE: false,
  CORS_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'error',
  TRUST_PROXY: false,
};

function createDeps(overrides: { failDatabase?: boolean; failCache?: boolean } = {}): AppDeps {
  return {
    env,
    db: {} as AppDeps['db'],
    pool: {
      query: async (text: string) => {
        if (overrides.failDatabase) throw new Error('database down');
        if (text.includes('schema_migrations')) return { rows: [{ count: '1' }] };
        return { rows: [] };
      },
    } as unknown as AppDeps['pool'],
    cache: {
      ping: async () => {
        if (overrides.failCache) throw new Error('cache down');
        return 'PONG';
      },
      quit: async () => 'OK',
    },
  };
}

test('GET /api/v1/health returns ok', async () => {
  const app = await buildApp(createDeps());
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ok');
  await app.close();
});

test('GET /api/v1/ready checks database, cache, and migrations', async () => {
  const app = await buildApp(createDeps());
  const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().checks, {
    database: 'ok',
    cache: 'ok',
    migrations: 'ok',
  });
  await app.close();
});

test('GET /api/v1/ready returns 503 when a dependency is down', async () => {
  const app = await buildApp(createDeps({ failCache: true }));
  const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.cache, 'failed');
  await app.close();
});

test('unknown routes use the RFC 9457 problem details shape', async () => {
  const app = await buildApp(createDeps());
  const response = await app.inject({ method: 'GET', url: '/api/v1/unknown' });
  assert.equal(response.statusCode, 404);
  assert.match(response.headers['content-type'] ?? '', /^application\/problem\+json/);
  assert.equal(response.json().code, 'not_found');
  await app.close();
});
