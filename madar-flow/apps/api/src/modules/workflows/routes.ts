import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  listWorkflowTemplateSummaries,
  workflowGraphSchema,
  validateGraph,
} from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { getWorkspaceRole, requireUser, requirePermission } from '../../lib/auth.js';
import type { RequestMeta } from './service.js';
import { parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import {
  createWorkflow,
  createWorkflowFromTemplate,
  duplicateWorkflow,
  getVersion,
  getWorkflow,
  listVersions,
  listWorkflows,
  publishWorkflow,
  rollbackWorkflow,
  saveDraft,
  updateWorkflow,
} from './service.js';

const workspaceParamsSchema = z.object({
  workspaceId: z.string().uuid(),
});

const workflowParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  workflowId: z.string().uuid(),
});

const versionParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  workflowId: z.string().uuid(),
  versionId: z.string().uuid(),
});

const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).optional().nullable(),
});

const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2_000).optional().nullable(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });

const saveDraftSchema = z.object({
  graph: workflowGraphSchema,
  revision: z.number().int().min(0),
});

const publishSchema = z.object({
  note: z.string().trim().max(500).optional().nullable(),
});

const templateParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  templateId: z.string().trim().min(1).max(120),
});

const instantiateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2_000).optional().nullable(),
    credentialIds: z.record(z.string().uuid()).optional(),
    urls: z.record(z.string().trim().max(2_048)).optional(),
  })
  .default({});

const listQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function requestMeta(request: FastifyRequest): RequestMeta {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    traceId: request.id,
  };
}

interface RouteContext {
  user: { id: string; email: string };
  workspaceId: string;
  role: Awaited<ReturnType<typeof getWorkspaceRole>>;
  meta: RequestMeta;
}

async function context(
  request: FastifyRequest,
  deps: AppDeps,
  paramsSchema: z.ZodTypeAny,
): Promise<RouteContext> {
  const user = await requireUser(request, deps);
  const params = parseParams(paramsSchema, request.params) as { workspaceId: string };
  const role = await getWorkspaceRole(deps, user.id, params.workspaceId);
  return { user, workspaceId: params.workspaceId, role, meta: requestMeta(request) };
}

