import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import {
  credentials,
  users,
  workflowDrafts,
  workflowVersions,
  workflows,
  type DatabaseTransaction,
} from '@madar/db';
import {
  AppError,
  EMPTY_GRAPH,
  getWorkflowTemplate,
  instantiateTemplateGraph,
  uuidv7,
  validateGraph,
  validateWorkflowForPublish,
  type WorkflowGraph,
} from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { recordAudit } from '../../lib/audit.js';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  traceId?: string;
}

interface Actor {
  id: string;
  email: string;
}

const workflowColumns = {
  id: workflows.id,
  name: workflows.name,
  description: workflows.description,
  currentVersionId: workflows.currentVersionId,
  createdBy: workflows.createdBy,
  createdAt: workflows.createdAt,
  updatedAt: workflows.updatedAt,
  archivedAt: workflows.archivedAt,
};

async function lockWorkflow(
  tx: DatabaseTransaction,
  workspaceId: string,
  workflowId: string,
) {
  const rows = await tx
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.workspaceId, workspaceId)))
    .limit(1)
    .for('update');

  const workflow = rows[0];
  if (!workflow) throw AppError.notFound('not_found', 'Workflow was not found');
  return workflow;
}

async function assertCredentialReferences(
  tx: DatabaseTransaction,
  workspaceId: string,
  graph: WorkflowGraph,
): Promise<void> {
  const credentialIds = [
    ...new Set(
      graph.nodes
        .filter((node) => !node.disabled)
        .map((node) => node.parameters.credentialId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ];
  const rows =
    credentialIds.length === 0
      ? []
      : await tx
          .select({ id: credentials.id, type: credentials.type, revokedAt: credentials.revokedAt })
          .from(credentials)
          .where(
            and(eq(credentials.workspaceId, workspaceId), inArray(credentials.id, credentialIds)),
          );

  const found = new Map(rows.map((row) => [row.id, row]));
  const problems: string[] = [];
  for (const credentialId of credentialIds) {
    const row = found.get(credentialId);
    if (!row) problems.push(`Credential ${credentialId} does not exist in this workspace.`);
    else if (row.revokedAt) problems.push(`Credential ${credentialId} has been revoked.`);
  }

  for (const node of graph.nodes) {
    if (node.type !== 'webhook' || node.disabled) continue;
    const credentialId = node.parameters.credentialId;
    if (typeof credentialId !== 'string' || !credentialId) {
      problems.push(`Webhook node "${node.name}" requires an HMAC credential.`);
      continue;
    }
    const credential = found.get(credentialId);
    if (credential && credential.type !== 'hmac') {
      problems.push(`Webhook node "${node.name}" must use an HMAC credential.`);
    }
  }

  if (problems.length > 0) {
    throw AppError.badRequest('validation_error', 'Workflow credential validation failed', problems.join(' '));
  }
}

async function assertWebhookPathsAvailable(
  tx: DatabaseTransaction,
  workspaceId: string,
  workflowId: string,
  graph: WorkflowGraph,
): Promise<void> {
  const paths = graph.nodes
    .filter((node) => node.type === 'webhook' && !node.disabled)
    .map((node) => String(node.parameters.path ?? '').trim())
    .filter(Boolean);
  if (paths.length === 0) return;

  const rows = await tx
    .select({ workflowId: workflows.id, graph: workflowVersions.graph })
    .from(workflows)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .where(and(eq(workflows.workspaceId, workspaceId), isNull(workflows.archivedAt)));

  for (const row of rows) {
    if (row.workflowId === workflowId) continue;
    for (const node of row.graph.nodes) {
      if (node.type !== 'webhook' || node.disabled) continue;
      const path = String(node.parameters.path ?? '').trim();
      if (path && paths.includes(path)) {
        throw AppError.conflict(
          'conflict',
          'Webhook path is already in use',
          `المسار ${path} مستخدم في Workflow آخر داخل هذه المساحة.`,
        );
      }
    }
  }
}

async function nextProductionVersion(tx: DatabaseTransaction, workflowId: string): Promise<number> {
  const rows = await tx
    .select({ value: max(workflowVersions.version) })
    .from(workflowVersions)
    .where(
      and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.kind, 'production')),
    );
  return (rows[0]?.value ?? 0) + 1;
}

