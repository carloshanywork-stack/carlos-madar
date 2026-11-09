import { and, eq } from 'drizzle-orm';
import { credentials, type Database } from '@madar/db';
import { decryptSecret, resolveCredentialsKey, type Env } from '@madar/shared';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const oauthCache = new Map<string, CachedToken>();

async function fetchOAuthToken(
  credentialId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const cached = oauthCache.get(credentialId);
  if (cached && cached.expiresAt > Date.now() + 5_000) return cached.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: String(payload.clientId ?? ''),
    client_secret: String(payload.clientSecret ?? ''),
    ...(payload.scope ? { scope: String(payload.scope) } : {}),
    ...(payload.audience ? { audience: String(payload.audience) } : {}),
  });

  const response = await fetch(String(payload.tokenUrl ?? ''), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`OAuth2 token endpoint returned HTTP ${response.status}`);
  }

  const parsed = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof parsed.access_token !== 'string' || !parsed.access_token) {
    throw new Error('OAuth2 token response did not include access_token');
  }

  const ttlSeconds = Number(parsed.expires_in);
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 300;
  oauthCache.set(credentialId, {
    token: parsed.access_token,
    expiresAt: Date.now() + ttl * 1_000,
  });

  return parsed.access_token;
}

export class WorkerCredentialResolver {
  private readonly key: Buffer;

  constructor(
    private readonly db: Database,
    env: Env,
    private readonly logger: { warn(data: unknown, message?: string): void },
  ) {
    this.key = resolveCredentialsKey(env);
  }

  async resolve(
    workspaceId: string,
    credentialId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, credentialId), eq(credentials.workspaceId, workspaceId)))
      .limit(1);

    const credential = rows[0];
    if (!credential || credential.revokedAt) return null;

    const payload = decryptSecret<Record<string, unknown>>(this.key, credential.encryptedPayload);

    await this.db
      .update(credentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(credentials.id, credentialId))
      .catch(() => undefined);

    switch (credential.type) {
      case 'api_key':
        return {
          type: 'api_key',
          secret: String(payload.secret ?? ''),
          headerName: String(payload.headerName ?? 'x-api-key'),
          ...(payload.valuePrefix ? { valuePrefix: String(payload.valuePrefix) } : {}),
        };
      case 'bearer':
        return { type: 'bearer', token: String(payload.token ?? '') };
      case 'basic':
        return {
          type: 'basic',
          username: String(payload.username ?? ''),
          password: String(payload.password ?? ''),
        };
      case 'oauth2':
        try {
          return { type: 'bearer', token: await fetchOAuthToken(credentialId, payload) };
        } catch (error) {
          this.logger.warn(
            {
              credentialId,
              error: error instanceof Error ? error.message : String(error),
            },
            'OAuth2 credential preflight failed at runtime',
          );
          throw error;
        }
      default:
        return null;
    }
  }
}
