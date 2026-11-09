import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { executeWorkflow } from '../src/executor.js';
import type { EngineContext } from '../src/types.js';
import type { WorkflowGraph, WorkflowNode } from '@madar/shared';

function node(
  id: string,
  type: string,
  parameters: Record<string, unknown> = {},
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode {
  return {
    id,
    type,
    typeVersion: 1,
    name: id,
    position: { x: 0, y: 0 },
    parameters,
    ...overrides,
  };
}

function edge(source: string, target: string, sourceHandle?: string, id = `${source}-${target}`) {
  return { id, source, target, sourceHandle };
}

function context(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    executionId: 'exec-1',
    workflowId: 'wf-1',
    workspaceId: 'ws-1',
    workflowVersionId: 'ver-1',
    mode: 'production',
    trigger: { type: 'manual', payload: { name: 'أحمد', count: 2 } },
    signal: new AbortController().signal,
    now: () => new Date('2026-11-08T12:00:00.000Z'),
    ...overrides,
  };
}

async function run(graph: WorkflowGraph, overrides: Partial<EngineContext> = {}) {
  return executeWorkflow({ graph, context: context(overrides) });
}

test('linear workflow resolves JSONata and passes items through', async () => {
  const result = await run({
    nodes: [
      node('trigger', 'manual'),
      node('set', 'set', {
        values: { greeting: 'مرحبًا {{ $json.name }}', total: '{{ $json.count * 2 }}' },
      }),
      node('noop', 'noop'),
    ],
    edges: [edge('trigger', 'set'), edge('set', 'noop')],
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.hasErrors, false);
  const output = result.outputs.noop?.main?.[0]?.json as Record<string, unknown>;
  assert.equal(output.greeting, 'مرحبًا أحمد');
  assert.equal(output.total, 4);
  assert.equal(result.steps.filter((step) => step.status === 'succeeded').length, 3);
});

test('IF splits items to true and false branches and only the taken path runs', async () => {
  const result = await run({
    nodes: [
      node('trigger', 'manual'),
      node('set', 'set', {
        values: { accepted: '{{ $json.count > 1 }}' },
      }),
      node('if', 'if', {
        conditions: [{ left: '{{ $json.count }}', operator: 'greaterThan', right: '1' }],
        combinator: 'and',
      }),
      node('yes', 'set', { values: { branch: 'yes' }, keepOnlySet: true }),
      node('no', 'set', { values: { branch: 'no' }, keepOnlySet: true }),
    ],
    edges: [
      edge('trigger', 'set'),
      edge('set', 'if'),
      edge('if', 'yes', 'true'),
      edge('if', 'no', 'false'),
    ],
  });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.outputs.yes?.main?.[0]?.json, { branch: 'yes' });
  assert.equal(result.outputs.no, undefined);
  const skipped = result.steps.find((step) => step.nodeId === 'no');
  assert.equal(skipped?.status, 'skipped');
});

test('merge combines items from both branches', async () => {
  const result = await run({
    nodes: [
      node('trigger', 'manual'),
      node('a', 'set', { values: { from: 'a' }, keepOnlySet: true }),
      node('b', 'set', { values: { from: 'b' }, keepOnlySet: true }),
      node('merge', 'merge', { mode: 'append' }),
    ],
    edges: [edge('trigger', 'a'), edge('trigger', 'b'), edge('a', 'merge'), edge('b', 'merge')],
  });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(
    result.outputs.merge?.main?.map((item) => (item.json as { from: string }).from),
    ['a', 'b'],
  );
});

test('disabled nodes are bypassed transparently', async () => {
  const result = await run({
    nodes: [
      node('trigger', 'manual'),
      node('disabled', 'set', { values: { broken: true } }, { disabled: true }),
      node('after', 'set', { values: { ok: true }, keepOnlySet: true }),
    ],
    edges: [edge('trigger', 'disabled'), edge('disabled', 'after')],
  });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.outputs.after?.main?.[0]?.json, { ok: true });
  assert.equal(result.outputs.disabled, undefined);
});

test('HTTP node retries and succeeds, then exposes the response body', async () => {
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts += 1;
    if (attempts < 3) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":"boom"}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true,"path":"' + request.url + '"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const result = await run({
      nodes: [
        node('trigger', 'manual'),
        node('http', 'http', {
          method: 'GET',
          url: `${base}/status`,
          query: { name: '{{ $json.name }}' },
          retry: { maxAttempts: 3, backoffMs: 1 },
        }),
      ],
      edges: [edge('trigger', 'http')],
    });

    assert.equal(result.status, 'succeeded', JSON.stringify(result.error));
    assert.equal(attempts, 3);
    assert.deepEqual(result.outputs.http?.main?.[0]?.json, {
      ok: true,
      path: '/status?name=%D8%A3%D8%AD%D9%85%D8%AF',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('failing node with an error branch continues and marks hasErrors', async () => {
  const result = await run({
    nodes: [
      node('trigger', 'manual'),
      node('http', 'http', { method: 'GET', url: 'http://127.0.0.1:1/unreachable' }),
      node('handler', 'set', { values: { recovered: true }, keepOnlySet: true }),
    ],
    edges: [edge('trigger', 'http'), edge('http', 'handler', 'error')],
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.hasErrors, true);
  assert.deepEqual(result.outputs.handler?.main?.[0]?.json, { recovered: true });
});

test('failing node without error branch fails the execution', async () => {
  const result = await run({
    nodes: [
      node('trigger', 'manual'),
      node('http', 'http', { method: 'GET', url: 'http://127.0.0.1:1/unreachable' }),
      node('after', 'noop'),
    ],
    edges: [edge('trigger', 'http'), edge('http', 'after')],
  });

  assert.equal(result.status, 'failed');
  assert.ok(result.error?.message);
  const after = result.steps.find((step) => step.nodeId === 'after');
  assert.equal(after?.status, 'skipped');
});

test('canceled signal stops the run and reports canceled status', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await run(
    {
      nodes: [node('trigger', 'manual'), node('after', 'noop')],
      edges: [edge('trigger', 'after')],
    },
    { signal: controller.signal },
  );

  assert.equal(result.status, 'canceled');
});
