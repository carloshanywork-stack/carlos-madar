import { and, desc, eq } from 'drizzle-orm';
import {
  executionEvents,
  executionSteps,
  executions,
  workflowDrafts,
  workflowVersions,
  workflows,
} from '@madar/db';
import {
  AppError,
  EXECUTION_JOB,
  TRIGGER_TYPES,
  uuidv7,
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

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_LIST_LIMIT = 100;

export interface RunWorkflowInput {
  mode: 'production' | 'test';
  payload?: unknown;
  triggerNodeId?: string;
}

function findTriggerNode(graph: WorkflowGraph, requestedId?: string) {
  const nodes = graph.nodes.filter((node) => !node.disabled);
  if (requestedId) {
    const requested = nodes.find((node) => node.id === requestedId);
    if (requested && TRIGGER_TYPES.has(requested.type)) return requested;
  }
  return nodes.find((node) => TRIGGER_TYPES.has(node.type));
}

function assertPayloadSize(payload: unknown): void {
  if (payload === undefined) return;
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw AppError.badRequest('validation_error', 'Payload is not serializable');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw AppError.badRequest(
      'validation_error',
      'Payload is too large',
      `Maximum payload size is ${MAX_PAYLOAD_BYTES} bytes.`,
    );
  }
}

async function enqueueExecution(
  deps: AppDeps,
  execution: { id: string; workspaceId: string; workflowId: string },
): Promise<void> {
  if (!deps.executionQueue) {
    throw new AppError(503, 'not_ready', 'Execution queue is not available');
  }

  try {
    await deps.executionQueue.add(
      EXECUTION_JOB,
      {
        executionId: execution.id,
        workspaceId: execution.workspaceId,
        workflowId: execution.workflowId,
      },
      {
        jobId: `execution-${execution.id}`,
        attempts: 1,
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    );
  } catch (caught) {
    await deps.db
      .update(executions)
      .set({
        status: 'failed',
        hasErrors: true,
        error: { message: 'Execution queue is not available', code: 'queue_unavailable' },
        finishedAt: new Date(),
      })
      .where(eq(executions.id, execution.id));

    throw new AppError(
      503,
      'not_ready',
      'Execution queue is not available',
      caught instanceof Error ? caught.message : undefined,
    );
  }
}

export async function runWorkflow(
  deps: AppDeps,
  workspaceId: string,
  workflowId: string,
  actor: Actor,
  input: RunWorkflowInput,
  meta: RequestMeta,
) {
  assertPayloadSize(input.payload);

  const workflowRows = await deps.db
    .select({
      id: workflows.id,
      name: workflows.name,
      archivedAt: workflows.archivedAt,
      currentVersionId: workflows.currentVersionId,
    })
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.workspaceId, workspaceId)))
    .limit(1);

  const workflow = workflowRows[0];
  if (!workflow) throw AppError.notFound('not_found', 'Workflow was not found');
  if (workflow.archivedAt) {
    throw AppError.conflict('conflict', 'Workflow is archived', 'Restore the workflow before running it.');
  }

  let versionId: string;
  let graph: WorkflowGraph;

  if (input.mode === 'test') {
    const testVersionId = await deps.db.transaction(async (tx) => {
      const draftRows = await tx
        .select({ graph: workflowDrafts.graph, revision: workflowDrafts.revision })
        .from(workflowDrafts)
        .where(eq(workflowDrafts.workflowId, workflowId))
        .limit(1)
        .for('update');
      const draft = draftRows[0];
      if (!draft) throw AppError.notFound('not_found', 'Workflow draft was not found');

      const id = uuidv7();
      await tx.insert(workflowVersions).values({
        id,
        workflowId,
        version: null,
        kind: 'test',
        graph: draft.graph,
        note: `Test run snapshot (draft revision ${draft.revision})`,
        createdBy: actor.id,
      });
      return id;
    });
    const versionRows = await deps.db
      .select({ graph: workflowVersions.graph })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, testVersionId))
      .limit(1);
    versionId = testVersionId;
    graph = versionRows[0]!.graph;
  } else {
    if (!workflow.currentVersionId) {
      throw AppError.badRequest(
        'validation_error',
        'Workflow has no published version',
        'Publish the workflow before running it in production mode.',
      );
    }
    const versionRows = await deps.db
      .select({ graph: workflowVersions.graph })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, workflow.currentVersionId))
      .limit(1);
    const version = versionRows[0];
    if (!version) {
      throw AppError.conflict('conflict', 'Published version is missing');
    }
    versionId = workflow.currentVersionId;
    graph = version.graph;
  }

  const trigger = findTriggerNode(graph, input.triggerNodeId);
  if (!trigger) {
    throw AppError.badRequest(
      'validation_error',
      'Workflow has no enabled trigger',
      'Add a Manual, Webhook, or Schedule trigger node.',
    );
  }

  const executionId = uuidv7();
  const now = new Date();

  await deps.db.transaction(async (tx) => {
    await tx.insert(executions).values({
      id: executionId,
      workspaceId,
      workflowId,
      workflowVersionId: versionId,
      triggerType: trigger.type,
      triggerNodeId: trigger.id,
      triggerPayload: input.payload ?? null,
      mode: input.mode,
      status: 'queued',
      createdAt: now,
    });

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'execution.triggered',
      entityType: 'execution',
      entityId: executionId,
      newValues: {
        workflowId,
        workflowName: workflow.name,
        workflowVersionId: versionId,
        mode: input.mode,
        triggerType: trigger.type,
        triggerNodeId: trigger.id,
      },
      ...meta,
    });
  });

  await enqueueExecution(deps, { id: executionId, workspaceId, workflowId });

  return {
    id: executionId,
    workspaceId,
    workflowId,
    workflowName: workflow.name,
    workflowVersionId: versionId,
    mode: input.mode,
    triggerType: trigger.type,
    status: 'queued' as const,
    hasErrors: false,
    createdAt: now.toISOString(),
  };
}

