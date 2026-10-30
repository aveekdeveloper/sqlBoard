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
  throw new ApiError(
    401,
    'MCP_UNAUTHENTICATED',
    'No MCP context available for session ' + (sessionId ?? 'unknown') +
      '. The session was initialized without valid credentials — check the Authorization (Bearer sb_…) and X-Tenant headers on the initialize request.',
  );
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
    // Accept slug (preferred), id, or a case-insensitive match.
    const { tenants } = await import('../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const slug = String(tenantHeader).trim();
    let rows = await db.select().from(tenants).where(eq(tenants.slug, slug));
    if (rows.length === 0) {
      rows = await db.select().from(tenants).where(eq(tenants.id, slug));
    }
    if (rows.length === 0) {
      // Fall back to a case-insensitive slug match.
      const all = await db.select().from(tenants);
      rows = all.filter((r: any) => String(r.slug).toLowerCase() === slug.toLowerCase());
    }
    if (rows.length === 0 || rows[0].status === 'deleted') {
      throw new ApiError(404, 'TENANT_NOT_FOUND', 'Unknown tenant: ' + slug);
    }
    tenant = {
      id: rows[0].id,
      slug: rows[0].slug,
      name: rows[0].name,
      domain: rows[0].domain,
      plan: rows[0].plan,
      status: rows[0].status,
      kind: rows[0].kind ?? 'tenant',
    };
  } else {
    // No X-Tenant header: derive the tenant from an API token if possible.
    const rawAuth = headers['authorization'];
    const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    const match = typeof authHeader === 'string' ? authHeader.match(/^Bearer\\s+(.+)$/i) : null;
    const token = match ? match[1].trim() : null;
    if (token && token.startsWith('sb_')) {
      try {
        const { apiTokens, tenants } = await import('../db/schema.js');
        const { eq } = await import('drizzle-orm');
        const { hashApiToken } = await import('../auth/session.js');
        const rows = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashApiToken(token)));
        const apiToken = rows[0];
        if (apiToken && !apiToken.revokedAt) {
          const trows = await db.select().from(tenants).where(eq(tenants.id, apiToken.tenantId));
          const t = trows[0];
          if (t && t.status !== 'deleted') {
            tenant = {
              id: t.id,
              slug: t.slug,
              name: t.name,
              domain: t.domain,
              plan: t.plan,
              status: t.status,
              kind: t.kind ?? 'tenant',
            };
          }
        }
      } catch {
        // Fall through to currentTenant(); requireUser will still enforce.
      }
    }
  }

  const user = await runWithTenantAsync(tenant, () => requireUser({ headers }, db));
  return { user, tenant };
}
