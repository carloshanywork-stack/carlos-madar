import { createDatabase } from '@madar/db';
import {
  EXECUTION_QUEUE,
  SCHEDULE_TRIGGER_JOB,
  isExecutionJobData,
  isScheduleTriggerJobData,
} from '@madar/shared';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from './config.js';
import { WorkerCredentialResolver } from './credentials.js';
import { runExecution, runScheduleTrigger, type RunnerDeps } from './runner.js';

const env = loadConfig();
const database = createDatabase(env.DATABASE_URL, {
  max: env.WORKER_CONCURRENCY + 2,
  applicationName: 'madar-flow-worker',
});
const redis = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: null });

const logger: RunnerDeps['logger'] = {
  info: (data, message) => {
    console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), message, ...(data as object) }));
  },
  warn: (data, message) => {
    console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), message, ...(data as object) }));
  },
  error: (data, message) => {
    console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), message, ...(data as object) }));
  },
};

redis.on('error', (error: Error) => {
  logger.error({ error: error.message }, 'Valkey connection error');
});

const deps: RunnerDeps = {
  db: database.db,
  redis,
  env,
  logger,
  credentials: new WorkerCredentialResolver(database.db, env, logger),
};

async function processJob(job: Job): Promise<void> {
  if (job.name === SCHEDULE_TRIGGER_JOB) {
    if (!isScheduleTriggerJobData(job.data)) {
      throw new Error('Invalid schedule trigger payload');
    }
    await runScheduleTrigger(deps, job.data);
    return;
  }

  if (!isExecutionJobData(job.data)) {
    throw new Error(`Invalid execution job payload for job ${job.id ?? job.name}`);
  }
  await runExecution(deps, job.data.executionId);
}

const worker = new Worker(EXECUTION_QUEUE, processJob, {
  connection: redis,
  concurrency: env.WORKER_CONCURRENCY,
  lockDuration: env.BULLMQ_LOCK_DURATION_MS,
  autorun: true,
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, name: job.name }, 'Job completed');
});

worker.on('failed', (job, error) => {
  logger.error(
    { jobId: job?.id, name: job?.name, error: error.message, attempts: job?.attemptsMade },
    'Job failed',
  );
});

worker.on('error', (error: Error) => {
  logger.error({ error: error.message }, 'Worker error');
});

logger.info(
  {
    queue: EXECUTION_QUEUE,
    concurrency: env.WORKER_CONCURRENCY,
    lockDurationMs: env.BULLMQ_LOCK_DURATION_MS,
  },
  'Madar Flow worker started',
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Worker shutting down; waiting for active jobs');
  try {
    await worker.close();
    await redis.quit().catch(() => undefined);
    await database.close();
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Shutdown error');
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
  void shutdown('uncaughtException').finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  logger.error(
    { error: reason instanceof Error ? reason.message : String(reason) },
    'Unhandled rejection',
  );
});