function assertValidGraph(graph: WorkflowGraph): void {
  const result = validateGraph(graph);
  if (!result.ok) {
    throw AppError.badRequest(
      'validation_error',
      'Invalid workflow graph',
      result.issues.map((issue) => issue.message).join(' '),
    );
  }
}

export async function listWorkflows(
  deps: AppDeps,
  workspaceId: string,
  options: { includeArchived?: boolean; limit?: number } = {},
) {
  const conditions = [eq(workflows.workspaceId, workspaceId)];
  if (!options.includeArchived) conditions.push(isNull(workflows.archivedAt));

  return deps.db
    .select({
      ...workflowColumns,
      draftRevision: workflowDrafts.revision,
      updatedByDraftAt: workflowDrafts.updatedAt,
    })
    .from(workflows)
    .leftJoin(workflowDrafts, eq(workflowDrafts.workflowId, workflows.id))
    .where(and(...conditions))
    .orderBy(desc(workflows.updatedAt))
    .limit(Math.min(options.limit ?? 50, 200));
}

export async function getWorkflow(deps: AppDeps, workspaceId: string, workflowId: string) {
  const rows = await deps.db
    .select(workflowColumns)
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.workspaceId, workspaceId)))
    .limit(1);

  const workflow = rows[0];
  if (!workflow) throw AppError.notFound('not_found', 'Workflow was not found');

  const draftRows = await deps.db
    .select({
      id: workflowDrafts.id,
      graph: workflowDrafts.graph,
      revision: workflowDrafts.revision,
      updatedAt: workflowDrafts.updatedAt,
      updatedBy: workflowDrafts.updatedBy,
    })
    .from(workflowDrafts)
    .where(eq(workflowDrafts.workflowId, workflowId))
    .limit(1);

  const versions = await listVersions(deps, workspaceId, workflowId, 50);

  return { ...workflow, draft: draftRows[0] ?? null, versions };
}

export async function createWorkflow(
  deps: AppDeps,
  workspaceId: string,
  actor: Actor,
  input: { name: string; description?: string | null },
  meta: RequestMeta,
) {
  const workflowId = uuidv7();

  await deps.db.transaction(async (tx) => {
    await tx.insert(workflows).values({
      id: workflowId,
      workspaceId,
      name: input.name,
      description: input.description ?? null,
      createdBy: actor.id,
    });
    await tx.insert(workflowDrafts).values({
      id: uuidv7(),
      workflowId,
      graph: EMPTY_GRAPH,
      revision: 1,
      updatedBy: actor.id,
    });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'workflow.created',
      entityType: 'workflow',
      entityId: workflowId,
      newValues: { name: input.name, description: input.description ?? null },
      ...meta,
    });
  });

  return getWorkflow(deps, workspaceId, workflowId);
}

export interface InstantiateTemplateInput {
  templateId: string;
  name?: string;
  description?: string | null;
  credentialIds?: Record<string, string>;
  urls?: Record<string, string>;
}

