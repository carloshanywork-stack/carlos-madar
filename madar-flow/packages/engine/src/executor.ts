import { topologicalOrder, TRIGGER_TYPES, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from '@madar/shared';
import { getNodeExecutor, nodeRetryOptions } from './nodes/registry.js';
import type {
  EngineContext,
  EngineHooks,
  ExecuteWorkflowOptions,
  ExecutionResult,
  Item,
  NodeExecutionResult,
  SerializedError,
  StepRecord,
} from './types.js';

interface EffectiveGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  incoming: Map<string, WorkflowEdge[]>;
  outgoing: Map<string, WorkflowEdge[]>;
}

function toSerializedError(caught: unknown): SerializedError {
  if (caught instanceof Error) {
    return {
      message: caught.message,
      code: (caught as { code?: string }).code,
      details: (caught as { details?: unknown }).details,
    };
  }
  return { message: String(caught) };
}

function resolveEnabledTargets(
  edge: WorkflowEdge,
  byId: Map<string, WorkflowNode>,
  enabled: Set<string>,
  originalOutgoing: Map<string, WorkflowEdge[]>,
  seen: Set<string>,
): string[] {
  if (enabled.has(edge.target)) return [edge.target];
  if (seen.has(edge.target)) return [];
  seen.add(edge.target);

  const target = byId.get(edge.target);
  if (!target) return [];
  const targets: string[] = [];
  for (const next of originalOutgoing.get(target.id) ?? []) {
    targets.push(...resolveEnabledTargets(next, byId, enabled, originalOutgoing, seen));
  }
  return targets;
}

/**
 * Disabled nodes act as transparent pass-throughs: edges are reconnected from
 * the nearest enabled predecessor to the nearest enabled successor(s).
 */
