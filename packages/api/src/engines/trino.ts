import {
  escapeLiteral,
  splitTableName,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableDescription,
  type TableInfo,
} from './query-engine.js';

export interface TrinoConfig {
  host: string;
  port: number;
  catalog: string;
  schema: string;
  user: string;
  password: string;
  ssl: boolean;
}

export class TrinoEngine implements QueryEngine {
  readonly type = 'trino' as const;

  constructor(private readonly config: TrinoConfig, private readonly timeoutMs: number = 30000) {}

  private baseUrl(): string {
    const protocol = this.config.ssl ? 'https' : 'http';
    return `${protocol}://${this.config.host}:${this.config.port}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'X-Trino-User': this.config.user,
      'X-Trino-Catalog': this.config.catalog,
      'X-Trino-Schema': this.config.schema,
      'Accept': 'application/json',
    };
    if (this.config.password) {
      const creds = Buffer.from(`${this.config.user}:${this.config.password}`).toString('base64');
      h['Authorization'] = `Basic ${creds}`;
    }
    return h;
  }

  private async execute(sql: string): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(`${this.baseUrl()}/v1/statement`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'text/plain' },
      body: sql,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Trino query failed (${res.status}): ${text}`);
    }
    let data = await res.json() as { data?: unknown[][]; columns?: { name: string }[]; nextUri?: string; error?: { message: string } };
    const columns = (data.columns ?? []).map((c) => c.name);
    const rows: Array<Record<string, unknown>> = [];
    const append = (d: typeof data) => {
      if (d.data) {
        for (const row of d.data) {
          const obj: Record<string, unknown> = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          rows.push(obj);
        }
      }
    };
    append(data);
    while (data.nextUri) {
      const next = await fetch(data.nextUri, { headers: this.headers() });
      if (!next.ok) throw new Error(`Trino nextUri failed (${next.status})`);
      data = await next.json() as typeof data;
      if (data.error) throw new Error(data.error.message);
      append(data);
    }
    if (data.error) throw new Error(data.error.message);
    return rows;
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const rows = await Promise.race([
        this.execute(sql),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Trino query timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
          if (timer && typeof timer.unref === 'function') timer.unref();
        }),
      ]);
      const limited = options?.maxRows ? rows.slice(0, options.maxRows) : rows;
      return toQueryResult(limited);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = await this.execute(
      `SHOW TABLES FROM ${this.config.catalog}.${this.config.schema}`,
    );
    return rows.map((r) => ({ name: String(Object.values(r)[0]) }));
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    return this.run(`SELECT * FROM ${table} LIMIT ${safe}`);
  }

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;
    const schema =
      parts.length >= 2 ? parts[parts.length - 2] : this.config.schema;
    const catalog =
      parts.length >= 3 ? parts[parts.length - 3] : this.config.catalog;
    const infoSchema = `${catalog}.information_schema`;
    const nameLit = escapeLiteral(tableName);
    const schemaLit = escapeLiteral(schema);

    const columnRows = await this.run(
      `SELECT column_name, data_type, is_nullable, column_default, comment
       FROM ${infoSchema}.columns
       WHERE table_schema = ${schemaLit} AND table_name = ${nameLit}
       ORDER BY ordinal_position`,
    );

    const columns = columnRows.rows.map((row) => ({
      name: String(row.column_name),
      type: String(row.data_type ?? 'unknown'),
      nullable: String(row.is_nullable ?? 'YES').toUpperCase() === 'YES',
      default: row.column_default == null ? null : String(row.column_default),
      comment: row.comment == null || String(row.comment) === '' ? null : String(row.comment),
    }));

    let kind: TableDescription['kind'] = 'unknown';
    try {
      const meta = await this.run(
        `SELECT table_type FROM ${infoSchema}.tables
         WHERE table_schema = ${schemaLit} AND table_name = ${nameLit}
         LIMIT 1`,
      );
      const tableType = String(meta.rows[0]?.table_type ?? '');
      kind = /VIEW/i.test(tableType) ? 'view' : tableType ? 'table' : 'unknown';
    } catch {
      // Table metadata is best-effort.
    }

    const primaryKey: string[] = [];
    try {
      const pkRows = await this.run(
        `SELECT kcu.column_name
         FROM ${infoSchema}.table_constraints tc
         JOIN ${infoSchema}.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = ${schemaLit}
           AND tc.table_name = ${nameLit}
         ORDER BY kcu.ordinal_position`,
      );
      for (const row of pkRows.rows) primaryKey.push(String(row.column_name));
    } catch {
      // Constraint metadata is best-effort; not all connectors expose it.
    }

    const foreignKeys: NonNullable<TableDescription['foreignKeys']> = [];
    try {
      const fkRows = await this.run(
        `SELECT kcu.constraint_name, kcu.column_name,
                ccu.table_schema AS ref_schema, ccu.table_name AS ref_table,
                ccu.column_name AS ref_column
         FROM ${infoSchema}.table_constraints tc
         JOIN ${infoSchema}.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         JOIN ${infoSchema}.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = ${schemaLit}
           AND tc.table_name = ${nameLit}
         ORDER BY kcu.constraint_name, kcu.ordinal_position`,
      );
      for (const row of fkRows.rows) {
        foreignKeys.push({
          column: String(row.column_name),
          referencedTable: `${String(row.ref_schema)}.${String(row.ref_table)}`,
          referencedColumn: String(row.ref_column),
          constraintName: String(row.constraint_name),
        });
      }
    } catch {
      // Constraint metadata is best-effort.
    }

    return {
      name: tableName,
      schema,
      catalog,
      kind,
      comment: null,
      columns,
      primaryKey,
      foreignKeys,
    };
  }
}
