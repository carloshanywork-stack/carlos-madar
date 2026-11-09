import { and, asc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { outbox, outboxArchive } from '@madar/db';
import { EXECUTION_JOB, uuidv7 } from '@madar/shared';
import type { AppDeps } from '../deps.js';

export interface OutboxPayload {
  executionId: string;
  workspaceId: string;
  workflowId: string;
}

export async function enqueueOutboxRow(
  deps: AppDeps,
  row: { id: string; payload: OutboxPayload },
): Promise<boolean> {
  if (!deps.executionQueue) return false;
  try {
    await deps.executionQueue.add(EXECUTION_JOB, row.payload as unknown as Record<string, unknown>, {
      jobId: `execution-${row.payload.executionId}`,
      attempts: 1,
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    });
    await deps.db
      .update(outbox)
      .set({ dispatchedAt: new Date(), lastError: null })
      .where(and(isNull(outbox.dispatchedAt), eq(outbox.id, row.id)));
    return true;
  } catch (error) {
    await deps.db
      .update(outbox)
      .set({
        lastError: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
      })
      .where(eq(outbox.id, row.id))
      .catch(() => undefined);
    return false;
  }
}

let dispatching = false;

/**
 * Drains pending outbox rows. Safe to call repeatedly; a single API process is
 * assumed (Decision Log: one server, one SQLite/Postgres instance).
 */
export async function dispatchOutbox(deps: AppDeps, limit = 20): Promise<number> {
  if (dispatching) return 0;
  dispatching = true;
  let dispatched = 0;
  try {
    const rows = await deps.db
      .select()
      .from(outbox)
      .where(isNull(outbox.dispatchedAt))
      .orderBy(asc(outbox.createdAt))
      .limit(limit);

    for (const row of rows) {
      const payload = row.payload as unknown as OutboxPayload;
      if (!payload?.executionId) continue;
      if (await enqueueOutboxRow(deps, { id: row.id, payload })) dispatched += 1;
    }
  } finally {
    dispatching = false;
  }
  return dispatched;
}

/**
 * Archives dispatched rows into the cold outbox_archive table. Business data
 * is never deleted; only the transient hot outbox rows move to the archive.
 */
export async function archiveDispatchedOutbox(
  deps: AppDeps,
  olderThanHours = 24,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  return deps.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outbox)
          .where(and(isNotNull(outbox.dispatchedAt), lt(outbox.createdAt, cutoff)))
      .limit(500)
      .for('update', { skipLocked: true });

    if (rows.length === 0) return 0;

    await tx.insert(outboxArchive).values(
      rows.map((row) => ({
        id: uuidv7(),
        topic: row.topic,
        payload: row.payload,
        attempts: row.attempts,
        lastError: row.lastError,
        createdAt: row.createdAt,
        dispatchedAt: row.dispatchedAt,
      })),
    );

    for (const row of rows) {
      await tx.delete(outbox).where(and(eq(outbox.id, row.id), lt(outbox.createdAt, cutoff)));
    }
    return rows.length;
  });
}

export function startOutboxDispatcher(deps: AppDeps): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void dispatchOutbox(deps).catch(() => undefined);
  }, 2_000);
  timer.unref?.();

  let lastArchive = Date.now();
  const archiveTimer = setInterval(() => {
    if (stopped) return;
    if (Date.now() - lastArchive < 3_600_000) return;
    lastArchive = Date.now();
    void archiveDispatchedOutbox(deps).catch(() => undefined);
  }, 600_000);
  archiveTimer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(archiveTimer);
  };
}