export function buildEffectiveGraph(graph: WorkflowGraph): EffectiveGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const enabled = new Set(
    graph.nodes.filter((node) => !node.disabled).map((node) => node.id),
  );

  const originalOutgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const list = originalOutgoing.get(edge.source) ?? [];
    list.push(edge);
    originalOutgoing.set(edge.source, list);
  }

  const edges: WorkflowEdge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!enabled.has(edge.source)) continue;
    const targets = resolveEnabledTargets(edge, byId, enabled, originalOutgoing, new Set([edge.source]));
    for (const target of targets) {
      const key = `${edge.source}|${edge.sourceHandle ?? ''}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: targets.length === 1 ? edge.id : `${edge.id}:${target}`,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target,
      });
    }
  }

  const nodes = graph.nodes.filter((node) => enabled.has(node.id));
  const incoming = new Map<string, WorkflowEdge[]>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }

  return { nodes, edges, incoming, outgoing };
}

function combineInputs(
  node: WorkflowNode,
  incoming: WorkflowEdge[],
  outputs: Map<string, Record<string, Item[]>>,
): Item[] {
  const groups: Item[][] = [];
  for (const edge of incoming) {
    const sourceOutputs = outputs.get(edge.source);
    if (!sourceOutputs) continue;
    const handle = edge.sourceHandle ?? 'main';
    const items = sourceOutputs[handle];
    if (items && items.length > 0) groups.push(items);
  }

  if (groups.length === 0) return [];
  if (node.type === 'merge') return groups.flat();
  // Regular nodes receive the concatenation of every active branch (n8n-like).
  return groups.flat();
}

function hasErrorBranch(
  nodeId: string,
  outgoing: Map<string, WorkflowEdge[]>,
): boolean {
  return (outgoing.get(nodeId) ?? []).some((edge) => edge.sourceHandle === 'error');
}

export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<ExecutionResult> {
  const { graph, context, hooks = {} } = options;
  const startedAt = new Date();
  const steps: StepRecord[] = [];
  const outputs = new Map<string, Record<string, Item[]>>();
  const effective = buildEffectiveGraph(graph);
  const ordered = topologicalOrder({ nodes: effective.nodes, edges: effective.edges });
  const byId = new Map(effective.nodes.map((node) => [node.id, node]));
  const triggerNodes = effective.nodes.filter(
    (node) =>
      TRIGGER_TYPES.has(node.type) && (effective.incoming.get(node.id) ?? []).length === 0,
  );

  const selectedTrigger =
    (options.triggerNodeId ? byId.get(options.triggerNodeId) : undefined) ?? triggerNodes[0];
  const roots = selectedTrigger ? [selectedTrigger] : triggerNodes;

  let hasErrors = false;
  let fatalError: SerializedError | undefined;
  let status: ExecutionResult['status'] = 'succeeded';

  const cancelled = async (): Promise<boolean> => {
    if (context.signal.aborted) return true;
    if (hooks.isCanceled) return Boolean(await hooks.isCanceled());
    return false;
  };

  const recordSkipped = async (node: WorkflowNode, reason: string): Promise<void> => {
    const now = new Date();
    const step: StepRecord = {
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name,
      iteration: 0,
      attempt: 1,
      status: 'skipped',
      input: { reason },
      startedAt: now,
      finishedAt: now,
    };
    steps.push(step);
    await hooks.onNodeFinished?.(step);
  };

  outer: for (const node of ordered) {
    if (await cancelled()) {
      status = 'canceled';
      await recordSkipped(node, 'Execution canceled');
      continue;
    }

    if (context.signal.aborted) {
      status = 'canceled';
      await recordSkipped(node, 'Execution canceled');
      continue;
    }

    const isRoot = roots.some((root) => root.id === node.id);
    const incoming = effective.incoming.get(node.id) ?? [];

    if (!isRoot && incoming.length === 0) {
      await recordSkipped(node, 'Orphan node (no active trigger path)');
      continue;
    }

    let input: Item[] = [];
    if (isRoot) {
      input = [{ json: context.trigger.payload ?? null }];
    } else {
      // Merge waits for every predecessor; other nodes also need their inputs
      // assembled, which topological order guarantees are available.
      input = combineInputs(node, incoming, outputs);
      if (input.length === 0) {
        await recordSkipped(node, 'No items reached this node');
        continue;
      }
    }

    const executor = getNodeExecutor(node.type);
    if (!executor) {
      const error = { message: `Unknown node type: ${node.type}`, code: 'unknown_node_type' };
      const now = new Date();
      const step: StepRecord = {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        iteration: 0,
        attempt: 1,
        status: 'failed',
        input: truncatePayload(input),
        error,
        startedAt: now,
        finishedAt: now,
      };
      steps.push(step);
      await hooks.onNodeFinished?.(step);
      hasErrors = true;
      fatalError = error;
      status = 'failed';
      break;
    }

    const retry = nodeRetryOptions(node);
    let result: NodeExecutionResult | undefined;
    let lastError: SerializedError | undefined;
    let attempt = 0;

    for (attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      if (await cancelled()) break;
      const attemptStarted = new Date();
      const startedStep: StepRecord = {
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name,
        iteration: 0,
        attempt,
        status: 'running',
        input: truncatePayload(input),
        startedAt: attemptStarted,
        finishedAt: attemptStarted,
      };
      await hooks.onNodeStarted?.(startedStep);

      try {
        const outcome = await executor({
          node,
          input,
          context,
          outputs,
          retry,
        });
        result = outcome;
        const finished: StepRecord = {
          ...startedStep,
          status: 'succeeded',
          output: truncatePayload(outcome.outputs),
          finishedAt: new Date(),
        };
        steps.push(finished);
        await hooks.onNodeFinished?.(finished);
        lastError = undefined;
        break;
      } catch (caught) {
        lastError = toSerializedError(caught);
        const finished: StepRecord = {
          ...startedStep,
          status: 'failed',
          error: lastError,
          finishedAt: new Date(),
        };
        steps.push(finished);
        await hooks.onNodeFinished?.(finished);

        if (context.signal.aborted) break;
        const retryable = (caught as { retryable?: boolean })?.retryable !== false;
        if (attempt >= retry.maxAttempts || !retryable) break;
        if (retry.backoffMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retry.backoffMs * attempt));
        }
      }
    }

    if (result) {
      outputs.set(node.id, result.outputs);
      continue;
    }

    if (context.signal.aborted || (await cancelled())) {
      status = 'canceled';
      continue;
    }

    if (lastError) {
      hasErrors = true;
      if (hasErrorBranch(node.id, effective.outgoing)) {
        const errorItem: Item = {
          json: {
            error: lastError,
            nodeId: node.id,
            nodeName: node.name,
          },
        };
        outputs.set(node.id, { error: [errorItem], main: [] });
        await hooks.onLog?.('warn', `Node "${node.name}" failed; continuing through error branch`, {
          nodeId: node.id,
          error: lastError,
        });
        continue;
      }

      fatalError = lastError;
      status = 'failed';
      await hooks.onLog?.('error', `Execution failed at node "${node.name}"`, {
        nodeId: node.id,
        error: lastError,
      });
      break outer;
    }
  }

  // Mark all nodes after an early stop as skipped for a complete timeline.
  const executed = new Set(steps.map((step) => step.nodeId));
  for (const node of ordered) {
    if (status === 'failed' || status === 'canceled') {
      if (!executed.has(node.id)) await recordSkipped(node, 'Not executed');
    }
  }

  const finishedAt = new Date();
  return {
    status,
    hasErrors,
    error: fatalError,
    steps,
    outputs: Object.fromEntries(outputs),
    startedAt,
    finishedAt,
  };
}

const MAX_PAYLOAD_CHARS = 200_000;

export function truncatePayload(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    if (serialized.length <= MAX_PAYLOAD_CHARS) return value;
    return {
      truncated: true,
      originalLength: serialized.length,
      preview: serialized.slice(0, MAX_PAYLOAD_CHARS),
    };
  } catch {
    return { truncated: true, reason: 'not_serializable' };
  }
}

export type { EngineContext, EngineHooks };
