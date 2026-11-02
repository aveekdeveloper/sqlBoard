import { createConnection, type Connection } from 'mysql2/promise';
import {
  escapeLiteral,
  quoteMysqlQualifiedIdentifier,
  splitTableName,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableDescription,
  type TableInfo,
} from './query-engine.js';

export interface MySqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export class MySqlEngine implements QueryEngine {
  readonly type = 'mysql' as const;

  private conn: Connection | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly config: MySqlConfig, private readonly timeoutMs: number = 30000) {}

  private async ensureReady(): Promise<void> {
    if (this.conn) {
      try {
        await this.conn.ping();
        return;
      } catch {
        this.conn = null;
        this.ready = null;
      }
    }
    if (!this.ready) {
      this.ready = (async () => {
        this.conn = await createConnection({
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user,
          password: this.config.password,
          ssl: this.config.ssl ? {} : undefined,
        });
      })();
    }
    await this.ready;
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    await this.ensureReady();
    let timer: NodeJS.Timeout | undefined;
    try {
      const rowsPromise = this.conn!.query(sql).then((r) => r);
      const result = await Promise.race([
        rowsPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`MySQL query timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
          if (timer && typeof timer.unref === 'function') timer.unref();
        }),
      ]);
      const [rows] = result as unknown as [unknown, unknown];
      const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
      const limited = options?.maxRows ? arr.slice(0, options.maxRows) : arr;
      return toQueryResult(limited);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async listTables(): Promise<TableInfo[]> {
    await this.ensureReady();
    const [rows] = await this.conn!.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
    );
    const arr = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    const tables: TableInfo[] = [];
    for (const row of arr) {
      const name = String(row.table_name ?? row.TABLE_NAME);
      tables.push({ name });
    }
    return tables;
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    return this.run(`SELECT * FROM ${quoteMysqlQualifiedIdentifier(table)} LIMIT ${safe}`);
  }

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;
    const database = parts.length >= 2 ? parts[parts.length - 2] : this.config.database;
    const nameLit = escapeLiteral(tableName);
    const databaseLit = escapeLiteral(database);

    const meta = await this.run(
      `SELECT table_type, table_comment
       FROM information_schema.tables
       WHERE table_schema = ${databaseLit} AND table_name = ${nameLit}
       LIMIT 1`,
    );

    const columnRows = await this.run(
      `SELECT column_name, column_type, is_nullable, column_default, column_key, column_comment
       FROM information_schema.columns
       WHERE table_schema = ${databaseLit} AND table_name = ${nameLit}
       ORDER BY ordinal_position`,
    );

    const columns = columnRows.rows.map((row) => ({
      name: String(row.column_name ?? row.COLUMN_NAME),
      type: String(row.column_type ?? row.COLUMN_TYPE ?? 'unknown'),
      nullable: String(row.is_nullable ?? row.IS_NULLABLE ?? 'YES').toUpperCase() === 'YES',
      primaryKey: String(row.column_key ?? row.COLUMN_KEY ?? '').toUpperCase() === 'PRI',
      default: row.column_default == null ? null : String(row.column_default),
      comment:
        row.column_comment == null || String(row.column_comment) === ''
          ? null
          : String(row.column_comment),
    }));

    const foreignKeys: NonNullable<TableDescription['foreignKeys']> = [];
    try {
      const fkRows = await this.run(
        `SELECT constraint_name, column_name, referenced_table_schema,
                referenced_table_name, referenced_column_name
         FROM information_schema.key_column_usage
         WHERE table_schema = ${databaseLit} AND table_name = ${nameLit}
           AND referenced_table_name IS NOT NULL
         ORDER BY constraint_name, ordinal_position`,
      );
      for (const row of fkRows.rows) {
        foreignKeys.push({
          column: String(row.column_name ?? row.COLUMN_NAME),
          referencedTable: `${String(
            row.referenced_table_schema ?? row.REFERENCED_TABLE_SCHEMA ?? database,
          )}.${String(row.referenced_table_name ?? row.REFERENCED_TABLE_NAME)}`,
          referencedColumn: String(
            row.referenced_column_name ?? row.REFERENCED_COLUMN_NAME,
          ),
          constraintName: String(row.constraint_name ?? row.CONSTRAINT_NAME),
        });
      }
    } catch {
      // Foreign-key metadata is best-effort.
    }

    const tableType = String(meta.rows[0]?.table_type ?? meta.rows[0]?.TABLE_TYPE ?? '');
    const kind: TableDescription['kind'] = /VIEW/i.test(tableType) ? 'view' : tableType ? 'table' : 'unknown';

    return {
      name: tableName,
      schema: database,
      kind,
      comment:
        meta.rows[0]?.table_comment == null || String(meta.rows[0].table_comment) === ''
          ? null
          : String(meta.rows[0].table_comment),
      columns,
      primaryKey: columns.filter((column) => column.primaryKey).map((column) => column.name),
      foreignKeys,
    };
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.end().catch(() => undefined);
      this.conn = null;
      this.ready = null;
    }
  }
}
