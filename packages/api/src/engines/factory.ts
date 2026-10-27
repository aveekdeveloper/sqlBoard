import { eq } from 'drizzle-orm';
import type { SqlboardConfig } from '../config.js';
import type { DrizzleDb } from '../db/client.js';
import { decryptJson } from '../crypto.js';
import { ApiError, notFound } from '../errors.js';
import { connections } from '../db/schema.js';
import { DuckDbEngine } from './duckdb.js';
import { PostgresEngine, type PostgresConfig } from './postgres.js';
import { SqliteFileEngine } from './sqlite-file.js';
import { MySqlEngine, type MySqlConfig } from './mysql.js';
import { ClickHouseEngine, type ClickHouseConfig } from './clickhouse.js';
import { TrinoEngine, type TrinoConfig } from './trino.js';
import { DatabricksEngine, type DatabricksConfig } from './databricks.js';
import { SnowflakeEngine, type SnowflakeConfig } from './snowflake.js';
import type { QueryEngine } from './query-engine.js';

export interface EngineFactoryDeps {
  config: SqlboardConfig;
  db: DrizzleDb;
  duckDb: DuckDbEngine;
}

export interface ConnectionRow {
  id: number;
  name: string;
  type: string;
  configEnc: string;
  createdAt: string;
}

export class EngineFactory {
  private readonly engines = new Map<number, QueryEngine>();

  constructor(private readonly deps: EngineFactoryDeps) {}

  async forConnectionId(connectionId: number): Promise<QueryEngine> {
    const cached = this.engines.get(connectionId);
    if (cached) return cached;

    const rows = this.deps.db
      .select()
      .from(connections)
      .where(eq(connections.id, connectionId))
      .all() as ConnectionRow[];

    const row = rows[0];
    if (!row) throw notFound(`Connection ${connectionId} not found`);

    const engine = await this.build(row.type, row.configEnc);
    this.engines.set(connectionId, engine);
    return engine;
  }

  async build(type: string, configEnc: string): Promise<QueryEngine> {
    const config = decryptJson<Record<string, unknown>>(configEnc, this.deps.config.secretKey);

    if (type === 'duckdb') return this.deps.duckDb;

    if (type === 'sqlite') {
      const path = String(config.path ?? '');
      if (!path) throw new ApiError(400, 'CONNECTION_FAILED', 'sqlite connection requires a path');
      return new SqliteFileEngine(path);
    }

    if (type === 'postgres') {
      const pgConfig: PostgresConfig = {
        host: String(config.host ?? ''),
        port: Number(config.port ?? 5432),
        database: String(config.database ?? ''),
        user: String(config.user ?? ''),
        password: String(config.password ?? ''),
        ssl: Boolean(config.ssl),
      };
      return new PostgresEngine(pgConfig, this.deps.config.queryTimeoutMs);
    }

    if (type === 'mysql') {
      const mysqlConfig: MySqlConfig = {
        host: String(config.host ?? ''),
        port: Number(config.port ?? 3306),
        database: String(config.database ?? ''),
        user: String(config.user ?? ''),
        password: String(config.password ?? ''),
        ssl: Boolean(config.ssl),
      };
      return new MySqlEngine(mysqlConfig);
    }

    if (type === 'clickhouse') {
      const chConfig: ClickHouseConfig = {
        host: String(config.host ?? ''),
        port: Number(config.port ?? 8123),
        database: String(config.database ?? 'default'),
        user: String(config.user ?? 'default'),
        password: String(config.password ?? ''),
        ssl: Boolean(config.ssl),
      };
      return new ClickHouseEngine(chConfig);
    }

    if (type === 'trino') {
      const trinoConfig: TrinoConfig = {
        host: String(config.host ?? ''),
        port: Number(config.port ?? 8080),
        catalog: String(config.catalog ?? 'hive'),
        schema: String(config.schema ?? 'default'),
        user: String(config.user ?? ''),
        password: String(config.password ?? ''),
        ssl: Boolean(config.ssl),
      };
      return new TrinoEngine(trinoConfig);
    }

    if (type === 'databricks') {
      const dbConfig: DatabricksConfig = {
        host: String(config.host ?? ''),
        httpPath: String(config.httpPath ?? ''),
        token: String(config.token ?? ''),
      };
      return new DatabricksEngine(dbConfig);
    }

    if (type === 'snowflake') {
      const sfConfig: SnowflakeConfig = {
        account: String(config.account ?? ''),
        user: String(config.user ?? ''),
        password: String(config.password ?? ''),
        warehouse: config.warehouse ? String(config.warehouse) : undefined,
        database: config.database ? String(config.database) : undefined,
        schema: config.schema ? String(config.schema) : undefined,
      };
      return new SnowflakeEngine(sfConfig);
    }

    throw new ApiError(400, 'CONNECTION_FAILED', `Unknown connection type: ${type}`);
  }

  async closeConnection(connectionId: number): Promise<void> {
    const engine = this.engines.get(connectionId);
    this.engines.delete(connectionId);
    if (engine instanceof PostgresEngine) {
      await engine.close().catch(() => undefined);
    }
    if (engine instanceof MySqlEngine) {
      await engine.close().catch(() => undefined);
    }
    if (engine instanceof ClickHouseEngine) {
      await engine.close().catch(() => undefined);
    }
    if (engine instanceof DatabricksEngine) {
      await engine.close().catch(() => undefined);
    }
    if (engine instanceof SnowflakeEngine) {
      await engine.close().catch(() => undefined);
    }
  }
}
