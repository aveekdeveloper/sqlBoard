import { ApiError } from '../errors.js';
import type { QueryEngine, QueryResult, RunOptions, TableInfo } from './query-engine.js';
import { toQueryResult, quoteIdentifier } from './query-engine.js';

export interface SemantixConfig {
  url: string;
  token: string;
}

export class SemantixEngine implements QueryEngine {
  readonly type = 'semantix' as const;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: SemantixConfig, timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    const url = `${this.cfg.url.replace(/\/$/, '')}/internal/run`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.cfg.token,
          'x-bi-call': '1',
        },
        body: JSON.stringify({ sql, maxRows: options?.maxRows ?? 5000 }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ApiError(502, 'BI_UPSTREAM', `semantix: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(502, 'QUERY_FAILED', `semantix: ${text || res.statusText}`);
    }
    const body = (await res.json()) as { columns?: string[]; rows?: Array<Record<string, unknown>>; rowCount?: number };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const result = toQueryResult(rows);
    if (Array.isArray(body.columns) && body.columns.length > 0) {
      result.columns = body.columns;
    }
    if (typeof body.rowCount === 'number') {
      result.rowCount = body.rowCount;
    }
    return result;
  }

  async listTables(): Promise<TableInfo[]> {
    const url = `${this.cfg.url.replace(/\/$/, '')}/internal/tables`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.cfg.token,
          'x-bi-call': '1',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { tables?: Array<{ name: string; columns?: string[] }> };
      return Array.isArray(body.tables) ? body.tables : [];
    } catch {
      return [];
    }
  }

  async preview(table: string, limit = 20): Promise<QueryResult> {
    return this.run(`SELECT * FROM ${quoteIdentifier(table)} LIMIT ${limit}`);
  }
}
