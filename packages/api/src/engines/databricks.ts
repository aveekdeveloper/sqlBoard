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
  catalog?: string;
  schema?: string;
}

export class DatabricksEngine implements QueryEngine {
  readonly type = 'databricks' as const;

  private client: DBSQLClient | null = null;
  private session: Awaited<ReturnType<DBSQLClient['openSession']>> | null = null;
  private catalog: string | undefined;
  private schema: string | undefined;

  constructor(private readonly config: DatabricksConfig, private readonly timeoutMs: number = 30000) {
    this.catalog = config.catalog;
    this.schema = config.schema;
  }

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

    // Set default catalog/schema if provided
    if (this.catalog) {
      const op = await this.session.executeStatement(`USE CATALOG ${this.catalog}`);
      await op.finished();
      await op.close().catch(() => undefined);
    }
    if (this.schema) {
      const op = await this.session.executeStatement(`USE SCHEMA ${this.schema}`);
      await op.finished();
      await op.close().catch(() => undefined);
    }
  }

  private qualifyTable(name: string): string {
    if (name.includes('.')) return name;
    const parts: string[] = [];
    if (this.catalog) parts.push(this.catalog);
    if (this.schema && this.schema.toLowerCase() !== 'default') parts.push(this.schema);
    parts.push(name);
    return parts.join('.');
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    await this.ensureReady();
    let timer: NodeJS.Timeout | undefined;
    try {
      const resultPromise = (async () => {
        const operation = await this.session!.executeStatement(sql);
        await operation.finished();
        const rows = await operation.fetchAll({ maxRows: options?.maxRows });
        await operation.close().catch(() => undefined);
        const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
        const limited = options?.maxRows ? arr.slice(0, options.maxRows) : arr;
        return toQueryResult(limited);
      })();
      return await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Databricks query timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
          if (timer && typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listTables(): Promise<TableInfo[]> {
    await this.ensureReady();
    const req: { catalogName?: string; schemaName?: string } = {};
    if (this.catalog) req.catalogName = this.catalog;
    if (this.schema && this.schema.toLowerCase() !== 'default') req.schemaName = this.schema;
    const operation = await this.session!.getTables(req);
    await operation.finished();
    const rows = await operation.fetchAll();
    await operation.close().catch(() => undefined);
    const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    const seen = new Set<string>();
    const result: TableInfo[] = [];
    for (const r of arr) {
      const catalog = String(r.TABLE_CAT ?? r.catalogName ?? r.CATALOG_NAME ?? r.catalog_name ?? this.catalog ?? '');
      const schema = String(r.TABLE_SCHEM ?? r.schemaName ?? r.SCHEMA_NAME ?? r.schema_name ?? this.schema ?? '');
      const table = String(r.TABLE_NAME ?? r.tableName ?? r.TABLE_NAME ?? r.table_name ?? '');
      if (!table) continue;
      const qualified = [catalog, schema, table].filter(Boolean).join('.');
      if (seen.has(qualified)) continue;
      seen.add(qualified);
      result.push({ name: qualified });
    }
    return result;
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    const qualified = this.qualifyTable(table);
    return this.run(`SELECT * FROM ${qualified} LIMIT ${safe}`);
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
