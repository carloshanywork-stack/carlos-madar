import assert from 'node:assert/strict';
import test from 'node:test';
import { and, eq, isNull } from 'drizzle-orm';
import { memberships, workflowVersions } from '@madar/db';
import { EXECUTION_JOB, uuidv7, type WorkflowGraph } from '@madar/shared';
import {
  authHeaders,
  createTestContext,
  hasTestDatabase,
  registerSession,
} from './helpers/app.js';

function simpleGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'trigger',
        type: 'manual',
        typeVersion: 1,
        name: 'بدء يدوي',
        position: { x: 0, y: 0 },
        parameters: {},
      },
      {
        id: 'set',
        type: 'set',
        typeVersion: 1,
        name: 'تعيين',
        position: { x: 260, y: 0 },
        parameters: { values: { greeting: 'مرحبا' } },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'set' }],
  };
}

async function createPublishedWorkflow(
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  headers: Record<string, string>,
  workspaceId: string,
): Promise<string> {
  const base = `/api/v1/workspaces/${workspaceId}/workflows`;
  const created = await ctx.app.inject({
    method: 'POST',
    url: base,
    headers,
    payload: { name: 'اختبار التنفيذ' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const workflowId = (created.json() as { id: string }).id;

  const saved = await ctx.app.inject({
    method: 'PUT',
    url: `${base}/${workflowId}/draft`,
    headers,
    payload: { revision: 1, graph: simpleGraph() },
  });
  assert.equal(saved.statusCode, 200, saved.body);

  const published = await ctx.app.inject({
    method: 'POST',
    url: `${base}/${workflowId}/publish`,
    headers,
    payload: {},
  });
  assert.equal(published.statusCode, 201, published.body);
  return workflowId;
}

test('executions: run, list, detail, cancel, retry, test snapshot, payload gating', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const workspaceBase = `/api/v1/workspaces/${session.workspaceId}`;
    const workflowId = await createPublishedWorkflow(ctx, headers, session.workspaceId);

    const run = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows/${workflowId}/run`,
      headers,
      payload: { mode: 'production', payload: { orderId: 'A-1' } },
    });
    assert.equal(run.statusCode, 202, run.body);
    const execution = run.json() as {
      id: string;
      status: string;
      mode: string;
      triggerType: string;
    };
    assert.equal(execution.status, 'queued');
    assert.equal(execution.mode, 'production');
    assert.equal(execution.triggerType, 'manual');

    assert.equal(ctx.jobs.length, 1);
    assert.equal(ctx.jobs[0]!.name, EXECUTION_JOB);
    assert.equal(ctx.jobs[0]!.data.executionId, execution.id);
    assert.equal(ctx.jobs[0]!.opts?.jobId, `execution-${execution.id}`);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `${workspaceBase}/executions?workflowId=${workflowId}`,
      headers,
    });
    assert.equal(list.statusCode, 200, list.body);
    const listed = list.json() as Array<{ id: string; workflowName: string }>;
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, execution.id);
    assert.equal(listed[0]!.workflowName, 'اختبار التنفيذ');

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `${workspaceBase}/executions/${execution.id}`,
      headers,
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const detailBody = detail.json() as {
      triggerNodeId: string;
      triggerPayload: unknown;
      payloadAccess: boolean;
      steps: unknown[];
    };
    assert.equal(detailBody.triggerNodeId, 'trigger');
    assert.deepEqual(detailBody.triggerPayload, { orderId: 'A-1' });
    assert.equal(detailBody.payloadAccess, true);
    assert.equal(detailBody.steps.length, 0);

    // Test mode snapshots the draft as a nullable test version.
    const testRun = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows/${workflowId}/run`,
      headers,
      payload: { mode: 'test', payload: { draft: true } },
    });
    assert.equal(testRun.statusCode, 202, testRun.body);
    const testExecution = testRun.json() as { id: string; workflowVersionId: string };

    const testVersions = await ctx.deps.db
      .select({ id: workflowVersions.id, kind: workflowVersions.kind, version: workflowVersions.version })
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowId, workflowId),
          eq(workflowVersions.kind, 'test'),
          isNull(workflowVersions.version),
        ),
      );
    assert.equal(testVersions.length, 1);
    assert.equal(testVersions[0]!.id, testExecution.workflowVersionId);

    // Cancel is terminal and idempotency is rejected with 409.
    const canceled = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/executions/${execution.id}/cancel`,
      headers,
    });
    assert.equal(canceled.statusCode, 200, canceled.body);
    assert.equal((canceled.json() as { status: string }).status, 'canceled');

    const cancelAgain = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/executions/${execution.id}/cancel`,
      headers,
    });
    assert.equal(cancelAgain.statusCode, 409);

    // Retry clones the execution and enqueues a new job.
    const retried = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/executions/${execution.id}/retry`,
      headers,
    });
    assert.equal(retried.statusCode, 202, retried.body);
    const retryBody = retried.json() as { id: string; retryOfExecutionId: string; status: string };
    assert.notEqual(retryBody.id, execution.id);
    assert.equal(retryBody.retryOfExecutionId, execution.id);
    assert.equal(retryBody.status, 'queued');
    assert.equal(ctx.jobs.length, 3);

    // SSE stream tokens are short lived and scoped to the execution.
    const streamToken = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/executions/${testExecution.id}/stream-token`,
      headers,
    });
    assert.equal(streamToken.statusCode, 200, streamToken.body);
    const tokenBody = streamToken.json() as { token: string; expiresIn: number; url: string };
    assert.equal(tokenBody.expiresIn, 60);
    assert.match(tokenBody.url, /\/api\/v1\/executions\/stream\?token=/);

    // A viewer can read executions but not payloads.
    const viewer = await registerSession(ctx.app);
    await ctx.deps.db.insert(memberships).values({
      id: uuidv7(),
      workspaceId: session.workspaceId,
      userId: viewer.userId,
      role: 'viewer',
    });

    const viewerDetail = await ctx.app.inject({
      method: 'GET',
      url: `${workspaceBase}/executions/${execution.id}`,
      headers: authHeaders(viewer),
    });
    assert.equal(viewerDetail.statusCode, 200, viewerDetail.body);
    const gated = viewerDetail.json() as {
      triggerPayload: unknown;
      payloadAccess: boolean;
      steps: Array<{ input: unknown; output: unknown }>;
    };
    assert.equal(gated.triggerPayload, null);
    assert.equal(gated.payloadAccess, false);
    assert.ok(gated.steps.every((step) => step.input === null && step.output === null));

    const viewerRun = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows/${workflowId}/run`,
      headers: authHeaders(viewer),
      payload: { mode: 'production' },
    });
    assert.equal(viewerRun.statusCode, 403);
  } finally {
    await ctx.close();
  }
});

test('executions: invalid input and queue failures', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const workspaceBase = `/api/v1/workspaces/${session.workspaceId}`;

    const created = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows`,
      headers,
      payload: { name: 'غير منشور' },
    });
    const workflowId = (created.json() as { id: string }).id;

    const noPublish = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows/${workflowId}/run`,
      headers,
      payload: { mode: 'production' },
    });
    assert.equal(noPublish.statusCode, 400);
    assert.equal((noPublish.json() as { title: string }).title, 'Workflow has no published version');

    const saved = await ctx.app.inject({
      method: 'PUT',
      url: `${workspaceBase}/workflows/${workflowId}/draft`,
      headers,
      payload: { revision: 1, graph: simpleGraph() },
    });
    assert.equal(saved.statusCode, 200);
    const published = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows/${workflowId}/publish`,
      headers,
      payload: {},
    });
    assert.equal(published.statusCode, 201);

    const oversized = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows/${workflowId}/run`,
      headers,
      payload: { mode: 'production', payload: { blob: 'x'.repeat(300 * 1024) } },
    });
    assert.equal(oversized.statusCode, 400);

    ctx.failNextEnqueue = true;
    const queueDown = await ctx.app.inject({
      method: 'POST',
      url: `${workspaceBase}/workflows/${workflowId}/run`,
      headers,
      payload: { mode: 'production' },
    });
    assert.equal(queueDown.statusCode, 503, queueDown.body);

    const list = await ctx.app.inject({
      method: 'GET',
      url: `${workspaceBase}/executions?status=failed`,
      headers,
    });
    const failed = list.json() as Array<{ status: string; error: { code?: string } | null }>;
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!.status, 'failed');
    assert.equal(failed[0]!.error?.code, 'queue_unavailable');

    const missing = await ctx.app.inject({
      method: 'GET',
      url: `${workspaceBase}/executions/${uuidv7()}`,
      headers,
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await ctx.close();
  }
});
