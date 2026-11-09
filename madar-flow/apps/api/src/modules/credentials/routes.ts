import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CREDENTIAL_TYPES } from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { getWorkspaceRole, requirePermission, requireUser } from '../../lib/auth.js';
import { parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import type { RequestMeta } from '../workflows/service.js';
import {
  createCredential,
  listCredentials,
  preflightCredential,
  revokeCredential,
} from './service.js';

const workspaceParamsSchema = z.object({ workspaceId: z.string().uuid() });
const credentialParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  credentialId: z.string().uuid(),
});

const listQuerySchema = z.object({
  includeRevoked: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(CREDENTIAL_TYPES),
  payload: z.record(z.unknown()),
});

function requestMeta(request: FastifyRequest): RequestMeta {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    traceId: request.id,
  };
}

async function context(request: FastifyRequest, deps: AppDeps) {
  const user = await requireUser(request, deps);
  const params = parseParams(workspaceParamsSchema, request.params);
  const role = await getWorkspaceRole(deps, user.id, params.workspaceId);
  return { user, workspaceId: params.workspaceId, role, meta: requestMeta(request) };
}

export async function credentialRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/:workspaceId/credentials', async (request) => {
    const ctx = await context(request, deps);
    requirePermission(ctx.role, 'credential:read');
    const query = parseQuery(listQuerySchema, request.query);
    return listCredentials(deps, ctx.workspaceId, query.includeRevoked ?? false);
  });

  app.post('/:workspaceId/credentials', async (request, reply) => {
    const ctx = await context(request, deps);
    requirePermission(ctx.role, 'credential:write');
    const input = parseBody(createSchema, request.body);
    const credential = await createCredential(
      deps,
      ctx.workspaceId,
      { id: ctx.user.id, email: ctx.user.email },
      input,
      ctx.meta,
    );
    return reply.code(201).send(credential);
  });

  app.post('/:workspaceId/credentials/:credentialId/revoke', async (request) => {
    const ctx = await context(request, deps);
    requirePermission(ctx.role, 'credential:write');
    const params = parseParams(credentialParamsSchema, request.params);
    return revokeCredential(
      deps,
      ctx.workspaceId,
      params.credentialId,
      { id: ctx.user.id, email: ctx.user.email },
      ctx.meta,
    );
  });

  app.post('/:workspaceId/credentials/:credentialId/preflight', async (request) => {
    const ctx = await context(request, deps);
    requirePermission(ctx.role, 'credential:write');
    const params = parseParams(credentialParamsSchema, request.params);
    return preflightCredential(deps, ctx.workspaceId, params.credentialId);
  });
}
