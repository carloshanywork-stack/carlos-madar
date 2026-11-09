import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSchedules, type WorkflowForScheduling } from '../src/schedules.js';
import type { WorkflowGraph } from '@madar/shared';

function workflow(overrides: Partial<WorkflowForScheduling> = {}): WorkflowForScheduling {
  const graph: WorkflowGraph = {
    nodes: [
      {
        id: 'sched',
        type: 'schedule',
        typeVersion: 1,
        name: 'كل ساعة',
        position: { x: 0, y: 0 },
        parameters: { cron: '0 * * * *', timezone: 'Africa/Cairo' },
      },
    ],
    edges: [],
  };
  return {
    id: 'wf-1',
    workspaceId: 'ws-1',
    name: 'مجدول',
    archivedAt: null,
    currentVersionId: 'ver-1',
    graph,
    ...overrides,
  };
}

test('extractSchedules: enabled schedule nodes on published versions', () => {
  const result = extractSchedules([workflow()]);
  assert.equal(result.schedules.length, 1);
  assert.deepEqual(result.schedules[0], {
    workflowId: 'wf-1',
    workspaceId: 'ws-1',
    workflowName: 'مجدول',
    nodeId: 'sched',
    nodeName: 'كل ساعة',
    cron: '0 * * * *',
    timezone: 'Africa/Cairo',
  });
  assert.equal(result.skipped.length, 0);
});

test('extractSchedules: skips archived, unpublished, disabled and invalid schedules', () => {
  const disabled = workflow();
  disabled.graph = {
    ...disabled.graph!,
    nodes: [{ ...disabled.graph!.nodes[0]!, disabled: true }],
  };

  const invalid = workflow();
  invalid.graph = {
    ...invalid.graph!,
    nodes: [{ ...invalid.graph!.nodes[0]!, parameters: { cron: 'not-a-cron' } }],
  };

  const result = extractSchedules([
    workflow({ id: 'archived', archivedAt: new Date() }),
    workflow({ id: 'draft-only', currentVersionId: null, graph: null }),
    disabled,
    invalid,
  ]);

  assert.equal(result.schedules.length, 0);
  assert.deepEqual(
    result.skipped.map((entry) => entry.reason).sort(),
    ['archived', 'no_published_version', 'صيغة Cron يجب أن تكون 5 حقول مثل: 0 9 * * *'],
  );
});
