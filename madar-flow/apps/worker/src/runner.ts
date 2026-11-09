import { and, eq } from 'drizzle-orm';
import {
  executionSteps,
  executions,
  workflowVersions,
  workflows,
  type Database,
} from '@madar/db';
import {
  executeWorkflow,
  type EngineContext,
  type ExecutionResult,
  type StepRecord,
} from '@madar/engine';
import {
  executionCancellationKey,
  uuidv7,
  type Env,
  type ScheduleTriggerJobData,
  type WorkflowGraph,
} from '@madar/shared';
import type { Redis } from 'ioredis';
import { ExecutionEventWriter } from './events.js';
import type { WorkerCredentialResolver } from './credentials.js';

export interface RunnerDeps {
  db: Database;
  redis: Redis;
  env: Env;
  credentials: WorkerCredentialResolver;
  logger: {
    info(data: unknown, message?: string): void;
    warn(data: unknown, message?: string): void;
    error(data: unknown, message?: string): void;
  };
}

class ExecutionCanceledError extends Error {
  constructor() {
    super('Execution canceled');
    this.name = 'ExecutionCanceledError';
  }
}

class ExecutionTimedOutError extends Error {
  constructor(timeoutMs: number) {
    super(`Execution timed out after ${timeoutMs}ms`);
    this.name = 'ExecutionTimedOutError';
  }
}

interface LoadedExecution {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  triggerType: string;
  triggerNodeId: string | null;
  triggerPayload: unknown;
  mode: string;
  status: string;
  workflowName: string;
  graph: WorkflowGraph;
}

async function loadExecution(db: Database, executionId: string): Promise<LoadedExecution | null> {
  const rows = await db
    .select({
      id: executions.id,
      workspaceId: executions.workspaceId,
      workflowId: executions.workflowId,
      workflowVersionId: executions.workflowVersionId,
      triggerType: executions.triggerType,
      triggerNodeId: executions.triggerNodeId,
      triggerPayload: executions.triggerPayload,
      mode: executions.mode,
      status: executions.status,
      workflowName: workflows.name,
      graph: workflowVersions.graph,
    })
    .from(executions)
    .innerJoin(workflows, eq(workflows.id, executions.workflowId))
    .innerJoin(workflowVersions, eq(workflowVersions.id, executions.workflowVersionId))
    .where(eq(executions.id, executionId))
    .limit(1);

  return (rows[0] as LoadedExecution | undefined) ?? null;
}

