export const ROLE_RANK = { viewer: 0, member: 1, admin: 2 } as const;

export type Role = keyof typeof ROLE_RANK;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}

export function toRole(value: unknown): Role {
  return isRole(value) ? value : 'viewer';
}

/** A token can never grant more than the owning user already has. */
export function effectiveRole(userRole: unknown, tokenScope: unknown): Role {
  const user = toRole(userRole);
  const scope = toRole(tokenScope);
  return ROLE_RANK[scope] < ROLE_RANK[user] ? scope : user;
}
