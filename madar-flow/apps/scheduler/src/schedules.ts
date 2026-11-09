import { validateNodeParameters, type WorkflowGraph } from '@madar/shared';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface ExtractedSchedule {
  workflowId: string;
  workspaceId: string;
  workflowName: string;
  nodeId: string;
  nodeName: string;
  cron: string;
  timezone: string;
}

export interface WorkflowForScheduling {
  id: string;
  workspaceId: string;
  name: string;
  archivedAt: Date | string | null;
  currentVersionId: string | null;
  graph: WorkflowGraph | null;
}

export interface ExtractSchedulesResult {
  schedules: ExtractedSchedule[];
  skipped: Array<{ workflowId: string; nodeId?: string; reason: string }>;
}

/**
 * Pure schedule extraction so it can be unit-tested without Valkey/PostgreSQL.
 * Only the current published version is considered; drafts never schedule.
 */
export function extractSchedules(
  workflows: WorkflowForScheduling[],
): ExtractSchedulesResult {
  const schedules: ExtractedSchedule[] = [];
  const skipped: ExtractSchedulesResult['skipped'] = [];

  for (const workflow of workflows) {
    if (workflow.archivedAt) {
      skipped.push({ workflowId: workflow.id, reason: 'archived' });
      continue;
    }
    if (!workflow.currentVersionId || !workflow.graph) {
      skipped.push({ workflowId: workflow.id, reason: 'no_published_version' });
      continue;
    }

    for (const node of workflow.graph.nodes ?? []) {
      if (node.type !== 'schedule' || node.disabled) continue;
      const parameters = isPlainObject(node.parameters) ? node.parameters : {};
      const issues = validateNodeParameters('schedule', parameters);
      if (issues.length > 0) {
        skipped.push({
          workflowId: workflow.id,
          nodeId: node.id,
          reason: issues.map((issue) => issue.message).join(' '),
        });
        continue;
      }
      schedules.push({
        workflowId: workflow.id,
        workspaceId: workflow.workspaceId,
        workflowName: workflow.name,
        nodeId: node.id,
        nodeName: node.name,
        cron: String(parameters.cron),
        timezone: String(parameters.timezone ?? 'Africa/Cairo'),
      });
    }
  }

  return { schedules, skipped };
}
