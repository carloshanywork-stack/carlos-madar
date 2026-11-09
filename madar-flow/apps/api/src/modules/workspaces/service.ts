import { and, eq } from 'drizzle-orm';
import { memberships, workspaces } from '@madar/db';
import { AppError, isRole, uuidv7 } from '@madar/shared';
import type { AppDeps } from '../../deps.js';
import { isUniqueViolation } from '../../lib/db-errors.js';

function slugBase(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return normalized || 'workspace';
}

export async function listWorkspaces(deps: AppDeps, userId: string) {
  return deps.db
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
}

export async function createWorkspace(deps: AppDeps, userId: string, name: string) {
  const workspaceId = uuidv7();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${uuidv7().replaceAll('-', '').slice(0, 6)}`;
    const slug = `${slugBase(name)}${suffix}`;

    try {
      await deps.db.transaction(async (tx) => {
        await tx.insert(workspaces).values({ id: workspaceId, name, slug });
        await tx.insert(memberships).values({
          id: uuidv7(),
          workspaceId,
          userId,
          role: 'owner',
        });
      });

      return { id: workspaceId, name, slug, role: 'owner' as const };
    } catch (error) {
      lastError = error;
      if (!isUniqueViolation(error, 'workspaces_slug_uq') || attempt === 2) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : AppError.internal();
}

export async function getWorkspaceForUser(deps: AppDeps, userId: string, workspaceId: string) {
  const rows = await deps.db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: memberships.role,
      createdAt: workspaces.createdAt,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);

  const workspace = rows[0];
  if (!workspace || !isRole(workspace.role)) {
    throw AppError.notFound('not_found', 'Workspace was not found');
  }

  return workspace;
}
