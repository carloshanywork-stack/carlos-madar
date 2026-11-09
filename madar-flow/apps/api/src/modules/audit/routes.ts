import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { getWorkspaceRole, requirePermission, requireUser } from '../../lib/auth.js';
import { parseParams, parseQuery } from '../../lib/validation.js';
import { listAuditLogs } from './service.js';

const workspaceParamsSchema = z.object({ workspaceId: z.string().uuid() });

const querySchema = z.object({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(80).optional(),
  entityId: z.string().trim().max(200).optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function auditRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/:workspaceId/audit', async (request) => {
    const user = await requireUser(request, deps);
    const params = parseParams(workspaceParamsSchema, request.params);
    const role = await getWorkspaceRole(deps, user.id, params.workspaceId);
    requirePermission(role, 'audit:read');
    const query = parseQuery(querySchema, request.query);
    return listAuditLogs(deps, params.workspaceId, query);
  });
}
