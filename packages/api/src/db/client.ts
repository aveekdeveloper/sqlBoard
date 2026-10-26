import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { encryptJson } from '../crypto.js';
import type { SqlboardConfig } from '../config.js';
import { connections } from './schema.js';

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
];

export interface OpenedDatabase {
  sqlite: Database.Database;
  db: DrizzleDb;
}

export type DrizzleDb = ReturnType<typeof drizzle>;

export function openDatabase(config: SqlboardConfig): OpenedDatabase {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const sqlite = new Database(config.dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  for (const statement of BOOTSTRAP_SQL) sqlite.exec(statement);

  const db = drizzle(sqlite);

  try {
    sqlite.exec('ALTER TABLE saved_queries ADD COLUMN latest_version INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists.
  }
  try {
    sqlite.exec('ALTER TABLE dashboard_items ADD COLUMN saved_query_id INTEGER');
  } catch {
    // Column already exists.
  }
  try {
    sqlite.exec('ALTER TABLE dashboards ADD COLUMN filters_json TEXT');
  } catch {
    // Column already exists.
  }

  const existing = db
    .select({ id: connections.id })
    .from(connections)
    .where(eq(connections.type, 'duckdb'))
    .all();

  if (existing.length === 0) {
    db.insert(connections)
      .values({
        name: 'Local uploads',
        type: 'duckdb',
        configEnc: encryptJson({ builtIn: true }, config.secretKey),
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  return { sqlite, db };
}
