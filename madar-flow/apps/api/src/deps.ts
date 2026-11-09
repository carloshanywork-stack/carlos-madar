import type { Database, DatabasePool } from '@madar/db';
import type { Env } from '@madar/shared';

export interface CacheClient {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

/** Minimal BullMQ queue surface used by the API (injectable for tests). */
export interface ExecutionQueue {
  add(
    name: string,
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<unknown>;
  close?(): Promise<void>;
}

export interface EventSubscriber {
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

export type EventSubscriberFactory = () => EventSubscriber;

export interface AppDeps {
  db: Database;
  pool: DatabasePool;
  cache: CacheClient;
  env: Env;
  executionQueue?: ExecutionQueue;
  eventSubscriberFactory?: EventSubscriberFactory;
}
