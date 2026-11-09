import { auditLogs, type DatabaseExecutor } from '@madar/db';
import { uuidv7 } from '@madar/shared';

export interface AuditEntry {
  workspaceId?: string;
  actorUserId?: string;
  actorLabel?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  traceId?: string;
}

export async function recordAudit(executor: DatabaseExecutor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values({
    id: uuidv7(),
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId,
    actorLabel: entry.actorLabel,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    ip: entry.ip,
    userAgent: entry.userAgent,
    traceId: entry.traceId,
  });
}
