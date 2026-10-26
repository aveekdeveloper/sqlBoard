import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../errors.js';
import {
  connections,
  savedQueries,
  savedQueryVersions,
  dashboards,
  dashboardItems,
  dashboardVersions,
  sessions,
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
  UpdateDashboardItemSchema,
  UpdateDashboardSchema,
  type ManifestDashboard,
} from '@sqlboard/shared';
import { QueryCache } from '../cache/query-cache.js';

interface RouteDeps {
  db: DrizzleDb;
  engineFactory: EngineFactory;
  secretKey: string;
  uploadsDir: string;
  duckDb: import('../engines/duckdb.js').DuckDbEngine;
  cache: import('../cache/query-cache.js').QueryCache;
}

export function registerConnectionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/connections', async () => {
    const rows = deps.db.select().from(connections).all();
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

    const { encryptJson } = await import('../crypto.js');
    const configEnc = encryptJson(parsed.data, deps.secretKey);
    const now = new Date().toISOString();
    const inserted = deps.db
      .insert(connections)
      .values({ name: parsed.data.name, type: parsed.data.type, configEnc, createdAt: now })
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

  app.get('/api/connections/:id', async (request) => {
    const { id } = request.params as { id: string };
    const rows = deps.db
      .select()
      .from(connections)
      .where(eq(connections.id, Number(id)))
      .all();
    const row = rows[0];
    if (!row) throw notFound(`Connection ${id} not found`);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      configSummary: row.type,
      createdAt: row.createdAt,
    };
  });

  app.delete('/api/connections/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const rows = deps.db
      .select()
      .from(connections)
      .where(eq(connections.id, numericId))
      .all();
    if (rows.length === 0) throw notFound(`Connection ${id} not found`);
    await deps.engineFactory.closeConnection(numericId);
    deps.cache.clear();
    deps.db.delete(connections).where(eq(connections.id, numericId)).run();
    reply.code(204);
  });

  app.post('/api/connections/:id/test', async (request) => {
    const { id } = request.params as { id: string };
    const engine = await deps.engineFactory.forConnectionId(Number(id));
    const tables = await engine.listTables();
    return { ok: true, tableCount: tables.length, tables };
  });

  app.get('/api/connections/:id/tables', async (request) => {
    const { id } = request.params as { id: string };
    const engine = await deps.engineFactory.forConnectionId(Number(id));
    return engine.listTables();
  });

  app.get('/api/connections/:id/tables/:name/preview', async (request) => {
    const { id, name } = request.params as { id: string; name: string };
    const engine = await deps.engineFactory.forConnectionId(Number(id));
    return engine.preview(name);
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
  const listVersions = (savedQueryId: number) =>
    deps.db
      .select()
      .from(savedQueryVersions)
      .where(eq(savedQueryVersions.savedQueryId, savedQueryId))
      .all()
      .sort((a, b) => a.version - b.version);

  app.get('/api/saved-queries', async () => {
    const rows = deps.db.select().from(savedQueries).all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      connectionId: row.connectionId,
      sql: row.sql,
      latestVersion: row.latestVersion ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  });

  app.get('/api/saved-queries/:id', async (request) => {
    const { id } = request.params as { id: string };
    const rows = deps.db
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
      .object({ name: z.string().min(1), connectionId: z.number().int(), sql: z.string().min(1) })
      .safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid saved query', parsed.error.flatten());

    const now = new Date().toISOString();
    const inserted = deps.db
      .insert(savedQueries)
      .values({
        name: parsed.data.name,
        connectionId: parsed.data.connectionId,
        sql: parsed.data.sql,
        latestVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    deps.db
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
      })
      .safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid saved query', parsed.error.flatten());

    const rows = deps.db
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
    deps.db
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

    if (changed) {
      const newVersion = (current.latestVersion ?? 0) + 1;
      deps.db
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

    const updated = deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all()[0];
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
    const rows = deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (rows.length === 0) throw notFound(`Saved query ${id} not found`);
    const versions = deps.db
      .select()
      .from(savedQueryVersions)
      .where(eq(savedQueryVersions.savedQueryId, Number(id)))
      .all()
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
    const queryRows = deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (queryRows.length === 0) throw notFound(`Saved query ${id} not found`);
    const versionRows = deps.db
      .select()
      .from(savedQueryVersions)
      .where(eq(savedQueryVersions.savedQueryId, Number(id)))
      .all()
      .filter((v) => v.version === Number(version));
    if (versionRows.length === 0) throw notFound(`Version ${version} not found`);
    const target = versionRows[0];
    const current = queryRows[0];
    const now = new Date().toISOString();
    const newVersion = (current.latestVersion ?? 0) + 1;
    deps.db
      .update(savedQueries)
      .set({ sql: target.sql, updatedAt: now, latestVersion: newVersion })
      .where(eq(savedQueries.id, Number(id)))
      .run();
    deps.db
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
    const updated = deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all()[0];
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
    const rows = deps.db
      .select()
      .from(savedQueries)
      .where(eq(savedQueries.id, Number(id)))
      .all();
    if (rows.length === 0) throw notFound(`Saved query ${id} not found`);
    deps.db.delete(savedQueryVersions).where(eq(savedQueryVersions.savedQueryId, Number(id))).run();
    deps.db.delete(savedQueries).where(eq(savedQueries.id, Number(id))).run();
    reply.code(204);
  });
}

type DashboardSnapshot = ManifestDashboard;

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

function readDashboard(deps: RouteDeps, id: number): {
  row: typeof dashboards.$inferSelect;
  snapshot: DashboardSnapshot;
} {
  const row = deps.db.select().from(dashboards).where(eq(dashboards.id, id)).all()[0];
  if (!row) throw notFound(`Dashboard ${id} not found`);
  const items = deps.db
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

function dashboardResponse(deps: RouteDeps, id: number) {
  const { row, snapshot } = readDashboard(deps, id);
  const latestVersion =
    deps.db
      .select({ version: dashboardVersions.version })
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, id))
      .all()
      .reduce((max, entry) => Math.max(max, entry.version), 0);

  return {
    id: row.id,
    name: snapshot.name,
    description: snapshot.description,
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

function serializeSnapshot(deps: RouteDeps, snapshot: DashboardSnapshot): string {
  const connectionList = deps.db
    .select({ id: connections.id, name: connections.name })
    .from(connections)
    .all();
  return serializeDashboardManifest(snapshot, connectionList);
}

function authorIdFrom(request: { headers: Record<string, unknown> }, deps: RouteDeps): number | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const session = deps.db.select().from(sessions).where(eq(sessions.token, match[1])).all()[0];
  if (!session) return null;
  if (Date.parse(session.expiresAt) < Date.now()) return null;
  return session.userId;
}

function insertVersion(
  deps: RouteDeps,
  dashboardId: number,
  snapshot: DashboardSnapshot,
  message: string | null,
  kind: DashboardVersionKind['kind'],
  authorId: number | null,
) {
  const versions = deps.db
    .select({ version: dashboardVersions.version })
    .from(dashboardVersions)
    .where(eq(dashboardVersions.dashboardId, dashboardId))
    .all();
  const latest = versions.reduce((max, row) => Math.max(max, row.version), 0);
  const version = latest + 1;
  const now = new Date().toISOString();

  const inserted = deps.db
    .insert(dashboardVersions)
    .values({
      dashboardId,
      version,
      parentVersion: latest > 0 ? latest : null,
      message,
      authorId,
      kind,
      snapshotJson: JSON.stringify(snapshot),
      codeText: serializeSnapshot(deps, snapshot),
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

function touchDashboard(deps: RouteDeps, id: number): void {
  deps.db
    .update(dashboards)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(dashboards.id, id))
    .run();
}

function applySnapshot(deps: RouteDeps, id: number, snapshot: DashboardSnapshot): void {
  const now = new Date().toISOString();
  deps.db
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

  deps.db.delete(dashboardItems).where(eq(dashboardItems.dashboardId, id)).run();

  for (const item of snapshot.items) {
    deps.db
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
  app.get('/api/dashboards', async () => {
    const rows = deps.db.select().from(dashboards).all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  });

  app.post('/api/dashboards', async (request, reply) => {
    const parsed = z
      .object({ name: z.string().min(1), description: z.string().optional() })
      .safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard', parsed.error.flatten());

    const now = new Date().toISOString();
    const inserted = deps.db
      .insert(dashboards)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    insertVersion(
      deps,
      inserted.id,
      { name: inserted.name, description: inserted.description, filters: [], items: [] },
      'Dashboard created',
      'manual',
      authorIdFrom(request, deps),
    );

    reply.code(201);
    return {
      id: inserted.id,
      name: inserted.name,
      description: inserted.description,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    };
  });

  app.patch('/api/dashboards/:id', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const parsed = UpdateDashboardSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard update', parsed.error.flatten());
    readDashboard(deps, numericId);

    const patch: Partial<typeof dashboards.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;

    deps.db.update(dashboards).set(patch).where(eq(dashboards.id, numericId)).run();
    return dashboardResponse(deps, numericId);
  });

  app.get('/api/dashboards/:id', async (request) => {
    const { id } = request.params as { id: string };
    return dashboardResponse(deps, Number(id));
  });

  app.post('/api/dashboards/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    readDashboard(deps, numericId);

    const parsed = CreateDashboardItemSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard item', parsed.error.flatten());

    const now = new Date().toISOString();
    const inserted = deps.db
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
    touchDashboard(deps, numericId);

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
    const existing = deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.id, numericItemId))
      .all()[0];
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
      deps.db
        .update(dashboardItems)
        .set(patch)
        .where(eq(dashboardItems.id, numericItemId))
        .run();
      touchDashboard(deps, numericId);
    }

    const updated = deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.id, numericItemId))
      .all()[0];
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
    readDashboard(deps, numericId);
    const parsed = DashboardLayoutUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid layout update', parsed.error.flatten());

    for (const entry of parsed.data.items) {
      const existing = deps.db
        .select({ id: dashboardItems.id, dashboardId: dashboardItems.dashboardId })
        .from(dashboardItems)
        .where(eq(dashboardItems.id, entry.id))
        .all()[0];
      if (!existing || existing.dashboardId !== numericId) continue;
      deps.db
        .update(dashboardItems)
        .set({ layoutJson: JSON.stringify(entry.layout) })
        .where(eq(dashboardItems.id, entry.id))
        .run();
    }
    touchDashboard(deps, numericId);
    return dashboardResponse(deps, numericId);
  });

  app.put('/api/dashboards/:id/state', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    readDashboard(deps, numericId);
    const parsed = ApplyDashboardStateSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard state', parsed.error.flatten());

    const current = readDashboard(deps, numericId).snapshot;
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

    applySnapshot(deps, numericId, snapshot);
    const version = insertVersion(
      deps,
      numericId,
      snapshot,
      parsed.data.message ?? 'Apply dashboard code',
      parsed.data.kind,
      authorIdFrom(request, deps),
    );

    return { ...dashboardResponse(deps, numericId), version };
  });

  app.delete('/api/dashboards/:id/items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const numericId = Number(id);
    const rows = deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.id, Number(itemId)))
      .all();
    if (rows.length === 0 || rows[0].dashboardId !== numericId) {
      throw notFound(`Dashboard item ${itemId} not found`);
    }
    deps.db.delete(dashboardItems).where(eq(dashboardItems.id, Number(itemId))).run();
    touchDashboard(deps, numericId);
    reply.code(204);
  });

  app.delete('/api/dashboards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    readDashboard(deps, numericId);
    deps.db.delete(dashboardItems).where(eq(dashboardItems.dashboardId, numericId)).run();
    deps.db.delete(dashboardVersions).where(eq(dashboardVersions.dashboardId, numericId)).run();
    deps.db.delete(dashboards).where(eq(dashboards.id, numericId)).run();
    reply.code(204);
  });

  app.get('/api/dashboards/:id/versions', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    readDashboard(deps, numericId);
    const rows = deps.db
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
    readDashboard(deps, numericId);
    const row = deps.db
      .select()
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, numericId))
      .all()
      .find((entry) => entry.version === Number(version));
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
    readDashboard(deps, numericId);
    const parsed = CommitDashboardSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid commit', parsed.error.flatten());

    const snapshot = readDashboard(deps, numericId).snapshot;
    const version = insertVersion(
      deps,
      numericId,
      snapshot,
      parsed.data.message,
      'manual',
      authorIdFrom(request, deps),
    );
    reply.code(201);
    return version;
  });

  app.post('/api/dashboards/:id/versions/:version/restore', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const numericId = Number(id);
    readDashboard(deps, numericId);
    const row = deps.db
      .select()
      .from(dashboardVersions)
      .where(eq(dashboardVersions.dashboardId, numericId))
      .all()
      .find((entry) => entry.version === Number(version));
    if (!row) throw notFound(`Dashboard version ${version} not found`);

    const snapshot = JSON.parse(row.snapshotJson) as DashboardSnapshot;
    applySnapshot(deps, numericId, snapshot);
    const restored = insertVersion(
      deps,
      numericId,
      snapshot,
      `Restored v${row.version}`,
      'restore',
      authorIdFrom(request, deps),
    );
    return { ...dashboardResponse(deps, numericId), version: restored };
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

    const uploadsDir = deps.uploadsDir;
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = path.join(uploadsDir, safeName);
    const buffer = await data.toBuffer();
    fs.writeFileSync(filePath, buffer);

    const tableName = `upload_${Date.now()}`;
    const engine = deps.duckDb;
    await engine.ingestFile(filePath, tableName);

    const rowCount = await engine.countRows(tableName);
    const now = new Date().toISOString();
    const inserted = deps.db
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
    const rows = deps.db.select().from(uploads).all();
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
    const rows = deps.db.select().from(uploads).where(eq(uploads.id, numericId)).all();
    if (rows.length === 0) throw notFound(`Upload ${id} not found`);
    const upload = rows[0];
    await deps.duckDb.dropTable(upload.tableName);
    deps.db.delete(uploads).where(eq(uploads.id, numericId)).run();
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

    return {
      flint: result.flint,
      echarts: result.echarts,
      compiled: result.compiled,
      diagnostics: result.diagnostics,
      query: data.length > 0 ? { columns: Object.keys(data[0] ?? {}), rowCount: data.length } : null,
    };
  });
}
