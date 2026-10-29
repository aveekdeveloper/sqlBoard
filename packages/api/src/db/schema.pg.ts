import {
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull().default(''),
  domain: text('domain').unique(),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  ownerEmail: text('owner_email'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: integer('user_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const connections = pgTable('connections', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  configEnc: text('config_enc').notNull(),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const uploads = pgTable('uploads', {
  id: serial('id').primaryKey(),
  tableName: text('table_name').notNull(),
  filename: text('filename').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  sizeBytes: integer('size_bytes').notNull().default(0),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const savedQueries = pgTable('saved_queries', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  connectionId: integer('connection_id').notNull(),
  sql: text('sql').notNull(),
  latestVersion: integer('latest_version').notNull().default(0),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const savedQueryVersions = pgTable('saved_query_versions', {
  id: serial('id').primaryKey(),
  savedQueryId: integer('saved_query_id').notNull(),
  version: integer('version').notNull(),
  parentVersion: integer('parent_version'),
  message: text('message'),
  authorId: integer('author_id'),
  kind: text('kind').notNull().default('manual'),
  sql: text('sql').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const dashboards = pgTable('dashboards', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  filtersJson: text('filters_json'),
  theme: text('theme'),
  colorsJson: text('colors_json'),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const dashboardItems = pgTable('dashboard_items', {
  id: serial('id').primaryKey(),
  dashboardId: integer('dashboard_id').notNull(),
  title: text('title').notNull(),
  sql: text('sql').notNull(),
  connectionId: integer('connection_id').notNull(),
  savedQueryId: integer('saved_query_id'),
  blockType: text('block_type').notNull().default('chart'),
  configJson: text('config_json'),
  layoutJson: text('layout_json').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const dashboardVersions = pgTable('dashboard_versions', {
  id: serial('id').primaryKey(),
  dashboardId: integer('dashboard_id').notNull(),
  version: integer('version').notNull(),
  parentVersion: integer('parent_version'),
  message: text('message'),
  authorId: integer('author_id'),
  kind: text('kind').notNull().default('manual'),
  snapshotJson: text('snapshot_json').notNull(),
  codeText: text('code_text').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  prefix: text('prefix').notNull(),
  scope: text('scope').notNull().default('viewer'),
  expiresAt: timestamp('expires_at'),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color'),
  tenantId: uuid('tenant_id').notNull().default('00000000-0000-0000-0000-000000000000'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const savedQueryTags = pgTable('saved_query_tags', {
  savedQueryId: integer('saved_query_id').notNull(),
  tagId: integer('tag_id').notNull(),
});

export const dashboardTags = pgTable('dashboard_tags', {
  dashboardId: integer('dashboard_id').notNull(),
  tagId: integer('tag_id').notNull(),
});
