import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, badRequest, notFound } from '../errors.js';
import {
  connections,
  savedQueries,
  savedQueryTags,
  tags,
  savedQueryVersions,
  dashboards,
  dashboardItems,
  dashboardVersions,
  dashboardTags,
  uploads,
} from '../db/schema.js';
import type { DrizzleDb } from '../db/client.js';
import type { EngineFactory } from '../engines/factory.js';
import {
  ApplyDashboardStateSchema,
  CommitDashboardSchema,
  CreateConnectionRequestSchema,
  CreateDashboardItemSchema,
  DashboardLayoutUpdateSchema,
  RunQueryRequestSchema,
  serializeDashboardManifest,
  UpdateConnectionRequestSchema,
  UpdateDashboardItemSchema,
  UpdateDashboardSchema,
  type ManifestDashboard,
} from '@sqlboard/shared';
import { QueryCache } from '../cache/query-cache.js';
import { currentTenant } from '../core/tenancy.js';

async function syncTags(
  db: DrizzleDb,
  entityType: 'saved_query' | 'dashboard',
  entityId: number,
  tagNames: string[],
  tenantId: string,
): Promise<void> {
  const existingTags = await db.select().from(tags).where(eq(tags.tenantId, tenantId)).all();
  const tagIds: number[] = [];
  for (const name of tagNames.slice(0, 10)) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    let tag = existingTags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (!tag) {
      const now = new Date().toISOString();
      const palette = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
      const color = palette[Math.floor(Math.random() * palette.length)];
      const inserted = await db.insert(tags).values({ name: trimmed, color, tenantId, createdAt: now }).returning().get();
      tag = inserted;
      existingTags.push(tag);
    }
    tagIds.push(tag.id);
  }

  if (entityType === 'saved_query') {
    await db.delete(savedQueryTags).where(eq(savedQueryTags.savedQueryId, entityId));
    for (const tagId of tagIds) {
      await db.insert(savedQueryTags).values({ savedQueryId: entityId, tagId });
    }
  } else {
    await db.delete(dashboardTags).where(eq(dashboardTags.dashboardId, entityId));
    for (const tagId of tagIds) {
      await db.insert(dashboardTags).values({ dashboardId: entityId, tagId });
    }
  }
}

interface RouteDeps {
  db: DrizzleDb;
  engineFactory: EngineFactory;
  secretKey: string;
  uploadsDir: string;
  duckDb: import('../engines/duckdb.js').DuckDbEngine;
  cache: import('../cache/query-cache.js').QueryCache;
  storage: import('../storage/index.js').StorageBackend;
}

