import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import {
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  instantiateTemplateGraph,
  validateWorkflowForPublish,
  type WorkflowGraph,
  type WorkflowTemplate,
} from '@madar/shared';
import { executeWorkflow } from '../src/executor.js';
import type { EngineContext } from '../src/types.js';

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function templateFixture(id: string): WorkflowTemplate {
  const template = getWorkflowTemplate(id);
  assert.ok(template, `template ${id} exists`);
  return template;
}

function localGraph(template: WorkflowTemplate, base: string): WorkflowGraph {
  const urls: Record<string, string> = {};
  for (const node of template.graph.nodes) {
    if (node.type !== 'http') continue;
    const parsed = new URL(String(node.parameters.url));
    urls[node.id] = `${base}${parsed.pathname}${parsed.search}`;
  }

  const graph = instantiateTemplateGraph(template, { urls });
  // Keep retry semantics (3 attempts) but remove the production back-off delay.
  for (const node of graph.nodes) {
    if (node.type === 'http' && node.parameters.retry) {
      node.parameters.retry = { maxAttempts: 3, backoffMs: 1 };
    }
  }
  return graph;
}

function context(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    executionId: 'exec-template',
    workflowId: 'wf-template',
    workspaceId: 'ws-template',
    workflowVersionId: 'ver-template',
    mode: 'production',
    trigger: { type: 'manual', payload: null },
    signal: new AbortController().signal,
    now: () => new Date('2026-11-09T09:00:00.000Z'),
    ...overrides,
  };
}

test('all five templates pass shared publish validation', () => {
  assert.equal(WORKFLOW_TEMPLATES.length, 5);

  for (const template of WORKFLOW_TEMPLATES) {
    const issues = validateWorkflowForPublish(template.graph);
    assert.deepEqual(issues, [], `${template.id}: ${JSON.stringify(issues)}`);
  }
});

