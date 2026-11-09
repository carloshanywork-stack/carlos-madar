import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import { memberships, outbox, outboxArchive } from '@madar/db';
import { uuidv7, type WorkflowGraph } from '@madar/shared';
import { archiveDispatchedOutbox, dispatchOutbox } from '../src/lib/outbox.js';
import { totpCode } from '../src/lib/totp.js';
import {
  authHeaders,
  createTestContext,
  hasTestDatabase,
  registerSession,
} from './helpers/app.js';

function webhookGraph(path: string, credentialId: string): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'hook',
        type: 'webhook',
        typeVersion: 1,
        name: 'استقبال الطلبات',
        position: { x: 0, y: 0 },
        parameters: { path, method: 'POST', credentialId },
      },
      {
        id: 'set',
        type: 'set',
        typeVersion: 1,
        name: 'تجهيز',
        position: { x: 240, y: 0 },
        parameters: { values: { received: true } },
      },
    ],
    edges: [{ id: 'e1', source: 'hook', target: 'set' }],
  };
}

function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

async function createHmacCredential(
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  headers: Record<string, string>,
  workspaceId: string,
  secret: string,
): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/credentials`,
    headers,
    payload: { name: 'Webhook HMAC', type: 'hmac', payload: { secret } },
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { id: string }).id;
}

async function publishWebhookWorkflow(
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  headers: Record<string, string>,
  workspaceId: string,
  path: string,
  credentialId: string,
): Promise<string> {
  const base = `/api/v1/workspaces/${workspaceId}/workflows`;
  const created = await ctx.app.inject({
    method: 'POST',
    url: base,
    headers,
    payload: { name: 'مستقبل Webhook' },
  });
  const workflowId = (created.json() as { id: string }).id;
  await ctx.app.inject({
    method: 'PUT',
    url: `${base}/${workflowId}/draft`,
    headers,
    payload: { revision: 1, graph: webhookGraph(path, credentialId) },
  });
  const published = await ctx.app.inject({
    method: 'POST',
    url: `${base}/${workflowId}/publish`,
    headers,
    payload: {},
  });
  assert.equal(published.statusCode, 201, published.body);
  return workflowId;
}

test('credentials: encrypted CRUD, revoke, permissions, and audit', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const base = `/api/v1/workspaces/${session.workspaceId}`;

    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `${base}/credentials`,
      headers,
      payload: { name: 'سيئ', type: 'basic', payload: { username: 'only-user' } },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);

    const created = await ctx.app.inject({
      method: 'POST',
      url: `${base}/credentials`,
      headers,
      payload: {
        name: 'مفتاح API',
        type: 'api_key',
        payload: { secret: 'super-secret-value', headerName: 'x-api-key' },
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const credential = created.json() as { id: string; name: string; type: string };
    assert.equal(credential.name, 'مفتاح API');
    assert.equal(credential.type, 'api_key');
    assert.equal(JSON.stringify(created.json()).includes('super-secret-value'), false);

    const listed = await ctx.app.inject({
      method: 'GET',
      url: `${base}/credentials`,
      headers,
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(JSON.stringify(listed.json()).includes('super-secret-value'), false);
    assert.equal((listed.json() as unknown[]).length, 1);

    const preflight = await ctx.app.inject({
      method: 'POST',
      url: `${base}/credentials/${credential.id}/preflight`,
      headers,
    });
    assert.equal(preflight.statusCode, 200, preflight.body);
    assert.equal((preflight.json() as { ok: boolean }).ok, true);

    // A viewer in the same workspace cannot manage credentials.
    const viewer = await registerSession(ctx.app);
    await ctx.deps.db.insert(memberships).values({
      id: uuidv7(),
      workspaceId: session.workspaceId,
      userId: viewer.userId,
      role: 'viewer',
    });
    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: `${base}/credentials`,
      headers: authHeaders(viewer),
      payload: { name: 'x', type: 'bearer', payload: { token: 'y' } },
    });
    assert.equal(forbidden.statusCode, 403);

    const revoked = await ctx.app.inject({
      method: 'POST',
      url: `${base}/credentials/${credential.id}/revoke`,
      headers,
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.ok((revoked.json() as { revokedAt: string }).revokedAt);

    const preflightRevoked = await ctx.app.inject({
      method: 'POST',
      url: `${base}/credentials/${credential.id}/preflight`,
      headers,
    });
    assert.equal(preflightRevoked.statusCode, 400);

    const audit = await ctx.app.inject({
      method: 'GET',
      url: `${base}/audit?entityType=credential`,
      headers,
    });
    assert.equal(audit.statusCode, 200, audit.body);
    const actions = (audit.json() as Array<{ action: string }>).map((row) => row.action);
    assert.ok(actions.includes('credential.created'));
    assert.ok(actions.includes('credential.revoked'));

    const viewerAudit = await ctx.app.inject({
      method: 'GET',
      url: `${base}/audit`,
      headers: authHeaders(viewer),
    });
    assert.equal(viewerAudit.statusCode, 403);
  } finally {
    await ctx.close();
  }
});

test('webhook: HMAC, idempotency, outbox dispatch, and publish validation', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);
    const base = `/api/v1/workspaces/${session.workspaceId}`;
    const secret = 'webhook-secret-that-is-long-enough';

    const credentialId = await createHmacCredential(ctx, headers, session.workspaceId, secret);
    const workflowId = await publishWebhookWorkflow(
      ctx,
      headers,
      session.workspaceId,
      'incoming-orders',
      credentialId,
    );

    // Publishing a webhook without an HMAC credential is rejected.
    const noCredential = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflows`,
      headers,
      payload: { name: 'بدون توقيع' },
    });
    const noCredentialId = (noCredential.json() as { id: string }).id;
    await ctx.app.inject({
      method: 'PUT',
      url: `${base}/workflows/${noCredentialId}/draft`,
      headers,
      payload: { revision: 1, graph: webhookGraph('unsigned', '') },
    });
    const rejected = await ctx.app.inject({
      method: 'POST',
      url: `${base}/workflows/${noCredentialId}/publish`,
      headers,
      payload: {},
    });
    assert.equal(rejected.statusCode, 400, rejected.body);

    const body = JSON.stringify({ orderId: 'A-100', total: 250 });
    const timestamp = String(Date.now());
    const delivery = uuidv7();

    const accepted = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${session.workspaceId}/incoming-orders`,
      headers: {
        'content-type': 'application/json',
        'x-madar-timestamp': timestamp,
        'x-madar-signature': sign(secret, timestamp, body),
        'x-madar-delivery': delivery,
      },
      payload: body,
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const acceptedBody = accepted.json() as {
      executionId: string;
      workflowId: string;
      duplicate: boolean;
    };
    assert.equal(acceptedBody.workflowId, workflowId);
    assert.equal(acceptedBody.duplicate, false);
    assert.equal(ctx.jobs.length, 1);
    assert.equal(ctx.jobs[0]!.data.executionId, acceptedBody.executionId);

    // Same delivery id is idempotent and does not create a second execution.
    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${session.workspaceId}/incoming-orders`,
      headers: {
        'content-type': 'application/json',
        'x-madar-timestamp': timestamp,
        'x-madar-signature': sign(secret, timestamp, body),
        'x-madar-delivery': delivery,
      },
      payload: body,
    });
    assert.equal(duplicate.statusCode, 202, duplicate.body);
    assert.equal((duplicate.json() as { duplicate: boolean }).duplicate, true);
    assert.equal(ctx.jobs.length, 1);

    // Bad signatures and stale timestamps are rejected.
    const badSignature = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${session.workspaceId}/incoming-orders`,
      headers: {
        'content-type': 'application/json',
        'x-madar-timestamp': timestamp,
        'x-madar-signature': 'sha256=deadbeef',
        'x-madar-delivery': uuidv7(),
      },
      payload: body,
    });
    assert.equal(badSignature.statusCode, 401);

    const staleTimestamp = String(Date.now() - 10 * 60_000);
    const stale = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${session.workspaceId}/incoming-orders`,
      headers: {
        'content-type': 'application/json',
        'x-madar-timestamp': staleTimestamp,
        'x-madar-signature': sign(secret, staleTimestamp, body),
        'x-madar-delivery': uuidv7(),
      },
      payload: body,
    });
    assert.equal(stale.statusCode, 401);

    const execution = await ctx.app.inject({
      method: 'GET',
      url: `${base}/executions/${acceptedBody.executionId}`,
      headers,
    });
    assert.equal(execution.statusCode, 200, execution.body);
    const executionBody = execution.json() as {
      triggerType: string;
      triggerPayload: { body: { orderId: string } };
      idempotencyKey: string;
    };
    assert.equal(executionBody.triggerType, 'webhook');
    assert.equal(executionBody.triggerPayload.body.orderId, 'A-100');
    assert.equal(executionBody.idempotencyKey, `webhook:${delivery}`);

    const outboxRows = await ctx.deps.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.topic, 'execution.enqueue'),
          sql`${outbox.payload}->>'workflowId' = ${workflowId}`,
        ),
      );
    assert.equal(outboxRows.length, 1);
    assert.ok(outboxRows[0]!.dispatchedAt);

    // Queue outage: webhook still commits and returns 202, dispatcher catches up.
    ctx.failNextEnqueue = true;
    const secondBody = JSON.stringify({ orderId: 'A-200' });
    const secondTimestamp = String(Date.now());
    const pending = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${session.workspaceId}/incoming-orders`,
      headers: {
        'content-type': 'application/json',
        'x-madar-timestamp': secondTimestamp,
        'x-madar-signature': sign(secret, secondTimestamp, secondBody),
        'x-madar-delivery': uuidv7(),
      },
      payload: secondBody,
    });
    assert.equal(pending.statusCode, 202, pending.body);
    assert.equal(ctx.jobs.length, 1);

    const pendingRows = await ctx.deps.db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.topic, 'execution.enqueue'),
          sql`${outbox.payload}->>'workflowId' = ${workflowId}`,
        ),
      );
    assert.equal(pendingRows.length, 2);
    const pendingRow = pendingRows.find((row) => !row.dispatchedAt);
    assert.ok(pendingRow);

    const dispatched = await dispatchOutbox(ctx.deps);
    assert.equal(dispatched, 1);
    assert.equal(ctx.jobs.length, 2);

    // Archive moves dispatched hot rows to the permanent cold archive.
    await ctx.deps.db
      .update(outbox)
      .set({ createdAt: new Date(Date.now() - 48 * 3_600_000) })
      .where(
        and(
          eq(outbox.topic, 'execution.enqueue'),
          sql`${outbox.payload}->>'workflowId' = ${workflowId}`,
        ),
      );
    const archived = await archiveDispatchedOutbox(ctx.deps);
    assert.equal(archived, 2);
    const archiveRows = await ctx.deps.db
      .select()
      .from(outboxArchive)
      .where(sql`${outboxArchive.payload}->>'workflowId' = ${workflowId}`);
    assert.equal(archiveRows.length, 2);
  } finally {
    await ctx.close();
  }
});

test('MFA: admin TOTP enrollment, challenge login, recovery codes, and role gate', { skip: !hasTestDatabase }, async () => {
  const ctx = await createTestContext();
  try {
    const session = await registerSession(ctx.app);
    const headers = authHeaders(session);

    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/setup',
      headers,
    });
    assert.equal(setup.statusCode, 200, setup.body);
    const setupBody = setup.json() as { secret: string; otpauthUrl: string };
    assert.match(setupBody.otpauthUrl, /^otpauth:\/\/totp\//);

    const currentStep = Math.floor(Date.now() / 30_000);
    const enable = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/enable',
      headers,
      payload: { code: totpCode(setupBody.secret, currentStep) },
    });
    assert.equal(enable.statusCode, 200, enable.body);
    const recoveryCodes = (enable.json() as { recoveryCodes: string[] }).recoveryCodes;
    assert.equal(recoveryCodes.length, 10);

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: session.email, password: 'correct-horse-battery-staple' },
    });
    assert.equal(login.statusCode, 200, login.body);
    const loginBody = login.json() as {
      mfaRequired: boolean;
      challengeToken: string;
      accessToken?: string;
    };
    assert.equal(loginBody.mfaRequired, true);
    assert.equal(loginBody.accessToken, undefined);

    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: {
        challengeToken: loginBody.challengeToken,
        code: totpCode(setupBody.secret, currentStep + 1),
      },
    });
    assert.equal(verify.statusCode, 200, verify.body);
    const verified = verify.json() as { accessToken: string; mfaMethod: string };
    assert.equal(verified.mfaMethod, 'totp');
    assert.ok(verified.accessToken.length > 100);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${verified.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { user: { id: string } }).user.id, session.userId);

    // The previous TOTP step cannot be replayed for a new challenge.
    const replayLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: session.email, password: 'correct-horse-battery-staple' },
    });
    const replayChallenge = (replayLogin.json() as { challengeToken: string }).challengeToken;
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: {
        challengeToken: replayChallenge,
        code: totpCode(setupBody.secret, currentStep + 1),
      },
    });
    assert.equal(replay.statusCode, 401);

    // Recovery code works once.
    const recoveryLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: session.email, password: 'correct-horse-battery-staple' },
    });
    const recoveryChallenge = (recoveryLogin.json() as { challengeToken: string }).challengeToken;
    const recoveryVerify = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { challengeToken: recoveryChallenge, code: recoveryCodes[0]! },
    });
    assert.equal(recoveryVerify.statusCode, 200, recoveryVerify.body);
    assert.equal((recoveryVerify.json() as { mfaMethod: string }).mfaMethod, 'recovery');

    const reuseLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: session.email, password: 'correct-horse-battery-staple' },
    });
    const reuseChallenge = (reuseLogin.json() as { challengeToken: string }).challengeToken;
    const reuse = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { challengeToken: reuseChallenge, code: recoveryCodes[0]! },
    });
    assert.equal(reuse.statusCode, 401);

    // Non-admins cannot enroll in TOTP.
    const viewer = await registerSession(ctx.app);
    await ctx.deps.db
      .update(memberships)
      .set({ role: 'viewer' })
      .where(
        and(
          eq(memberships.userId, viewer.userId),
          eq(memberships.workspaceId, viewer.workspaceId),
        ),
      );
    const status = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/mfa/status',
      headers: authHeaders(viewer),
    });
    assert.equal(status.statusCode, 200);
    assert.equal((status.json() as { admin: boolean }).admin, false);

    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/setup',
      headers: authHeaders(viewer),
    });
    assert.equal(forbidden.statusCode, 403);
  } finally {
    await ctx.close();
  }
});
