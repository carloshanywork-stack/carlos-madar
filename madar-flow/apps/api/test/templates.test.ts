import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowGraph } from '@madar/shared';
import {
  authHeaders,
  createTestContext,
  hasTestDatabase,
  registerSession,
} from './helpers/app.js';

interface TemplateSummary {
  id: string;
  name: string;
  trigger: string;
  nodeTypes: string[];
  requiresHmacCredentialFor: string[];
}

async function createHmacCredential(
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  headers: Record<string, string>,
  workspaceId: string,
): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/credentials`,
    headers,
    payload: { name: 'Webhook HMAC', type: 'hmac', payload: { secret: 'template-test-secret' } },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

test('templates: list the five MVP acceptance workflows', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${session.workspaceId}/workflow-templates`,
      headers: authHeaders(session),
    });

    assert.equal(response.statusCode, 200, response.body);
    const templates = response.json() as TemplateSummary[];
    assert.deepEqual(
      templates.map((template) => template.id),
      ['wf1-health-check', 'wf2-webhook-alert', 'wf3-daily-report', 'wf4-two-source-sync', 'wf5-api-monitor'],
    );
    assert.deepEqual(
      templates.map((template) => template.trigger),
      ['manual', 'webhook', 'schedule', 'manual', 'schedule'],
    );
    const webhookTemplate = templates.find((template) => template.id === 'wf2-webhook-alert');
    assert.deepEqual(webhookTemplate?.requiresHmacCredentialFor, ['wf2_webhook']);
  } finally {
    await ctx.close();
  }
});

test('templates: instantiate as a draft with URL and credential mapping', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const base = `/api/v1/workspaces/${session.workspaceId}`;

    const instantiated = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflow-templates/wf4-two-source-sync/instantiate`,
      headers,
      payload: {
        name: 'مزامنة الإنتاج',
        urls: {
          wf4_source_a: 'https://internal.example/source-a',
          wf4_source_b: 'https://internal.example/source-b',
          wf4_sink: 'https://internal.example/sink',
        },
      },
    });

    assert.equal(instantiated.statusCode, 201, instantiated.body);
    const workflow = instantiated.json() as {
      id: string;
      name: string;
      currentVersionId: string | null;
      draft: { revision: number; graph: WorkflowGraph } | null;
      versions: unknown[];
    };

    assert.equal(workflow.name, 'مزامنة الإنتاج');
    assert.equal(workflow.currentVersionId, null);
    assert.equal(workflow.draft?.revision, 1);
    assert.equal(workflow.versions.length, 0);

    const urls = new Map(
      (workflow.draft?.graph.nodes ?? []).map((node) => [node.id, node.parameters.url]),
    );
    assert.equal(urls.get('wf4_source_a'), 'https://internal.example/source-a');
    assert.equal(urls.get('wf4_source_b'), 'https://internal.example/source-b');
    assert.equal(urls.get('wf4_sink'), 'https://internal.example/sink');

    // The stored graph is a copy: publishing later must not mutate the template.
    const publish = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflows/${workflow.id}/publish`,
      headers,
      payload: {},
    });
    assert.equal(publish.statusCode, 201, publish.body);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `${base}/workflows/${workflow.id}`,
      headers,
    });
    const detailBody = detail.json() as { currentVersionId: string | null; versions: unknown[] };
    assert.ok(detailBody.currentVersionId);
    assert.equal(detailBody.versions.length, 1);
  } finally {
    await ctx.close();
  }
});

test('templates: WF2 requires an HMAC credential before publishing', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const base = `/api/v1/workspaces/${session.workspaceId}`;

    const instantiated = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflow-templates/wf2-webhook-alert/instantiate`,
      headers,
      payload: {},
    });
    assert.equal(instantiated.statusCode, 201, instantiated.body);
    const workflowId = (instantiated.json() as { id: string }).id;

    const rejected = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflows/${workflowId}/publish`,
      headers,
      payload: {},
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.match(rejected.body, /HMAC credential/);

    const credentialId = await createHmacCredential(ctx, headers, session.workspaceId);

    const configured = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflow-templates/wf2-webhook-alert/instantiate`,
      headers,
      payload: { credentialIds: { wf2_webhook: credentialId } },
    });
    assert.equal(configured.statusCode, 201, configured.body);
    const configuredWorkflow = configured.json() as {
      id: string;
      draft: { graph: WorkflowGraph };
    };

    const hook = configuredWorkflow.draft.graph.nodes.find((node) => node.id === 'wf2_webhook');
    assert.equal(hook?.parameters.credentialId, credentialId);

    const published = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflows/${configuredWorkflow.id}/publish`,
      headers,
      payload: {},
    });
    assert.equal(published.statusCode, 201, published.body);
  } finally {
    await ctx.close();
  }
});

test('templates: unknown template and foreign credentials are rejected', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const base = `/api/v1/workspaces/${session.workspaceId}`;

    const missing = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflow-templates/does-not-exist/instantiate`,
      headers,
      payload: {},
    });
    assert.equal(missing.statusCode, 404, missing.body);

    const foreignSession = await registerSession(ctx.app);
    const foreignCredential = await createHmacCredential(
      ctx,
      authHeaders(foreignSession),
      foreignSession.workspaceId,
    );

    const foreign = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflow-templates/wf2-webhook-alert/instantiate`,
      headers,
      payload: { credentialIds: { wf2_webhook: foreignCredential } },
    });
    assert.equal(foreign.statusCode, 400, foreign.body);

    const unknownNode = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflow-templates/wf1-health-check/instantiate`,
      headers,
      payload: { urls: { not_a_node: 'https://example.com/x' } },
    });
    assert.equal(unknownNode.statusCode, 400, unknownNode.body);
  } finally {
    await ctx.close();
  }
});
