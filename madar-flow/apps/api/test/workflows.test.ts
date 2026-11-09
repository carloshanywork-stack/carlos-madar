import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowGraph } from '@madar/shared';
import {
  authHeaders,
  createTestContext,
  hasTestDatabase,
  registerSession,
} from './helpers/app.js';

function graphWithNodes(): WorkflowGraph {
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
        parameters: { values: { ok: true } },
      },
      {
        id: 'http',
        type: 'http',
        typeVersion: 1,
        name: 'طلب HTTP',
        position: { x: 520, y: 0 },
        parameters: { method: 'GET', url: 'https://example.com' },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'set' },
      { id: 'e2', source: 'set', target: 'http' },
    ],
  };
}

test('workflow lifecycle: draft, publish, versions, rollback, archive, duplicate', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const base = `/api/v1/workspaces/${session.workspaceId}/workflows`;

    const created = await ctx.app.inject({
      method: 'POST',
      url: base,
      headers,
      payload: { name: 'فحص صحة النظام', description: 'WF1' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const workflow = created.json() as {
      id: string;
      name: string;
      draft: { revision: number; graph: WorkflowGraph };
    };
    assert.equal(workflow.draft.revision, 1);
    assert.deepEqual(workflow.draft.graph, { nodes: [], edges: [] });

    const emptyPublish = await ctx.app.inject({
      method: 'POST',
      url: `${base}/${workflow.id}/publish`,
      headers,
      payload: {},
    });
    assert.equal(emptyPublish.statusCode, 400);

    const saved = await ctx.app.inject({
      method: 'PUT',
      url: `${base}/${workflow.id}/draft`,
      headers,
      payload: { revision: 1, graph: graphWithNodes() },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((saved.json() as { revision: number }).revision, 2);

    const stale = await ctx.app.inject({
      method: 'PUT',
      url: `${base}/${workflow.id}/draft`,
      headers,
      payload: { revision: 1, graph: { nodes: [], edges: [] } },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((stale.json() as { code: string }).code, 'conflict');

    const cyclic: WorkflowGraph = {
      nodes: graphWithNodes().nodes,
      edges: [
        { id: 'a', source: 'trigger', target: 'http' },
        { id: 'b', source: 'http', target: 'trigger' },
      ],
    };
    const rejected = await ctx.app.inject({
      method: 'PUT',
      url: `${base}/${workflow.id}/draft`,
      headers,
      payload: { revision: 2, graph: cyclic },
    });
    assert.equal(rejected.statusCode, 400, rejected.body);

    const invalidWorkflow = await ctx.app.inject({
      method: 'POST',
      url: base,
      headers,
      payload: { name: 'مسودة ناقصة' },
    });
    const invalidId = (invalidWorkflow.json() as { id: string }).id;
    const invalidGraph = graphWithNodes();
    invalidGraph.nodes[2]!.parameters = { method: 'GET', url: '' };
    const invalidDraft = await ctx.app.inject({
      method: 'PUT',
      url: `${base}/${invalidId}/draft`,
      headers,
      payload: { revision: 1, graph: invalidGraph },
    });
    assert.equal(invalidDraft.statusCode, 200, invalidDraft.body);

    const invalidPublish = await ctx.app.inject({
      method: 'POST',
      url: `${base}/${invalidId}/publish`,
      headers,
      payload: {},
    });
    assert.equal(invalidPublish.statusCode, 400, invalidPublish.body);
    assert.match((invalidPublish.json() as { detail: string }).detail, /url/);

    const published = await ctx.app.inject({
      method: 'POST',
      url: `${base}/${workflow.id}/publish`,
      headers,
      payload: { note: 'أول نشر' },
    });
    assert.equal(published.statusCode, 201, published.body);
    const version = published.json() as { id: string; version: number; graph: WorkflowGraph };
    assert.equal(version.version, 1);
    assert.equal(version.graph.nodes.length, 3);

    const versions = await ctx.app.inject({
      method: 'GET',
      url: `${base}/${workflow.id}/versions`,
      headers,
    });
    assert.equal(versions.statusCode, 200);
    assert.equal((versions.json() as unknown[]).length, 1);

    const fetchedVersion = await ctx.app.inject({
      method: 'GET',
      url: `${base}/${workflow.id}/versions/${version.id}`,
      headers,
    });
    assert.equal(fetchedVersion.statusCode, 200);
    assert.equal((fetchedVersion.json() as { version: number }).version, 1);

    const rollback = await ctx.app.inject({
      method: 'POST',
      url: `${base}/${workflow.id}/versions/${version.id}/rollback`,
      headers,
    });
    assert.equal(rollback.statusCode, 201, rollback.body);
    assert.equal((rollback.json() as { version: number }).version, 2);

    const afterRollback = await ctx.app.inject({
      method: 'GET',
      url: `${base}/${workflow.id}`,
      headers,
    });
    const detail = afterRollback.json() as {
      draft: { revision: number; graph: WorkflowGraph };
      currentVersionId: string;
    };
    assert.equal(detail.draft.revision, 3);
    assert.equal(detail.draft.graph.nodes.length, 3);
    assert.ok(detail.currentVersionId);

    const archived = await ctx.app.inject({
      method: 'PATCH',
      url: `${base}/${workflow.id}`,
      headers,
      payload: { archived: true },
    });
    assert.equal(archived.statusCode, 200);
    assert.ok((archived.json() as { archivedAt: string | null }).archivedAt);

    const hidden = await ctx.app.inject({ method: 'GET', url: base, headers });
    const hiddenIds = (hidden.json() as Array<{ id: string }>).map((entry) => entry.id);
    assert.ok(!hiddenIds.includes(workflow.id));

    const visible = await ctx.app.inject({
      method: 'GET',
      url: `${base}?includeArchived=true`,
      headers,
    });
    const visibleIds = (visible.json() as Array<{ id: string }>).map((entry) => entry.id);
    assert.ok(visibleIds.includes(workflow.id));

    const restored = await ctx.app.inject({
      method: 'PATCH',
      url: `${base}/${workflow.id}`,
      headers,
      payload: { archived: false },
    });
    assert.equal((restored.json() as { archivedAt: string | null }).archivedAt, null);

    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: `${base}/${workflow.id}/duplicate`,
      headers,
    });
    assert.equal(duplicate.statusCode, 201, duplicate.body);
    const copy = duplicate.json() as { id: string; name: string; draft: { graph: WorkflowGraph } };
    assert.notEqual(copy.id, workflow.id);
    assert.match(copy.name, /\(نسخة\)$/);
    assert.equal(copy.draft.graph.nodes.length, 3);

    const outsider = await registerSession(ctx.app);
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: `${base}/${workflow.id}`,
      headers: authHeaders(outsider),
    });
    assert.equal(forbidden.statusCode, 403);

    const missing = await ctx.app.inject({
      method: 'GET',
      url: `${base}/00000000-0000-7000-8000-000000000000`,
      headers,
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await ctx.close();
  }
});
