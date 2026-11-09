import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateNodeParameters,
  validateWorkflowForPublish,
} from '../src/node-contracts.js';
import type { WorkflowGraph } from '../src/graph.js';

function node(
  id: string,
  type: string,
  parameters: Record<string, unknown> = {},
  overrides: Partial<WorkflowGraph['nodes'][number]> = {},
): WorkflowGraph['nodes'][number] {
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

test('HTTP contract accepts valid parameters and rejects bad URLs', () => {
  assert.deepEqual(
    validateNodeParameters('http', { method: 'GET', url: 'https://example.com' }),
    [],
  );
  const errors = validateNodeParameters('http', { method: 'GET', url: 'example.com' });
  assert.ok(errors.some((issue) => issue.path === 'url'));

  const expressionUrl = validateNodeParameters('http', {
    method: 'POST',
    url: '{{ $json.baseUrl }}/orders',
  });
  assert.deepEqual(expressionUrl, []);
});

test('HTTP JSON body must parse unless it contains expressions', () => {
  const bad = validateNodeParameters('http', {
    method: 'POST',
    url: 'https://example.com',
    bodyType: 'json',
    body: '{ bad json',
  });
  assert.ok(bad.some((issue) => issue.path === 'body'));

  const templated = validateNodeParameters('http', {
    method: 'POST',
    url: 'https://example.com',
    bodyType: 'json',
    body: '{ "name": "{{ $json.name }}" }',
  });
  assert.deepEqual(templated, []);
});

test('IF requires an operator and a right side where needed', () => {
  assert.ok(
    validateNodeParameters('if', { conditions: [], combinator: 'and' }).some(
      (issue) => issue.path === 'conditions',
    ),
  );

  assert.ok(
    validateNodeParameters('if', {
      conditions: [{ left: '{{ $json.count }}', operator: 'greaterThan' }],
      combinator: 'and',
    }).some((issue) => issue.path === 'conditions.0.right'),
  );

  assert.deepEqual(
    validateNodeParameters('if', {
      conditions: [{ left: '{{ $json.count }}', operator: 'exists' }],
      combinator: 'and',
    }),
    [],
  );
});

test('schedule validates cron and timezone', () => {
  assert.deepEqual(
    validateNodeParameters('schedule', { cron: '0 9 * * *', timezone: 'Africa/Cairo' }),
    [],
  );
  assert.ok(validateNodeParameters('schedule', { cron: 'every day', timezone: 'Africa/Cairo' }).length > 0);
  assert.ok(validateNodeParameters('schedule', { cron: '0 9 * * *', timezone: 'Mars/Base' }).length > 0);
});

test('publish validation requires a trigger and known node types', () => {
  const noTrigger = validateWorkflowForPublish({
    nodes: [node('set', 'set', { values: {} })],
    edges: [],
  });
  assert.ok(noTrigger.some((issue) => issue.message.includes('Trigger')));

  const unknown = validateWorkflowForPublish({
    nodes: [node('manual', 'manual'), node('custom', 'custom_node', {})],
    edges: [{ id: 'e', source: 'manual', target: 'custom' }],
  });
  assert.ok(unknown.some((issue) => issue.message.includes('نوع عقدة غير معروف')));
});

test('publish validation skips disabled nodes and reports bad expressions', () => {
  const issue = validateWorkflowForPublish({
    nodes: [
      node('manual', 'manual'),
      node('http', 'http', { method: 'GET', url: '{{ $json. }}' }),
      node('bad', 'http', { method: 'GET', url: '' }, { disabled: true }),
    ],
    edges: [
      { id: 'e1', source: 'manual', target: 'http' },
      { id: 'e2', source: 'http', target: 'bad' },
    ],
  });
  assert.ok(issue.some((entry) => entry.nodeId === 'http' && entry.message.includes('JSONata')));
  assert.ok(!issue.some((entry) => entry.nodeId === 'bad'));
});