export function registerConnectionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/connections', async () => {
    const { currentTenant } = await import('../core/tenancy.js');
    const tenant = currentTenant();
    const rows = await deps.db.select().from(connections).where(eq(connections.tenantId, tenant.id)).all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      configSummary: row.type,
      createdAt: row.createdAt,
    }));
  });

  app.post('/api/connections', async (request, reply) => {
    const parsed = CreateConnectionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid connection payload', parsed.error.flatten());

    const existing = (await deps.db.select().from(connections).where(eq(connections.tenantId, currentTenant().id)).all()).find((c) => c.name === parsed.data.name);
    if (existing) throw new ApiError(409, 'CONFLICT', `A connection named "${parsed.data.name}" already exists`);

    const { encryptJson } = await import('../crypto.js');
    const tenant = currentTenant();
    const configEnc = encryptJson(parsed.data, deps.secretKey);
    const now = new Date().toISOString();
    const inserted = await deps.db
      .insert(connections)
      .values({ name: parsed.data.name, type: parsed.data.type, configEnc, tenantId: tenant.id, createdAt: now })
      .returning()
      .get();
    reply.code(201);
    return {
      id: inserted.id,
      name: inserted.name,
      type: inserted.type,
      configSummary: inserted.type,
      createdAt: inserted.createdAt,
    };
  });

  app.patch('/api/connections/:id', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const rows = await deps.db
      .select()
      .from(connections)
      .where(eq(connections.id, numericId))
      .all();
    const existing = rows[0];
    if (!existing) throw notFound(`Connection ${id} not found`);

    const parsed = UpdateConnectionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid connection update', parsed.error.flatten());

    const { decryptJson, encryptJson } = await import('../crypto.js');
    const currentConfig = decryptJson<Record<string, unknown>>(existing.configEnc, deps.secretKey);
    const merged = { ...currentConfig };
    for (const [key, value] of Object.entries(parsed.data)) {
      if (key === 'name') continue;
      if (value !== undefined && value !== '' && value !== null) {
        merged[key] = value;
      }
    }
    const configEnc = encryptJson(merged, deps.secretKey);

    const newName = parsed.data.name ?? existing.name;
    // Check name uniqueness if name changed
    if (newName !== existing.name) {
      const dup = (await deps.db.select().from(connections).where(eq(connections.tenantId, currentTenant().id)).all()).find((c) => c.name === newName && c.id !== numericId);
      if (dup) throw new ApiError(409, 'CONFLICT', `A connection named "${newName}" already exists`);
    }

    await deps.engineFactory.closeConnection(numericId);
    deps.cache.clear();

    await deps.db
      .update(connections)
      .set({ name: newName, configEnc })
      .where(eq(connections.id, numericId))
      .run();

    return {
      id: numericId,
      name: newName,
      type: existing.type,
      configSummary: existing.type,
      createdAt: existing.createdAt,
    };
  });

  app.delete('/api/connections/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const rows = await deps.db
      .select()
      .from(connections)
      .where(eq(connections.id, numericId))
      .all();
    if (rows.length === 0) throw notFound(`Connection ${id} not found`);
    await deps.engineFactory.closeConnection(numericId);
    deps.cache.clear();
    await deps.db.delete(connections).where(eq(connections.id, numericId)).run();
    reply.code(204);
  });

  app.post('/api/connections/validate', async (request) => {
    const parsed = CreateConnectionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid connection payload', parsed.error.flatten());

    const { encryptJson } = await import('../crypto.js');
    const configEnc = encryptJson(parsed.data, deps.secretKey);
    const engine = await deps.engineFactory.build(parsed.data.type, configEnc);
    try {
      const tables = await engine.listTables();
      return { ok: true, tableCount: tables.length, tables: tables.slice(0, 50) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    } finally {
      const closeable = engine as unknown as { close?: () => Promise<void> };
      if (typeof closeable.close === 'function') {
        await closeable.close().catch(() => undefined);
      }
    }
  });

  app.post('/api/connections/:id/test', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    try {
      const engine = await deps.engineFactory.forConnectionId(numericId);
      const tables = await engine.listTables();
      return { ok: true, tableCount: tables.length, tables: tables.slice(0, 50) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  app.get('/api/connections/:id/tables', async (request) => {
    const { id } = request.params as { id: string };
    try {
      const engine = await deps.engineFactory.forConnectionId(Number(id));
      return await engine.listTables();
    } catch (error) {
      throw new ApiError(500, 'CONNECTION_FAILED', (error as Error).message);
    }
  });

  app.get('/api/connections/:id/tables/:name/preview', async (request) => {
    const { id, name } = request.params as { id: string; name: string };
    try {
      const engine = await deps.engineFactory.forConnectionId(Number(id));
      return await engine.preview(name);
    } catch (error) {
      throw new ApiError(500, 'CONNECTION_FAILED', (error as Error).message);
    }
  });

  app.post('/api/connections/:id/query', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = RunQueryRequestSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid query payload', parsed.error.flatten());

    const connectionId = Number(id);
    const cacheKey = QueryCache.hashKey(connectionId, parsed.data.sql);
    const cached = deps.cache.get(cacheKey);
    if (cached) {
      return {
        columns: cached.columns,
        rows: cached.rows,
        rowCount: cached.rows.length,
        cached: true,
        staleAt: new Date(cached.staleAt).toISOString(),
      };
    }

    const engine = await deps.engineFactory.forConnectionId(connectionId);
    const result = await engine.run(parsed.data.sql, { maxRows: parsed.data.maxRows });

    if (result.rows.length <= 10000) {
      deps.cache.set(cacheKey, result.columns, result.rows);
    }

    return { ...result, cached: false, staleAt: null };
  });
}

export function registerSavedQueryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/saved-queries', async (request) => {
    const { currentTenant } = await import('../core/tenancy.js');
    const tenant = currentTenant();
    const url = new URL(request.url, 'http://localhost');
    const tagsParam = url.searchParams.get('tags');
    const connectionIdParam = url.searchParams.get('connectionId');
    const sortBy = url.searchParams.get('sortBy') || 'updatedAt';
    const sortDir = url.searchParams.get('sortDir') || 'desc';

    let rows = await deps.db.select().from(savedQueries).where(eq(savedQueries.tenantId, tenant.id)).all();

    // Filter by connection
    if (connectionIdParam) {
      const connId = Number(connectionIdParam);
      rows = rows.filter((r) => r.connectionId === connId);
    }

    // Filter by tags (OR logic)
    if (tagsParam) {
      const tagNames = tagsParam.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (tagNames.length > 0) {
        const allTags = await deps.db.select().from(tags).where(eq(tags.tenantId, tenant.id)).all();
        const matchingTagIds = allTags.filter((t) => tagNames.includes(t.name.toLowerCase())).map((t) => t.id);
        if (matchingTagIds.length > 0) {
          const associations = await deps.db.select().from(savedQueryTags).all();
          const matchingQueryIds = new Set(
            associations.filter((a) => matchingTagIds.includes(a.tagId)).map((a) => a.savedQueryId),
          );
          rows = rows.filter((r) => matchingQueryIds.has(r.id));
        } else {
          rows = [];
        }
      }
    }

    // Sort
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'createdAt') cmp = a.createdAt.localeCompare(b.createdAt);
      else cmp = a.updatedAt.localeCompare(b.updatedAt);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    // Attach tags to each query
    const allTags = await deps.db.select().from(tags).where(eq(tags.tenantId, tenant.id)).all();
    const allAssociations = await deps.db.select().from(savedQueryTags).all();
    const tagMap = new Map<number, string[]>();
    for (const assoc of allAssociations) {
      if (!tagMap.has(assoc.savedQueryId)) tagMap.set(assoc.savedQueryId, []);
      const tag = allTags.find((t) => t.id === assoc.tagId);
      if (tag) tagMap.get(assoc.savedQueryId)!.push(tag.name);
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      connectionId: row.connectionId,
      sql: row.sql,
      tags: tagMap.get(row.id) || [],
      latestVersion: row.latestVersion ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  });

  app.get('/api/saved-queries/:id', async (request) => {
    const { id } = request.params as { id: string };
    const rows = await deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (rows.length === 0) throw notFound(`Saved query ${id} not found`);
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      connectionId: row.connectionId,
      sql: row.sql,
      latestVersion: row.latestVersion ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  app.post('/api/saved-queries', async (request, reply) => {
    const parsed = z
      .object({ name: z.string().min(1), connectionId: z.number().int(), sql: z.string().min(1), tags: z.array(z.string()).max(10).optional() })
      .safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid saved query', parsed.error.flatten());

    const now = new Date().toISOString();
    const { currentTenant } = await import('../core/tenancy.js');
    const tenant = currentTenant();
    const inserted = await deps.db
      .insert(savedQueries)
      .values({
        name: parsed.data.name,
        connectionId: parsed.data.connectionId,
        sql: parsed.data.sql,
        latestVersion: 1,
        tenantId: tenant.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    await deps.db
      .insert(savedQueryVersions)
      .values({
        savedQueryId: inserted.id,
        version: 1,
        parentVersion: null,
        message: 'Create saved query',
        authorId: null,
        kind: 'manual',
        sql: parsed.data.sql,
        createdAt: now,
      })
      .run();
    // Sync tags if provided
    if (parsed.data.tags && parsed.data.tags.length > 0) {
      await syncTags(deps.db, 'saved_query', inserted.id, parsed.data.tags, tenant.id);
    }
    reply.code(201);
    return {
      id: inserted.id,
      name: inserted.name,
      connectionId: inserted.connectionId,
      sql: inserted.sql,
      latestVersion: inserted.latestVersion ?? 1,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    };
  });

  app.patch('/api/saved-queries/:id', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        name: z.string().min(1).optional(),
        connectionId: z.number().int().optional(),
        sql: z.string().min(1).optional(),
        message: z.string().optional(),
        tags: z.array(z.string()).max(10).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid saved query', parsed.error.flatten());

    const rows = await deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (rows.length === 0) throw notFound(`Saved query ${id} not found`);
    const current = rows[0];

    const nextSql = parsed.data.sql ?? current.sql;
    const nextName = parsed.data.name ?? current.name;
    const nextConnection = parsed.data.connectionId ?? current.connectionId;
    const changed = nextSql !== current.sql || nextName !== current.name || nextConnection !== current.connectionId;

    const now = new Date().toISOString();
    await deps.db
      .update(savedQueries)
      .set({
        name: nextName,
        connectionId: nextConnection,
        sql: nextSql,
        updatedAt: now,
        latestVersion: changed ? (current.latestVersion ?? 0) + 1 : (current.latestVersion ?? 0),
      })
      .where(eq(savedQueries.id, Number(id)))
      .run();

    // Update tags if provided
    if (parsed.data.tags !== undefined) {
      await syncTags(deps.db, 'saved_query', Number(id), parsed.data.tags, current.tenantId);
    }

    if (changed) {
      const newVersion = (current.latestVersion ?? 0) + 1;
      await deps.db
        .insert(savedQueryVersions)
        .values({
          savedQueryId: Number(id),
          version: newVersion,
          parentVersion: current.latestVersion ?? null,
          message: parsed.data.message ?? `Update ${nextName}`,
          authorId: null,
          kind: 'manual',
          sql: nextSql,
          createdAt: now,
        })
        .run();
    }

    const updated = await deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .get();
    if (!updated) throw notFound(`Not found`);
    return {
      id: updated.id,
      name: updated.name,
      connectionId: updated.connectionId,
      sql: updated.sql,
      latestVersion: updated.latestVersion ?? 0,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.get('/api/saved-queries/:id/versions', async (request) => {
    const { id } = request.params as { id: string };
    const rows = await deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (rows.length === 0) throw notFound(`Saved query ${id} not found`);
    const versions = (await deps.db
      .select()
      .from(savedQueryVersions)
      .where(eq(savedQueryVersions.savedQueryId, Number(id)))
      .all())
      .sort((a, b) => a.version - b.version);
    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      parentVersion: v.parentVersion,
      message: v.message,
      kind: v.kind,
      sql: v.sql,
      createdAt: v.createdAt,
    }));
  });

  app.post('/api/saved-queries/:id/restore/:version', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const queryRows = await deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (queryRows.length === 0) throw notFound(`Saved query ${id} not found`);
    const versionRows = (await deps.db
      .select()
      .from(savedQueryVersions)
      .where(eq(savedQueryVersions.savedQueryId, Number(id)))
      .all())
      .filter((v) => v.version === Number(version));
    if (versionRows.length === 0) throw notFound(`Version ${version} not found`);
    const target = versionRows[0];
    const current = queryRows[0];
    const now = new Date().toISOString();
    const newVersion = (current.latestVersion ?? 0) + 1;
    await deps.db
      .update(savedQueries)
      .set({ sql: target.sql, updatedAt: now, latestVersion: newVersion })
      .where(eq(savedQueries.id, Number(id)))
      .run();
    await deps.db
      .insert(savedQueryVersions)
      .values({
        savedQueryId: Number(id),
        version: newVersion,
        parentVersion: current.latestVersion ?? null,
        message: `Restore v${version}`,
        authorId: null,
        kind: 'restore',
        sql: target.sql,
        createdAt: now,
      })
      .run();
    const updated = await deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .get();
    if (!updated) throw notFound(`Not found`);
    return {
      id: updated.id,
      name: updated.name,
      connectionId: updated.connectionId,
      sql: updated.sql,
      latestVersion: updated.latestVersion ?? 0,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.delete('/api/saved-queries/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (rows.length === 0) throw notFound(`Saved query ${id} not found`);
    await deps.db.delete(savedQueryVersions).where(eq(savedQueryVersions.savedQueryId, Number(id))).run();
    await deps.db.delete(savedQueries).where(eq(savedQueries.id, Number(id))).run();
    reply.code(204);
  });
}

type DashboardSnapshot = ManifestDashboard;

/**
 * sqlboard extends sqlFlint with a custom palette annotation:
 *
 *   -- @colors: #1d5c4a, #c8412f
 *
 * sqlFlint only knows named theme presets, so the palette is applied here, on the
 * server, so the rendered UI and `POST /api/compile` return the same colors.
 */
export function colorsFromAnnotations(sql: string): string[] {
  const match = sql.match(/^\s*--\s*@colors\s*:\s*(.+)$/im);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value));
}

interface DashboardVersionKind {
  kind: 'manual' | 'apply' | 'restore';
}

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function readDashboard(deps: RouteDeps, id: number): Promise<{
  row: typeof dashboards.$inferSelect;
  snapshot: DashboardSnapshot;
}> {
  const row = await deps.db.select().from(dashboards).where(eq(dashboards.id, id)).get();
  if (!row) throw notFound(`Dashboard ${id} not found`);
  const items = await deps.db
    .select()
    .from(dashboardItems)
    .where(eq(dashboardItems.dashboardId, id))
    .all();

  return {
    row,
    snapshot: {
      name: row.name,
      description: row.description,
      filters: row.filtersJson ? JSON.parse(row.filtersJson) : [],
      theme: row.theme ?? undefined,
      colors: row.colorsJson ? JSON.parse(row.colorsJson) : undefined,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        sql: item.sql,
        connectionId: item.connectionId,
        savedQueryId: item.savedQueryId ?? null,
        blockType: item.blockType as DashboardSnapshot['items'][number]['blockType'],
        config: parseConfig(item.configJson),
        layout: JSON.parse(item.layoutJson),
      })),
    },
  };
}

