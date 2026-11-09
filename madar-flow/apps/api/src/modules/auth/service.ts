import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  auditLogs,
  memberships,
  refreshTokens,
  userRecoveryCodes,
  users,
  workspaces,
} from '@madar/db';
import {
  AppError,
  decryptSecret,
  encryptSecret,
  resolveCredentialsKey,
  sha256,
  uuidv7,
} from '@madar/shared';
import { createMfaChallengeToken, verifyMfaChallengeToken } from '../../lib/jwt.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotpCode,
} from '../../lib/totp.js';
import type { AppDeps } from '../../deps.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { createAccessToken } from '../../lib/jwt.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';

type UserRow = typeof users.$inferSelect;

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function isWorkspaceAdmin(deps: AppDeps, userId: string): Promise<boolean> {
  const rows = await deps.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), inArray(memberships.role, ['owner', 'admin'])))
    .limit(1);
  return rows.length > 0;
}

function credentialsKey(deps: AppDeps): Buffer {
  return resolveCredentialsKey(deps.env);
}

async function createSession(
  deps: AppDeps,
  userId: string,
  meta: SessionMeta,
): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date }> {
  const familyId = uuidv7();
  const refreshToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + deps.env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await deps.db.insert(refreshTokens).values({
    id: uuidv7(),
    userId,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  const accessToken = await createAccessToken(
    deps.env.JWT_ACCESS_SECRET,
    { sub: userId, sid: familyId },
    deps.env.JWT_ACCESS_TTL_SECONDS,
  );

  return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
}

export async function register(
  deps: AppDeps,
  input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  } & SessionMeta,
) {
  const email = normalizeEmail(input.email);
  const userId = uuidv7();
  const workspaceId = uuidv7();
  const passwordHash = await hashPassword(input.password);
  const workspaceSlug = `ws-${workspaceId.replaceAll('-', '').slice(0, 16)}`;

  try {
    await deps.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        passwordHash,
        displayName: input.displayName,
      });
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: input.workspaceName,
        slug: workspaceSlug,
      });
      await tx.insert(memberships).values({
        id: uuidv7(),
        workspaceId,
        userId,
        role: 'owner',
      });
      await tx.insert(auditLogs).values({
        id: uuidv7(),
        workspaceId,
        actorUserId: userId,
        actorLabel: email,
        action: 'user.register',
        entityType: 'user',
        entityId: userId,
        newValues: { email, workspaceName: input.workspaceName },
        ip: input.ip,
        userAgent: input.userAgent,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_uq')) {
      throw AppError.conflict('email_taken', 'Email already registered');
    }
    throw error;
  }

  const session = await createSession(deps, userId, input);

  return {
    ...session,
    user: {
      id: userId,
      email,
      displayName: input.displayName,
      createdAt: new Date().toISOString(),
    } satisfies PublicUser,
    workspace: {
      id: workspaceId,
      name: input.workspaceName,
      slug: workspaceSlug,
      role: 'owner' as const,
    },
  };
}

export async function login(
  deps: AppDeps,
  input: { email: string; password: string } & SessionMeta,
) {
  const email = normalizeEmail(input.email);
  const rows = await deps.db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);

  const user = rows[0];
  const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;
  if (!user || !valid) {
    throw AppError.unauthorized('invalid_credentials', 'Invalid email or password');
  }

  if (user.totpEnabled) {
    const challengeToken = await createMfaChallengeToken(deps.env.JWT_ACCESS_SECRET, user.id);
    return {
      mfaRequired: true as const,
      challengeToken,
      user: toPublicUser(user),
    };
  }

  await deps.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const session = await createSession(deps, user.id, input);
  const admin = await isWorkspaceAdmin(deps, user.id);

  return {
    ...session,
    user: toPublicUser(user),
    mfaRequired: false as const,
    mfaSetupRequired: admin && !user.totpEnabled,
  };
}

async function verifySecondFactor(
  deps: AppDeps,
  user: UserRow,
  code: string,
): Promise<'totp' | 'recovery'> {
  const normalized = normalizeRecoveryCode(code);
  const recoveryRows = await deps.db
    .select({ id: userRecoveryCodes.id })
    .from(userRecoveryCodes)
    .where(
      and(
        eq(userRecoveryCodes.userId, user.id),
        eq(userRecoveryCodes.codeHash, sha256(normalized)),
        isNull(userRecoveryCodes.usedAt),
      ),
    )
    .limit(1);

  if (recoveryRows[0]) {
    await deps.db
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(eq(userRecoveryCodes.id, recoveryRows[0].id));
    return 'recovery';
  }

  if (!user.totpSecretEncrypted) {
    throw AppError.unauthorized('invalid_token', 'MFA is not configured for this account');
  }

  const secret = decryptSecret<{ secret: string }>(
    credentialsKey(deps),
    user.totpSecretEncrypted,
  ).secret;
  const verification = verifyTotpCode(secret, code);
  if (!verification.valid) {
    throw AppError.unauthorized('invalid_credentials', 'Invalid authentication code');
  }
  if (user.totpLastUsedStep !== null && verification.step <= user.totpLastUsedStep) {
    throw AppError.unauthorized('invalid_credentials', 'Authentication code has already been used');
  }

  await deps.db
    .update(users)
    .set({ totpLastUsedStep: verification.step })
    .where(eq(users.id, user.id));
  return 'totp';
}

