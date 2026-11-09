import { resolveTemplates } from '@madar/shared';
import type { EngineContext, Item, NodeExecutionArgs } from '../types.js';

export function asItem(value: unknown): Item {
  return { json: value };
}

export function asItems(value: unknown): Item[] {
  if (Array.isArray(value)) return value.map(asItem);
  return [asItem(value)];
}

export function itemJson(item: Item): unknown {
  return item.json;
}

export function itemObject(item: Item): Record<string, unknown> {
  const value = item.json;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

/**
 * JSONata bindings exposed to every node:
 * `$json`, `$node["Name"].json`, `$trigger`, `$execution`, `$workflow`, `$now`.
 */
export function buildExpressionContext(
  args: Pick<NodeExecutionArgs, 'context' | 'outputs'>,
  item: Item,
): Record<string, unknown> {
  const nodes: Record<string, unknown> = {};
  for (const [nodeId, branches] of args.outputs) {
    const main = branches.main ?? [];
    if (main.length === 0) continue;
    nodes[nodeId] = {
      json: main[0]?.json ?? null,
      items: main.map((entry) => entry.json),
    };
  }

  return {
    json: item.json,
    node: nodes,
    trigger: args.context.trigger.payload ?? null,
    execution: {
      id: args.context.executionId,
      mode: args.context.mode,
      workflowId: args.context.workflowId,
    },
    workflow: { id: args.context.workflowId },
    now: args.context.now().toISOString(),
  };
}

export async function resolveForItem(
  value: unknown,
  args: Pick<NodeExecutionArgs, 'context' | 'outputs'>,
  item: Item,
): Promise<unknown> {
  return resolveTemplates(value, buildExpressionContext(args, item), item.json);
}

export function stringValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function truncate(value: string, max = 2_000): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function abortError(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  const error = new Error('Execution canceled');
  error.name = 'AbortError';
  return error;
}

export function contextLog(
  context: EngineContext,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: unknown,
): void {
  context.logger?.(level, message, data);
}
