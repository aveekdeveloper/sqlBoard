import snowflake from 'snowflake-sdk';
import {
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableInfo,
} from './query-engine.js';

export interface SnowflakeConfig {
  account: string;
  user: string;
  password: string;
  warehouse?: string;
  database?: string;
  schema?: string;
}

export class SnowflakeEngine implements QueryEngine {
  readonly type = 'snowflake' as const;

  private conn: snowflake.Connection | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly config: SnowflakeConfig) {
    snowflake.configure({ logLevel: 'ERROR', logFilePath: undefined, additionalLogToConsole: false });
  }

  private async ensureReady(): Promise<void> {
    if (this.conn) return;
    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        const connection = snowflake.createConnection({
          account: this.config.account,
          username: this.config.user,
          password: this.config.password,
          warehouse: this.config.warehouse,
          database: this.config.database,
          schema: this.config.schema,
        });
        connection.connect((err) => {
          if (err) {
            reject(new Error(err.message));
            return;
          }
          this.conn = connection;
          resolve();
        });
      });
    }
    await this.ready;
  }

  private async execute(sql: string): Promise<Array<Record<string, unknown>>> {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      this.conn!.execute({
        sqlText: sql,
        complete: (err, _stmt, rows) => {
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve((rows ?? []) as Array<Record<string, unknown>>);
        },
      });
    });
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    const rows = await this.execute(sql);
    const limited = options?.maxRows ? rows.slice(0, options.maxRows) : rows;
    return toQueryResult(limited);
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = await this.execute(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = CURRENT_SCHEMA() ORDER BY table_name`,
    );
    return rows.map((r) => ({ name: String(r.table_name ?? r.TABLE_NAME) }));
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    return this.run(`SELECT * FROM ${table} LIMIT ${safe}`);
  }

  async close(): Promise<void> {
    if (this.conn) {
      await new Promise<void>((resolve) => {
        this.conn!.destroy((err) => {
          if (err) console.error('snowflake close error:', err.message);
          resolve();
        });
      });
      this.conn = null;
      this.ready = null;
    }
  }
}