test('WF1 health check: manual → set → HTTP → noop', async () => {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method ?? '', url: request.url ?? '', body });
    json(response, 200, { status: 'ok', version: '1.0.0' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const graph = localGraph(templateFixture('wf1-health-check'), base);
    const result = await executeWorkflow({
      graph,
      context: context({ trigger: { type: 'manual', payload: { requestedBy: 'اختبار' } } }),
    });

    assert.equal(result.status, 'succeeded', JSON.stringify(result.error));
    assert.equal(result.hasErrors, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, '/health');

    const prepared = result.outputs.wf1_prepare?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(prepared.requestedBy, 'اختبار');
    assert.equal(prepared.checkedAt, '2026-11-09T09:00:00.000Z');

    const output = result.outputs.wf1_done?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(output.status, 'ok');
    assert.equal(output.version, '1.0.0');
    assert.equal(result.steps.length, 4);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WF2 webhook alert: HMAC payload, IF branches, HTTP delivery, and error branch', async () => {
  const requests: RecordedRequest[] = [];
  let failDelivery = false;
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method ?? '', url: request.url ?? '', body });
    if (failDelivery) {
      json(response, 500, { error: 'channel down' });
      return;
    }
    json(response, 200, { delivered: true });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const graph = localGraph(templateFixture('wf2-webhook-alert'), base);

    const critical = await executeWorkflow({
      graph,
      context: context({
        trigger: {
          type: 'webhook',
          method: 'POST',
          payload: { severity: 'critical', message: 'قاعدة البيانات متوقفة' },
          headers: { 'x-madar-delivery': 'delivery-1' },
        },
      }),
    });

    assert.equal(critical.status, 'succeeded', JSON.stringify(critical.error));
    assert.equal(critical.hasErrors, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'POST');
    assert.deepEqual(JSON.parse(requests[0]!.body), {
      severity: 'critical',
      message: 'قاعدة البيانات متوقفة',
    });
    const delivered = critical.outputs.wf2_done?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(delivered.delivered, true);

    requests.length = 0;
    const normal = await executeWorkflow({
      graph,
      context: context({
        trigger: {
          type: 'webhook',
          method: 'POST',
          payload: { severity: 'info', message: 'تحديث دوري' },
        },
      }),
    });

    assert.equal(normal.status, 'succeeded');
    assert.equal(requests.length, 0, 'normal severity must not call the alert channel');
    const normalOutput = normal.outputs.wf2_done?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(normalOutput.severity, 'info');
    assert.equal(normal.steps.find((step) => step.nodeId === 'wf2_send')?.status, 'skipped');

    failDelivery = true;
    requests.length = 0;
    const failed = await executeWorkflow({
      graph,
      context: context({
        trigger: {
          type: 'webhook',
          method: 'POST',
          payload: { severity: 'critical', message: 'فشل القناة' },
        },
      }),
    });

    assert.equal(failed.status, 'succeeded');
    assert.equal(failed.hasErrors, true);
    assert.equal(requests.length, 3, 'HTTP retries three times before the error branch');
    assert.equal(failed.steps.find((step) => step.nodeId === 'wf2_error')?.status, 'succeeded');
    const errorItem = failed.outputs.wf2_error?.main?.[0]?.json as {
      nodeId: string;
      error: { message: string };
    };
    assert.equal(errorItem.nodeId, 'wf2_send');
    assert.match(errorItem.error.message, /500/);
    assert.equal(failed.outputs.wf2_done?.main?.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WF3 daily report: schedule metadata and ready/empty IF branches', async () => {
  let reportStatus = 'ready';
  const server = createServer((request, response) => {
    json(response, 200, { status: reportStatus, date: '2026-11-09' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const graph = localGraph(templateFixture('wf3-daily-report'), base);
    const scheduledAt = '2026-11-09T07:00:00.000Z';

    const ready = await executeWorkflow({
      graph,
      context: context({ trigger: { type: 'schedule', scheduledAt } }),
    });

    assert.equal(ready.status, 'succeeded', JSON.stringify(ready.error));
    assert.deepEqual(ready.outputs.wf3_schedule?.main?.[0]?.json, { scheduledAt });
    const readyOutput = ready.outputs.wf3_ready?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(readyOutput.status, 'ready');
    assert.equal(ready.steps.find((step) => step.nodeId === 'wf3_empty')?.status, 'skipped');

    reportStatus = 'empty';
    const empty = await executeWorkflow({
      graph,
      context: context({ trigger: { type: 'schedule', scheduledAt } }),
    });

    assert.equal(empty.status, 'succeeded');
    const emptyOutput = empty.outputs.wf3_empty?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(emptyOutput.status, 'empty');
    assert.equal(empty.steps.find((step) => step.nodeId === 'wf3_ready')?.status, 'skipped');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WF4 two-source sync: fan-out, merge, set, and sink payload', async () => {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ method: request.method ?? '', url: request.url ?? '', body });

    if (request.url === '/source-a') {
      json(response, 200, { source: 'a', value: 1 });
      return;
    }
    if (request.url === '/source-b') {
      json(response, 200, { source: 'b', value: 2 });
      return;
    }
    if (request.url === '/sync') {
      json(response, 202, { accepted: true });
      return;
    }
    json(response, 404, { error: 'not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const graph = localGraph(templateFixture('wf4-two-source-sync'), base);
    const result = await executeWorkflow({ graph, context: context() });

    assert.equal(result.status, 'succeeded', JSON.stringify(result.error));
    assert.equal(result.hasErrors, false);

    const merged = result.outputs.wf4_merge?.main?.map((item) => item.json) ?? [];
    assert.deepEqual(merged, [
      { source: 'a', value: 1 },
      { source: 'b', value: 2 },
    ]);

    const unified = result.outputs.wf4_unify?.main?.map((item) => item.json) ?? [];
    assert.equal(unified.length, 2);
    assert.deepEqual(unified[0], {
      source: 'a',
      value: 1,
      syncedAt: '2026-11-09T09:00:00.000Z',
      origin: 'madar-flow',
    });

    const syncRequest = requests.find((request) => request.url === '/sync');
    assert.ok(syncRequest);
    assert.equal(syncRequest.method, 'POST');
    assert.deepEqual(JSON.parse(syncRequest.body), unified[0]);
    const accepted = result.outputs.wf4_sink?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(accepted.accepted, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WF5 API monitor: healthy, degraded, and retry-exhausted error branch', async () => {
  let healthStatus = 'ok';
  let failHealth = false;
  let attempts = 0;
  const server = createServer((request, response) => {
    attempts += 1;
    if (failHealth) {
      json(response, 503, { status: 'down' });
      return;
    }
    json(response, 200, { status: healthStatus });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const graph = localGraph(templateFixture('wf5-api-monitor'), base);
    const scheduledAt = '2026-11-09T08:45:00.000Z';

    const healthy = await executeWorkflow({
      graph,
      context: context({ trigger: { type: 'schedule', scheduledAt } }),
    });
    assert.equal(healthy.status, 'succeeded', JSON.stringify(healthy.error));
    assert.equal(healthy.hasErrors, false);
    const healthyOutput = healthy.outputs.wf5_success?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(healthyOutput.state, 'healthy');
    assert.equal(healthyOutput.checkedAt, '2026-11-09T09:00:00.000Z');
    assert.equal(healthy.steps.find((step) => step.nodeId === 'wf5_warning')?.status, 'skipped');

    healthStatus = 'degraded';
    const degraded = await executeWorkflow({
      graph,
      context: context({ trigger: { type: 'schedule', scheduledAt } }),
    });
    assert.equal(degraded.status, 'succeeded');
    const degradedOutput = degraded.outputs.wf5_warning?.main?.[0]?.json as Record<string, unknown>;
    assert.equal(degradedOutput.state, 'degraded');
    assert.equal(degraded.steps.find((step) => step.nodeId === 'wf5_success')?.status, 'skipped');

    failHealth = true;
    attempts = 0;
    const failed = await executeWorkflow({
      graph,
      context: context({ trigger: { type: 'schedule', scheduledAt } }),
    });

    assert.equal(failed.status, 'succeeded');
    assert.equal(failed.hasErrors, true);
    assert.equal(attempts, 3, 'retry.maxAttempts is honored before the error branch');
    assert.equal(failed.steps.find((step) => step.nodeId === 'wf5_if')?.status, 'skipped');
    assert.equal(failed.steps.find((step) => step.nodeId === 'wf5_error')?.status, 'succeeded');
    const errorItem = failed.outputs.wf5_error?.main?.[0]?.json as {
      nodeId: string;
      error: { details?: { status?: number } };
    };
    assert.equal(errorItem.nodeId, 'wf5_check');
    assert.equal(errorItem.error.details?.status, 503);
    assert.equal(failed.outputs.wf5_done?.main?.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
