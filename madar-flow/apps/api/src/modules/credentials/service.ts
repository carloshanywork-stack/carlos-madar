import { and, desc, eq, isNull } from 'drizzle-orm';
import { credentials } from '@madar/db';
import {
  AppError,
  decryptSecret,
  encryptSecret,
  isCredentialType,
  resolveCredentialsKey,
  uuidv7,
  validateCredentialPayload,
  type CredentialType,
} from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { recordAudit } from '../../lib/audit.js';
import type { RequestMeta } from '../workflows/service.js';

interface Actor {
  id: string;
  email: string;
}

export interface CredentialMetadata {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function toMetadata(row: typeof credentials.$inferSelect): CredentialMetadata {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type,
    keyVersion: row.keyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export function credentialKey(deps: AppDeps): Buffer {
  return resolveCredentialsKey(deps.env);
}

export async function listCredentials(
  deps: AppDeps,
  workspaceId: string,
  includeRevoked: boolean,
): Promise<CredentialMetadata[]> {
  const rows = await deps.db
    .select()
    .from(credentials)
    .where(
      includeRevoked
        ? eq(credentials.workspaceId, workspaceId)
        : and(eq(credentials.workspaceId, workspaceId), isNull(credentials.revokedAt)),
    )
    .orderBy(desc(credentials.createdAt));

  return rows.map(toMetadata);
}

export async function createCredential(
  deps: AppDeps,
  workspaceId: string,
  actor: Actor,
  input: { name: string; type: string; payload: unknown },
  meta: RequestMeta,
): Promise<CredentialMetadata> {
  if (!isCredentialType(input.type)) {
    throw AppError.badRequest('validation_error', 'Unsupported credential type');
  }
  const issues = validateCredentialPayload(input.type, input.payload);
  if (issues.length > 0) {
    throw AppError.badRequest(
      'validation_error',
      'Invalid credential payload',
      issues.map((issue) => `${issue.path}: ${issue.message}`).join(' '),
    );
  }

  const id = uuidv7();
  const encrypted = encryptSecret(credentialKey(deps), input.payload);

  return deps.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(credentials)
      .values({
        id,
        workspaceId,
        name: input.name,
        type: input.type,
        encryptedPayload: encrypted,
        keyVersion: 1,
        createdBy: actor.id,
      })
      .returning();

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'credential.created',
      entityType: 'credential',
      entityId: id,
      newValues: { name: input.name, type: input.type },
      ...meta,
    });

    return toMetadata(inserted[0]!);
  });
}

export async function revokeCredential(
  deps: AppDeps,
  workspaceId: string,
  credentialId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<CredentialMetadata> {
  const rows = await deps.db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.workspaceId, workspaceId)))
    .limit(1);

  const existing = rows[0];
  if (!existing) throw AppError.notFound('not_found', 'Credential was not found');
  if (existing.revokedAt) {
    throw AppError.conflict('conflict', 'Credential is already revoked');
  }

  const now = new Date();
  return deps.db.transaction(async (tx) => {
    const updated = await tx
      .update(credentials)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(credentials.id, credentialId))
      .returning();

    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: 'credential.revoked',
      entityType: 'credential',
      entityId: credentialId,
      oldValues: { revokedAt: null, name: existing.name, type: existing.type },
      newValues: { revokedAt: now.toISOString() },
      ...meta,
    });

    return toMetadata(updated[0]!);
  });
}

export async function loadCredentialPayload(
  deps: AppDeps,
  workspaceId: string,
  credentialId: string,
): Promise<{ type: CredentialType; payload: Record<string, unknown> }> {
  const rows = await deps.db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, credentialId), eq(credentials.workspaceId, workspaceId)))
    .limit(1);

  const credential = rows[0];
  if (!credential) {
    throw AppError.badRequest('validation_error', 'Credential was not found');
  }
  if (credential.revokedAt) {
    throw AppError.badRequest('validation_error', 'Credential has been revoked');
  }
  if (!isCredentialType(credential.type)) {
    throw AppError.badRequest('validation_error', 'Credential type is invalid');
  }

  const payload = decryptSecret<Record<string, unknown>>(
    credentialKey(deps),
    credential.encryptedPayload,
  );

  await deps.db
    .update(credentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .catch(() => undefined);

  return { type: credential.type, payload };
}

export interface CredentialPreflightResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
}

export async function preflightCredential(
  deps: AppDeps,
  workspaceId: string,
  credentialId: string,
): Promise<CredentialPreflightResult> {
  const { type, payload } = await loadCredentialPayload(deps, workspaceId, credentialId);
  const issues = validateCredentialPayload(type, payload);
  const checks: CredentialPreflightResult['checks'] = [
    {
      name: 'schema',
      ok: issues.length === 0,
      message: issues.map((issue) => `${issue.path}: ${issue.message}`).join(' ') || undefined,
    },
  ];

  if (type === 'oauth2') {
    const tokenUrl = String(payload.tokenUrl ?? '');
    let reachable = false;
    let message: string | undefined;
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: String(payload.clientId ?? ''),
          client_secret: String(payload.clientSecret ?? ''),
          ...(payload.scope ? { scope: String(payload.scope) } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      reachable = response.ok;
      if (!response.ok) message = `Token endpoint returned HTTP ${response.status}`;
    } catch (caught) {
      message = caught instanceof Error ? caught.message : 'Token endpoint is unreachable';
    }
    checks.push({ name: 'oauth2_token', ok: reachable, message });
  }

  return { ok: checks.every((check) => check.ok), checks };
}