async function dashboardResponse(deps: RouteDeps, id: number) {
  const { row, snapshot } = await readDashboard(deps, id);
  const latestVersion = (
    await deps.db
      .select({ version: dashboardVersions.version })
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, id))
      .all()
  ).reduce((max, entry) => Math.max(max, entry.version), 0);

  // Attach tags
  const dashTags = await deps.db.select().from(dashboardTags).where(eq(dashboardTags.dashboardId, id)).all();
  const allTags = await deps.db.select().from(tags).where(eq(tags.tenantId, row.tenantId)).all();
  const tagNames = dashTags.map((a) => allTags.find((t) => t.id === a.tagId)?.name).filter(Boolean) as string[];

  return {
    id: row.id,
    name: snapshot.name,
    description: snapshot.description,
    tags: tagNames,
    filters: snapshot.filters ?? [],
    theme: snapshot.theme,
    colors: snapshot.colors,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    latestVersion,
    items: snapshot.items.map((item) => ({
      id: item.id,
      dashboardId: row.id,
      title: item.title,
      sql: item.sql,
      connectionId: item.connectionId,
      savedQueryId: item.savedQueryId ?? null,
      blockType: item.blockType,
      config: item.config,
      layout: item.layout,
      createdAt: row.createdAt,
    })),
  };
}

