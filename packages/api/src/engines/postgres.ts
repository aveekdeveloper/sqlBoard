import { Pool } from 'pg';
import { queryFailed } from '../errors.js';
import {
  quoteIdentifier,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableInfo,
} from './query-engine.js';

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export class PostgresEngine implements QueryEngine {
  readonly type = 'postgres' as const;

  private readonly pool: Pool;

  constructor(config: PostgresConfig, timeoutMs: number) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      statement_timeout: timeoutMs,
      max: 5,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql);
      const rows = result.rows as Array<Record<string, unknown>>;
      const limited = options?.maxRows ? rows.slice(0, options.maxRows) : rows;
      return toQueryResult(limited);
    } catch (error) {
      throw queryFailed(`Postgres query failed: ${String((error as Error).message)}`);
    } finally {
      client.release();
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = await this.run(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tables: TableInfo[] = [];
    for (const row of rows.rows) {
      const name = String(row.table_name);
      const columns = await this.run(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ${`'${name.replace(/'/g, "''")}'`}
         ORDER BY ordinal_position`,
      );
      tables.push({ name, columns: columns.rows.map((c) => String(c.column_name)) });
    }
    return tables;
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    return this.run(
      `SELECT * FROM ${quoteIdentifier(table)} LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
    );
  }
}
