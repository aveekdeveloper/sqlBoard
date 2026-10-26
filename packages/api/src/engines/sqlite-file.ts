import Database from 'better-sqlite3';
import { queryFailed } from '../errors.js';
import {
  quoteIdentifier,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
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
      `SELECT * FROM ${quoteIdentifier(table)} LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
    );
  }
}
