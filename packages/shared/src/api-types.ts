import { z } from 'zod';

export const ConnectionTypeSchema = z.enum([
  'duckdb',
  'sqlite',
  'postgres',
  'databricks',
  'snowflake',
]);
export type ConnectionType = z.infer<typeof ConnectionTypeSchema>;

export const BackendSchema = z.enum(['echarts', 'vegalite', 'chartjs', 'plotly']);
export type Backend = z.infer<typeof BackendSchema>;

export const RoleSchema = z.enum(['admin', 'member', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

export const CreateDuckDbConnectionSchema = z.object({
  type: z.literal('duckdb'),
  name: z.string().min(1),
});

export const CreateSqliteConnectionSchema = z.object({
  type: z.literal('sqlite'),
  name: z.string().min(1),
  path: z.string().min(1),
});

export const CreatePostgresConnectionSchema = z.object({
  type: z.literal('postgres'),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string(),
  ssl: z.boolean().default(false),
});

export const CreateDatabricksConnectionSchema = z.object({
  type: z.literal('databricks'),
  name: z.string().min(1),
  host: z.string().min(1),
  httpPath: z.string().min(1),
  token: z.string().min(1),
});

export const CreateSnowflakeConnectionSchema = z.object({
  type: z.literal('snowflake'),
  name: z.string().min(1),
  account: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  warehouse: z.string().optional(),
  database: z.string().optional(),
  schema: z.string().optional(),
});

export const CreateConnectionRequestSchema = z.discriminatedUnion('type', [
  CreateDuckDbConnectionSchema,
  CreateSqliteConnectionSchema,
  CreatePostgresConnectionSchema,
  CreateDatabricksConnectionSchema,
  CreateSnowflakeConnectionSchema,
]);
export type CreateConnectionRequest = z.infer<typeof CreateConnectionRequestSchema>;

export const ConnectionDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: ConnectionTypeSchema,
  configSummary: z.string(),
  createdAt: z.string(),
});
export type ConnectionDto = z.infer<typeof ConnectionDtoSchema>;

export const QueryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
  rowCount: z.number().int(),
  cached: z.boolean().optional(),
  staleAt: z.string().nullable().optional(),
});
export type QueryResult = z.infer<typeof QueryResultSchema>;

export const TableInfoSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()).optional(),
});
export type TableInfo = z.infer<typeof TableInfoSchema>;

export const RunQueryRequestSchema = z.object({
  sql: z.string().min(1),
  maxRows: z.number().int().min(1).max(50000).default(5000),
});
export type RunQueryRequest = z.infer<typeof RunQueryRequestSchema>;

export const CompileRequestSchema = z.object({
  sql: z.string().min(1),
  connectionId: z.number().int().optional(),
  data: z.array(z.record(z.unknown())).optional(),
  theme: z.string().optional(),
  backend: BackendSchema.optional(),
  backends: z.array(BackendSchema).optional(),
});
export type CompileRequest = z.infer<typeof CompileRequestSchema>;

export const CompileResponseSchema = z.object({
  flint: z.record(z.unknown()),
  echarts: z.record(z.unknown()).nullable(),
  compiled: z.record(z.unknown()),
  diagnostics: z.array(
    z.object({
      severity: z.enum(['error', 'warning', 'info']),
      code: z.string(),
      message: z.string(),
      column: z.string().optional(),
    }),
  ),
  query: z
    .object({
      columns: z.array(z.string()),
      rowCount: z.number().int(),
      cached: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});
export type CompileResponse = z.infer<typeof CompileResponseSchema>;

export const SavedQueryDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  connectionId: z.number().int(),
  sql: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedQueryDto = z.infer<typeof SavedQueryDtoSchema>;

export const CreateSavedQuerySchema = z.object({
  name: z.string().min(1),
  connectionId: z.number().int(),
  sql: z.string().min(1),
});
export type CreateSavedQuery = z.infer<typeof CreateSavedQuerySchema>;

export const DashboardBlockTypeSchema = z.enum(['chart', 'metric', 'table', 'text']);
export type DashboardBlockType = z.infer<typeof DashboardBlockTypeSchema>;

export const LayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(60),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const MetricFormatSchema = z.enum(['number', 'currency', 'percent', 'compact']);
export type MetricFormat = z.infer<typeof MetricFormatSchema>;

export const MetricBlockConfigSchema = z.object({
  metricColumn: z.string().optional(),
  priorColumn: z.string().optional(),
  sparklineColumn: z.string().optional(),
  higherIsBetter: z.boolean().default(true),
  format: MetricFormatSchema.default('number'),
  target: z
    .object({
      value: z.number(),
      direction: z.enum(['above', 'below']).default('above'),
      thresholds: z
        .object({ amber: z.number().default(0.9), red: z.number().default(0.7) })
        .optional(),
    })
    .optional(),
});
export type MetricBlockConfig = z.infer<typeof MetricBlockConfigSchema>;

export const TableBlockConfigSchema = z.object({
  columns: z.array(z.string()).optional(),
  pageSize: z.number().int().min(5).max(500).default(25),
  density: z.enum(['compact', 'comfortable']).default('compact'),
  maxRows: z.number().int().min(10).max(5000).default(1000),
  format: z.record(MetricFormatSchema).optional(),
  rowNumbers: z.boolean().optional(),
});
export type TableBlockConfig = z.infer<typeof TableBlockConfigSchema>;

export const TextBlockConfigSchema = z.object({
  markdown: z.string().default(''),
});
export type TextBlockConfig = z.infer<typeof TextBlockConfigSchema>;

export const CreateDashboardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type CreateDashboard = z.infer<typeof CreateDashboardSchema>;

export const UpdateDashboardSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});
export type UpdateDashboard = z.infer<typeof UpdateDashboardSchema>;

