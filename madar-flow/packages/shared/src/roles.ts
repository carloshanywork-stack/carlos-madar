export const ROLES = ['owner', 'admin', 'editor', 'runner', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'workspace:read',
  'workspace:manage',
  'member:read',
  'member:manage',
  'workflow:read',
  'workflow:write',
  'workflow:publish',
  'execution:read',
  'execution:run',
  'execution:cancel',
  'execution:read_payload',
  'credential:read',
  'credential:write',
  'audit:read',
  'data:export',
  'data:purge',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [
    'workspace:read',
    'workspace:manage',
    'member:read',
    'member:manage',
    'workflow:read',
    'workflow:write',
    'workflow:publish',
    'execution:read',
    'execution:run',
    'execution:cancel',
    'execution:read_payload',
    'credential:read',
    'credential:write',
    'audit:read',
    'data:export',
  ],
  editor: [
    'workspace:read',
    'member:read',
    'workflow:read',
    'workflow:write',
    'workflow:publish',
    'execution:read',
    'execution:run',
    'execution:cancel',
    'execution:read_payload',
    'credential:read',
  ],
  runner: [
    'workspace:read',
    'workflow:read',
    'execution:read',
    'execution:run',
    'execution:cancel',
    'execution:read_payload',
  ],
  viewer: ['workspace:read', 'workflow:read', 'execution:read'],
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
