import { DBSQLClient } from '@databricks/sql';
import {
  splitTableName,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableDescription,
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

  private async reset(): Promise<void> {
    await this.session?.close().catch(() => undefined);
    await this.client?.close().catch(() => undefined);
    this.session = null;
    this.client = null;
  }

  private isStaleSessionError(error: unknown): boolean {
    const message = String((error as Error)?.message ?? error).toLowerCase();
    return (
      message.includes('bad http status code: 400') ||
      message.includes('bad http status code: 401') ||
      message.includes('invalid session') ||
      message.includes('session is closed') ||
      message.includes('unauthorized') ||
      message.includes('token')
    );
  }

  private async runOnce(sql: string, options?: RunOptions): Promise<QueryResult> {
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

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    try {
      return await this.runOnce(sql, options);
    } catch (error) {
      // A cached Databricks session can go stale (warehouse restart, token
      // rotation). Reconnect once before surfacing the error.
      if (!this.isStaleSessionError(error)) throw error;
      await this.reset();
      return await this.runOnce(sql, options);
    }
  }

  private async listTablesOnce(): Promise<TableInfo[]> {
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

  async listTables(): Promise<TableInfo[]> {
    try {
      return await this.listTablesOnce();
    } catch (error) {
      if (!this.isStaleSessionError(error)) throw error;
      await this.reset();
      return await this.listTablesOnce();
    }
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    const qualified = this.qualifyTable(table);
    return this.run(`SELECT * FROM ${qualified} LIMIT ${safe}`);
  }

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;
    const qualified = this.qualifyTable(table);

    const result = await this.run(`DESCRIBE TABLE EXTENDED ${qualified}`);

    const columns: TableDescription['columns'] = [];
    const details = new Map<string, string>();
    let inDetails = false;
    for (const row of result.rows) {
      const name = String(row.col_name ?? row.COLUMN_NAME ?? '').trim();
      const type = String(row.data_type ?? row.DATA_TYPE ?? '').trim();
      const comment = row.comment ?? row.COMMENT;
      if (!name) continue;
      if (name.startsWith('#')) {
        inDetails = true;
        continue;
      }
      if (inDetails) {
        if (name && type) details.set(name, type);
        continue;
      }
      if (!type) continue;
      columns.push({
        name,
        type,
        nullable: true,
        default: null,
        comment: comment == null || String(comment) === '' ? null : String(comment),
      });
    }

    const detailType = String(details.get('Type') ?? '').toUpperCase();
    const kind: TableDescription['kind'] = detailType.includes('VIEW')
      ? 'view'
      : detailType
        ? 'table'
        : 'unknown';

    return {
      name: tableName,
      schema: parts.length >= 2 ? parts[parts.length - 2] : this.schema ?? null,
      catalog: parts.length >= 3 ? parts[parts.length - 3] : this.catalog ?? null,
      kind,
      comment: null,
      columns,
      primaryKey: [],
      foreignKeys: [],
    };
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