async function serializeSnapshot(deps: RouteDeps, snapshot: DashboardSnapshot): Promise<string> {
  const connectionList = await deps.db
    .select({ id: connections.id, name: connections.name })
    .from(connections)
    .all();
  return serializeDashboardManifest(snapshot, connectionList);
}

function authorIdFrom(request: { user?: { id: number } }): number | null {
  return request.user?.id ?? null;
}

async function latestDashboardVersion(deps: RouteDeps, dashboardId: number): Promise<number> {
  return (
    await deps.db
      .select({ version: dashboardVersions.version })
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, dashboardId))
      .all()
  ).reduce((max, row) => Math.max(max, row.version), 0);
}

async function assertBaseVersion(deps: RouteDeps, dashboardId: number, baseVersion?: number): Promise<void> {
  if (baseVersion === undefined) return;
  const latest = await latestDashboardVersion(deps, dashboardId);
  if (baseVersion !== latest) {
    throw new ApiError(
      409,
      'VERSION_CONFLICT',
      `Dashboard is at v${latest}, but the request expected v${baseVersion}. Reload and retry.`,
    );
  }
}

async function insertVersion(
  deps: RouteDeps,
  dashboardId: number,
  snapshot: DashboardSnapshot,
  message: string | null,
  kind: DashboardVersionKind['kind'],
  authorId: number | null,
) {
  const latest = await latestDashboardVersion(deps, dashboardId);
  const version = latest + 1;
  const now = new Date().toISOString();

  const inserted = await deps.db
    .insert(dashboardVersions)
    .values({
      dashboardId,
      version,
      parentVersion: latest > 0 ? latest : null,
      message,
      authorId,
      kind,
      snapshotJson: JSON.stringify(snapshot),
      codeText: await serializeSnapshot(deps, snapshot),
      createdAt: now,
    })
    .returning()
    .get();

  return {
    id: inserted.id,
    dashboardId: inserted.dashboardId,
    version: inserted.version,
    parentVersion: inserted.parentVersion,
    message: inserted.message,
    authorId: inserted.authorId,
    kind: inserted.kind as DashboardVersionKind['kind'],
    createdAt: inserted.createdAt,
  };
}

