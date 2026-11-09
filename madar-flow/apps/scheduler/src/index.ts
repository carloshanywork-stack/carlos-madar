import { eq } from 'drizzle-orm';
import { createDatabase } from '@madar/db';
import { workflows, workflowVersions } from '@madar/db';
import {
  EXECUTION_QUEUE,
  SCHEDULE_TRIGGER_JOB,
  scheduleSchedulerId,
  schedulerLeaderKey,
  type ScheduleTriggerJobData,
  type WorkflowGraph,
} from '@madar/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { extractSchedules } from './schedules.js';

const env = loadConfig();
const database = createDatabase(env.DATABASE_URL, {
  max: 3,
  applicationName: 'madar-flow-scheduler',
});
const redis = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: null });
const queue = new Queue<ScheduleTriggerJobData>(EXECUTION_QUEUE, { connection: redis });

const LEADER_TTL_MS = 30_000;
const LEADER_RENEW_MS = 10_000;
const instanceId = `${process.env.HOSTNAME ?? 'scheduler'}:${process.pid}:${Math.random()
  .toString(36)
  .slice(2, 10)}`;

function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  data: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...data });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

async function acquireOrRenewLeadership(): Promise<boolean> {
  const key = schedulerLeaderKey();
  const acquired = await redis.set(key, instanceId, 'PX', LEADER_TTL_MS, 'NX');
  if (acquired === 'OK') return true;

  const renewed = await redis.eval(
    `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`,
    1,
    key,
    instanceId,
    String(LEADER_TTL_MS),
  );
  return renewed === 1;
}

async function loadPublishedWorkflows() {
  return database.db
    .select({
      id: workflows.id,
      workspaceId: workflows.workspaceId,
      name: workflows.name,
      archivedAt: workflows.archivedAt,
      currentVersionId: workflows.currentVersionId,
      graph: workflowVersions.graph,
    })
    .from(workflows)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId));
}

let lastSyncSummary = '';
let leaderState: boolean | null = null;

async function syncSchedules(): Promise<void> {
  const rows = await loadPublishedWorkflows();
  const { schedules, skipped } = extractSchedules(
    rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      archivedAt: row.archivedAt,
      currentVersionId: row.currentVersionId,
      graph: (row.graph as WorkflowGraph | null) ?? null,
    })),
  );

  const activeIds = new Set<string>();
  for (const schedule of schedules) {
    const id = scheduleSchedulerId(schedule.workflowId, schedule.nodeId);
    activeIds.add(id);
    await queue.upsertJobScheduler(
      id,
      { pattern: schedule.cron, tz: schedule.timezone },
      {
        name: SCHEDULE_TRIGGER_JOB,
        data: {
          workflowId: schedule.workflowId,
          workspaceId: schedule.workspaceId,
          nodeId: schedule.nodeId,
        },
        opts: {
          attempts: 1,
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 1_000 },
        },
      },
    );
  }

  const existing = (await queue.getJobSchedulers(0, -1, true)) as Array<{
    key?: string;
    id?: string;
  }>;
  let removed = 0;
  for (const scheduler of existing) {
    const id = scheduler.key ?? scheduler.id;
    if (!id || !id.startsWith('schedule-')) continue;
    if (activeIds.has(id)) continue;
    await queue.removeJobScheduler(id);
    removed += 1;
  }

  const summary = JSON.stringify({
    schedules: schedules.length,
    removed,
    skipped: skipped.length,
  });
  if (summary !== lastSyncSummary) {
    lastSyncSummary = summary;
    log('info', 'Schedule sync completed', {
      active: schedules.length,
      removed,
      skipped: skipped.map((entry) => entry.reason),
    });
  }
}

async function tick(): Promise<void> {
  try {
    const leader = await acquireOrRenewLeadership();
    if (leader !== leaderState) {
      leaderState = leader;
      log(leader ? 'info' : 'warn', leader ? 'Scheduler became leader' : 'Scheduler is on standby', {
        instanceId,
      });
    }
    if (leader) await syncSchedules();
  } catch (error) {
    log('error', 'Scheduler tick failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let syncTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function start(): Promise<void> {
  await tick().catch(() => undefined);
  syncTimer = setInterval(() => void tick(), env.SCHEDULER_SYNC_INTERVAL_MS);
  log('info', 'Scheduler started', {
    instanceId,
    intervalMs: env.SCHEDULER_SYNC_INTERVAL_MS,
    queue: EXECUTION_QUEUE,
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'Scheduler shutting down', { signal });
  if (syncTimer) clearInterval(syncTimer);
  try {
    await redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      schedulerLeaderKey(),
      instanceId,
    );
  } catch {
    // Leadership will expire naturally.
  }
  try {
    await queue.close();
    await redis.quit().catch(() => undefined);
    await database.close();
  } catch (error) {
    log('error', 'Shutdown error', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  log('error', 'Uncaught exception', { error: error.message, stack: error.stack });
  void shutdown('uncaughtException').finally(() => process.exit(1));
});

void start();
