import fs from 'node:fs';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { encryptJson } from '../crypto.js';
import type { SqlboardConfig } from '../config.js';
import { connections } from './schema.js';

export type DrizzleDb = ReturnType<typeof drizzle>;

export interface OpenedDatabase {
  client: Client;
  db: DrizzleDb;
}

const BOOTSTRAP_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config_enc TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS saved_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    connection_id INTEGER NOT NULL,
    sql TEXT NOT NULL,
    latest_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS saved_query_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_query_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    parent_version INTEGER,
    message TEXT,
    author_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'manual',
    sql TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS saved_query_versions_unique ON saved_query_versions (saved_query_id, version)`,
  `CREATE TABLE IF NOT EXISTS dashboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    filters_json TEXT,
    theme TEXT,
    colors_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dashboard_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    sql TEXT NOT NULL,
    connection_id INTEGER NOT NULL,
    saved_query_id INTEGER,
    block_type TEXT NOT NULL DEFAULT 'chart',
    config_json TEXT,
    layout_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dashboard_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dashboard_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    parent_version INTEGER,
    message TEXT,
    author_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'manual',
    snapshot_json TEXT NOT NULL,
    code_text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dashboard_versions_unique ON dashboard_versions (dashboard_id, version)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    prefix TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'viewer',
    expires_at TEXT,
    last_used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_unique ON api_tokens (token_hash)`,
];

export async function openDatabase(config: SqlboardConfig): Promise<OpenedDatabase> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const client = createClient({
    url: config.databaseUrl,
    authToken: process.env.LIBSQL_AUTH_TOKEN,
  });

  for (const statement of BOOTSTRAP_SQL) {
    await client.execute(statement);
  }

  const db = drizzle(client);

  // Migrations (idempotent)
  const migrations = [
    'ALTER TABLE saved_queries ADD COLUMN latest_version INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE dashboard_items ADD COLUMN saved_query_id INTEGER',
    'ALTER TABLE dashboards ADD COLUMN filters_json TEXT',
    'ALTER TABLE dashboards ADD COLUMN theme TEXT',
    'ALTER TABLE dashboards ADD COLUMN colors_json TEXT',
  ];
  for (const m of migrations) {
    try {
      await client.execute(m);
    } catch {
      // Column already exists.
    }
  }

  // Seed built-in DuckDB connection if none exists
  const existing = await db
    .select({ id: connections.id })
    .from(connections)
    .where(eq(connections.type, 'duckdb'))
    .all();
  if (existing.length === 0) {
    await db.insert(connections).values({
      name: 'Local uploads',
      type: 'duckdb',
      configEnc: encryptJson({ builtIn: true }, config.secretKey),
      createdAt: new Date().toISOString(),
    });
  }

  return { client, db };
}
