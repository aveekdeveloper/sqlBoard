import Fastify, { type FastifyInstance } from 'fastify';
import type { SqlboardConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { DuckDbEngine } from './engines/duckdb.js';
import { EngineFactory } from './engines/factory.js';
import { registerConnectionRoutes, registerSavedQueryRoutes, registerDashboardRoutes, registerUploadRoutes, registerCompileRoute } from './routes/connections.js';
import { registerAuthRoutes } from './auth/session.js';

export interface ServerContext {
  app: FastifyInstance;
  db: ReturnType<typeof openDatabase>['db'];
  sqlite: ReturnType<typeof openDatabase>['sqlite'];
  duckDb: DuckDbEngine;
  engineFactory: EngineFactory;
  config: SqlboardConfig;
}

export async function buildServer(config: SqlboardConfig): Promise<ServerContext> {
  const { sqlite, db } = openDatabase(config);
  const duckDb = new DuckDbEngine(config.duckDbPath);
  const engineFactory = new EngineFactory({ config, db, duckDb });

  const app = Fastify({ logger: true });

  await app.register(import('@fastify/multipart'), { limits: { fileSize: 50 * 1024 * 1024 } });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const err = error as { statusCode?: number; code?: string; message?: string };
    reply.code(err.statusCode ?? 500).send({
      error: {
        code: err.code ?? 'INTERNAL_ERROR',
        message: err.message ?? 'Internal server error',
      },
    });
  });

  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));

  const routeDeps = { db, engineFactory, secretKey: config.secretKey, uploadsDir: config.uploadsDir, duckDb };
  registerAuthRoutes(app, db);
  registerConnectionRoutes(app, routeDeps);
  registerSavedQueryRoutes(app, routeDeps);
  registerDashboardRoutes(app, routeDeps);
  registerUploadRoutes(app, routeDeps);
  registerCompileRoute(app, routeDeps);

  return { app, db, sqlite, duckDb, engineFactory, config };
}

export async function startServer(config: SqlboardConfig): Promise<void> {
  const ctx = await buildServer(config);
  await ctx.app.listen({ port: config.port, host: config.host });
}
