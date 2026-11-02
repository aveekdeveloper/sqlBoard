import { createClient, type ClickHouseClient } from '@clickhouse/client';
import {
  escapeLiteral,
  quoteQualifiedIdentifier,
  splitTableName,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableDescription,
  type TableInfo,
} from './query-engine.js';

export interface ClickHouseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export class ClickHouseEngine implements QueryEngine {
  readonly type = 'clickhouse' as const;

  private client: ClickHouseClient;

  constructor(private readonly config: ClickHouseConfig, private readonly timeoutMs: number = 30000) {
    const protocol = config.ssl ? 'https' : 'http';
    this.client = createClient({
      url: `${protocol}://${config.host}:${config.port}`,
      database: config.database || 'default',
      username: config.user || 'default',
      password: config.password || '',
    });
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const queryPromise = (async () => {
        const result = await this.client.query({ query: sql, format: 'JSONEachRow' });
        const rows = await result.json<Record<string, unknown>>();
        return Array.isArray(rows) ? rows : [];
      })();
      const rows = await Promise.race([
        queryPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`ClickHouse query timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
          if (timer && typeof timer.unref === 'function') timer.unref();
        }),
      ]);
      const arr = rows as Array<Record<string, unknown>>;
      const limited = options?.maxRows ? arr.slice(0, options.maxRows) : arr;
      return toQueryResult(limited);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const result = await this.client.query({
      query: `SELECT name FROM system.tables WHERE database = currentDatabase() ORDER BY name`,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ name: string }>();
    return (Array.isArray(rows) ? rows : []).map((r) => ({ name: String(r.name) }));
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    return this.run(`SELECT * FROM ${quoteQualifiedIdentifier(table)} LIMIT ${safe}`);
  }

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;
    const database = parts.length >= 2 ? parts[parts.length - 2] : this.config.database;

    const columnRows = await this.run(
      `DESCRIBE TABLE ${quoteQualifiedIdentifier(table)}`,
    );
    const columns = columnRows.rows.map((row) => {
      const type = String(row.type ?? 'unknown');
      return {
        name: String(row.name),
        type,
        nullable: /^Nullable\(/.test(type),
        default: row.default_expression ? String(row.default_expression) : null,
        comment: row.comment == null || String(row.comment) === '' ? null : String(row.comment),
      };
    });

    let kind: TableDescription['kind'] = 'unknown';
    let comment: string | null = null;
    try {
      const meta = await this.run(
        `SELECT engine, comment FROM system.tables
         WHERE database = ${escapeLiteral(database)} AND name = ${escapeLiteral(tableName)}
         LIMIT 1`,
      );
      const engine = String(meta.rows[0]?.engine ?? '');
      comment =
        meta.rows[0]?.comment == null || String(meta.rows[0].comment) === ''
          ? null
          : String(meta.rows[0].comment);
      kind = /MaterializedView/i.test(engine)
        ? 'materialized_view'
        : /View/i.test(engine)
          ? 'view'
          : engine
            ? 'table'
            : 'unknown';
    } catch {
      // Table metadata is best-effort; DESCRIBE already succeeded.
    }

    return {
      name: tableName,
      schema: database,
      kind,
      comment,
      columns,
      primaryKey: [],
      foreignKeys: [],
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
