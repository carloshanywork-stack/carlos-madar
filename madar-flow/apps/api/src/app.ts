import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppError, toProblemDetails, uuidv7 } from '@madar/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { auditRoutes } from './modules/audit/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { credentialRoutes } from './modules/credentials/routes.js';
import { executionRoutes, executionStreamRoutes } from './modules/executions/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { workflowRoutes } from './modules/workflows/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      deps.env.NODE_ENV === 'test'
        ? false
        : {
            level: deps.env.LOG_LEVEL,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
          },
    trustProxy: deps.env.TRUST_PROXY,
    genReqId: () => uuidv7(),
    bodyLimit: 1_048_576,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: deps.env.CORS_ORIGIN,
    credentials: true,
  });
  await app.register(helmet, {
    // The SPA is served by the web container; the API only returns JSON and SSE.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // Coarse guard for every API route. Authentication and webhook routes add
  // stricter per-route limits below.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (request) => request.url === '/api/v1/health' || request.url === '/api/v1/ready',
  });

  app.setErrorHandler((error, request, reply) => {
    const isAppError = error instanceof AppError;
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : null;

    const message = error instanceof Error ? error.message : 'Request failed';
    const isRateLimited = statusCode === 429;
    const appError = isAppError
      ? error
      : isRateLimited
        ? new AppError(
            429,
            'rate_limited',
            'Too many requests',
            'Too many requests; retry later.',
          )
        : statusCode !== null && statusCode >= 400 && statusCode < 500
          ? AppError.badRequest('validation_error', message)
          : AppError.internal();

    if (!isAppError && !isRateLimited) {
      request.log.error({ err: error }, 'Unhandled request error');
    }
    if (isRateLimited) {
      reply.header('retry-after', '60');
    }

    const problem = toProblemDetails(appError, {
      instance: request.url,
      traceId: request.id,
    });

    return reply.status(problem.status).type('application/problem+json').send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = toProblemDetails(AppError.notFound(), {
      instance: request.url,
      traceId: request.id,
    });
    return reply.status(404).type('application/problem+json').send(problem);
  });

  await app.register(async (instance) => healthRoutes(instance, deps), { prefix: '/api/v1' });
  await app.register(async (instance) => authRoutes(instance, deps), { prefix: '/api/v1/auth' });
  await app.register(async (instance) => workspaceRoutes(instance, deps), {
    prefix: '/api/v1/workspaces',
  });
  await app.register(async (instance) => workflowRoutes(instance, deps), {
    prefix: '/api/v1/workspaces',
  });
  await app.register(async (instance) => executionRoutes(instance, deps), {
    prefix: '/api/v1/workspaces',
  });
  await app.register(async (instance) => credentialRoutes(instance, deps), {
    prefix: '/api/v1/workspaces',
  });
  await app.register(async (instance) => auditRoutes(instance, deps), {
    prefix: '/api/v1/workspaces',
  });
  await app.register(async (instance) => executionStreamRoutes(instance, deps), {
    prefix: '/api/v1/executions',
  });
  await app.register(async (instance) => webhookRoutes(instance, deps), {
    prefix: '/api/v1/webhooks',
  });

  return app;
}
