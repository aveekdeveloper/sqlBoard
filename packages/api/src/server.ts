import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'node:path';
import fs from 'node:fs';
import type { SqlboardConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { auditLog } from './db/schema.js';
import { DuckDbEngine } from './engines/duckdb.js';
import { EngineFactory } from './engines/factory.js';
import {
  registerConnectionRoutes,
  registerSavedQueryRoutes,
  registerDashboardRoutes,
  registerUploadRoutes,
  registerCompileRoute,
} from './routes/connections.js';
import { registerAuthRoutes, requireUser } from './auth/session.js';
import { registerTokenRoutes } from './routes/tokens.js';
import { ROLE_RANK } from './auth/roles.js';
import { QueryCache } from './cache/query-cache.js';
import { ApiError } from './errors.js';
import './auth/types.js';

export interface ServerContext {
  app: FastifyInstance;
  db: Awaited<ReturnType<typeof openDatabase>>['db'];
  client: Awaited<ReturnType<typeof openDatabase>>['client'];
  duckDb: DuckDbEngine;
  engineFactory: EngineFactory;
  cache: QueryCache;
  config: SqlboardConfig;
}

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

// Viewers may still mint read-only tokens and revoke them.
const SELF_SERVICE_WRITES = [/^\/api\/tokens$/, /^\/api\/tokens\/\d+$/];

// POSTs that read but never persist: query execution and compilation.
const READ_ONLY_POSTS = [
  /^\/api\/compile$/,
  /^\/api\/connections\/\d+\/query$/,
  /^\/api\/connections\/\d+\/test$/,
];

export async function buildServer(config: SqlboardConfig): Promise<ServerContext> {
  const { client, db } = await openDatabase(config);
  const duckDb = new DuckDbEngine(config.duckDbPath);
  const engineFactory = new EngineFactory({ config, db, duckDb });
  const cache = new QueryCache(config.cacheTtlMinutes * 60 * 1000);

  const app = Fastify({ logger: true });

  await app.register(import('@fastify/cors'), {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  // Clients routinely send `Content-Type: application/json` on DELETE/POST with no body.
  // Fastify's default parser rejects that with 400, so treat an empty body as absent.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      const error = new Error('Body is not valid JSON') as Error & {
        statusCode?: number;
        code?: string;
      };
      error.statusCode = 400;
      error.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
      done(error, undefined);
    }
  });

  await app.register(import('@fastify/multipart'), { limits: { fileSize: 50 * 1024 * 1024 } });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'sqlboard API',
        description:
          'Headless BI dashboard layer. Authenticate with a session token or a scoped API token.',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'auth', description: 'Sessions, identity, and API tokens' },
        { name: 'connections', description: 'Data sources, queries, and uploads' },
        { name: 'saved-queries', description: 'Reusable, versioned SQL' },
        { name: 'dashboards', description: 'SQL-first dashboard manifests and versions' },
        { name: 'compile', description: 'Compile SQL annotations into chart specs' },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  app.get('/openapi.json', async () => app.swagger());

  app.addHook('preHandler', async (request) => {
    if (request.method === 'OPTIONS') return;
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (PUBLIC_PATHS.has(path)) return;

    const user = await requireUser(request, db);
    request.user = user;

    if (request.method === 'GET' || request.method === 'HEAD') return;

    const selfService = SELF_SERVICE_WRITES.some((pattern) => pattern.test(path));
    const readOnlyPost = READ_ONLY_POSTS.some((pattern) => pattern.test(path));
    if (readOnlyPost) return;
    if (!selfService && ROLE_RANK[user.role] < ROLE_RANK.member) {
      throw new ApiError(403, 'FORBIDDEN', 'this action requires the member role');
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/') || path.startsWith('/api/auth/')) return;
    if (reply.statusCode >= 400) return;
    if (READ_ONLY_POSTS.some((pattern) => pattern.test(path))) return;

    const segments = path.split('/').filter(Boolean);
    try {
      await db.insert(auditLog)
        .values({
          userId: request.user?.id ?? null,
          action: `${request.method} ${path}`,
          resourceType: segments[1] ?? 'unknown',
          resourceId: segments[2] ?? null,
          createdAt: new Date().toISOString(),
        });
    } catch {
      // Auditing must never fail a request that already succeeded.
    }
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    const err = error as { statusCode?: number; code?: string; message?: string; details?: unknown };
    // Only our own ApiError carries a meaningful HTTP status. Upstream SDK
    // errors (Databricks, Snowflake, etc.) may carry a `statusCode` field
    // (e.g. 401/403) that must NOT propagate as the HTTP status, otherwise the
    // client treats it as a session failure and logs the user out. Fastify's
    // own content-type parser errors (FST_ERR_CTP_*) are the exception: they
    // are genuine 400 client errors.
    const isApiError = error instanceof ApiError;
    const isParserError = typeof err.code === 'string' && err.code.startsWith('FST_ERR_CTP');
    const statusCode = isApiError || isParserError ? (err.statusCode ?? 500) : 500;
    reply.code(statusCode).send({
      error: {
        code: isApiError ? (err.code ?? 'INTERNAL_ERROR') : (err.code ?? 'INTERNAL_ERROR'),
        message: err.message ?? 'Internal server error',
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
  });

  app.get('/api/health', async () => ({ status: 'ok', version: '0.1.0' }));

  const routeDeps = { db, engineFactory, secretKey: config.secretKey, uploadsDir: config.uploadsDir, duckDb, cache };
  registerAuthRoutes(app, db);
  registerTokenRoutes(app, { db });
  registerConnectionRoutes(app, routeDeps);
  registerSavedQueryRoutes(app, routeDeps);
  registerDashboardRoutes(app, routeDeps);
  registerUploadRoutes(app, routeDeps);
  registerCompileRoute(app, routeDeps);

  // Serve the built web app (SPA) when present. In dev the Vite dev server owns
  // the frontend, so this is a no-op unless WEB_DIST_DIR (or packages/web/dist)
  // exists.
  const webDistDir =
    process.env.WEB_DIST_DIR ?? path.resolve(process.cwd(), 'packages/web/dist');
  if (fs.existsSync(path.join(webDistDir, 'index.html'))) {
    await app.register(import('@fastify/static'), {
      root: webDistDir,
      prefix: '/',
      wildcard: false,
    });
    app.get('/*', async (request, reply) => {
      const url = request.url.split('?')[0];
      if (
        url.startsWith('/api') ||
        url.startsWith('/docs') ||
        url === '/openapi.json' ||
        url === '/health'
      ) {
        reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
        return;
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, db, client, duckDb, engineFactory, cache, config };
}

export async function startServer(config: SqlboardConfig): Promise<void> {
  const ctx = await buildServer(config);
  await ctx.app.listen({ port: config.port, host: config.host });
}
