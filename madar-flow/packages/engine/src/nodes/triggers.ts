import type { NodeExecutionArgs, NodeExecutionResult } from '../types.js';
import { isPlainObject } from './helpers.js';

export async function executeManualNode(
  args: NodeExecutionArgs,
): Promise<NodeExecutionResult> {
  const payload = args.context.trigger.payload;
  return { outputs: { main: [{ json: payload ?? null }] } };
}

export async function executeWebhookNode(
  args: NodeExecutionArgs,
): Promise<NodeExecutionResult> {
  const { trigger } = args.context;
  const json = {
    body: trigger.payload ?? null,
    headers: trigger.headers ?? {},
    query: trigger.query ?? {},
    method: trigger.method ?? 'POST',
  };
  return { outputs: { main: [{ json }] } };
}

export async function executeScheduleNode(
  args: NodeExecutionArgs,
): Promise<NodeExecutionResult> {
  const scheduledAt = args.context.trigger.scheduledAt ?? args.context.now().toISOString();
  return { outputs: { main: [{ json: { scheduledAt } }] } };
}

export function isTriggerExecutionResult(value: unknown): value is NodeExecutionResult {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    isPlainObject((value as unknown as NodeExecutionResult).outputs)
  );
}
