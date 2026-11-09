import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { memberships, users } from '@madar/db';
import { AppError, hasPermission, isRole, type Permission, type Role } from '@madar/shared';
import type { AppDeps } from '../deps.js';
import { verifyAccessToken } from './jwt.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
}

export async function requireUser(
  request: FastifyRequest,
  deps: AppDeps,
): Promise<AuthenticatedUser> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('unauthorized', 'Missing bearer token');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) throw AppError.unauthorized('unauthorized', 'Missing bearer token');

  let claims: { sub: string; sid: string };
  try {
    claims = await verifyAccessToken(deps.env.JWT_ACCESS_SECRET, token);
  } catch {
    throw AppError.unauthorized('invalid_token', 'Invalid or expired access token');
  }

  const rows = await deps.db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.id, claims.sub), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);

  const user = rows[0];
  if (!user) throw AppError.unauthorized('invalid_token', 'User is not available');

  return { ...user, sessionId: claims.sid };
}

export async function getWorkspaceRole(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<Role> {
  const rows = await deps.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);

  const membership = rows[0];
  if (!membership || !isRole(membership.role)) {
    throw AppError.forbidden('forbidden', 'No access to this workspace');
  }

  return membership.role;
}

export async function requireWorkspaceAccess(
  request: FastifyRequest,
  deps: AppDeps,
  userId: string,
): Promise<{ workspaceId: string; role: Role }> {
  const header = request.headers['x-workspace-id'];
  const workspaceId = Array.isArray(header) ? header[0] : header;
  if (!workspaceId) {
    throw AppError.badRequest('validation_error', 'Missing x-workspace-id header');
  }

  const role = await getWorkspaceRole(deps, userId, workspaceId);
  return { workspaceId, role };
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw AppError.forbidden('forbidden', 'Insufficient permissions');
  }
}