export async function workflowRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/:workspaceId/workflows', async (request) => {
    const ctx = await context(request, deps, workspaceParamsSchema);
    requirePermission(ctx.role, 'workflow:read');
    const query = parseQuery(listQuerySchema, request.query);
    return listWorkflows(deps, ctx.workspaceId, query);
  });

  app.get('/:workspaceId/workflow-templates', async (request) => {
    const ctx = await context(request, deps, workspaceParamsSchema);
    requirePermission(ctx.role, 'workflow:read');
    return listWorkflowTemplateSummaries();
  });

  app.post('/:workspaceId/workflow-templates/:templateId/instantiate', async (request, reply) => {
    const ctx = await context(request, deps, templateParamsSchema);
    requirePermission(ctx.role, 'workflow:write');
    const params = parseParams(templateParamsSchema, request.params);
    const input = parseBody(instantiateTemplateSchema, request.body ?? {});
    const workflow = await createWorkflowFromTemplate(
      deps,
      ctx.workspaceId,
      { id: ctx.user.id, email: ctx.user.email },
      { ...input, templateId: params.templateId },
      ctx.meta,
    );
    return reply.code(201).send(workflow);
  });

  app.post('/:workspaceId/workflows', async (request, reply) => {
    const ctx = await context(request, deps, workspaceParamsSchema);
    requirePermission(ctx.role, 'workflow:write');
    const input = parseBody(createWorkflowSchema, request.body);
    const workflow = await createWorkflow(
      deps,
      ctx.workspaceId,
      { id: ctx.user.id, email: ctx.user.email },
      input,
      ctx.meta,
    );
    return reply.code(201).send(workflow);
  });

  app.get('/:workspaceId/workflows/:workflowId', async (request) => {
    const ctx = await context(request, deps, workflowParamsSchema);
    requirePermission(ctx.role, 'workflow:read');
    const params = parseParams(workflowParamsSchema, request.params);
    return getWorkflow(deps, ctx.workspaceId, params.workflowId);
  });

  app.patch('/:workspaceId/workflows/:workflowId', async (request) => {
    const ctx = await context(request, deps, workflowParamsSchema);
    requirePermission(ctx.role, 'workflow:write');
    const params = parseParams(workflowParamsSchema, request.params);
    const input = parseBody(updateWorkflowSchema, request.body);
    return updateWorkflow(
      deps,
      ctx.workspaceId,
      params.workflowId,
      { id: ctx.user.id, email: ctx.user.email },
      input,
      ctx.meta,
    );
  });

  app.put('/:workspaceId/workflows/:workflowId/draft', async (request) => {
    const ctx = await context(request, deps, workflowParamsSchema);
    requirePermission(ctx.role, 'workflow:write');
    const params = parseParams(workflowParamsSchema, request.params);
    const input = parseBody(saveDraftSchema, request.body);

    const validation = validateGraph(input.graph);
    if (!validation.ok) {
      throw AppError.badRequest(
        'validation_error',
        'Invalid workflow graph',
        validation.issues.map((issue) => issue.message).join(' '),
      );
    }

    return saveDraft(
      deps,
      ctx.workspaceId,
      params.workflowId,
      { id: ctx.user.id, email: ctx.user.email },
      input,
    );
  });

  app.post('/:workspaceId/workflows/:workflowId/publish', async (request, reply) => {
    const ctx = await context(request, deps, workflowParamsSchema);
    requirePermission(ctx.role, 'workflow:publish');
    const params = parseParams(workflowParamsSchema, request.params);
    const input = parseBody(publishSchema, request.body ?? {});
    const version = await publishWorkflow(
      deps,
      ctx.workspaceId,
      params.workflowId,
      { id: ctx.user.id, email: ctx.user.email },
      input,
      ctx.meta,
    );
    return reply.code(201).send(version);
  });

  app.get('/:workspaceId/workflows/:workflowId/versions', async (request) => {
    const ctx = await context(request, deps, workflowParamsSchema);
    requirePermission(ctx.role, 'workflow:read');
    const params = parseParams(workflowParamsSchema, request.params);
    return listVersions(deps, ctx.workspaceId, params.workflowId);
  });

  app.get('/:workspaceId/workflows/:workflowId/versions/:versionId', async (request) => {
    const ctx = await context(request, deps, versionParamsSchema);
    requirePermission(ctx.role, 'workflow:read');
    const params = parseParams(versionParamsSchema, request.params);
    return getVersion(deps, ctx.workspaceId, params.workflowId, params.versionId);
  });

  app.post(
    '/:workspaceId/workflows/:workflowId/versions/:versionId/rollback',
    async (request, reply) => {
      const ctx = await context(request, deps, versionParamsSchema);
      requirePermission(ctx.role, 'workflow:publish');
      const params = parseParams(versionParamsSchema, request.params);
      const version = await rollbackWorkflow(
        deps,
        ctx.workspaceId,
        params.workflowId,
        params.versionId,
        { id: ctx.user.id, email: ctx.user.email },
        ctx.meta,
      );
      return reply.code(201).send(version);
    },
  );

  app.post('/:workspaceId/workflows/:workflowId/duplicate', async (request, reply) => {
    const ctx = await context(request, deps, workflowParamsSchema);
    requirePermission(ctx.role, 'workflow:write');
    const params = parseParams(workflowParamsSchema, request.params);
    const workflow = await duplicateWorkflow(
      deps,
      ctx.workspaceId,
      params.workflowId,
      { id: ctx.user.id, email: ctx.user.email },
      ctx.meta,
    );
    return reply.code(201).send(workflow);
  });
}