export async function verifyMfaLogin(
  deps: AppDeps,
  input: { challengeToken: string; code: string } & SessionMeta,
) {
  let userId: string;
  try {
    const claims = await verifyMfaChallengeToken(
      deps.env.JWT_ACCESS_SECRET,
      input.challengeToken,
    );
    userId = claims.sub;
  } catch {
    throw AppError.unauthorized('invalid_token', 'Invalid or expired MFA challenge');
  }

  const rows = await deps.db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);
  const user = rows[0];
  if (!user) throw AppError.unauthorized('invalid_token', 'User is not available');

  const method = await verifySecondFactor(deps, user, input.code);
  await deps.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const session = await createSession(deps, user.id, input);

  return { ...session, user: toPublicUser(user), mfaMethod: method };
}

export async function getMfaStatus(deps: AppDeps, userId: string) {
  const rows = await deps.db
    .select({
      totpEnabled: users.totpEnabled,
      totpSecretEncrypted: users.totpSecretEncrypted,
      totpConfirmedAt: users.totpConfirmedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  const admin = await isWorkspaceAdmin(deps, userId);
  return {
    admin,
    totpEnabled: Boolean(user?.totpEnabled),
    setupPending: Boolean(user?.totpSecretEncrypted) && !user?.totpEnabled,
    confirmedAt: user?.totpConfirmedAt?.toISOString() ?? null,
  };
}

export async function setupMfa(deps: AppDeps, userId: string) {
  const userRows = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw AppError.notFound('not_found', 'User was not found');
  if (!(await isWorkspaceAdmin(deps, userId))) {
    throw AppError.forbidden('forbidden', 'TOTP is available to workspace admins only');
  }
  if (user.totpEnabled) {
    throw AppError.conflict('conflict', 'TOTP is already enabled');
  }

  const secret = generateTotpSecret();
  await deps.db
    .update(users)
    .set({
      totpSecretEncrypted: encryptSecret(credentialsKey(deps), { secret }),
      totpEnabled: false,
      totpConfirmedAt: null,
    })
    .where(eq(users.id, userId));

  return { secret, otpauthUrl: otpauthUrl(user.email, secret) };
}

export async function enableMfa(deps: AppDeps, userId: string, code: string) {
  const userRows = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw AppError.notFound('not_found', 'User was not found');
  if (!(await isWorkspaceAdmin(deps, userId))) {
    throw AppError.forbidden('forbidden', 'TOTP is available to workspace admins only');
  }
  if (!user.totpSecretEncrypted) {
    throw AppError.badRequest('validation_error', 'Start MFA setup first');
  }

  const secret = decryptSecret<{ secret: string }>(
    credentialsKey(deps),
    user.totpSecretEncrypted,
  ).secret;
  const verification = verifyTotpCode(secret, code);
  if (!verification.valid) {
    throw AppError.badRequest('validation_error', 'Invalid authentication code');
  }

  const recoveryCodes = generateRecoveryCodes();
  const now = new Date();

  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        totpEnabled: true,
        totpConfirmedAt: now,
        totpLastUsedStep: verification.step,
      })
      .where(eq(users.id, userId));

    await tx.insert(userRecoveryCodes).values(
      recoveryCodes.map((recoveryCode) => ({
        id: uuidv7(),
        userId,
        codeHash: sha256(normalizeRecoveryCode(recoveryCode)),
      })),
    );

    await tx.insert(auditLogs).values({
      id: uuidv7(),
      actorUserId: userId,
      actorLabel: user.email,
      action: 'mfa.enabled',
      entityType: 'user',
      entityId: userId,
    });
  });

  return { recoveryCodes, totpEnabled: true };
}

