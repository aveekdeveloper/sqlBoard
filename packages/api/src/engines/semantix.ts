import { ApiError } from '../errors.js';
import type {
  QueryEngine,
  QueryResult,
  RunOptions,
  TableDescription,
  TableInfo,
} from './query-engine.js';
import { toQueryResult, escapeLiteral, quoteIdentifier, splitTableName } from './query-engine.js';

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

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;
    let schema = parts.length >= 2 ? parts[parts.length - 2] : null;
    if (!schema) {
      try {
        const current = await this.run('SELECT current_schema() AS schema_name');
        schema = current.rows[0]?.schema_name
          ? String(current.rows[0].schema_name)
          : null;
      } catch {
        schema = null;
      }
    }

    const nameLit = escapeLiteral(tableName);
    const schemaFilter = schema ? ` AND table_schema = ${escapeLiteral(schema)}` : '';
    const constraintSchemaFilter = schema
      ? ` AND tc.table_schema = ${escapeLiteral(schema)}`
      : '';

    const columnRows = await this.run(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = ${nameLit}${schemaFilter}
       ORDER BY ordinal_position`,
    );

    const columns = columnRows.rows.map((row) => ({
      name: String(row.column_name),
      type: String(row.data_type ?? 'unknown'),
      nullable: String(row.is_nullable ?? 'YES').toUpperCase() === 'YES',
      default: row.column_default == null ? null : String(row.column_default),
      comment: null,
    }));

    let kind: TableDescription['kind'] = 'unknown';
    try {
      const meta = await this.run(
        `SELECT table_type FROM information_schema.tables
         WHERE table_name = ${nameLit}${schemaFilter}
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
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_name = ${nameLit}${constraintSchemaFilter}
         ORDER BY kcu.ordinal_position`,
      );
      for (const row of pkRows.rows) primaryKey.push(String(row.column_name));
    } catch {
      // Constraint metadata is best-effort.
    }

    const foreignKeys: NonNullable<TableDescription['foreignKeys']> = [];
    try {
      const fkRows = await this.run(
        `SELECT kcu.constraint_name, kcu.column_name,
                ccu.table_schema AS ref_schema, ccu.table_name AS ref_table,
                ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_name = ${nameLit}${constraintSchemaFilter}
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
      kind,
      comment: null,
      columns,
      primaryKey,
      foreignKeys,
    };
  }
}
