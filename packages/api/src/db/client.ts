import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { eq } from 'drizzle-orm';
import { encryptJson } from '../crypto.js';
import type { SqlboardConfig } from '../config.js';
import { connections, tenants } from './schema.js';

const require = createRequire(import.meta.url);

export type DrizzleDb = any;

export interface OpenedDatabase {
  db: DrizzleDb;
  client: any;
}

const isPostgres = (config: SqlboardConfig): boolean => {
  return config.databaseUrl.startsWith('postgres://') || config.databaseUrl.startsWith('postgresql://');
};

export async function openDatabase(config: SqlboardConfig): Promise<OpenedDatabase> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  if (isPostgres(config)) {
    return openPostgres(config);
  }
  return openLibsql(config);
}

async function openLibsql(config: SqlboardConfig): Promise<OpenedDatabase> {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');

  const rawUrl = config.databaseUrl;
  let databaseUrl = rawUrl.startsWith('libsql://') ? rawUrl.replace(/^libsql:\/\//, 'http://') : rawUrl;
  let authToken = process.env.LIBSQL_AUTH_TOKEN ?? null;

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.username || parsed.password) {
      if (!authToken) authToken = parsed.password || parsed.username;
      parsed.username = '';
      parsed.password = '';
      databaseUrl = parsed.toString();
    }
  } catch { /* not a valid URL */ }

  if (authToken && !authToken.includes('.')) {
    try {
      const jwt = require('jsonwebtoken');
      authToken = jwt.sign({ sub: 'sqlboard' }, authToken, { expiresIn: '365d' });
    } catch { /* use as-is */ }
  }

  const client = createClient({ url: databaseUrl, authToken: authToken || undefined });

  // Wait for DB to be ready
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await client.execute('SELECT 1');
      break;
    } catch (err) {
      if (attempt === 30) throw err;
      await new Promise((r: any) => setTimeout(r, 2000));
    }
  }

  const bootstrapSql = [
    `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', domain TEXT UNIQUE, plan TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'active', kind TEXT NOT NULL DEFAULT 'tenant', owner_email TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS connections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, config_enc TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, filename TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS saved_queries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, connection_id INTEGER NOT NULL, sql TEXT NOT NULL, latest_version INTEGER NOT NULL DEFAULT 0, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS saved_query_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, saved_query_id INTEGER NOT NULL, version INTEGER NOT NULL, parent_version INTEGER, message TEXT, author_id INTEGER, kind TEXT NOT NULL DEFAULT 'manual', sql TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS saved_query_versions_unique ON saved_query_versions (saved_query_id, version)`,
    `CREATE TABLE IF NOT EXISTS dashboards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, filters_json TEXT, theme TEXT, colors_json TEXT, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS dashboard_items (id INTEGER PRIMARY KEY AUTOINCREMENT, dashboard_id INTEGER NOT NULL, title TEXT NOT NULL, sql TEXT NOT NULL, connection_id INTEGER NOT NULL, saved_query_id INTEGER, block_type TEXT NOT NULL DEFAULT 'chart', config_json TEXT, layout_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS dashboard_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, dashboard_id INTEGER NOT NULL, version INTEGER NOT NULL, parent_version INTEGER, message TEXT, author_id INTEGER, kind TEXT NOT NULL DEFAULT 'manual', snapshot_json TEXT NOT NULL, code_text TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS dashboard_versions_unique ON dashboard_versions (dashboard_id, version)`,
    `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS api_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL, prefix TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'viewer', expires_at TEXT, last_used_at TEXT, revoked_at TEXT, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_unique ON api_tokens (token_hash)`,
    `CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tags_name_tenant_unique ON tags (name, tenant_id)`,
    `CREATE TABLE IF NOT EXISTS saved_query_tags (saved_query_id INTEGER NOT NULL, tag_id INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS dashboard_tags (dashboard_id INTEGER NOT NULL, tag_id INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS dashboard_shares (id INTEGER PRIMARY KEY AUTOINCREMENT, dashboard_id INTEGER NOT NULL, tenant_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workbooks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, tenant_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workbook_dashboards (workbook_id INTEGER NOT NULL, dashboard_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0)`,
  ];

  for (const stmt of bootstrapSql) {
    await client.execute(stmt);
  }

  const db = drizzle(client);

  // Migration: add tenants.kind column (idempotent) BEFORE any select uses it.
  try { await client.execute("ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'tenant'"); } catch { /* exists */ }
  await client.execute("UPDATE tenants SET kind='platform' WHERE slug='default'");
  await client.execute("UPDATE users SET role='platform_admin' WHERE role='admin' AND tenant_id='00000000-0000-0000-0000-000000000000'");
  await client.execute("UPDATE users SET role='tenant_admin' WHERE role='admin' AND tenant_id!='00000000-0000-0000-0000-000000000000'");
  await client.execute("UPDATE api_tokens SET scope='platform_admin' WHERE scope='admin' AND tenant_id='00000000-0000-0000-0000-000000000000'");
  await client.execute("UPDATE api_tokens SET scope='tenant_admin' WHERE scope='admin' AND tenant_id!='00000000-0000-0000-0000-000000000000'");

  // Seed default tenant if none exists
  const existingTenants = await db.select().from(tenants);
  if (existingTenants.length === 0) {
    await db.insert(tenants).values({
      id: '00000000-0000-0000-0000-000000000000',
      slug: 'default',
      name: 'Default',
      domain: null,
      plan: 'free',
      status: 'active',
      kind: 'platform',
      ownerEmail: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Seed built-in DuckDB connection if none exists
  const existing = await db.select({ id: connections.id }).from(connections).where(eq(connections.type, 'duckdb'));
  if (existing.length === 0) {
    await db.insert(connections).values({
      name: 'Local uploads',
      type: 'duckdb',
      configEnc: encryptJson({ builtIn: true }, config.secretKey),
      tenantId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date().toISOString(),
    });
  }

  return { client, db };
}

async function openPostgres(config: SqlboardConfig): Promise<OpenedDatabase> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pgSchema = await import('./schema.pg.js');

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Test connection
  const testClient = await pool.connect();
  await testClient.query('SELECT 1');
  testClient.release();

  const db = drizzle(pool, { schema: pgSchema });

  // Bootstrap tables (Postgres syntax)
  const bootstrapSql = [
    `CREATE TABLE IF NOT EXISTS tenants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', domain TEXT UNIQUE, plan TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'active', kind TEXT NOT NULL DEFAULT 'tenant', owner_email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS connections (id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, config_enc TEXT NOT NULL, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS uploads (id SERIAL PRIMARY KEY, table_name TEXT NOT NULL, filename TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS saved_queries (id SERIAL PRIMARY KEY, name TEXT NOT NULL, connection_id INTEGER NOT NULL, sql TEXT NOT NULL, latest_version INTEGER NOT NULL DEFAULT 0, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS saved_query_versions (id SERIAL PRIMARY KEY, saved_query_id INTEGER NOT NULL, version INTEGER NOT NULL, parent_version INTEGER, message TEXT, author_id INTEGER, kind TEXT NOT NULL DEFAULT 'manual', sql TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE UNIQUE INDEX IF NOT EXISTS saved_query_versions_unique ON saved_query_versions (saved_query_id, version)`,
    `CREATE TABLE IF NOT EXISTS dashboards (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, filters_json TEXT, theme TEXT, colors_json TEXT, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS dashboard_items (id SERIAL PRIMARY KEY, dashboard_id INTEGER NOT NULL, title TEXT NOT NULL, sql TEXT NOT NULL, connection_id INTEGER NOT NULL, saved_query_id INTEGER, block_type TEXT NOT NULL DEFAULT 'chart', config_json TEXT, layout_json TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS dashboard_versions (id SERIAL PRIMARY KEY, dashboard_id INTEGER NOT NULL, version INTEGER NOT NULL, parent_version INTEGER, message TEXT, author_id INTEGER, kind TEXT NOT NULL DEFAULT 'manual', snapshot_json TEXT NOT NULL, code_text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE UNIQUE INDEX IF NOT EXISTS dashboard_versions_unique ON dashboard_versions (dashboard_id, version)`,
    `CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS api_tokens (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL, prefix TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'viewer', expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_unique ON api_tokens (token_hash)`,
    `CREATE TABLE IF NOT EXISTS tags (id SERIAL PRIMARY KEY, name TEXT NOT NULL, color TEXT, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tags_name_tenant_unique ON tags (name, tenant_id)`,
    `CREATE TABLE IF NOT EXISTS saved_query_tags (saved_query_id INTEGER NOT NULL, tag_id INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS dashboard_tags (dashboard_id INTEGER NOT NULL, tag_id INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS dashboard_shares (id SERIAL PRIMARY KEY, dashboard_id INTEGER NOT NULL, tenant_id UUID NOT NULL, token TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS workbooks (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS workbook_dashboards (workbook_id INTEGER NOT NULL, dashboard_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0)`,
  ];

  for (const stmt of bootstrapSql) {
    await pool.query(stmt);
  }

  // Migration: add tenants.kind column (idempotent) BEFORE any select uses it.
  await pool.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tenant'");
  await pool.query("UPDATE tenants SET kind='platform' WHERE slug='default'");
  await pool.query("UPDATE users SET role='platform_admin' WHERE role='admin' AND tenant_id='00000000-0000-0000-0000-000000000000'");
  await pool.query("UPDATE users SET role='tenant_admin' WHERE role='admin' AND tenant_id!='00000000-0000-0000-0000-000000000000'");
  await pool.query("UPDATE api_tokens SET scope='platform_admin' WHERE scope='admin' AND tenant_id='00000000-0000-0000-0000-000000000000'");
  await pool.query("UPDATE api_tokens SET scope='tenant_admin' WHERE scope='admin' AND tenant_id!='00000000-0000-0000-0000-000000000000'");

  // Seed default tenant if none exists
  const existingTenants = await db.select().from(pgSchema.tenants);
  if (existingTenants.length === 0) {
    await db.insert(pgSchema.tenants).values({
      id: '00000000-0000-0000-0000-000000000000',
      slug: 'default',
      name: 'Default',
      domain: null,
      plan: 'free',
      status: 'active',
      kind: 'platform',
      ownerEmail: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Seed built-in DuckDB connection if none exists
  const existing = await db.select({ id: pgSchema.connections.id }).from(pgSchema.connections).where(eq(pgSchema.connections.type, 'duckdb'));
  if (existing.length === 0) {
    await db.insert(pgSchema.connections).values({
      name: 'Local uploads',
      type: 'duckdb',
      configEnc: encryptJson({ builtIn: true }, config.secretKey),
      tenantId: '00000000-0000-0000-0000-000000000000',
      createdAt: new Date(),
    });
  }

  return { client: pool, db };
}
