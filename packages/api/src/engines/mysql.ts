import { createConnection, type Connection } from 'mysql2/promise';
import {
  quoteIdentifier,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableInfo,
} from './query-engine.js';

export interface MySqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export class MySqlEngine implements QueryEngine {
  readonly type = 'mysql' as const;

  private conn: Connection | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly config: MySqlConfig, private readonly timeoutMs: number = 30000) {}

  private async ensureReady(): Promise<void> {
    if (this.conn) {
      try {
        await this.conn.ping();
        return;
      } catch {
        this.conn = null;
        this.ready = null;
      }
    }
    if (!this.ready) {
      this.ready = (async () => {
        this.conn = await createConnection({
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user,
          password: this.config.password,
          ssl: this.config.ssl ? {} : undefined,
        });
      })();
    }
    await this.ready;
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    await this.ensureReady();
    let timer: NodeJS.Timeout | undefined;
    try {
      const rowsPromise = this.conn!.query(sql).then((r) => r);
      const result = await Promise.race([
        rowsPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`MySQL query timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
          if (timer && typeof timer.unref === 'function') timer.unref();
        }),
      ]);
      const [rows] = result as unknown as [unknown, unknown];
      const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
      const limited = options?.maxRows ? arr.slice(0, options.maxRows) : arr;
      return toQueryResult(limited);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listTables(): Promise<TableInfo[]> {
    await this.ensureReady();
    const [rows] = await this.conn!.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
    );
    const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    const tables: TableInfo[] = [];
    for (const row of arr) {
      const name = String(row.table_name ?? row.TABLE_NAME);
      tables.push({ name });
    }
    return tables;
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    return this.run(`SELECT * FROM ${quoteIdentifier(table)} LIMIT ${safe}`);
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.end().catch(() => undefined);
      this.conn = null;
      this.ready = null;
    }
  }
}