function stepError(error: StepRecord['error']): Record<string, unknown> | null {
  if (!error) return null;
  return {
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}

async function recordStepStarted(
  deps: RunnerDeps,
  executionId: string,
  step: StepRecord,
): Promise<void> {
  await deps.db.insert(executionSteps).values({
    id: uuidv7(),
    executionId,
    nodeId: step.nodeId,
    nodeType: step.nodeType,
    iteration: step.iteration,
    attempt: step.attempt,
    status: 'running',
    input: step.input ?? null,
    startedAt: step.startedAt,
  });
}

async function recordStepFinished(
  deps: RunnerDeps,
  executionId: string,
  step: StepRecord,
): Promise<void> {
  const updated = await deps.db
    .update(executionSteps)
    .set({
      status: step.status,
      input: step.input ?? null,
      output: step.output ?? null,
      error: stepError(step.error),
      finishedAt: step.finishedAt,
    })
    .where(
      and(
        eq(executionSteps.executionId, executionId),
        eq(executionSteps.nodeId, step.nodeId),
        eq(executionSteps.iteration, step.iteration),
        eq(executionSteps.attempt, step.attempt),
      ),
    )
    .returning({ id: executionSteps.id });

  if (updated.length === 0) {
    await deps.db.insert(executionSteps).values({
      id: uuidv7(),
      executionId,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      iteration: step.iteration,
      attempt: step.attempt,
      status: step.status,
      input: step.input ?? null,
      output: step.output ?? null,
      error: stepError(step.error),
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    });
  }
}

async function finalize(
  deps: RunnerDeps,
  writer: ExecutionEventWriter,
  executionId: string,
  result: ExecutionResult,
  currentStatus: string | null,
): Promise<void> {
  const status =
    currentStatus === 'canceled' || result.status === 'canceled'
      ? 'canceled'
      : result.status === 'failed'
        ? 'failed'
        : 'succeeded';

  await deps.db
    .update(executions)
    .set({
      status,
      hasErrors: result.hasErrors,
      error: result.error
        ? {
            message: result.error.message,
            ...(result.error.code ? { code: result.error.code } : {}),
            ...(result.error.details === undefined ? {} : { details: result.error.details }),
          }
        : null,
      finishedAt: result.finishedAt,
    })
    .where(eq(executions.id, executionId));

  await writer.emit('execution_finished', {
    executionStatus: status,
    hasErrors: result.hasErrors,
    durationMs: result.finishedAt.valueOf() - result.startedAt.valueOf(),
    error: result.error ?? null,
  });

  await deps.redis.del(executionCancellationKey(executionId)).catch(() => undefined);
}

export async function runExecution(deps: RunnerDeps, executionId: string): Promise<void> {
  const execution = await loadExecution(deps.db, executionId);
  if (!execution) {
    deps.logger.warn({ executionId }, 'Execution row not found; skipping job');
    return;
  }

  if (['succeeded', 'failed', 'canceled'].includes(execution.status)) {
    deps.logger.info({ executionId, status: execution.status }, 'Execution already finished');
    return;
  }

  await deps.db
    .update(executions)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(executions.id, executionId));

  const writer = new ExecutionEventWriter(deps.db, deps.redis, executionId);
  await writer.initialize();

  await writer.emit('execution_started', {
    executionStatus: 'running',
    data: {
      workflowName: execution.workflowName,
      triggerType: execution.triggerType,
      mode: execution.mode,
    },
  });

  const controller = new AbortController();
  let cancelReason: 'canceled' | 'timeout' | null = null;

  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return;
    cancelReason = 'timeout';
    controller.abort(new ExecutionTimedOutError(deps.env.EXECUTION_TIMEOUT_MS));
  }, deps.env.EXECUTION_TIMEOUT_MS);

  let checking = false;
  const cancelCheck = setInterval(() => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    void (async () => {
      try {
        const [flag, rows] = await Promise.all([
          deps.redis.get(executionCancellationKey(executionId)).catch(() => null),
          deps.db
            .select({ status: executions.status })
            .from(executions)
            .where(eq(executions.id, executionId))
            .limit(1),
        ]);
        if (flag === '1' || rows[0]?.status === 'canceled') {
          cancelReason = 'canceled';
          controller.abort(new ExecutionCanceledError());
        }
      } finally {
        checking = false;
      }
    })();
  }, 1_000);

  const context: EngineContext = {
    executionId,
    workflowId: execution.workflowId,
    workspaceId: execution.workspaceId,
    workflowVersionId: execution.workflowVersionId,
    mode: execution.mode === 'test' ? 'test' : 'production',
    trigger: {
      type:
        execution.triggerType === 'webhook' || execution.triggerType === 'schedule'
          ? execution.triggerType
          : 'manual',
      payload: execution.triggerPayload ?? null,
      ...(execution.triggerType === 'schedule'
        ? { scheduledAt: new Date().toISOString() }
        : {}),
    },
    signal: controller.signal,
    now: () => new Date(),
    logger: (level, message, data) => {
      void writer.log(level, message, data as Record<string, unknown> | undefined);
    },
    credentials: {
      get: (credentialId) => deps.credentials.resolve(execution.workspaceId, credentialId),
    },
  };

  let result: ExecutionResult;
  try {
    result = await executeWorkflow({
      graph: execution.graph,
      context,
      hooks: {
        onNodeStarted: async (step) => {
          await recordStepStarted(deps, executionId, step);
          await writer.emit('node_started', {
            nodeId: step.nodeId,
            nodeName: step.nodeName,
            nodeType: step.nodeType,
            status: 'running',
            attempt: step.attempt,
          });
        },
        onNodeFinished: async (step) => {
          await recordStepFinished(deps, executionId, step);
          await writer.emit('node_finished', {
            nodeId: step.nodeId,
            nodeName: step.nodeName,
            nodeType: step.nodeType,
            status: step.status,
            attempt: step.attempt,
            output: step.status === 'succeeded' ? step.output : undefined,
            error: step.error ?? undefined,
          });
        },
        onLog: async (level, message, data) => {
          await writer.log(level, message, data);
        },
        isCanceled: () => controller.signal.aborted,
      },
    });
  } catch (caught) {
    result = {
      status: 'failed',
      hasErrors: true,
      error: {
        message: caught instanceof Error ? caught.message : 'Execution crashed',
        code: 'execution_crash',
      },
      steps: [],
      outputs: {},
      startedAt: new Date(),
      finishedAt: new Date(),
    };
  } finally {
    clearTimeout(timeout);
    clearInterval(cancelCheck);
  }

  if (cancelReason === 'timeout') {
    result.status = 'failed';
    result.hasErrors = true;
    result.error = {
      message: `Execution timed out after ${deps.env.EXECUTION_TIMEOUT_MS}ms`,
      code: 'execution_timeout',
    };
  } else if (cancelReason === 'canceled') {
    result.status = 'canceled';
  }

  const rows = await deps.db
    .select({ status: executions.status })
    .from(executions)
    .where(eq(executions.id, executionId))
    .limit(1);

  await finalize(deps, writer, executionId, result, rows[0]?.status ?? null);
}

