import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { WorkflowGraph } from '@madar/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('workspaces_slug_uq').on(table.slug)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    totpSecretEncrypted: text('totp_secret_encrypted'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
    totpLastUsedStep: bigint('totp_last_used_step', { mode: 'number' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('users_email_uq').on(table.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('memberships_workspace_user_uq').on(table.workspaceId, table.userId),
    index('memberships_user_idx').on(table.userId),
    check('memberships_role_chk', sql`${table.role} in ('owner','admin','editor','runner','viewer')`),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    graceExpiresAt: timestamp('grace_expires_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_uq').on(table.tokenHash),
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
  ],
);

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    // No FK here on purpose: workflows.current_version_id and
    // workflow_versions.workflow_id would otherwise form a circular dependency.
    currentVersionId: uuid('current_version_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('workflows_workspace_idx').on(table.workspaceId),
    index('workflows_workspace_created_idx').on(table.workspaceId, table.createdAt),
  ],
);

export const workflowDrafts = pgTable(
  'workflow_drafts',
  {
    id: uuid('id').primaryKey(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    graph: jsonb('graph').$type<WorkflowGraph>().notNull(),
    revision: integer('revision').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('workflow_drafts_workflow_uq').on(table.workflowId)],
);

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id').primaryKey(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    version: integer('version'),
    kind: text('kind').notNull().default('production'),
    graph: jsonb('graph').$type<WorkflowGraph>().notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('workflow_versions_prod_uq')
      .on(table.workflowId, table.version)
      .where(sql`${table.kind} = 'production'`),
    index('workflow_versions_workflow_idx').on(table.workflowId, table.createdAt),
    check('workflow_versions_kind_chk', sql`${table.kind} in ('production','test')`),
    check(
      'workflow_versions_version_chk',
      sql`(${table.kind} = 'production' AND ${table.version} IS NOT NULL) OR (${table.kind} = 'test' AND ${table.version} IS NULL)`,
    ),
  ],
);

export const userRecoveryCodes = pgTable(
  'user_recovery_codes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('user_recovery_codes_user_hash_uq').on(table.userId, table.codeHash),
    index('user_recovery_codes_user_idx').on(table.userId),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    encryptedPayload: text('encrypted_payload').notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [index('credentials_workspace_idx').on(table.workspaceId)],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    workflowVersionId: uuid('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id, { onDelete: 'restrict' }),
    triggerType: text('trigger_type').notNull(),
    triggerNodeId: text('trigger_node_id'),
    triggerPayload: jsonb('trigger_payload').$type<unknown>(),
    idempotencyKey: text('idempotency_key'),
    mode: text('mode').notNull().default('production'),
    status: text('status').notNull().default('queued'),
    hasErrors: boolean('has_errors').notNull().default(false),
    error: jsonb('error').$type<Record<string, unknown>>(),
    retryOfExecutionId: uuid('retry_of_execution_id').references(
      (): AnyPgColumn => executions.id,
      { onDelete: 'restrict' },
    ),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('executions_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('executions_workflow_created_idx').on(table.workflowId, table.createdAt),
    index('executions_status_idx').on(table.status),
    uniqueIndex('executions_idempotency_uq')
      .on(table.workflowId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    check('executions_mode_chk', sql`${table.mode} in ('test','production')`),
    check(
      'executions_status_chk',
      sql`${table.status} in ('queued','running','waiting','succeeded','failed','canceled')`,
    ),
  ],
);

export const executionSteps = pgTable(
  'execution_steps',
  {
    id: uuid('id').primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'restrict' }),
    nodeId: text('node_id').notNull(),
    nodeType: text('node_type').notNull(),
    iteration: integer('iteration').notNull().default(0),
    attempt: integer('attempt').notNull().default(0),
    status: text('status').notNull().default('pending'),
    input: jsonb('input').$type<unknown>(),
    output: jsonb('output').$type<unknown>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('execution_steps_unique_uq').on(
      table.executionId,
      table.nodeId,
      table.iteration,
      table.attempt,
    ),
    index('execution_steps_execution_idx').on(table.executionId),
    check(
      'execution_steps_status_chk',
      sql`${table.status} in ('pending','running','succeeded','failed','skipped')`,
    ),
  ],
);

export const executionEvents = pgTable(
  'execution_events',
  {
    id: uuid('id').primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'restrict' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('execution_events_execution_seq_uq').on(table.executionId, table.seq),
    index('execution_events_execution_created_idx').on(table.executionId, table.createdAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id'),
    actorUserId: uuid('actor_user_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    oldValues: jsonb('old_values').$type<Record<string, unknown>>(),
    newValues: jsonb('new_values').$type<Record<string, unknown>>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    traceId: text('trace_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  ],
);

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  },
  (table) => [index('outbox_pending_idx').on(table.dispatchedAt)],
);

export const outboxArchive = pgTable(
  'outbox_archive',
  {
    id: uuid('id').primaryKey(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('outbox_archive_created_idx').on(table.createdAt)],
);
