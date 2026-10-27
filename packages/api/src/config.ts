import path from 'node:path';

export interface SqlboardConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  databaseUrl: string;
  duckDbPath: string;
  uploadsDir: string;
  secretKey: string;
  cacheTtlMinutes: number;
  maxCacheRows: number;
  queryTimeoutMs: number;
  tenancyEnabled: boolean;
  baseDomain: string;
  s3Endpoint: string | null;
  s3AccessKey: string | null;
  s3SecretKey: string | null;
  s3Bucket: string;
  s3Region: string;
  s3ForcePathStyle: boolean;
}

export function loadConfig(overrides?: Partial<SqlboardConfig>): SqlboardConfig {
  const dataDir = path.resolve(overrides?.dataDir ?? process.env.DATA_DIR ?? './data');
  const secretKey = overrides?.secretKey ?? process.env.SECRET_KEY ?? 'dev-secret-change-me';
  // Default to a local SQLite file via libSQL. Same code path everywhere:
  // local dev uses file:, prod uses libsql:// (or http://).
  const defaultUrl = `file:${path.join(dataDir, 'sqlboard.db')}`;
  const databaseUrl = overrides?.databaseUrl ?? process.env.DATABASE_URL ?? defaultUrl;

  return {
    host: overrides?.host ?? process.env.HOST ?? '0.0.0.0',
    port: Number(overrides?.port ?? process.env.PORT ?? 3001),
    dataDir,
    dbPath: path.join(dataDir, 'sqlboard.db'),
    databaseUrl,
    duckDbPath: path.join(dataDir, 'sqlboard.duckdb'),
    uploadsDir: path.join(dataDir, 'uploads'),
    secretKey,
    cacheTtlMinutes: Number(
      overrides?.cacheTtlMinutes ?? process.env.CACHE_TTL_MINUTES ?? 5,
    ),
    maxCacheRows: Number(overrides?.maxCacheRows ?? process.env.MAX_CACHE_ROWS ?? 10000),
    queryTimeoutMs: Number(
      overrides?.queryTimeoutMs ?? process.env.QUERY_TIMEOUT_MS ?? 30000,
    ),
    tenancyEnabled: overrides?.tenancyEnabled ?? process.env.TENANCY_ENABLED === 'true',
    baseDomain: overrides?.baseDomain ?? process.env.BASE_DOMAIN ?? '',
    s3Endpoint: overrides?.s3Endpoint ?? process.env.S3_ENDPOINT ?? null,
    s3AccessKey: overrides?.s3AccessKey ?? process.env.S3_ACCESS_KEY ?? null,
    s3SecretKey: overrides?.s3SecretKey ?? process.env.S3_SECRET_KEY ?? null,
    s3Bucket: overrides?.s3Bucket ?? process.env.S3_BUCKET ?? 'sqlboard',
    s3Region: overrides?.s3Region ?? process.env.S3_REGION ?? 'us-east-1',
    s3ForcePathStyle: overrides?.s3ForcePathStyle ?? (process.env.S3_FORCE_PATH_STYLE !== 'false'),
  };
}
