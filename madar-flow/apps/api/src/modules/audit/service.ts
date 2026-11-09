import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { auditLogs } from '@madar/db';
import type { AppDeps } from '../../deps.js';

export interface AuditFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function listAuditLogs(deps: AppDeps, workspaceId: string, filters: AuditFilters) {
  const conditions: SQL[] = [eq(auditLogs.workspaceId, workspaceId) as SQL];
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action) as SQL);
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType) as SQL);
  if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId) as SQL);
  if (filters.actorUserId) {
    conditions.push(eq(auditLogs.actorUserId, filters.actorUserId) as SQL);
  }
  if (filters.from) conditions.push(gte(auditLogs.createdAt, filters.from) as SQL);
  if (filters.to) conditions.push(lte(auditLogs.createdAt, filters.to) as SQL);

  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const rows = await deps.db
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      actorLabel: auditLogs.actorLabel,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      oldValues: auditLogs.oldValues,
      newValues: auditLogs.newValues,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
      traceId: auditLogs.traceId,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}
