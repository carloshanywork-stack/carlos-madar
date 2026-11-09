import type { NodeExecutionResult } from '../types.js';
import type { WorkflowNode } from '@madar/shared';
import { executeHttpNode } from './http.js';
import {
  executeErrorNode,
  executeIfNode,
  executeMergeNode,
  executeNoopNode,
  executeSetNode,
} from './logic.js';
import {
  executeManualNode,
  executeScheduleNode,
  executeWebhookNode,
} from './triggers.js';

export type { NodeExecutor } from '../types.js';

const REGISTRY: Record<string, (args: Parameters<typeof executeNoopNode>[0]) => Promise<NodeExecutionResult>> = {
  manual: executeManualNode,
  webhook: executeWebhookNode,
  schedule: executeScheduleNode,
  http: executeHttpNode,
  set: executeSetNode,
  if: executeIfNode,
  merge: executeMergeNode,
  noop: executeNoopNode,
  error: executeErrorNode,
};

export function getNodeExecutor(type: string) {
  return REGISTRY[type];
}

export function isKnownNodeType(type: string): boolean {
  return type in REGISTRY;
}

export function nodeRetryOptions(node: WorkflowNode): {
  maxAttempts: number;
  backoffMs: number;
} {
  const raw = node.parameters.retry;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const attempts = Number(record.maxAttempts ?? 1);
    const backoff = Number(record.backoffMs ?? 0);
    return {
      maxAttempts: Number.isFinite(attempts)
        ? Math.min(Math.max(Math.trunc(attempts), 1), 10)
        : 1,
      backoffMs: Number.isFinite(backoff) ? Math.min(Math.max(Math.trunc(backoff), 0), 60_000) : 0,
    };
  }
  return { maxAttempts: 1, backoffMs: 0 };
}
