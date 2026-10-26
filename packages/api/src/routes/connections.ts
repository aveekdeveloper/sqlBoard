import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from '../errors.js';
import { connections, savedQueries, dashboards, dashboardItems, uploads } from '../db/schema.js';
import type { DrizzleDb } from '../db/client.js';
import type { EngineFactory } from '../engines/factory.js';
import { CreateConnectionRequestSchema, RunQueryRequestSchema } from '@sqlboard/shared';
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
  app.get('/api/saved-queries', async () => {
    const rows = deps.db.select().from(savedQueries).all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      connectionId: row.connectionId,
      sql: row.sql,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
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
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    reply.code(201);
    return {
      id: inserted.id,
      name: inserted.name,
      connectionId: inserted.connectionId,
      sql: inserted.sql,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
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
    deps.db.delete(savedQueries).where(eq(savedQueries.id, Number(id))).run();
    reply.code(204);
  });
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
    const parsed = z.object({ name: z.string().min(1), description: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard', parsed.error.flatten());

    const now = new Date().toISOString();
    const inserted = deps.db
      .insert(dashboards)
      .values({ name: parsed.data.name, description: parsed.data.description ?? null, createdAt: now, updatedAt: now })
      .returning()
      .get();
    reply.code(201);
    return {
      id: inserted.id,
      name: inserted.name,
      description: inserted.description,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    };
  });

  app.get('/api/dashboards/:id', async (request) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const rows = deps.db.select().from(dashboards).where(eq(dashboards.id, numericId)).all();
    if (rows.length === 0) throw notFound(`Dashboard ${id} not found`);
    const items = deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.dashboardId, numericId))
      .all();
    return {
      id: rows[0].id,
      name: rows[0].name,
      description: rows[0].description,
      createdAt: rows[0].createdAt,
      updatedAt: rows[0].updatedAt,
      items: items.map((item) => ({
        id: item.id,
        dashboardId: item.dashboardId,
        title: item.title,
        sql: item.sql,
        connectionId: item.connectionId,
        blockType: item.blockType,
        config: item.configJson ? JSON.parse(item.configJson) : null,
        layout: JSON.parse(item.layoutJson),
        createdAt: item.createdAt,
      })),
    };
  });

  app.post('/api/dashboards/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        title: z.string().min(1),
        sql: z.string().min(1),
        connectionId: z.number().int(),
        blockType: z.enum(['chart', 'metric']).default('chart'),
        config: z.record(z.unknown()).optional(),
        layout: z.object({
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          w: z.number().int().min(1).max(12),
          h: z.number().int().min(1).max(12),
        }),
      })
      .safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid dashboard item', parsed.error.flatten());

    const now = new Date().toISOString();
    const inserted = deps.db
      .insert(dashboardItems)
      .values({
        dashboardId: Number(id),
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
    reply.code(201);
    return {
      id: inserted.id,
      dashboardId: inserted.dashboardId,
      title: inserted.title,
      sql: inserted.sql,
      connectionId: inserted.connectionId,
      blockType: inserted.blockType,
      config: inserted.configJson ? JSON.parse(inserted.configJson) : null,
      layout: JSON.parse(inserted.layoutJson),
      createdAt: inserted.createdAt,
    };
  });

  app.delete('/api/dashboards/:id/items/:itemId', async (request, reply) => {
    const { itemId } = request.params as { id: string; itemId: string };
    const rows = deps.db
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.id, Number(itemId)))
      .all();
    if (rows.length === 0) throw notFound(`Dashboard item ${itemId} not found`);
    deps.db.delete(dashboardItems).where(eq(dashboardItems.id, Number(itemId))).run();
    reply.code(204);
  });

  app.delete('/api/dashboards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const rows = deps.db.select().from(dashboards).where(eq(dashboards.id, numericId)).all();
    if (rows.length === 0) throw notFound(`Dashboard ${id} not found`);
    deps.db.delete(dashboardItems).where(eq(dashboardItems.dashboardId, numericId)).run();
    deps.db.delete(dashboards).where(eq(dashboards.id, numericId)).run();
    reply.code(204);
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
