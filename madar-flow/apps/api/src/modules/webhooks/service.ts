import { createHmac } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { executions, outbox, workflows, workflowVersions, workspaces, type Database } from '@madar/db';
import { AppError, uuidv7, type WorkflowGraph } from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { loadCredentialPayload } from '../credentials/service.js';
import { enqueueOutboxRow, type OutboxPayload } from '../../lib/outbox.js';

const MAX_SKEW_MS = 5 * 60_000;
const MAX_BODY_BYTES = 1024 * 1024;

export interface WebhookRequest {
  workspaceId: string;
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  rawBody: string;
  parsedBody: unknown;
}

export interface WebhookResult {
  executionId: string;
  workflowId: string;
  workflowName: string;
  duplicate: boolean;
}

interface MatchedWebhook {
  workflowId: string;
  workflowName: string;
  versionId: string;
  nodeId: string;
  nodeName: string;
  credentialId: string | null;
  graph: WorkflowGraph;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function webhookSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function normalizeSignature(value: string): string {
  return value.startsWith('sha256=') ? value.slice('sha256='.length) : value;
}

function assertFreshTimestamp(timestamp: string): void {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw AppError.badRequest('validation_error', 'Invalid webhook timestamp');
  }
  const millis = parsed > 1e12 ? parsed : parsed * 1_000;
  if (Math.abs(Date.now() - millis) > MAX_SKEW_MS) {
    throw AppError.unauthorized('invalid_token', 'Webhook timestamp is outside the allowed window');
  }
}

export async function findWebhook(
  db: Database,
  workspaceId: string,
  path: string,
  method: string,
): Promise<MatchedWebhook | null> {
  const rows = await db
    .select({
      workflowId: workflows.id,
      workflowName: workflows.name,
      versionId: workflowVersions.id,
      graph: workflowVersions.graph,
    })
    .from(workflows)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .where(and(eq(workflows.workspaceId, workspaceId), isNull(workflows.archivedAt)))
    .orderBy(asc(workflows.createdAt));

  for (const row of rows) {
    for (const node of row.graph.nodes) {
      if (node.type !== 'webhook' || node.disabled) continue;
      const nodePath = String(node.parameters.path ?? '').trim();
      const nodeMethod = String(node.parameters.method ?? 'POST').toUpperCase();
      if (nodePath !== path || nodeMethod !== method) continue;
      const credentialId =
        typeof node.parameters.credentialId === 'string' ? node.parameters.credentialId : null;
      return {
        workflowId: row.workflowId,
        workflowName: row.workflowName,
        versionId: row.versionId,
        nodeId: node.id,
        nodeName: node.name,
        credentialId,
        graph: row.graph,
      };
    }
  }

  return null;
}

export async function handleWebhook(
  deps: AppDeps,
  request: WebhookRequest,
): Promise<WebhookResult> {
  if (request.rawBody.length > MAX_BODY_BYTES) {
    throw AppError.badRequest('validation_error', 'Webhook body is too large');
  }

  const workspaceRows = await deps.db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, request.workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!workspaceRows[0]) throw AppError.notFound('not_found', 'Webhook was not found');

  const webhook = await findWebhook(deps.db, request.workspaceId, request.path, request.method);
  if (!webhook) throw AppError.notFound('not_found', 'Webhook was not found');
  if (!webhook.credentialId) {
    throw AppError.badRequest('validation_error', 'Webhook has no HMAC credential configured');
  }

  const timestamp = headerValue(request.headers, 'x-madar-timestamp');
  const signature = headerValue(request.headers, 'x-madar-signature');
  const deliveryId = headerValue(request.headers, 'x-madar-delivery');

  if (!timestamp) throw AppError.badRequest('validation_error', 'Missing x-madar-timestamp');
  if (!signature) throw AppError.unauthorized('invalid_token', 'Missing x-madar-signature');
  if (!deliveryId || deliveryId.length < 8 || deliveryId.length > 200) {
    throw AppError.badRequest('validation_error', 'Invalid x-madar-delivery header');
  }
  assertFreshTimestamp(timestamp);

  const credential = await loadCredentialPayload(
    deps,
    request.workspaceId,
    webhook.credentialId,
  );
  if (credential.type !== 'hmac') {
    throw AppError.badRequest('validation_error', 'Webhook credential must be an HMAC secret');
  }

  const expected = webhookSignature(
    String(credential.payload.secret ?? ''),
    timestamp,
    request.rawBody,
  );
  const presented = normalizeSignature(signature);
  if (!timingSafeCompare(expected, presented)) {
    throw AppError.unauthorized('invalid_token', 'Invalid webhook signature');
  }

  const idempotencyKey = `webhook:${deliveryId}`;
  const filteredHeaders: Record<string, string> = {};
  for (const name of ['content-type', 'user-agent', 'x-madar-delivery']) {
    const value = headerValue(request.headers, name);
    if (value) filteredHeaders[name] = value;
  }

  const executionId = uuidv7();
  const outboxId = uuidv7();
  const now = new Date();

  try {
    await deps.db.transaction(async (tx) => {
      await tx.insert(executions).values({
        id: executionId,
        workspaceId: request.workspaceId,
        workflowId: webhook.workflowId,
        workflowVersionId: webhook.versionId,
        triggerType: 'webhook',
        triggerNodeId: webhook.nodeId,
        triggerPayload: {
          body: request.parsedBody,
          headers: filteredHeaders,
          query: request.query,
          method: request.method,
          deliveryId,
          receivedAt: now.toISOString(),
        },
        idempotencyKey,
        mode: 'production',
        status: 'queued',
        createdAt: now,
      });

      await tx.insert(outbox).values({
        id: outboxId,
        topic: 'execution.enqueue',
        payload: {
          executionId,
          workspaceId: request.workspaceId,
          workflowId: webhook.workflowId,
        },
        createdAt: now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, 'executions_idempotency_uq')) {
      const existing = await deps.db
        .select({ id: executions.id })
        .from(executions)
        .where(
          and(
            eq(executions.workflowId, webhook.workflowId),
            eq(executions.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return {
        executionId: existing[0]?.id ?? executionId,
        workflowId: webhook.workflowId,
        workflowName: webhook.workflowName,
        duplicate: true,
      };
    }
    throw error;
  }

  // Best-effort immediate enqueue. If Valkey is unavailable the outbox keeps
  // the execution pending and the dispatcher retries; the webhook still
  // returns 202 because the transaction committed.
  await enqueueOutboxRow(deps, {
    id: outboxId,
    payload: {
      executionId,
      workspaceId: request.workspaceId,
      workflowId: webhook.workflowId,
    } satisfies OutboxPayload,
  });

  return {
    executionId,
    workflowId: webhook.workflowId,
    workflowName: webhook.workflowName,
    duplicate: false,
  };
}

function timingSafeCompare(expected: string, presented: string): boolean {
  if (expected.length !== presented.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ presented.charCodeAt(index);
  }
  return mismatch === 0;
}