async function touchDashboard(deps: RouteDeps, id: number): Promise<void> {
  await deps.db
    .update(dashboards)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(dashboards.id, id));
}

async function applySnapshot(deps: RouteDeps, id: number, snapshot: DashboardSnapshot): Promise<void> {
  const now = new Date().toISOString();
  await deps.db
    .update(dashboards)
    .set({
      name: snapshot.name,
      description: snapshot.description,
      filtersJson: JSON.stringify(snapshot.filters ?? []),
      theme: snapshot.theme ?? null,
      colorsJson: snapshot.colors ? JSON.stringify(snapshot.colors) : null,
      updatedAt: now,
    })
    .where(eq(dashboards.id, id))
    .run();

  await deps.db.delete(dashboardItems).where(eq(dashboardItems.dashboardId, id)).run();

  for (const item of snapshot.items) {
    await deps.db
      .insert(dashboardItems)
      .values({
        dashboardId: id,
        title: item.title,
        sql: item.sql,
        connectionId: item.connectionId,
        savedQueryId: item.savedQueryId ?? null,
        blockType: item.blockType,
        configJson: item.config ? JSON.stringify(item.config) : null,
        layoutJson: JSON.stringify(item.layout),
        createdAt: now,
      })
      .run();
  }
}

export function registerDashboardRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/dashboards', async (request) => {
    const { currentTenant } = await import('../core/tenancy.js');
    const tenant = currentTenant();
    const url = new URL(request.url, 'http://localhost');
    const tagsParam = url.searchParams.get('tags');
    const sortBy = url.searchParams.get('sortBy') || 'updatedAt';
    const sortDir = url.searchParams.get('sortDir') || 'desc';

    let rows = await deps.db.select().from(dashboards).where(eq(dashboards.tenantId, tenant.id)).all();

    // Filter by tags (OR logic)
    if (tagsParam) {
      const tagNames = tagsParam.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (tagNames.length > 0) {
        const allTags = await deps.db.select().from(tags).where(eq(tags.tenantId, tenant.id)).all();
        const matchingTagIds = allTags.filter((t) => tagNames.includes(t.name.toLowerCase())).map((t) => t.id);
        if (matchingTagIds.length > 0) {
          const associations = await deps.db.select().from(dashboardTags).all();
          const matchingDashIds = new Set(
            associations.filter((a) => matchingTagIds.includes(a.tagId)).map((a) => a.dashboardId),
          );
          rows = rows.filter((r) => matchingDashIds.has(r.id));
        } else {
          rows = [];
        }
      }
    }

    // Sort
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'createdAt') cmp = a.createdAt.localeCompare(b.createdAt);
      else cmp = a.updatedAt.localeCompare(b.updatedAt);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    // Attach tags
    const allTags = await deps.db.select().from(tags).where(eq(tags.tenantId, tenant.id)).all();
    const allAssociations = await deps.db.select().from(dashboardTags).all();
    const tagMap = new Map<number, string[]>();
    for (const assoc of allAssociations) {
      if (!tagMap.has(assoc.dashboardId)) tagMap.set(assoc.dashboardId, []);
      const tag = allTags.find((t) => t.id === assoc.tagId);
      if (tag) tagMap.get(assoc.dashboardId)!.push(tag.name);
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      tags: tagMap.get(row.id) || [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  });

  app.post('/api/dashboards', async (request, reply) => {
    const parsed = z
      .object({ name: z.string().min(1), description: z.string().optional(), tags: z.array(z.string()).max(10).optional() })
      .safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard', parsed.error.flatten());

    const now = new Date().toISOString();
    const { currentTenant } = await import('../core/tenancy.js');
    const tenant = currentTenant();
    const inserted = await deps.db
      .insert(dashboards)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        tenantId: tenant.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    // Sync tags if provided
    if (parsed.data.tags && parsed.data.tags.length > 0) {
      await syncTags(deps.db, 'dashboard', inserted.id, parsed.data.tags, tenant.id);
    }

    const version = await insertVersion(
      deps,
      inserted.id,
      { name: inserted.name, description: inserted.description, filters: [], items: [] },
      'Dashboard created',
      'manual',
      authorIdFrom(request),
    );

    reply.code(201);
    return {
      id: inserted.id,
      name: inserted.name,
      description: inserted.description,
      tags: parsed.data.tags || [],
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    };
  });

  app.patch('/api/dashboards/:id', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const parsed = UpdateDashboardSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard update', parsed.error.flatten());
    await readDashboard(deps, numericId);

    const patch: Partial<typeof dashboards.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;

    await deps.db.update(dashboards).set(patch).where(eq(dashboards.id, numericId)).run();

    // Sync tags if provided
    if (parsed.data.tags !== undefined) {
      const { currentTenant } = await import('../core/tenancy.js');
      const tenant = currentTenant();
      await syncTags(deps.db, 'dashboard', numericId, parsed.data.tags, tenant.id);
    }

    return await dashboardResponse(deps, numericId);
  });

  app.get('/api/dashboards/:id', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const { currentTenant } = await import('../core/tenancy.js');
    const tenant = currentTenant();
    const rows = await deps.db.select().from(dashboards).where(eq(dashboards.id, numericId)).all();
    if (rows.length === 0 || rows[0].tenantId !== tenant.id) throw notFound(`Dashboard ${id} not found`);
    return await dashboardResponse(deps, numericId);
  });

  app.post('/api/dashboards/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);

    const parsed = CreateDashboardItemSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard item', parsed.error.flatten());

    const now = new Date().toISOString();
    const inserted = await deps.db
      .insert(dashboardItems)
      .values({
        dashboardId: numericId,
        title: parsed.data.title,
        sql: parsed.data.sql,
        connectionId: parsed.data.connectionId,
        blockType: parsed.data.blockType,
        configJson: parsed.data.config ? JSON.stringify(parsed.data.config) : null,
        layoutJson: JSON.stringify(parsed.data.layout),
        createdAt: now,
      })
      .returning()
      .get();
    await touchDashboard(deps, numericId);

    reply.code(201);
    return {
      id: inserted.id,
      dashboardId: inserted.dashboardId,
      title: inserted.title,
      sql: inserted.sql,
      connectionId: inserted.connectionId,
      blockType: inserted.blockType,
      config: parseConfig(inserted.configJson),
      layout: JSON.parse(inserted.layoutJson),
      createdAt: inserted.createdAt,
    };
  });

  app.patch('/api/dashboards/:id/items/:itemId', async (request) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const numericId = Number(id);
    const numericItemId = Number(itemId);
    const existing = await deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.id, numericItemId))
      .get();
    if (!existing || existing.dashboardId !== numericId) {
      throw notFound(`Dashboard item ${itemId} not found`);
    }

    const parsed = UpdateDashboardItemSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard item update', parsed.error.flatten());

    const patch: Partial<typeof dashboardItems.$inferInsert> = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.sql !== undefined) patch.sql = parsed.data.sql;
    if (parsed.data.connectionId !== undefined) patch.connectionId = parsed.data.connectionId;
    if (parsed.data.blockType !== undefined) patch.blockType = parsed.data.blockType;
    if (parsed.data.config !== undefined) {
      patch.configJson = parsed.data.config ? JSON.stringify(parsed.data.config) : null;
    }
    if (parsed.data.layout !== undefined) patch.layoutJson = JSON.stringify(parsed.data.layout);

    if (Object.keys(patch).length > 0) {
      await deps.db
        .update(dashboardItems)
        .set(patch)
        .where(eq(dashboardItems.id, numericItemId))
        .run();
      await touchDashboard(deps, numericId);
    }

    const updated = await deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.id, numericItemId))
      .get();
    if (!updated) throw notFound(`Not found`);
    return {
      id: updated.id,
      dashboardId: updated.dashboardId,
      title: updated.title,
      sql: updated.sql,
      connectionId: updated.connectionId,
      blockType: updated.blockType,
      config: parseConfig(updated.configJson),
      layout: JSON.parse(updated.layoutJson),
      createdAt: updated.createdAt,
    };
  });

  app.put('/api/dashboards/:id/layout', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);
    const parsed = DashboardLayoutUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid layout update', parsed.error.flatten());

    for (const entry of parsed.data.items) {
      const existing = await deps.db
        .select({ id: dashboardItems.id, dashboardId: dashboardItems.dashboardId })
        .from(dashboardItems)
        .where(eq(dashboardItems.id, entry.id))
        .get();
      if (!existing || existing.dashboardId !== numericId) continue;
      await deps.db
        .update(dashboardItems)
        .set({ layoutJson: JSON.stringify(entry.layout) })
        .where(eq(dashboardItems.id, entry.id))
        .run();
    }
    await touchDashboard(deps, numericId);
    return await dashboardResponse(deps, numericId);
  });

  app.put('/api/dashboards/:id/state', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);
    const parsed = ApplyDashboardStateSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard state', parsed.error.flatten());

    await assertBaseVersion(deps, numericId, parsed.data.baseVersion);

    const current = (await readDashboard(deps, numericId)).snapshot;
    const snapshot: DashboardSnapshot = {
      name: parsed.data.name ?? current.name,
      description:
        parsed.data.description === undefined ? current.description : parsed.data.description,
      filters: current.filters ?? [],
      theme: parsed.data.theme === undefined ? current.theme : parsed.data.theme,
      colors: parsed.data.colors === undefined ? current.colors : parsed.data.colors,
      items: parsed.data.items.map((item) => ({
        title: item.title,
        sql: item.sql,
        connectionId: item.connectionId,
        savedQueryId: item.savedQueryId ?? null,
        blockType: item.blockType,
        config: item.config ?? null,
        layout: item.layout,
      })),
    };

    await applySnapshot(deps, numericId, snapshot);
    const version = await insertVersion(
      deps,
      numericId,
      snapshot,
      parsed.data.message ?? 'Apply dashboard code',
      parsed.data.kind,
      authorIdFrom(request),
    );

    const response = await dashboardResponse(deps, numericId);
    return { ...response, version };
  });

  app.delete('/api/dashboards/:id/items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const numericId = Number(id);
    const rows = await deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.id, Number(itemId)))
      .all();
    if (rows.length === 0 || rows[0].dashboardId !== numericId) {
      throw notFound(`Dashboard item ${itemId} not found`);
    }
    await deps.db.delete(dashboardItems).where(eq(dashboardItems.id, Number(itemId))).run();
    await touchDashboard(deps, numericId);
    reply.code(204);
  });

  app.delete('/api/dashboards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);
    await deps.db.delete(dashboardItems).where(eq(dashboardItems.dashboardId, numericId)).run();
    await deps.db.delete(dashboardVersions).where(eq(dashboardVersions.dashboardId, numericId)).run();
    await deps.db.delete(dashboards).where(eq(dashboards.id, numericId)).run();
    reply.code(204);
  });

  app.get('/api/dashboards/:id/versions', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);
    const rows = await deps.db
      .select()
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, numericId))
      .all();
    return rows
      .sort((left, right) => right.version - left.version)
      .map((row) => ({
        id: row.id,
        dashboardId: row.dashboardId,
        version: row.version,
        parentVersion: row.parentVersion,
        message: row.message,
        authorId: row.authorId,
        kind: row.kind as DashboardVersionKind['kind'],
        createdAt: row.createdAt,
        codeText: row.codeText,
      }));
  });

  app.get('/api/dashboards/:id/versions/:version', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);
    const row = (await deps.db
      .select()
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, numericId))
      .all()).find((entry) => entry.version === Number(version));
    if (!row) throw notFound(`Dashboard version ${version} not found`);
    return {
      id: row.id,
      dashboardId: row.dashboardId,
      version: row.version,
      parentVersion: row.parentVersion,
      message: row.message,
      authorId: row.authorId,
      kind: row.kind as DashboardVersionKind['kind'],
      createdAt: row.createdAt,
      codeText: row.codeText,
      snapshot: JSON.parse(row.snapshotJson),
    };
  });

  app.post('/api/dashboards/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);
    const parsed = CommitDashboardSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid commit', parsed.error.flatten());

    await assertBaseVersion(deps, numericId, parsed.data.baseVersion);

    const snapshot = (await readDashboard(deps, numericId)).snapshot;
    const version = await insertVersion(
      deps,
      numericId,
      snapshot,
      parsed.data.message,
      'manual',
      authorIdFrom(request),
    );
    reply.code(201);
    return version;
  });

  app.post('/api/dashboards/:id/versions/:version/restore', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const numericId = Number(id);
    await readDashboard(deps, numericId);
    const row = (await deps.db
      .select()
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, numericId))
      .all()).find((entry) => entry.version === Number(version));
    if (!row) throw notFound(`Dashboard version ${version} not found`);

    const snapshot = JSON.parse(row.snapshotJson) as DashboardSnapshot;
    await applySnapshot(deps, numericId, snapshot);
    const restored = await insertVersion(
      deps,
      numericId,
      snapshot,
      `Restored v${row.version}`,
      'restore',
      authorIdFrom(request),
    );
    return { ...await dashboardResponse(deps, numericId), version: restored };
  });
}