/**
 * Creates the execution row for a BullMQ schedule trigger, then runs it.
 * The current published version is used at fire time (Decision Log v3).
 */
export async function runScheduleTrigger(
  deps: RunnerDeps,
  data: ScheduleTriggerJobData,
): Promise<{ executionId: string } | null> {
  const rows = await deps.db
    .select({
      workflowId: workflows.id,
      workspaceId: workflows.workspaceId,
      archivedAt: workflows.archivedAt,
      currentVersionId: workflows.currentVersionId,
      name: workflows.name,
    })
    .from(workflows)
    .where(and(eq(workflows.id, data.workflowId), eq(workflows.workspaceId, data.workspaceId)))
    .limit(1);

  const workflow = rows[0];
  if (!workflow || workflow.archivedAt || !workflow.currentVersionId) {
    deps.logger.warn({ workflowId: data.workflowId }, 'Skipping schedule: workflow unavailable');
    return null;
  }

  const versionRows = await deps.db
    .select({ id: workflowVersions.id, graph: workflowVersions.graph })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, workflow.currentVersionId))
    .limit(1);
  const version = versionRows[0];
  if (!version) return null;

  const nodes = (version.graph as { nodes?: Array<{ id: string; type: string; disabled?: boolean }> })
    .nodes;
  const node = nodes?.find((entry) => entry.id === data.nodeId);
  if (!node || node.type !== 'schedule' || node.disabled) {
    deps.logger.warn(
      { workflowId: data.workflowId, nodeId: data.nodeId },
      'Skipping schedule: node is no longer an enabled schedule trigger',
    );
    return null;
  }

  const executionId = uuidv7();
  await deps.db.insert(executions).values({
    id: executionId,
    workspaceId: workflow.workspaceId,
    workflowId: workflow.workflowId,
    workflowVersionId: version.id,
    triggerType: 'schedule',
    triggerNodeId: node.id,
    triggerPayload: { scheduledAt: new Date().toISOString(), scheduler: 'bullmq' },
    mode: 'production',
    status: 'queued',
  });

  await runExecution(deps, executionId);
  return { executionId };
}
