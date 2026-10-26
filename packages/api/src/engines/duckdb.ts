import duckdb, { type DuckDbConnection } from 'duckdb';
import {
  quoteIdentifier,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableInfo,
} from './query-engine.js';

const escapeLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const columnTypeOf = (rows: Array<Record<string, unknown>>, column: string): string => {
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' && Number.isFinite(value)) return 'DOUBLE';
    if (typeof value === 'boolean') return 'BOOLEAN';
    return 'VARCHAR';
  }
  return 'VARCHAR';
};

export class DuckDbEngine implements QueryEngine {
  readonly type = 'duckdb' as const;

  private conn: DuckDbConnection | null = null;
  private connPromise: Promise<DuckDbConnection> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dbPath: string) {}

  private connection(): Promise<DuckDbConnection> {
    if (this.conn) return Promise.resolve(this.conn);
    if (!this.connPromise) {
      this.connPromise = new Promise((resolve, reject) => {
        const db = new duckdb.Database(this.dbPath, (err: Error | null) => {
          if (err) reject(err);
        });
        db.connect((err: Error | null, conn: DuckDbConnection) => {
          if (err) reject(err);
          else resolve(conn);
        });
      });
      this.connPromise.catch(() => {
        this.connPromise = null;
      });
    }
    return this.connPromise;
  }

  private async all(sql: string): Promise<Array<Record<string, unknown>>> {
    const conn = await this.connection();
    return new Promise((resolve, reject) => {
      conn.all(sql, (err: Error | null, rows?: Array<Record<string, unknown>>) => {
        if (err) reject(new Error(String(err.message ?? err)));
        else resolve(rows ?? []);
      });
    });
  }

  private async exec(sql: string, params?: unknown[]): Promise<void> {
    const conn = await this.connection();
    return new Promise((resolve, reject) => {
      const callback = (err: Error | null) => {
        if (err) reject(new Error(String(err.message ?? err)));
        else resolve();
      };
      if (params) conn.run(sql, params, callback);
      else conn.run(sql, callback);
    });
  }

  async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(operation, operation);
    this.writeChain = result.catch(() => undefined);
    return result;
  }

  async execute(sql: string): Promise<void> {
    await this.withWriteLock(() => this.exec(sql));
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    const rows = await this.all(sql);
    const limited = options?.maxRows ? rows.slice(0, options.maxRows) : rows;
    return toQueryResult(limited);
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = await this.all(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'main' AND table_name NOT LIKE 'cache_%'
       ORDER BY table_name`,
    );
    const tables: TableInfo[] = [];
    for (const row of rows) {
      const name = String(row.table_name);
      tables.push({ name, columns: await this.columnNames(name) });
    }
    return tables;
  }

  private async columnNames(table: string): Promise<string[]> {
    const rows = await this.all(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'main' AND table_name = ${escapeLiteral(table)}
       ORDER BY ordinal_position`,
    );
    return rows.map((row) => String(row.column_name));
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    return this.run(
      `SELECT * FROM ${quoteIdentifier(table)} LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
    );
  }

  async countRows(table: string): Promise<number> {
    const rows = await this.all(`SELECT COUNT(*) AS c FROM ${quoteIdentifier(table)}`);
    const count = rows[0]?.c;
    const numeric = typeof count === 'bigint' ? Number(count) : Number(count);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  async dropTable(table: string): Promise<void> {
    await this.withWriteLock(() => this.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`));
  }

  async ingestFile(filePath: string, table: string): Promise<void> {
    const extension = filePath.toLowerCase().split('.').pop() ?? '';
    const reader =
      extension === 'parquet'
        ? 'read_parquet'
        : extension === 'json'
          ? 'read_json_auto'
          : 'read_csv_auto';
    await this.dropTable(table);
    await this.withWriteLock(() =>
      this.exec(
        `CREATE TABLE ${quoteIdentifier(table)} AS
         SELECT * FROM ${reader}(${escapeLiteral(filePath)})`,
      ),
    );
  }

  async materializeRows(
    table: string,
    columns: string[],
    rows: Array<Record<string, unknown>>,
  ): Promise<void> {
    await this.dropTable(table);
    const columnDefs = columns
      .map((column) => `${quoteIdentifier(column)} ${columnTypeOf(rows, column)}`)
      .join(', ');
    await this.withWriteLock(() =>
      this.exec(`CREATE TABLE ${quoteIdentifier(table)} (${columnDefs})`),
    );

    const batchSize = 200;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const tuples = batch
        .map(
          (row) =>
            `(${columns
              .map((column) => {
                const value = row[column];
                if (value === null || value === undefined) return 'NULL';
                if (typeof value === 'number' || typeof value === 'boolean') return '?';
                return '?';
              })
              .join(', ')})`,
        )
        .join(', ');
      const params: unknown[] = [];
      for (const row of batch) {
        for (const column of columns) {
          const value = row[column];
          if (value === null || value === undefined) params.push(null);
          else if (typeof value === 'number' || typeof value === 'boolean') params.push(value);
          else if (typeof value === 'bigint') params.push(Number(value));
          else if (typeof value === 'object') params.push(JSON.stringify(value));
          else params.push(String(value));
        }
      }
      await this.withWriteLock(() =>
        this.exec(
          `INSERT INTO ${quoteIdentifier(table)} (${columns
            .map(quoteIdentifier)
            .join(', ')}) VALUES ${tuples}`,
          params,
        ),
      );
    }
  }
}
