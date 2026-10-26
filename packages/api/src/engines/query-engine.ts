import type { ConnectionType } from '@sqlboard/shared';

export interface QueryResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  cached?: boolean;
  staleAt?: string | null;
}

export interface TableInfo {
  name: string;
  columns?: string[];
}

export interface RunOptions {
  maxRows?: number;
}

export interface QueryEngine {
  readonly type: ConnectionType;
  run(sql: string, options?: RunOptions): Promise<QueryResult>;
  listTables(): Promise<TableInfo[]>;
  preview(table: string, limit?: number): Promise<QueryResult>;
}

export function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return value;
}

export function toQueryResult(rows: Array<Record<string, unknown>>): QueryResult {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return {
    columns,
    rows: rows.map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(row)) normalized[key] = normalizeValue(row[key]);
      return normalized;
    }),
    rowCount: rows.length,
  };
}

export const quoteIdentifier = (name: string): string =>
  `"${name.replace(/"/g, '""')}"`;
