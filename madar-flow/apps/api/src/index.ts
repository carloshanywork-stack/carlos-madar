import { createDatabase } from '@madar/db';
import { EXECUTION_QUEUE, type ExecutionQueueData } from '@madar/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { EventSubscriber, EventSubscriberFactory } from './deps.js';
import { startOutboxDispatcher } from './lib/outbox.js';

const env = loadConfig();
const database = createDatabase(env.DATABASE_URL);
const cache = new Redis(env.VALKEY_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

// BullMQ requires its own blocking connection with `maxRetriesPerRequest: null`.
const queueConnection = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: null });
const executionQueue = new Queue<ExecutionQueueData>(EXECUTION_QUEUE, {
  connection: queueConnection,
});

const eventSubscriberFactory: EventSubscriberFactory = () => {
  const subscriber = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: null });
  const wrapper: EventSubscriber = {
    subscribe: async (channel, listener) => {
      subscriber.on('message', (incoming, message) => {
        if (incoming === channel) listener(message);
      });
      return subscriber.subscribe(channel);
    },
    unsubscribe: (channel) => subscriber.unsubscribe(channel),
    quit: () => subscriber.quit(),
  };
  return wrapper;
};

const app = await buildApp({
  db: database.db,
  pool: database.pool,
  cache,
  env,
  executionQueue: {
    add: (name, data, opts) =>
      executionQueue.add(name, data as unknown as ExecutionQueueData, opts),
    close: () => executionQueue.close(),
  },
  eventSubscriberFactory,
});

const stopOutboxDispatcher = startOutboxDispatcher({
  db: database.db,
  pool: database.pool,
  cache,
  env,
  executionQueue: {
    add: (name, data, opts) =>
      executionQueue.add(name, data as unknown as ExecutionQueueData, opts),
    close: () => executionQueue.close(),
  },
  eventSubscriberFactory,
});

cache.on('error', (error: Error) => {
  app.log.error({ err: error }, 'Valkey connection error');
});

queueConnection.on('error', (error: Error) => {
  app.log.error({ err: error }, 'Queue Valkey connection error');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down');

  try {
    stopOutboxDispatcher();
    await app.close();
    await executionQueue.close();
    await queueConnection.quit();
    await database.close();
    await cache.quit();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'Graceful shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: env.HOST, port: env.PORT });