export function registerUploadRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/uploads', async (request, reply) => {
    const data = await request.file();
    if (!data) throw badRequest('No file uploaded');

    const filename = data.filename;
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    const allowed = ['csv', 'parquet', 'json'];
    if (!allowed.includes(ext)) {
      throw badRequest(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`);
    }

    const buffer = await data.toBuffer();

    // Store file in storage backend (S3 or local)
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storageKey = `uploads/${safeName}`;
    await deps.storage.upload(storageKey, buffer, data.mimetype);

    // DuckDB needs a local file path for ingestion
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    let filePath: string;
    if (deps.storage.constructor.name === 'LocalStorage') {
      filePath = deps.uploadsDir + '/' + safeName; // local path
    } else {
      // Download from S3 to temp file for DuckDB ingestion
      const tmpDir = path.join(os.tmpdir(), 'sqlboard-uploads');
      fs.mkdirSync(tmpDir, { recursive: true });
      filePath = path.join(tmpDir, safeName);
      const downloaded = await deps.storage.download(storageKey);
      fs.writeFileSync(filePath, downloaded);
    }

    const tableName = `upload_${Date.now()}`;
    const engine = deps.duckDb;
    await engine.ingestFile(filePath, tableName);

    const rowCount = await engine.countRows(tableName);
    const now = new Date().toISOString();
    const inserted = await deps.db
      .insert(uploads)
      .values({
        tableName,
        filename,
        rowCount,
        sizeBytes: buffer.length,
        createdAt: now,
      })
      .returning()
      .get();

    reply.code(201);
    return {
      id: inserted.id,
      tableName: inserted.tableName,
      filename: inserted.filename,
      rowCount: inserted.rowCount,
      sizeBytes: inserted.sizeBytes,
      createdAt: inserted.createdAt,
    };
  });

  app.get('/api/uploads', async () => {
    const rows = await deps.db.select().from(uploads).all();
    return rows.map((row) => ({
      id: row.id,
      tableName: row.tableName,
      filename: row.filename,
      rowCount: row.rowCount,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
    }));
  });

  app.delete('/api/uploads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const rows = await deps.db.select().from(uploads).where(eq(uploads.id, numericId)).all();
    if (rows.length === 0) throw notFound(`Upload ${id} not found`);
    const upload = rows[0];
    await deps.duckDb.dropTable(upload.tableName);
    await deps.db.delete(uploads).where(eq(uploads.id, numericId)).run();
    reply.code(204);
  });
}

export function registerCompileRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/compile', async (request) => {
    const { z } = await import('zod');
    const body = z
      .object({
        sql: z.string().min(1),
        connectionId: z.number().int().optional(),
        data: z.array(z.record(z.unknown())).optional(),
        theme: z.string().optional(),
        backend: z.enum(['echarts', 'vegalite', 'chartjs', 'plotly']).optional(),
        backends: z.array(z.enum(['echarts', 'vegalite', 'chartjs', 'plotly'])).optional(),
      })
      .safeParse(request.body);
    if (!body.success) throw badRequest('Invalid compile payload', body.error.flatten());

    let data = body.data.data ?? [];
    if (body.data.connectionId && data.length === 0) {
      const engine = await deps.engineFactory.forConnectionId(body.data.connectionId);
      const result = await engine.run(body.data.sql);
      data = result.rows;
    }

    const { compileSqlToFlint } = await import('sql-to-flint');
    const result = compileSqlToFlint({
      sql: body.data.sql,
      data,
      theme: body.data.theme,
      backend: body.data.backend,
      backends: body.data.backends,
    });

    const palette = colorsFromAnnotations(body.data.sql);
    let compiled = result.compiled;
    let echarts = result.echarts ?? null;
    if (palette.length > 0) {
      if (compiled?.echarts) {
        compiled = { ...compiled, echarts: { ...compiled.echarts, color: palette } };
      }
      if (echarts) {
        echarts = { ...echarts, color: palette };
      }
    }

    return {
      flint: result.flint,
      echarts,
      compiled,
      diagnostics: result.diagnostics,
      query: data.length > 0 ? { columns: Object.keys(data[0] ?? {}), rowCount: data.length } : null,
    };
  });
}
