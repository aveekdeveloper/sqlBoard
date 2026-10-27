import {
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
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

  constructor(private readonly config: TrinoConfig) {}

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
    const rows = await this.execute(sql);
    const limited = options?.maxRows ? rows.slice(0, options.maxRows) : rows;
    return toQueryResult(limited);
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
}
