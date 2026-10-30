import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DrizzleDb } from '../db/client.js';
import { getMcpContext, setMcpContext } from './auth.js';
import { ROLE_RANK } from '../auth/roles.js';
import { currentTenant } from '../core/tenancy.js';
import { connections, dashboards, savedQueries, tenants, users } from '../db/schema.js';
import {
  applyDashboardState,
  dashboardResponse,
  insertVersion,
  readDashboard,
} from '../core/dashboard-service.js';
import { ApplyDashboardStateSchema, CommitDashboardSchema } from '@sqlboard/shared';
import { eq } from 'drizzle-orm';
import { EngineFactory } from '../engines/factory.js';
import { QueryCache } from '../cache/query-cache.js';
import { DuckDbEngine } from '../engines/duckdb.js';

export interface McpDeps {
  db: DrizzleDb;
  engineFactory: EngineFactory;
  duckDb: DuckDbEngine;
  cache: QueryCache;
  secretKey: string;
}

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({
    name: 'sqlboard',
    version: '0.1.0',
  });

  // --- Read tools ---

  server.tool('list_connections', 'List all data connections for the current tenant.', {}, async (_args: any, extra: any) => {
    const ctx = getMcpContext(extra?.sessionId);
    const rows = await deps.db.select().from(connections).where(eq(connections.tenantId, ctx.tenant.id));
    return { content: [{ type: 'text', text: JSON.stringify(rows.map((r: any) => ({ id: r.id, name: r.name, type: r.type, createdAt: r.createdAt })), null, 2) }] };
  });

  server.tool('get_connection', 'Get details of a specific connection by ID.', { id: z.number().int().describe('Connection ID') }, async ({ id }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    const rows = await deps.db.select().from(connections).where(eq(connections.id, id));
    const row = rows[0];
    if (!row || row.tenantId !== ctx.tenant.id) {
      return { content: [{ type: 'text', text: `Connection ${id} not found` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ id: row.id, name: row.name, type: row.type, createdAt: row.createdAt }, null, 2) }] };
  });

  server.tool('list_tables', 'List tables in a connection.', { connectionId: z.number().int().describe('Connection ID') }, async ({ connectionId }, extra) => {
    try {
      const engine = await deps.engineFactory.forConnectionId(connectionId);
      const tables = await engine.listTables();
      return { content: [{ type: 'text', text: JSON.stringify(tables, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  server.tool('preview_table', 'Preview rows from a table.', { connectionId: z.number().int(), table: z.string(), limit: z.number().int().min(1).max(100).default(20) }, async ({ connectionId, table, limit }, extra) => {
    try {
      const engine = await deps.engineFactory.forConnectionId(connectionId);
      const result = await engine.preview(table, limit);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  server.tool('run_query', 'Execute a SQL query against a connection. Returns columns, rows, and row count.', { connectionId: z.number().int(), sql: z.string(), maxRows: z.number().int().min(1).max(5000).default(1000) }, async ({ connectionId, sql, maxRows }, extra) => {
    try {
      const engine = await deps.engineFactory.forConnectionId(connectionId);
      const result = await engine.run(sql, { maxRows });
      const truncated = result.rows.length >= maxRows;
      const output = { ...result, truncated };
      if (truncated) (output as any).note = `Results truncated to ${maxRows} rows.`;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  server.tool('compile_chart', 'Compile SQL with annotations into a chart spec (ECharts). Returns the spec and diagnostics.', { sql: z.string(), connectionId: z.number().int().optional(), theme: z.string().optional() }, async ({ sql, connectionId, theme }, extra) => {
    try {
      let data: any[] = [];
      if (connectionId) {
        const engine = await deps.engineFactory.forConnectionId(connectionId);
        const result = await engine.run(sql);
        data = result.rows;
      }
      const { compileSqlToFlint } = await import('sql-to-flint');
      const result = compileSqlToFlint({ sql, data, theme, backends: ['echarts'] });
      return { content: [{ type: 'text', text: JSON.stringify({ flint: result.flint, echarts: result.echarts, compiled: result.compiled, diagnostics: result.diagnostics }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  server.tool('list_saved_queries', 'List saved queries for the current tenant.', {}, async (_args: any, extra: any) => {
    const ctx = getMcpContext(extra?.sessionId);
    const rows = await deps.db.select().from(savedQueries).where(eq(savedQueries.tenantId, ctx.tenant.id));
    return { content: [{ type: 'text', text: JSON.stringify(rows.map((r: any) => ({ id: r.id, name: r.name, connectionId: r.connectionId, latestVersion: r.latestVersion, updatedAt: r.updatedAt })), null, 2) }] };
  });

  server.tool('get_saved_query', 'Get a saved query by ID, including its SQL.', { id: z.number().int() }, async ({ id }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    const rows = await deps.db.select().from(savedQueries).where(eq(savedQueries.id, id));
    const row = rows[0];
    if (!row || row.tenantId !== ctx.tenant.id) {
      return { content: [{ type: 'text', text: `Saved query ${id} not found` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
  });

  server.tool('list_dashboards', 'List dashboards for the current tenant.', {}, async (_args: any, extra: any) => {
    const ctx = getMcpContext(extra?.sessionId);
    const rows = await deps.db.select().from(dashboards).where(eq(dashboards.tenantId, ctx.tenant.id));
    return { content: [{ type: 'text', text: JSON.stringify(rows.map((r: any) => ({ id: r.id, name: r.name, description: r.description, createdAt: r.createdAt, updatedAt: r.updatedAt })), null, 2) }] };
  });

  server.tool('get_dashboard', 'Get a dashboard by ID.', { id: z.number().int() }, async ({ id }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    const rows = await deps.db.select().from(dashboards).where(eq(dashboards.id, id));
    const row = rows[0];
    if (!row || row.tenantId !== ctx.tenant.id) {
      return { content: [{ type: 'text', text: `Dashboard ${id} not found` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ id: row.id, name: row.name, description: row.description, createdAt: row.createdAt, updatedAt: row.updatedAt }, null, 2) }] };
  });

  // --- Write tools ---

  server.tool('create_connection', 'Create a new data connection. Requires member role.', {
    name: z.string().min(1),
    type: z.enum(['duckdb', 'sqlite', 'postgres', 'mysql', 'clickhouse', 'trino', 'databricks', 'snowflake']),
    config: z.record(z.unknown()).describe('Connection-specific config (host, port, database, user, password, etc.)'),
  }, async ({ name, type, config }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    if (ROLE_RANK[ctx.user.role] < ROLE_RANK.member) return { content: [{ type: 'text', text: 'Requires member role' }], isError: true };
    try {
      const { encryptJson } = await import('../crypto.js');
      const configEnc = encryptJson({ ...config, name, type }, deps.secretKey);
      const now = new Date().toISOString();
      const [inserted] = await deps.db.insert(connections).values({ name, type, configEnc, tenantId: ctx.tenant.id, createdAt: now }).returning();
      return { content: [{ type: 'text', text: JSON.stringify({ id: inserted.id, name: inserted.name, type: inserted.type }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  server.tool('create_saved_query', 'Save a SQL query for reuse. Requires analyst role.', { name: z.string().min(1), connectionId: z.number().int(), sql: z.string().min(1) }, async ({ name, connectionId, sql }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    if (ROLE_RANK[ctx.user.role] < ROLE_RANK.analyst) return { content: [{ type: 'text', text: 'Requires analyst role' }], isError: true };
    try {
      const now = new Date().toISOString();
      const [inserted] = await deps.db.insert(savedQueries).values({ name, connectionId, sql, latestVersion: 1, tenantId: ctx.tenant.id, createdAt: now, updatedAt: now }).returning();
      return { content: [{ type: 'text', text: JSON.stringify({ id: inserted.id, name: inserted.name, connectionId: inserted.connectionId }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  server.tool('create_dashboard', 'Create a new dashboard. Requires analyst role.', { name: z.string().min(1), description: z.string().optional() }, async ({ name, description }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    if (ROLE_RANK[ctx.user.role] < ROLE_RANK.analyst) return { content: [{ type: 'text', text: 'Requires analyst role' }], isError: true };
    try {
      const now = new Date().toISOString();
      const [inserted] = await deps.db.insert(dashboards).values({ name, description: description ?? null, tenantId: ctx.tenant.id, createdAt: now, updatedAt: now }).returning();
      return { content: [{ type: 'text', text: JSON.stringify({ id: inserted.id, name: inserted.name }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  // --- Dashboard state tools (member+) ---

  server.tool('apply_dashboard_state', 'Replace a dashboard blocks and optionally name/description/filters/theme/colors, recording a new version. Requires analyst role.', {
    id: z.number().int().describe('Dashboard ID'),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    filters: z.array(z.record(z.unknown())).optional(),
    theme: z.string().optional(),
    colors: z.array(z.string()).optional(),
    items: z.array(z.object({
      title: z.string().min(1),
      sql: z.string(),
      connectionId: z.number().int(),
      blockType: z.enum(['chart', 'metric', 'table', 'text']),
      savedQueryId: z.number().int().nullable().optional(),
      config: z.record(z.unknown()).optional(),
      layout: z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1).max(60),
      }),
    })),
    message: z.string().optional(),
    kind: z.enum(['manual', 'apply', 'restore']).default('apply'),
    baseVersion: z.number().int().nonnegative().optional(),
  }, async (args: any, extra: any) => {
    const ctx = getMcpContext(extra?.sessionId);
    if (ROLE_RANK[ctx.user.role] < ROLE_RANK.analyst) return { content: [{ type: 'text', text: 'Requires analyst role' }], isError: true };
    try {
      await readDashboard(deps.db, args.id, ctx.tenant.id);
      const parsed = ApplyDashboardStateSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: 'text', text: `Invalid dashboard state: ${JSON.stringify(parsed.error.flatten())}` }], isError: true };
      const { dashboard, version } = await applyDashboardState(deps.db, args.id, parsed.data, ctx.user.id, ctx.tenant.id, ctx.user.email);
      return { content: [{ type: 'text', text: JSON.stringify({ ...dashboard, version }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  server.tool('commit_dashboard_version', 'Commit the current dashboard state as a new manual version. Requires analyst role.', {
    id: z.number().int().describe('Dashboard ID'),
    message: z.string().min(1).max(200),
    baseVersion: z.number().int().nonnegative().optional(),
  }, async ({ id, message, baseVersion }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    if (ROLE_RANK[ctx.user.role] < ROLE_RANK.analyst) return { content: [{ type: 'text', text: 'Requires analyst role' }], isError: true };
    try {
      const { snapshot } = await readDashboard(deps.db, id, ctx.tenant.id);
      const parsed = CommitDashboardSchema.safeParse({ message, baseVersion });
      if (!parsed.success) return { content: [{ type: 'text', text: `Invalid commit: ${JSON.stringify(parsed.error.flatten())}` }], isError: true };
      await (await import('../core/dashboard-service.js')).assertBaseVersion(deps.db, id, parsed.data.baseVersion);
      const version = await insertVersion(deps.db, id, snapshot, parsed.data.message, 'manual', ctx.user.id, ctx.user.email);
      return { content: [{ type: 'text', text: JSON.stringify(version, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  // --- Tenant management (admin only) ---

  server.tool('list_tenants', 'List all tenants. Requires platform admin role.', {}, async (_args: any, extra: any) => {
    const ctx = getMcpContext(extra?.sessionId);
    if (ctx.user.role !== 'platform_admin') return { content: [{ type: 'text', text: 'Requires platform admin role' }], isError: true };
    const rows = await deps.db.select().from(tenants);
    return { content: [{ type: 'text', text: JSON.stringify(rows.filter((t: any) => t.status !== 'deleted').map((t: any) => ({ id: t.id, slug: t.slug, name: t.name, plan: t.plan, status: t.status })), null, 2) }] };
  });

  server.tool('create_tenant', 'Create a new tenant with an admin user. Requires platform admin role.', {
    slug: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    adminEmail: z.string().email(),
    adminPassword: z.string().min(8),
  }, async ({ slug, name, adminEmail, adminPassword }, extra) => {
    const ctx = getMcpContext(extra?.sessionId);
    if (ctx.user.role !== 'platform_admin') return { content: [{ type: 'text', text: 'Requires platform admin role' }], isError: true };
    try {
      const { randomUUID } = await import('node:crypto');
      const { scryptSync, randomBytes } = await import('node:crypto');
      const id = randomUUID();
      const now = new Date().toISOString();
      const existing = await deps.db.select().from(tenants).where(eq(tenants.slug, slug));
      if (existing.length > 0) {
        return { content: [{ type: 'text', text: `Tenant "${slug}" already exists` }], isError: true };
      }
      await deps.db.insert(tenants).values({ id, slug, name, plan: 'free', status: 'active', ownerEmail: adminEmail, createdAt: now, updatedAt: now });
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(adminPassword, salt, 64).toString('hex');
      await deps.db.insert(users).values({ email: adminEmail, passwordHash: `${salt}:${hash}`, role: 'tenant_admin', tenantId: id, createdAt: now });
      return { content: [{ type: 'text', text: JSON.stringify({ id, slug, name, adminEmail }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  return server;
}
