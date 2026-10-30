export const ROLE_RANK = {
  viewer: 0,
  analyst: 1,
  member: 2,
  tenant_admin: 3,
  platform_admin: 4,
} as const;

export type Role = keyof typeof ROLE_RANK;

// Stored value 'admin' from older installs maps to tenant_admin by default.
// session.ts upgrades it to platform_admin on the platform tenant.
export const LEGACY_ROLE_ALIASES: Record<string, Role> = {
  admin: 'tenant_admin',
};

export function normalizeRole(value: unknown): Role {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, value)) {
    return value as Role;
  }
  if (typeof value === 'string' && LEGACY_ROLE_ALIASES[value]) {
    return LEGACY_ROLE_ALIASES[value];
  }
  return 'viewer';
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}

export function toRole(value: unknown): Role {
  return normalizeRole(value);
}

export type Capability =
  | 'connection:read' | 'connection:write' | 'connection:delete'
  | 'query:run' | 'query:compile'
  | 'saved_query:write' | 'dashboard:write' | 'dashboard:share'
  | 'token:create:self' | 'token:revoke:any' | 'user:manage'
  | 'tenant:read' | 'tenant:write' | 'audit:read';

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  viewer: ['connection:read', 'query:run', 'query:compile'],
  analyst: ['connection:read', 'query:run', 'query:compile', 'saved_query:write', 'dashboard:write', 'dashboard:share', 'token:create:self'],
  member: ['connection:read', 'connection:write', 'connection:delete', 'query:run', 'query:compile', 'saved_query:write', 'dashboard:write', 'dashboard:share', 'token:create:self'],
  tenant_admin: ['connection:read', 'connection:write', 'connection:delete', 'query:run', 'query:compile', 'saved_query:write', 'dashboard:write', 'dashboard:share', 'token:create:self', 'token:revoke:any', 'user:manage', 'audit:read'],
  platform_admin: ['connection:read', 'connection:write', 'connection:delete', 'query:run', 'query:compile', 'saved_query:write', 'dashboard:write', 'dashboard:share', 'token:create:self', 'token:revoke:any', 'user:manage', 'audit:read', 'tenant:read', 'tenant:write'],
};

export function capabilities(role: unknown): Capability[] {
  return ROLE_CAPABILITIES[toRole(role)] ?? [];
}

export function can(role: unknown, capability: Capability): boolean {
  return capabilities(role).includes(capability);
}

/** A token can never grant more than the owning user already has. */
export function effectiveRole(userRole: unknown, tokenScope: unknown): Role {
  const user = toRole(userRole);
  const scope = toRole(tokenScope);
  return ROLE_RANK[scope] < ROLE_RANK[user] ? scope : user;
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: 'Read dashboards, connections, tables and run queries.',
  analyst: 'Viewer + save queries/dashboards and share. Cannot modify connections.',
  member: 'Analyst + create, update and delete connections.',
  tenant_admin: 'Member + manage users, revoke tokens, read audit log (own tenant).',
  platform_admin: 'Tenant admin + create, update and delete tenants (platform tenant only).',
};