export async function createWorkflowFromTemplate(
  deps: AppDeps,
  workspaceId: string,
  actor: Actor,
  input: InstantiateTemplateInput,
  meta: RequestMeta,
) {
  const template = getWorkflowTemplate(input.templateId);
  if (!template) {
    throw AppError.notFound('not_found', 'Workflow template was not found', input.templateId);
  }

  const templateNodeIds = new Set(template.graph.nodes.map((node) => node.id));

  for (const nodeId of Object.keys(input.credentialIds ?? {})) {
    if (!templateNodeIds.has(nodeId)) {
      throw AppError.badRequest(
        'validation_error',
        `Template "${template.id}" has no node "${nodeId}".`,
      );
    }
  }
  for (const nodeId of Object.keys(input.urls ?? {})) {
    if (!templateNodeIds.has(nodeId)) {
      throw AppError.badRequest(
        'validation_error',
        `Template "${template.id}" has no node "${nodeId}".`,
      );
    }
  }

  const graph = instantiateTemplateGraph(template, {
    credentialIds: input.credentialIds,
    urls: input.urls,
  });

  const structure = validateGraph(graph);
  if (!structure.ok) {
    throw AppError.badRequest(
      'validation_error',
      'Invalid template graph',
      structure.issues.map((issue) => issue.message).join(' '),
    );
  }

  const credentialIds = [
    ...new Set(
      Object.values(input.credentialIds ?? {}).filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    ),
  ];

  const workflowId = uuidv7();
  const name = input.name?.trim() || template.name;
  const description =
    input.description === undefined ? template.description : input.description;

  await deps.db.transaction(async (tx) => {
    if (credentialIds.length > 0) {
      const rows = await tx
        .select({ id: credentials.id, revokedAt: credentials.revokedAt })
        .from(credentials)
        .where(
          and(eq(credentials.workspaceId, workspaceId), inArray(credentials.id, credentialIds)),
        );
      const found = new Map(rows.map((row) => [row.id, row]));
      for (const credentialId of credentialIds) {
        const row = found.get(credentialId);
        if (!row) {
          throw AppError.badRequest(
            'validation_error',
            `Credential ${credentialId} does not exist in this workspace.`,
          );
        }
        if (row.revokedAt) {
          throw AppError.badRequest(
            'validation_error',
            `Credential ${credentialId} has been revoked.`,
          );
        }
      }
    }

    await tx.insert(workflows).values({
      id: workflowId,
      workspaceId,
      name,
      description,
      createdBy: actor.id,
    });
    await tx.insert(workflowDrafts).values({
      id: uuidv7(),
      workflowId,
      graph,
      revision: 1,
      updatedBy: actor.id,
    });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'workflow.created_from_template',
      entityType: 'workflow',
      entityId: workflowId,
      newValues: {
        name,
        description,
        templateId: template.id,
        credentialNodes: Object.keys(input.credentialIds ?? {}),
      },
      ...meta,
    });
  });

  return getWorkflow(deps, workspaceId, workflowId);
}

export async function updateWorkflow(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  actor: Actor,
  input: { name?: string; description?: string | null; archived?: boolean },
  meta: RequestMeta,
) {
  await deps.db.transaction(async (tx) => {
    const existing = await lockWorkflow(tx, workspaceId, workflowId);
    const patch: Partial<typeof workflows.$inferInsert> = { updatedAt: new Date() };

    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.archived !== undefined) patch.archivedAt = input.archived ? new Date() : null;

    await tx.update(workflows).set(patch).where(eq(workflows.id, workflowId));

    const isArchiveChange = input.archived !== undefined && input.archived !== Boolean(existing.archivedAt);
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: isArchiveChange
        ? input.archived
          ? 'workflow.archived'
          : 'workflow.unarchived'
        : 'workflow.updated',
      entityType: 'workflow',
      entityId: workflowId,
      oldValues: {
        name: existing.name,
        description: existing.description,
        archivedAt: existing.archivedAt?.toISOString() ?? null,
      },
      newValues: {
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        archivedAt:
          input.archived === undefined
            ? (existing.archivedAt?.toISOString() ?? null)
            : input.archived
              ? new Date().toISOString()
              : null,
      },
      ...meta,
    });
  });

  return getWorkflow(deps, workspaceId, workflowId);
}

