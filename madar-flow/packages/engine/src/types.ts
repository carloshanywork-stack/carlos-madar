import type { WorkflowGraph, WorkflowNode } from '@madar/shared';

/** A single flow item. `json` is intentionally unknown: HTTP responses may be objects, arrays, or primitives. */
export interface Item {
  json: unknown;
}

export type TriggerType = 'manual' | 'webhook' | 'schedule';

export interface TriggerInput {
  type: TriggerType;
  /** Raw payload supplied by the caller (manual run body, webhook body, schedule metadata). */
  payload?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  method?: string;
  scheduledAt?: string;
}

export interface EngineContext {
  executionId: string;
  workflowId: string;
  workspaceId: string;
  workflowVersionId: string;
  mode: 'test' | 'production';
  trigger: TriggerInput;
  /** Aborted when the execution is canceled or exceeds its timeout. */
  signal: AbortSignal;
  now: () => Date;
  logger?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
  /**
   * Optional credential resolver supplied by the worker. It returns a
   * normalized authentication descriptor (`api_key`, `bearer`, or `basic`).
   */
  credentials?: {
    get(credentialId: string): Promise<Record<string, unknown> | null>;
  };
}

export type NodeStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export interface StepRecord {
  nodeId: string;
  nodeType: string;
  nodeName: string;
  iteration: number;
  attempt: number;
  status: NodeStatus;
  input?: unknown;
  output?: unknown;
  error?: SerializedError;
  startedAt: Date;
  finishedAt: Date;
}

export interface SerializedError {
  message: string;
  code?: string;
  details?: unknown;
}

export interface EngineHooks {
  onNodeStarted?(record: StepRecord): Promise<void> | void;
  onNodeFinished?(record: StepRecord): Promise<void> | void;
  onLog?(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> | void;
  /** Return true to stop scheduling new nodes. */
  isCanceled?(): Promise<boolean> | boolean;
}

export interface NodeExecutionArgs {
  node: WorkflowNode;
  input: Item[];
  context: EngineContext;
  /** Outputs of every already executed node, keyed by node id. */
  outputs: Map<string, Record<string, Item[]>>;
  retry: RetryOptions;
}

export interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
}

export interface NodeExecutionResult {
  outputs: Record<string, Item[]>;
  /** Extra data stored on the step record (e.g. HTTP status). */
  meta?: Record<string, unknown>;
  error?: SerializedError;
}

export type NodeExecutor = (args: NodeExecutionArgs) => Promise<NodeExecutionResult>;

export interface ExecuteWorkflowOptions {
  graph: WorkflowGraph;
  context: EngineContext;
  hooks?: EngineHooks;
  /** When set, only this trigger node starts the graph. */
  triggerNodeId?: string;
}

export interface ExecutionResult {
  status: 'succeeded' | 'failed' | 'canceled';
  hasErrors: boolean;
  error?: SerializedError;
  steps: StepRecord[];
  /** Final outputs per node id (last attempt). */
  outputs: Record<string, Record<string, Item[]>>;
  startedAt: Date;
  finishedAt: Date;
}
