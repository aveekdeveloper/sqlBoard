import Database from 'better-sqlite3';
import { queryFailed } from '../errors.js';
import {
  quoteIdentifier,
  quoteQualifiedIdentifier,
  splitTableName,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableDescription,
  type TableInfo,
} from './query-engine.js';

export class SqliteFileEngine implements QueryEngine {
  readonly type = 'sqlite' as const;

  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath, { readonly: true, fileMustExist: true });
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    const trimmed = sql.trim().replace(/;+\s*$/, '');
    try {
      const statement = this.db.prepare(trimmed);
      const rows = statement.all() as Array<Record<string, unknown>>;
      const limited = options?.maxRows ? rows.slice(0, options.maxRows) : rows;
      return toQueryResult(limited);
    } catch (error) {
      const message = String((error as Error).message);
      if (/does not return data/i.test(message)) {
        this.db.prepare(trimmed).run();
        return { columns: [], rows: [], rowCount: 0 };
      }
      throw queryFailed(`SQLite query failed: ${message}`);
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = this.db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    const tables: TableInfo[] = [];
    for (const row of rows) {
      const info = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(row.name)})`).all() as Array<{
        name: string;
      }>;
      tables.push({ name: row.name, columns: info.map((column) => column.name) });
    }
    return tables;
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    return this.run(
      `SELECT * FROM ${quoteQualifiedIdentifier(table)} LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
    );
  }

  async close(): Promise<void> {
    if (this.db.open) this.db.close();
  }

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;

    const columnRows = this.db
      .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;

    const columns = columnRows.map((row) => ({
      name: row.name,
      type: row.type || 'unknown',
      nullable: !row.notnull,
      primaryKey: row.pk > 0,
      default: row.dflt_value == null ? null : String(row.dflt_value),
      comment: null,
    }));

    const foreignKeys: NonNullable<TableDescription['foreignKeys']> = [];
    try {
      const fkRows = this.db
        .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`)
        .all() as Array<{ id: number; table: string; from: string; to: string }>;
      for (const row of fkRows) {
        foreignKeys.push({
          column: row.from,
          referencedTable: row.table,
          referencedColumn: row.to,
          constraintName: `fk_${row.id}`,
        });
      }
    } catch {
      // Foreign-key metadata is best-effort.
    }

    let kind: TableDescription['kind'] = 'unknown';
    try {
      const meta = this.db
        .prepare(`SELECT type FROM sqlite_master WHERE name = ? LIMIT 1`)
        .get(tableName) as { type?: string } | undefined;
      kind = meta?.type === 'view' ? 'view' : meta?.type === 'table' ? 'table' : 'unknown';
    } catch {
      // Table metadata is best-effort.
    }

    return {
      name: tableName,
      schema: parts.length >= 2 ? parts[parts.length - 2] : null,
      kind,
      comment: null,
      columns,
      primaryKey: columns.filter((column) => column.primaryKey).map((column) => column.name),
      foreignKeys,
    };
  }
}