export async function saveDraft(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  actor: Actor,
  input: { graph: WorkflowGraph; revision: number },
) {
  assertValidGraph(input.graph);

  return deps.db.transaction(async (tx) => {
    await lockWorkflow(tx, workspaceId, workflowId);

    const draftRows = await tx
      .select()
      .from(workflowDrafts)
      .where(eq(workflowDrafts.workflowId, workflowId))
      .limit(1)
      .for('update');

    const draft = draftRows[0];
    if (!draft) {
      throw AppError.conflict('conflict', 'Workflow draft is missing; reload the workflow.');
    }

    if (draft.revision !== input.revision) {
      throw AppError.conflict(
        'conflict',
        'Draft revision conflict',
        `Expected revision ${input.revision}, current revision is ${draft.revision}. Reload before saving.`,
      );
    }

    const now = new Date();
    await tx
      .update(workflowDrafts)
      .set({
        graph: input.graph,
        revision: draft.revision + 1,
        updatedBy: actor.id,
        updatedAt: now,
      })
      .where(eq(workflowDrafts.workflowId, workflowId));

    await tx.update(workflows).set({ updatedAt: now }).where(eq(workflows.id, workflowId));

    return { revision: draft.revision + 1, updatedAt: now.toISOString() };
  });
}

export async function publishWorkflow(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  actor: Actor,
  input: { note?: string | null },
  meta: RequestMeta,
) {
  return deps.db.transaction(async (tx) => {
    await lockWorkflow(tx, workspaceId, workflowId);

    const draftRows = await tx
      .select()
      .from(workflowDrafts)
      .where(eq(workflowDrafts.workflowId, workflowId))
      .limit(1)
      .for('update');

    const draft = draftRows[0];
    if (!draft) throw AppError.notFound('not_found', 'Workflow draft was not found');
    if (draft.graph.nodes.length === 0) {
      throw AppError.badRequest('validation_error', 'Cannot publish an empty workflow');
    }
    assertValidGraph(draft.graph);

    const publishIssues = validateWorkflowForPublish(draft.graph);
    if (publishIssues.length > 0) {
      throw AppError.badRequest(
        'validation_error',
        'Workflow validation failed',
        publishIssues
          .slice(0, 8)
          .map(
            (issue) =>
              `${issue.nodeName ? `${issue.nodeName} · ` : ''}${issue.path ? `${issue.path}: ` : ''}${issue.message}`,
          )
          .join(' | '),
      );
    }

    await assertCredentialReferences(tx, workspaceId, draft.graph);
    await assertWebhookPathsAvailable(tx, workspaceId, workflowId, draft.graph);

    const version = await nextProductionVersion(tx, workflowId);
    const versionId = uuidv7();
    const now = new Date();

    await tx.insert(workflowVersions).values({
      id: versionId,
      workflowId,
      version,
      kind: 'production',
      graph: draft.graph,
      note: input.note ?? null,
      createdBy: actor.id,
    });

    await tx
      .update(workflows)
      .set({ currentVersionId: versionId, updatedAt: now })
      .where(eq(workflows.id, workflowId));

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'workflow.published',
      entityType: 'workflow',
      entityId: workflowId,
      newValues: { versionId, version, note: input.note ?? null },
      ...meta,
    });

    return {
      id: versionId,
      workflowId,
      version,
      kind: 'production' as const,
      note: input.note ?? null,
      createdAt: now.toISOString(),
      graph: draft.graph,
    };
  });
}

export async function listVersions(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  limit = 100,
) {
  const workflowRows = await deps.db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.workspaceId, workspaceId)))
    .limit(1);
  if (!workflowRows[0]) throw AppError.notFound('not_found', 'Workflow was not found');

  return deps.db
    .select({
      id: workflowVersions.id,
      version: workflowVersions.version,
      kind: workflowVersions.kind,
      note: workflowVersions.note,
      createdAt: workflowVersions.createdAt,
      createdBy: workflowVersions.createdBy,
      createdByEmail: users.email,
    })
    .from(workflowVersions)
    .leftJoin(users, eq(users.id, workflowVersions.createdBy))
    .where(eq(workflowVersions.workflowId, workflowId))
    .orderBy(desc(workflowVersions.createdAt))
    .limit(Math.min(limit, 200));
}