export const CreateDashboardItemSchema = z.object({
  title: z.string().min(1),
  // Text blocks carry markdown in config and intentionally have no SQL.
  sql: z.string(),
  connectionId: z.number().int(),
  blockType: DashboardBlockTypeSchema,
  savedQueryId: z.number().int().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  layout: LayoutSchema,
});
export type CreateDashboardItem = z.infer<typeof CreateDashboardItemSchema>;

export const UpdateDashboardItemSchema = z.object({
  title: z.string().min(1).optional(),
  sql: z.string().min(1).optional(),
  connectionId: z.number().int().optional(),
  blockType: DashboardBlockTypeSchema.optional(),
  config: z.record(z.unknown()).nullable().optional(),
  layout: LayoutSchema.optional(),
});
export type UpdateDashboardItem = z.infer<typeof UpdateDashboardItemSchema>;

export const DashboardLayoutUpdateSchema = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      layout: LayoutSchema,
    }),
  ),
});
export type DashboardLayoutUpdate = z.infer<typeof DashboardLayoutUpdateSchema>;

export const ApplyDashboardStateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  filters: z.array(z.record(z.unknown())).optional(),
  theme: z.string().optional(),
  colors: z.array(z.string()).optional(),
  items: z.array(CreateDashboardItemSchema),
  message: z.string().optional(),
  kind: z.enum(['manual', 'apply', 'restore']).default('apply'),
});
export type ApplyDashboardState = z.infer<typeof ApplyDashboardStateSchema>;

export const DashboardItemDtoSchema = z.object({
  id: z.number().int(),
  dashboardId: z.number().int(),
  title: z.string(),
  sql: z.string(),
  connectionId: z.number().int(),
  blockType: DashboardBlockTypeSchema,
  savedQueryId: z.number().int().nullable().optional(),
  config: z.record(z.unknown()).nullable(),
  layout: LayoutSchema,
  createdAt: z.string(),
});
export type DashboardItemDto = z.infer<typeof DashboardItemDtoSchema>;

export const DashboardDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  filters: z.array(z.record(z.unknown())).default([]),
  theme: z.string().optional(),
  colors: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DashboardDto = z.infer<typeof DashboardDtoSchema>;

export const DashboardVersionDtoSchema = z.object({
  id: z.number().int(),
  dashboardId: z.number().int(),
  version: z.number().int(),
  parentVersion: z.number().int().nullable(),
  message: z.string().nullable(),
  authorId: z.number().int().nullable(),
  kind: z.enum(['manual', 'apply', 'restore']),
  createdAt: z.string(),
});
export type DashboardVersionDto = z.infer<typeof DashboardVersionDtoSchema>;

export const DashboardVersionDetailDtoSchema = DashboardVersionDtoSchema.extend({
  snapshot: z.unknown(),
  codeText: z.string(),
});
export type DashboardVersionDetailDto = z.infer<typeof DashboardVersionDetailDtoSchema>;

export const CommitDashboardSchema = z.object({
  message: z.string().min(1).max(200),
});
export type CommitDashboard = z.infer<typeof CommitDashboardSchema>;

export const UploadDtoSchema = z.object({
  id: z.number().int(),
  tableName: z.string(),
  filename: z.string(),
  rowCount: z.number().int(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});
export type UploadDto = z.infer<typeof UploadDtoSchema>;

export const UserDtoSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;
