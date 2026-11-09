import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { createDatabase, credentials, workspaces } from '@madar/db';
import {
  encryptSecret,
  resolveCredentialsKey,
  uuidv7,
  type Env,
} from '@madar/shared';
import { WorkerCredentialResolver } from '../src/credentials.js';

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

function testEnv(): Env {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 3001,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://unused',
    VALKEY_URL: 'redis://unused',
    JWT_ACCESS_SECRET: 'worker-test-secret-that-is-long-enough',
    CREDENTIALS_KEK: Buffer.alloc(32, 7).toString('base64'),
    JWT_ACCESS_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
    REFRESH_GRACE_SECONDS: 10,
    SSE_TOKEN_TTL_SECONDS: 60,
    COOKIE_SECURE: false,
    CORS_ORIGIN: 'http://localhost:5173',
    LOG_LEVEL: 'error',
    TRUST_PROXY: false,
    WORKER_CONCURRENCY: 2,
    EXECUTION_TIMEOUT_MS: 300_000,
    BULLMQ_LOCK_DURATION_MS: 120_000,
    SCHEDULER_SYNC_INTERVAL_MS: 60_000,
  };
}

test('worker credentials: decrypt, scope by workspace, and reject revoked values', { skip: !hasTestDatabase }, async () => {
  const env = testEnv();
  const database = createDatabase(env.DATABASE_URL, { max: 2, applicationName: 'madar-flow-worker-test' });
  const key = resolveCredentialsKey(env);
  const workspaceId = uuidv7();
  const credentialId = uuidv7();
  const warnings: unknown[] = [];

  try {
    await database.db.insert(workspaces).values({
      id: workspaceId,
      name: 'Worker Test Workspace',
      slug: `worker-test-${workspaceId.replaceAll('-', '').slice(0, 12)}`,
    });

    await database.db.insert(credentials).values({
      id: credentialId,
      workspaceId,
      name: 'API Key',
      type: 'api_key',
      encryptedPayload: encryptSecret(key, {
        secret: 'super-secret',
        headerName: 'x-custom-key',
        valuePrefix: 'Token ',
      }),
      keyVersion: 1,
    });

    const resolver = new WorkerCredentialResolver(database.db, env, {
      warn: (data) => warnings.push(data),
    });

    const resolved = await resolver.resolve(workspaceId, credentialId);
    assert.deepEqual(resolved, {
      type: 'api_key',
      secret: 'super-secret',
      headerName: 'x-custom-key',
      valuePrefix: 'Token ',
    });

    const stored = await database.db
      .select({ lastUsedAt: credentials.lastUsedAt })
      .from(credentials)
      .where(eq(credentials.id, credentialId))
      .limit(1);
    assert.ok(stored[0]?.lastUsedAt, 'lastUsedAt is recorded after resolution');

    const otherWorkspace = await resolver.resolve(uuidv7(), credentialId);
    assert.equal(otherWorkspace, null, 'credentials are scoped to their workspace');

    await database.db
      .update(credentials)
      .set({ revokedAt: new Date() })
      .where(eq(credentials.id, credentialId));

    const revoked = await resolver.resolve(workspaceId, credentialId);
    assert.equal(revoked, null, 'revoked credentials are never resolved');
    assert.equal(warnings.length, 0);
  } finally {
    await database.close();
  }
});