export async function getVersion(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  versionId: string,
) {
  const rows = await deps.db
    .select({
      id: workflowVersions.id,
      workflowId: workflowVersions.workflowId,
      version: workflowVersions.version,
      kind: workflowVersions.kind,
      note: workflowVersions.note,
      graph: workflowVersions.graph,
      createdAt: workflowVersions.createdAt,
      createdBy: workflowVersions.createdBy,
    })
    .from(workflowVersions)
    .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
    .where(
      and(
        eq(workflowVersions.id, versionId),
        eq(workflowVersions.workflowId, workflowId),
        eq(workflows.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  const version = rows[0];
  if (!version) throw AppError.notFound('not_found', 'Workflow version was not found');
  return version;
}

export async function rollbackWorkflow(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  versionId: string,
  actor: Actor,
  meta: RequestMeta,
) {
  return deps.db.transaction(async (tx) => {
    await lockWorkflow(tx, workspaceId, workflowId);

    const targetRows = await tx
      .select()
      .from(workflowVersions)
      .where(
        and(eq(workflowVersions.id, versionId), eq(workflowVersions.workflowId, workflowId)),
      )
      .limit(1);
    const target = targetRows[0];
    if (!target) throw AppError.notFound('not_found', 'Workflow version was not found');

    assertValidGraph(target.graph);

    const version = await nextProductionVersion(tx, workflowId);
    const newVersionId = uuidv7();
    const now = new Date();

    await tx.insert(workflowVersions).values({
      id: newVersionId,
      workflowId,
      version,
      kind: 'production',
      graph: target.graph,
      note: `Rollback to version ${target.version ?? 'unknown'}`,
      createdBy: actor.id,
    });

    await tx
      .update(workflows)
      .set({ currentVersionId: newVersionId, updatedAt: now })
      .where(eq(workflows.id, workflowId));

    const draftRows = await tx
      .select()
      .from(workflowDrafts)
      .where(eq(workflowDrafts.workflowId, workflowId))
      .limit(1)
      .for('update');
    const draft = draftRows[0];
    if (draft) {
      await tx
        .update(workflowDrafts)
        .set({
          graph: target.graph,
          revision: draft.revision + 1,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .where(eq(workflowDrafts.workflowId, workflowId));
    }

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'workflow.rolled_back',
      entityType: 'workflow',
      entityId: workflowId,
      oldValues: { versionId: target.id, version: target.version },
      newValues: { versionId: newVersionId, version },
      ...meta,
    });

    return {
      id: newVersionId,
      workflowId,
      version,
      kind: 'production' as const,
      note: `Rollback to version ${target.version ?? 'unknown'}`,
      createdAt: now.toISOString(),
      graph: target.graph,
    };
  });
}

export async function duplicateWorkflow(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  actor: Actor,
  meta: RequestMeta,
) {
  const source = await getWorkflow(deps, workspaceId, workflowId);
  const newId = uuidv7();

  await deps.db.transaction(async (tx) => {
    await tx.insert(workflows).values({
      id: newId,
      workspaceId,
      name: `${source.name} (نسخة)`,
      description: source.description,
      createdBy: actor.id,
    });
    await tx.insert(workflowDrafts).values({
      id: uuidv7(),
      workflowId: newId,
      graph: source.draft?.graph ?? EMPTY_GRAPH,
      revision: 1,
      updatedBy: actor.id,
    });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'workflow.duplicated',
      entityType: 'workflow',
      entityId: newId,
      newValues: { sourceWorkflowId: workflowId, name: `${source.name} (نسخة)` },
      ...meta,
    });
  });

  return getWorkflow(deps, workspaceId, newId);
}
