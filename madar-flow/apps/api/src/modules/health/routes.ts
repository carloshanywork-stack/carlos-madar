import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../deps.js';

const VERSION = '0.1.0';

export async function healthRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'madar-flow-api',
    version: VERSION,
    timestamp: new Date().toISOString(),
  }));

  app.get('/ready', async (request, reply) => {
    const checks: Record<string, 'ok' | 'failed'> = {};
    let ready = true;

    try {
      await deps.pool.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'failed';
      ready = false;
    }

    try {
      await deps.cache.ping();
      checks.cache = 'ok';
    } catch {
      checks.cache = 'failed';
      ready = false;
    }

    try {
      const result = await deps.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM schema_migrations',
      );
      const count = Number(result.rows[0]?.count ?? 0);
      checks.migrations = count > 0 ? 'ok' : 'failed';
      if (checks.migrations !== 'ok') ready = false;
    } catch {
      checks.migrations = 'failed';
      ready = false;
    }

    if (!ready) request.log.warn({ checks }, 'Readiness check failed');

    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}
