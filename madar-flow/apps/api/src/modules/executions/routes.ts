import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hasPermission, executionEventsChannel } from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { getWorkspaceRole, requirePermission, requireUser } from '../../lib/auth.js';
import { createStreamToken, verifyStreamToken } from '../../lib/jwt.js';
import { parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import { AppError } from '@madar/shared';
import {
  cancelExecution,
  getExecution,
  listExecutions,
  retryExecution,
  runWorkflow,
  type RequestMeta,
} from './service.js';

const workspaceParamsSchema = z.object({ workspaceId: z.string().uuid() });

const executionParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  executionId: z.string().uuid(),
});

const runParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  workflowId: z.string().uuid(),
});

const runSchema = z.object({
  mode: z.enum(['production', 'test']).default('production'),
  payload: z.unknown().optional(),
  triggerNodeId: z.string().trim().min(1).max(120).optional(),
});

const listQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: z
    .enum(['queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const streamQuerySchema = z.object({ token: z.string().min(10) });

function requestMeta(request: FastifyRequest): RequestMeta {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    traceId: request.id,
  };
}

async function context(
  request: FastifyRequest,
  deps: AppDeps,
  schema: z.ZodTypeAny,
): Promise<{ user: { id: string; email: string }; params: { workspaceId: string }; role: Awaited<ReturnType<typeof getWorkspaceRole>>; meta: RequestMeta }> {
  const user = await requireUser(request, deps);
  const params = parseParams(schema, request.params) as { workspaceId: string };
  const role = await getWorkspaceRole(deps, user.id, params.workspaceId);
  return { user, params, role, meta: requestMeta(request) };
}

export async function executionRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/:workspaceId/workflows/:workflowId/run', async (request, reply) => {
    const ctx = await context(request, deps, runParamsSchema);
    requirePermission(ctx.role, 'execution:run');
    const params = ctx.params as unknown as { workspaceId: string; workflowId: string };
    const input = parseBody(runSchema, request.body ?? {});
    const execution = await runWorkflow(
      deps,
      params.workspaceId,
      params.workflowId,
      { id: ctx.user.id, email: ctx.user.email },
      input,
      ctx.meta,
    );
    return reply.code(202).send(execution);
  });

  app.get('/:workspaceId/executions', async (request) => {
    const ctx = await context(request, deps, workspaceParamsSchema);
    requirePermission(ctx.role, 'execution:read');
    const query = parseQuery(listQuerySchema, request.query);
    return listExecutions(deps, ctx.params.workspaceId, {
      ...query,
      canReadPayload: hasPermission(ctx.role, 'execution:read_payload'),
    });
  });

  app.get('/:workspaceId/executions/:executionId', async (request) => {
    const ctx = await context(request, deps, executionParamsSchema);
    requirePermission(ctx.role, 'execution:read');
    const params = ctx.params as unknown as { workspaceId: string; executionId: string };
    return getExecution(
      deps,
      params.workspaceId,
      params.executionId,
      hasPermission(ctx.role, 'execution:read_payload'),
    );
  });

  app.post('/:workspaceId/executions/:executionId/cancel', async (request) => {
    const ctx = await context(request, deps, executionParamsSchema);
    requirePermission(ctx.role, 'execution:cancel');
    const params = ctx.params as unknown as { workspaceId: string; executionId: string };
    return cancelExecution(
      deps,
      params.workspaceId,
      params.executionId,
      { id: ctx.user.id, email: ctx.user.email },
      ctx.meta,
    );
  });

  app.post('/:workspaceId/executions/:executionId/retry', async (request, reply) => {
    const ctx = await context(request, deps, executionParamsSchema);
    requirePermission(ctx.role, 'execution:run');
    const params = ctx.params as unknown as { workspaceId: string; executionId: string };
    const execution = await retryExecution(
      deps,
      params.workspaceId,
      params.executionId,
      { id: ctx.user.id, email: ctx.user.email },
      ctx.meta,
    );
    return reply.code(202).send(execution);
  });

  app.post('/:workspaceId/executions/:executionId/stream-token', async (request) => {
    const ctx = await context(request, deps, executionParamsSchema);
    requirePermission(ctx.role, 'execution:read');
    const params = ctx.params as unknown as { workspaceId: string; executionId: string };

    // Ensure the execution belongs to the workspace before minting a token.
    await getExecution(deps, params.workspaceId, params.executionId, false);

    const token = await createStreamToken(
      deps.env.JWT_ACCESS_SECRET,
      {
        sub: ctx.user.id,
        sid: `stream:${request.id}`,
        workspaceId: params.workspaceId,
        executionId: params.executionId,
      },
      deps.env.SSE_TOKEN_TTL_SECONDS,
    );

    return {
      token,
      expiresIn: deps.env.SSE_TOKEN_TTL_SECONDS,
      url: `/api/v1/executions/stream?token=${encodeURIComponent(token)}`,
    };
  });
}

export async function executionStreamRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  app.get('/stream', async (request, reply) => {
    const query = parseQuery(streamQuerySchema, request.query);

    let claims: Awaited<ReturnType<typeof verifyStreamToken>>;
    try {
      claims = await verifyStreamToken(deps.env.JWT_ACCESS_SECRET, query.token);
    } catch {
      throw AppError.unauthorized('invalid_token', 'Invalid or expired stream token');
    }

    const role = await getWorkspaceRole(deps, claims.sub, claims.workspaceId);
    requirePermission(role, 'execution:read');
    const canReadPayload = hasPermission(role, 'execution:read_payload');

    const subscriber = deps.eventSubscriberFactory?.();
    const channel = executionEventsChannel(claims.executionId);
    const buffered: string[] = [];
    let live = false;

    if (subscriber) {
      await subscriber.subscribe(channel, (message) => {
        if (!live) {
          buffered.push(message);
          return;
        }
        reply.raw.write(`event: message\ndata: ${message}\n\n`);
      });
    }

    let execution: Awaited<ReturnType<typeof getExecution>>;
    try {
      execution = await getExecution(
        deps,
        claims.workspaceId,
        claims.executionId,
        canReadPayload,
      );
    } catch (error) {
      await subscriber?.unsubscribe(channel).catch(() => undefined);
      await subscriber?.quit().catch(() => undefined);
      throw error;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(
      `event: snapshot\ndata: ${JSON.stringify({ execution, payloadAccess: canReadPayload })}\n\n`,
    );

    live = true;
    for (const message of buffered) {
      reply.raw.write(`event: message\ndata: ${message}\n\n`);
    }
    buffered.length = 0;

    if (!subscriber) {
      reply.raw.end();
      return;
    }

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
    }, 15_000);
    heartbeat.unref?.();

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      void subscriber.unsubscribe(channel).catch(() => undefined);
      void subscriber.quit().catch(() => undefined);
    };

    request.raw.on('close', cleanup);
    reply.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
  });
}
