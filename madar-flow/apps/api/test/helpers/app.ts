import { createDatabase } from '@madar/db';
import type { Env } from '@madar/shared';
import { buildApp } from '../../src/app.js';
import type { AppDeps, EventSubscriber, ExecutionQueue } from '../../src/deps.js';

export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

const testEnv: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3001,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://unused',
  VALKEY_URL: 'redis://unused',
  JWT_ACCESS_SECRET: 'test-secret-that-is-long-enough-for-hs256',
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

export interface CapturedJob {
  name: string;
  data: Record<string, unknown>;
  opts?: Record<string, unknown>;
}

export interface TestContext {
  app: Awaited<ReturnType<typeof buildApp>>;
  deps: AppDeps;
  jobs: CapturedJob[];
  failNextEnqueue: boolean;
  close: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for integration tests.');

  const database = createDatabase(databaseUrl, { max: 4, applicationName: 'madar-flow-test' });
  const jobs: CapturedJob[] = [];
  const state = { failNextEnqueue: false };

  const executionQueue: ExecutionQueue = {
    add: async (name, data, opts) => {
      if (state.failNextEnqueue) {
        state.failNextEnqueue = false;
        throw new Error('queue down');
      }
      const captured = { name, data, opts };
      jobs.push(captured);
      return { id: opts?.jobId ?? `job-${jobs.length}` };
    },
  };

  const eventSubscriberFactory = () => {
    const subscriber: EventSubscriber = {
      subscribe: async () => 1,
      unsubscribe: async () => 1,
      quit: async () => 'OK',
    };
    return subscriber;
  };

  const deps: AppDeps = {
    db: database.db,
    pool: database.pool,
    cache: {
      ping: async () => 'PONG',
      quit: async () => 'OK',
    },
    env: { ...testEnv, DATABASE_URL: databaseUrl },
    executionQueue,
    eventSubscriberFactory,
  };

  const app = await buildApp(deps);

  const context: TestContext = {
    app,
    deps,
    jobs,
    get failNextEnqueue() {
      return state.failNextEnqueue;
    },
    set failNextEnqueue(value: boolean) {
      state.failNextEnqueue = value;
    },
    close: async () => {
      await app.close();
      await database.close();
    },
  };

  return context;
}

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@test.madar.local`;
}

export interface TestSession {
  token: string;
  userId: string;
  workspaceId: string;
  email: string;
}

export async function registerSession(
  app: TestContext['app'],
  overrides: { email?: string; workspaceName?: string } = {},
): Promise<TestSession> {
  const email = overrides.email ?? uniqueEmail();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email,
      password: 'correct-horse-battery-staple',
      displayName: 'مستخدم اختبار',
      workspaceName: overrides.workspaceName ?? 'مساحة اختبار',
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Registration failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as {
    accessToken: string;
    user: { id: string };
    workspace: { id: string };
  };

  return {
    token: body.accessToken,
    userId: body.user.id,
    workspaceId: body.workspace.id,
    email,
  };
}

export function authHeaders(session: TestSession): Record<string, string> {
  return {
    authorization: `Bearer ${session.token}`,
  };
}
