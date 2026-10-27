import { DBSQLClient } from '@databricks/sql';
import {
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableInfo,
} from './query-engine.js';

export interface DatabricksConfig {
  host: string;
  httpPath: string;
  token: string;
}

export class DatabricksEngine implements QueryEngine {
  readonly type = 'databricks' as const;

  private client: DBSQLClient | null = null;
  private session: Awaited<ReturnType<DBSQLClient['openSession']>> | null = null;

  constructor(private readonly config: DatabricksConfig) {}

  private async ensureReady(): Promise<void> {
    if (this.session) return;
    const client = new DBSQLClient();
    await client.connect({
      host: this.config.host.replace(/^https?:\/\//, ''),
      path: this.config.httpPath,
      token: this.config.token,
      authType: 'access-token',
    });
    this.client = client;
    this.session = await client.openSession();
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    await this.ensureReady();
    const operation = await this.session!.executeStatement(sql);
    await operation.finished();
    const rows = await operation.fetchAll({ maxRows: options?.maxRows });
    await operation.close().catch(() => undefined);
    const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    const limited = options?.maxRows ? arr.slice(0, options.maxRows) : arr;
    return toQueryResult(limited);
  }

  async listTables(): Promise<TableInfo[]> {
    await this.ensureReady();
    const operation = await this.session!.getTables({});
    await operation.finished();
    const rows = await operation.fetchAll();
    await operation.close().catch(() => undefined);
    const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    const names = new Set<string>();
    for (const r of arr) {
      const t = r.tableName ?? r.TABLE_NAME ?? r.table_name;
      if (t) names.add(String(t));
    }
    return [...names].map((n) => ({ name: n }));
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    return this.run(`SELECT * FROM ${table} LIMIT ${safe}`);
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.session.close().catch(() => undefined);
      this.session = null;
    }
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
  }
}
