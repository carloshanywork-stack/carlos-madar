import { eq, max } from 'drizzle-orm';
import { executionEvents, type Database } from '@madar/db';
import {
  executionEventsChannel,
  uuidv7,
  type ExecutionEventPayload,
} from '@madar/shared';
import type { Redis } from 'ioredis';

export type EventType =
  | 'execution_started'
  | 'execution_finished'
  | 'execution_log'
  | 'node_started'
  | 'node_finished';

export interface ExecutionEventInput {
  type: EventType;
  payload: ExecutionEventPayload;
}

/**
 * Appends execution events to PostgreSQL (durable, retained forever) and
 * publishes them on Redis for the SSE endpoint. The database write happens
 * first so a reconnect can always replay from the durable log.
 */
export class ExecutionEventWriter {
  private seq = 0;

  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly executionId: string,
  ) {}

  async initialize(): Promise<void> {
    const rows = await this.db
      .select({ value: max(executionEvents.seq) })
      .from(executionEvents)
      .where(eq(executionEvents.executionId, this.executionId));
    this.seq = rows[0]?.value ?? 0;
  }

  async emit(type: EventType, payload: ExecutionEventPayload): Promise<void> {
    this.seq += 1;
    const seq = this.seq;
    const createdAt = new Date().toISOString();

    await this.db.insert(executionEvents).values({
      id: uuidv7(),
      executionId: this.executionId,
      seq,
      type,
      payload: { ...payload, seq, at: createdAt },
    });

    await this.redis
      .publish(
        executionEventsChannel(this.executionId),
        JSON.stringify({ seq, type, payload, at: createdAt }),
      )
      .catch(() => undefined);
  }

  async log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit('execution_log', { level, message, data });
  }
}
