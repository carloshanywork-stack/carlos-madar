import { z } from 'zod';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from './graph.js';

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const workflowNodeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(120),
  typeVersion: z.number().int().min(1).default(1),
  name: z.string().trim().min(1).max(200),
  position: positionSchema,
  parameters: z.record(z.unknown()).default({}),
  disabled: z.boolean().optional(),
  notes: z.string().max(4_000).optional(),
});

export const workflowEdgeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(120),
  sourceHandle: z.string().max(120).optional(),
  target: z.string().trim().min(1).max(120),
  targetHandle: z.string().max(120).optional(),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema).max(500),
  edges: z.array(workflowEdgeSchema).max(2_000),
});

export interface GraphIssue {
  code:
    | 'duplicate_node_id'
    | 'duplicate_edge'
    | 'unknown_edge_source'
    | 'unknown_edge_target'
    | 'self_loop'
    | 'cycle';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GraphValidationResult {
  ok: boolean;
  issues: GraphIssue[];
}

/**
 * Validates referential integrity and DAG-ness. Node parameter contents are
 * validated by each node's own contract (Phase 2+).
 */
export function validateGraph(graph: WorkflowGraph): GraphValidationResult {
  const issues: GraphIssue[] = [];
  const nodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: 'duplicate_node_id',
        message: `Node id "${node.id}" is used more than once.`,
        nodeId: node.id,
      });
    }
    nodeIds.add(node.id);
  }

  const edgeKeys = new Set<string>();
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
    indegree.set(id, 0);
  }

  for (const edge of graph.edges) {
    const key = [edge.source, edge.sourceHandle ?? '', edge.target, edge.targetHandle ?? ''].join('|');
    if (edgeKeys.has(key)) {
      issues.push({
        code: 'duplicate_edge',
        message: `Duplicate edge "${edge.id}".`,
        edgeId: edge.id,
      });
    }
    edgeKeys.add(key);

    if (edge.source === edge.target) {
      issues.push({
        code: 'self_loop',
        message: `Edge "${edge.id}" connects a node to itself.`,
        edgeId: edge.id,
      });
      continue;
    }

    if (!nodeIds.has(edge.source)) {
      issues.push({
        code: 'unknown_edge_source',
        message: `Edge "${edge.id}" starts from an unknown node "${edge.source}".`,
        edgeId: edge.id,
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        code: 'unknown_edge_target',
        message: `Edge "${edge.id}" ends at an unknown node "${edge.target}".`,
        edgeId: edge.id,
      });
    }

    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue = [...nodeIds].filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (visited !== nodeIds.size) {
    issues.push({
      code: 'cycle',
      message: 'The workflow graph contains a cycle; only DAGs are supported.',
    });
  }

  return { ok: issues.length === 0, issues };
}

export function topologicalOrder(graph: WorkflowGraph): WorkflowNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return ordered;
}

export function graphFromEdges(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
  return { nodes, edges };
}