export interface ListExecutionsOptions {
  workflowId?: string;
  status?: string;
  limit?: number;
  offset?: number;
  canReadPayload: boolean;
}

export async function listExecutions(
  deps: AppDeps,
  workspaceId: string,
  options: ListExecutionsOptions,
) {
  const conditions = [eq(executions.workspaceId, workspaceId)];
  if (options.workflowId) conditions.push(eq(executions.workflowId, options.workflowId));
  if (options.status) conditions.push(eq(executions.status, options.status));

  const rows = await deps.db
    .select({
      id: executions.id,
      workflowId: executions.workflowId,
      workflowName: workflows.name,
      workflowVersionId: executions.workflowVersionId,
      version: workflowVersions.version,
      versionKind: workflowVersions.kind,
      mode: executions.mode,
      triggerType: executions.triggerType,
      triggerNodeId: executions.triggerNodeId,
      status: executions.status,
      hasErrors: executions.hasErrors,
      error: executions.error,
      retryOfExecutionId: executions.retryOfExecutionId,
      startedAt: executions.startedAt,
      finishedAt: executions.finishedAt,
      createdAt: executions.createdAt,
    })
    .from(executions)
    .innerJoin(workflows, eq(workflows.id, executions.workflowId))
    .innerJoin(workflowVersions, eq(workflowVersions.id, executions.workflowVersionId))
    .where(and(...conditions))
    .orderBy(desc(executions.createdAt))
    .limit(Math.min(options.limit ?? 30, MAX_LIST_LIMIT))
    .offset(options.offset ?? 0);

  if (options.canReadPayload) return rows;

  return rows.map((row) => ({
    ...row,
    error: row.error ? { message: String(row.error.message ?? 'Execution failed') } : null,
  }));
}

function stripStepPayload(step: Record<string, unknown>) {
  return {
    ...step,
    input: null,
    output: null,
    error: step.error
      ? { message: String((step.error as Record<string, unknown>).message ?? 'Step failed') }
      : null,
  };
}

