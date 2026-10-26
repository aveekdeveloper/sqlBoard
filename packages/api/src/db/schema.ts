import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'),
  createdAt: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  userId: integer('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const connections = sqliteTable('connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  configEnc: text('config_enc').notNull(),
  createdAt: text('created_at').notNull(),
});

export const uploads = sqliteTable('uploads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tableName: text('table_name').notNull(),
  filename: text('filename').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  sizeBytes: integer('size_bytes').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const savedQueries = sqliteTable('saved_queries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  connectionId: integer('connection_id').notNull(),
  sql: text('sql').notNull(),
  latestVersion: integer('latest_version').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const savedQueryVersions = sqliteTable('saved_query_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  savedQueryId: integer('saved_query_id').notNull(),
  version: integer('version').notNull(),
  parentVersion: integer('parent_version'),
  message: text('message'),
  authorId: integer('author_id'),
  kind: text('kind').notNull().default('manual'),
  sql: text('sql').notNull(),
  createdAt: text('created_at').notNull(),
});

export const dashboards = sqliteTable('dashboards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  filtersJson: text('filters_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dashboardItems = sqliteTable('dashboard_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dashboardId: integer('dashboard_id').notNull(),
  title: text('title').notNull(),
  sql: text('sql').notNull(),
  connectionId: integer('connection_id').notNull(),
  savedQueryId: integer('saved_query_id'),
  blockType: text('block_type').notNull().default('chart'),
  configJson: text('config_json'),
  layoutJson: text('layout_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const dashboardVersions = sqliteTable('dashboard_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dashboardId: integer('dashboard_id').notNull(),
  version: integer('version').notNull(),
  parentVersion: integer('parent_version'),
  message: text('message'),
  authorId: integer('author_id'),
  kind: text('kind').notNull().default('manual'),
  snapshotJson: text('snapshot_json').notNull(),
  codeText: text('code_text').notNull(),
  createdAt: text('created_at').notNull(),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  createdAt: text('created_at').notNull(),
});