export async function regenerateRecoveryCodes(
  deps: AppDeps,
  userId: string,
  code: string,
) {
  const userRows = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw AppError.notFound('not_found', 'User was not found');
  if (!(await isWorkspaceAdmin(deps, userId))) {
    throw AppError.forbidden('forbidden', 'TOTP is available to workspace admins only');
  }
  if (!user.totpEnabled || !user.totpSecretEncrypted) {
    throw AppError.badRequest('validation_error', 'TOTP is not enabled');
  }

  const secret = decryptSecret<{ secret: string }>(
    credentialsKey(deps),
    user.totpSecretEncrypted,
  ).secret;
  const verification = verifyTotpCode(secret, code);
  if (!verification.valid) {
    throw AppError.badRequest('validation_error', 'Invalid authentication code');
  }
  if (user.totpLastUsedStep !== null && verification.step <= user.totpLastUsedStep) {
    throw AppError.badRequest('validation_error', 'Authentication code has already been used');
  }

  const recoveryCodes = generateRecoveryCodes();
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(userRecoveryCodes)
      .set({ usedAt: now })
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
    await tx.insert(userRecoveryCodes).values(
      recoveryCodes.map((recoveryCode) => ({
        id: uuidv7(),
        userId,
        codeHash: sha256(normalizeRecoveryCode(recoveryCode)),
      })),
    );
    await tx.update(users).set({ totpLastUsedStep: verification.step }).where(eq(users.id, userId));
  });

  return { recoveryCodes };
}

export async function disableMfa(
  deps: AppDeps,
  userId: string,
  input: { password: string; code: string },
) {
  const userRows = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw AppError.notFound('not_found', 'User was not found');
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw AppError.unauthorized('invalid_credentials', 'Invalid password');
  }
  await verifySecondFactor(deps, user, input.code);

  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        totpEnabled: false,
        totpSecretEncrypted: null,
        totpConfirmedAt: null,
        totpLastUsedStep: null,
      })
      .where(eq(users.id, userId));
    await tx
      .update(userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
    await tx.insert(auditLogs).values({
      id: uuidv7(),
      actorUserId: userId,
      actorLabel: user.email,
      action: 'mfa.disabled',
      entityType: 'user',
      entityId: userId,
    });
  });

  return { totpEnabled: false };
}

export async function refresh(
  deps: AppDeps,
  presentedToken: string,
  meta: SessionMeta,
) {
  const rows = await deps.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(presentedToken)))
    .limit(1);

  const current = rows[0];
  if (!current) throw AppError.unauthorized('invalid_token', 'Invalid refresh token');

  const now = new Date();
  if (current.expiresAt.getTime() <= now.getTime()) {
    throw AppError.unauthorized('invalid_token', 'Refresh token expired');
  }

  if (current.revokedAt) {
    const graceActive =
      current.graceExpiresAt !== null && current.graceExpiresAt.getTime() > now.getTime();
    if (!graceActive) {
      await deps.db
        .update(refreshTokens)
        .set({ revokedAt: now, graceExpiresAt: null })
        .where(eq(refreshTokens.familyId, current.familyId));
      throw new AppError(401, 'token_reuse_detected', 'Refresh token reuse detected');
    }
  }

  const userRows = await deps.db
    .select()
    .from(users)
    .where(and(eq(users.id, current.userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);

  const user = userRows[0];
  if (!user) throw AppError.unauthorized('invalid_token', 'User is not available');

  const nextId = uuidv7();
  const nextToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + deps.env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await deps.db.transaction(async (tx) => {
    if (!current.revokedAt) {
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: now,
          graceExpiresAt: new Date(now.getTime() + deps.env.REFRESH_GRACE_SECONDS * 1000),
          replacedById: nextId,
        })
        .where(eq(refreshTokens.id, current.id));
    }

    await tx.insert(refreshTokens).values({
      id: nextId,
      userId: current.userId,
      familyId: current.familyId,
      tokenHash: hashToken(nextToken),
      expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
  });

  const accessToken = await createAccessToken(
    deps.env.JWT_ACCESS_SECRET,
    { sub: user.id, sid: current.familyId },
    deps.env.JWT_ACCESS_TTL_SECONDS,
  );

  return {
    accessToken,
    refreshToken: nextToken,
    refreshExpiresAt: expiresAt,
    user: toPublicUser(user),
  };
}

export async function logout(deps: AppDeps, presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;

  const rows = await deps.db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(presentedToken)))
    .limit(1);

  const row = rows[0];
  if (!row) return;

  await deps.db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), graceExpiresAt: null })
    .where(eq(refreshTokens.familyId, row.familyId));
}

export async function getProfile(deps: AppDeps, userId: string) {
  const rows = await deps.db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);

  const user = rows[0];
  if (!user) throw AppError.unauthorized('invalid_token', 'User is not available');

  const workspaceRows = await deps.db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: memberships.role,
      createdAt: workspaces.createdAt,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId));

  return { user: toPublicUser(user), workspaces: workspaceRows };
}