export async function getExecution(
  deps: AppDeps,
  workspaceId: string,
  executionId: string,
  canReadPayload: boolean,
) {
  const rows = await deps.db
    .select({
      id: executions.id,
      workspaceId: executions.workspaceId,
      workflowId: executions.workflowId,
      workflowName: workflows.name,
      workflowVersionId: executions.workflowVersionId,
      version: workflowVersions.version,
      versionKind: workflowVersions.kind,
      mode: executions.mode,
      triggerType: executions.triggerType,
      triggerNodeId: executions.triggerNodeId,
      triggerPayload: executions.triggerPayload,
      idempotencyKey: executions.idempotencyKey,
      status: executions.status,
      hasErrors: executions.hasErrors,
      error: executions.error,
      retryOfExecutionId: executions.retryOfExecutionId,
      startedAt: executions.startedAt,
      finishedAt: executions.finishedAt,
      createdAt: executions.createdAt,
    })
    .from(executions)
    .innerJoin(workflows, eq(workflows.id, executions.workflowId))
    .innerJoin(workflowVersions, eq(workflowVersions.id, executions.workflowVersionId))
    .where(and(eq(executions.id, executionId), eq(executions.workspaceId, workspaceId)))
    .limit(1);

  const execution = rows[0];
  if (!execution) throw AppError.notFound('not_found', 'Execution was not found');

  const steps = await deps.db
    .select()
    .from(executionSteps)
    .where(eq(executionSteps.executionId, executionId))
    .orderBy(executionSteps.startedAt, executionSteps.attempt);

  const events = await deps.db
    .select({
      id: executionEvents.id,
      seq: executionEvents.seq,
      type: executionEvents.type,
      payload: executionEvents.payload,
      createdAt: executionEvents.createdAt,
    })
    .from(executionEvents)
    .where(eq(executionEvents.executionId, executionId))
    .orderBy(executionEvents.seq)
    .limit(2_000);

  if (!canReadPayload) {
    return {
      ...execution,
      triggerPayload: null,
      error: execution.error
        ? { message: String(execution.error.message ?? 'Execution failed') }
        : null,
      steps: steps.map((step) => stripStepPayload(step as Record<string, unknown>)),
      events: events.filter((event) => event.type !== 'execution_log'),
      payloadAccess: false as const,
    };
  }

  return { ...execution, steps, events, payloadAccess: true as const };
}

export async function cancelExecution(
  deps: AppDeps,
  workspaceId: string,
  executionId: string,
  actor: Actor,
  meta: RequestMeta,
) {
  const rows = await deps.db
    .select({ id: executions.id, workflowId: executions.workflowId, status: executions.status })
    .from(executions)
    .where(and(eq(executions.id, executionId), eq(executions.workspaceId, workspaceId)))
    .limit(1);

  const execution = rows[0];
  if (!execution) throw AppError.notFound('not_found', 'Execution was not found');
  if (TERMINAL_STATUSES.has(execution.status)) {
    throw AppError.conflict('conflict', 'Execution already finished');
  }

  const now = new Date();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(executions)
      .set({
        status: 'canceled',
        error: { message: 'Canceled by user', code: 'canceled_by_user' },
      })
      .where(eq(executions.id, executionId));

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'execution.canceled',
      entityType: 'execution',
      entityId: executionId,
      oldValues: { status: execution.status },
      newValues: { status: 'canceled', requestedAt: now.toISOString() },
      ...meta,
    });
  });

  return getExecution(deps, workspaceId, executionId, true);
}

export async function retryExecution(
  deps: AppDeps,
  workspaceId: string,
  executionId: string,
  actor: Actor,
  meta: RequestMeta,
) {
  const rows = await deps.db
    .select()
    .from(executions)
    .where(and(eq(executions.id, executionId), eq(executions.workspaceId, workspaceId)))
    .limit(1);

  const original = rows[0];
  if (!original) throw AppError.notFound('not_found', 'Execution was not found');
  if (!TERMINAL_STATUSES.has(original.status) && original.status !== 'waiting') {
    throw AppError.conflict('conflict', 'Execution is still running');
  }

  const newId = uuidv7();
  const now = new Date();

  await deps.db.transaction(async (tx) => {
    await tx.insert(executions).values({
      id: newId,
      workspaceId,
      workflowId: original.workflowId,
      workflowVersionId: original.workflowVersionId,
      triggerType: original.triggerType,
      triggerNodeId: original.triggerNodeId,
      triggerPayload: original.triggerPayload,
      mode: original.mode,
      status: 'queued',
      retryOfExecutionId: original.id,
      createdAt: now,
    });

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'execution.retried',
      entityType: 'execution',
      entityId: newId,
      newValues: { retryOfExecutionId: original.id, workflowId: original.workflowId },
      ...meta,
    });
  });

  await enqueueExecution(deps, {
    id: newId,
    workspaceId,
    workflowId: original.workflowId,
  });

  return getExecution(deps, workspaceId, newId, true);
}
