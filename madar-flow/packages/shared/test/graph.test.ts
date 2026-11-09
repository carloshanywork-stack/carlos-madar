import assert from 'node:assert/strict';
import test from 'node:test';
import { topologicalOrder, validateGraph, workflowGraphSchema } from '../src/graph-validation.js';
import type { WorkflowGraph } from '../src/graph.js';

function node(id: string): WorkflowGraph['nodes'][number] {
  return {
    id,
    type: 'noop',
    typeVersion: 1,
    name: id,
    position: { x: 0, y: 0 },
    parameters: {},
  };
}

function edge(source: string, target: string, id = `${source}-${target}`): WorkflowGraph['edges'][number] {
  return { id, source, target };
}

test('valid DAG passes validation', () => {
  const graph: WorkflowGraph = {
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('a', 'b'), edge('b', 'c')],
  };
  assert.deepEqual(validateGraph(graph), { ok: true, issues: [] });
  assert.deepEqual(
    topologicalOrder(graph).map((entry) => entry.id),
    ['a', 'b', 'c'],
  );
});

test('cycle is rejected', () => {
  const graph: WorkflowGraph = {
    nodes: [node('a'), node('b')],
    edges: [edge('a', 'b'), edge('b', 'a')],
  };
  const result = validateGraph(graph);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'cycle'));
});

test('unknown endpoints, duplicates, and self loops are reported', () => {
  const graph: WorkflowGraph = {
    nodes: [node('a'), node('a')],
    edges: [edge('a', 'missing'), edge('a', 'a'), edge('a', 'missing')],
  };
  const result = validateGraph(graph);
  const codes = new Set(result.issues.map((issue) => issue.code));
  assert.ok(codes.has('duplicate_node_id'));
  assert.ok(codes.has('unknown_edge_target'));
  assert.ok(codes.has('self_loop'));
  assert.ok(codes.has('duplicate_edge'));
});

test('graph schema fills defaults and rejects non-finite positions', () => {
  const parsed = workflowGraphSchema.parse({
    nodes: [
      {
        id: 'n1',
        type: 'http',
        name: 'طلب',
        position: { x: 1, y: 2 },
        parameters: {},
      },
    ],
    edges: [],
  });
  assert.equal(parsed.nodes[0]!.typeVersion, 1);
  assert.equal(workflowGraphSchema.safeParse({ nodes: [{ id: 'x' }], edges: [] }).success, false);
});
