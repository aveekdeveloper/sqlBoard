import type { DrizzleDb } from '../db/client.js';
import { requireUser, type AuthUser } from '../auth/session.js';
import { currentTenant, runWithTenantAsync, type TenantContext } from '../core/tenancy.js';
import { ApiError } from '../errors.js';

export interface McpContext {
  user: AuthUser;
  tenant: TenantContext;
}

// Global map: sessionId -> McpContext
// Populated by transport.ts when a session is initialized.
const sessionContexts = new Map<string, McpContext>();

export function getMcpContext(sessionId?: string): McpContext {
  if (sessionId && sessionContexts.has(sessionId)) {
    return sessionContexts.get(sessionId)!;
  }
  // Fallback: try to resolve from current async context (for stdio mode)
  throw new Error('No MCP context available for session: ' + (sessionId ?? 'unknown'));
}

export function setMcpContext(sessionId: string, ctx: McpContext): void {
  sessionContexts.set(sessionId, ctx);
}

export function deleteMcpContext(sessionId: string): void {
  sessionContexts.delete(sessionId);
}

export async function resolveMcpContext(
  headers: Record<string, string | string[] | undefined>,
  db: DrizzleDb,
): Promise<McpContext> {
  // Resolve the tenant first, then authenticate inside that tenant context.
  const rawHeader = headers['x-tenant'];
  const tenantHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  let tenant = currentTenant();
  if (tenantHeader) {
    const { tenants } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(tenants).where(eq(tenants.slug, tenantHeader));
    if (rows.length === 0 || rows[0].status === 'deleted') {
      throw new ApiError(404, 'TENANT_NOT_FOUND', 'Unknown tenant');
    }
    tenant = {
      id: rows[0].id,
      slug: rows[0].slug,
      name: rows[0].name,
      domain: rows[0].domain,
      plan: rows[0].plan,
      status: rows[0].status,
    };
  }
  const user = await runWithTenantAsync(tenant, () => requireUser({ headers }, db));
  return { user, tenant };
}
