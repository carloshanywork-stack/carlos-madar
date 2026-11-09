import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../../lib/auth.js';
import { parseBody, parseParams } from '../../lib/validation.js';
import { createWorkspace, getWorkspaceForUser, listWorkspaces } from './service.js';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const workspaceParamsSchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function workspaceRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/', async (request) => {
    const user = await requireUser(request, deps);
    return listWorkspaces(deps, user.id);
  });

  app.post('/', async (request, reply) => {
    const user = await requireUser(request, deps);
    const input = parseBody(createWorkspaceSchema, request.body);
    const workspace = await createWorkspace(deps, user.id, input.name);
    return reply.code(201).send(workspace);
  });

  app.get('/:workspaceId', async (request) => {
    const user = await requireUser(request, deps);
    const params = parseParams(workspaceParamsSchema, request.params);
    return getWorkspaceForUser(deps, user.id, params.workspaceId);
  });
}
