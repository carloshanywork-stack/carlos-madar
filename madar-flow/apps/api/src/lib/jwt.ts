import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'madar-flow';
const AUDIENCE = 'madar-flow-api';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createAccessToken(
  secret: string,
  claims: AccessTokenClaims,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: claims.sid, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('Invalid access token payload.');
  }

  return { sub: payload.sub, sid: payload.sid };
}

export interface StreamTokenClaims {
  sub: string;
  sid: string;
  workspaceId: string;
  executionId: string;
}

/** Short-lived token for EventSource, which cannot send Authorization headers. */
export async function createStreamToken(
  secret: string,
  claims: StreamTokenClaims,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sid: claims.sid,
    workspaceId: claims.workspaceId,
    executionId: claims.executionId,
    typ: 'execution_stream',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey(secret));
}

export async function verifyStreamToken(
  secret: string,
  token: string,
): Promise<StreamTokenClaims> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  if (
    payload.typ !== 'execution_stream' ||
    typeof payload.sub !== 'string' ||
    typeof payload.sid !== 'string' ||
    typeof payload.workspaceId !== 'string' ||
    typeof payload.executionId !== 'string'
  ) {
    throw new Error('Invalid stream token payload.');
  }

  return {
    sub: payload.sub,
    sid: payload.sid,
    workspaceId: payload.workspaceId,
    executionId: payload.executionId,
  };
}

export interface MfaChallengeClaims {
  sub: string;
}

/** Short-lived token proving the password step succeeded; exchanged for a session after TOTP. */
export async function createMfaChallengeToken(
  secret: string,
  userId: string,
  ttlSeconds = 300,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: 'mfa_challenge' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey(secret));
}

export async function verifyMfaChallengeToken(
  secret: string,
  token: string,
): Promise<MfaChallengeClaims> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (payload.typ !== 'mfa_challenge' || typeof payload.sub !== 'string') {
    throw new Error('Invalid MFA challenge token.');
  }
  return { sub: payload.sub };
}
