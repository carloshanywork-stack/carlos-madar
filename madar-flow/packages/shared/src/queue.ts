/** Shared queue contracts between the API, worker, and scheduler. */

export const EXECUTION_QUEUE = 'workflow-executions';

/** Runs a persisted execution row. */
export const EXECUTION_JOB = 'workflow-execution';

/** Emitted by BullMQ job schedulers; the worker creates the execution row. */
export const SCHEDULE_TRIGGER_JOB = 'schedule-trigger';

export interface ExecutionJobData {
  executionId: string;
  workspaceId: string;
  workflowId: string;
}

export interface ScheduleTriggerJobData {
  workflowId: string;
  workspaceId: string;
  nodeId: string;
}

export type ExecutionQueueData = ExecutionJobData | ScheduleTriggerJobData;

export function isExecutionJobData(value: unknown): value is ExecutionJobData {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as ExecutionJobData).executionId === 'string';
}

export function isScheduleTriggerJobData(value: unknown): value is ScheduleTriggerJobData {
  if (!value || typeof value !== 'object') return false;
  const record = value as ScheduleTriggerJobData;
  return (
    typeof record.workflowId === 'string' &&
    typeof record.workspaceId === 'string' &&
    typeof record.nodeId === 'string'
  );
}

export function executionCancellationKey(executionId: string): string {
  return `execution:${executionId}:cancel`;
}

export function executionEventsChannel(executionId: string): string {
  return `execution:${executionId}:events`;
}

export function scheduleSchedulerId(workflowId: string, nodeId: string): string {
  return `schedule-${workflowId}-${nodeId}`;
}

export function schedulerLeaderKey(): string {
  return 'scheduler:leader';
}

export interface ExecutionEventPayload {
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  data?: Record<string, unknown>;
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  status?: string;
  attempt?: number;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  executionStatus?: string;
  hasErrors?: boolean;
  durationMs?: number;
}
