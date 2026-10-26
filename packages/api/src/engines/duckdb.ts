import duckdb from 'duckdb';
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

  private db: any = null;
  private conn: any = null;
  private ready: Promise<void> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dbPath: string) {}

  private async ensureReady(): Promise<void> {
    // If we have a connection, verify it's alive
    if (this.conn) {
      try {
        await this.ping();
        return;
      } catch {
        // Connection is dead — recreate
        this.conn = null;
        this.db = null;
        this.ready = null;
      }
    }

    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        const db = new duckdb.Database(this.dbPath, (err: Error | null) => {
          if (err) {
            reject(err);
            return;
          }
          this.db = db;
          this.conn = db.connect();
          resolve();
        });
      });
    }

    await this.ready;
  }

  private async ping(): Promise<void> {
    if (!this.conn) throw new Error('no connection');
    return new Promise((resolve, reject) => {
      this.conn.all('SELECT 1 AS ok', (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async all(sql: string): Promise<Array<Record<string, unknown>>> {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      this.conn.all(sql, (err: Error | null, rows?: Array<Record<string, unknown>>) => {
        if (err) {
          // If connection error, mark as dead for next call
          const msg = String(err.message ?? err);
          if (/never established|closed already|Connection Error/i.test(msg)) {
            this.conn = null;
            this.db = null;
            this.ready = null;
          }
          reject(new Error(msg));
        } else {
          resolve(rows ?? []);
        }
      });
    });
  }

  private async exec(sql: string, params?: unknown[]): Promise<void> {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const callback = (err: Error | null) => {
        if (err) {
          const msg = String(err.message ?? err);
          if (/never established|closed already|Connection Error/i.test(msg)) {
            this.conn = null;
            this.db = null;
            this.ready = null;
          }
          reject(new Error(msg));
        } else {
          resolve();
        }
      };
      if (params && params.length > 0) this.conn.run(sql, ...params, callback);
      else this.conn.run(sql, callback);
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
    try {
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
    } catch (error) {
      // Fallback: if information_schema fails, try sqlite_master equivalent
      console.error('listTables failed:', (error as Error).message);
      return [];
    }
  }

  private async columnNames(table: string): Promise<string[]> {
    try {
      const rows = await this.all(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'main' AND table_name = ${escapeLiteral(table)}
         ORDER BY ordinal_position`,
      );
      return rows.map((row) => String(row.column_name));
    } catch {
      return [];
    }
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
    if (extension === 'parquet') {
      await this.dropTable(table);
      await this.withWriteLock(() =>
        this.exec(
          `CREATE TABLE ${quoteIdentifier(table)} AS
           SELECT * FROM read_parquet(${escapeLiteral(filePath)})`,
        ),
      );
      return;
    }

    const fs = await import('node:fs');
    const raw = fs.readFileSync(filePath, 'utf8');
    const { columns, rows } = parseDelimited(raw, extension === 'json' ? 'json' : 'csv');
    await this.materializeRows(table, columns, rows);
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

function parseDelimited(
  raw: string,
  format: 'csv' | 'json',
): { columns: string[]; rows: Array<Record<string, unknown>> } {
  if (format === 'json') {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const columns: string[] = [];
    for (const row of rows) {
      for (const key of Object.keys(row ?? {})) {
        if (!columns.includes(key)) columns.push(key);
      }
    }
    return { columns, rows };
  }

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) return { columns: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          cells.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    cells.push(current);
    return cells;
  };

  const header = parseRow(nonEmpty[0]);
  const columns = header.map((h) => h.trim());
  const rows: Array<Record<string, unknown>> = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = parseRow(nonEmpty[i]);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < columns.length; j++) {
      const rawValue = cells[j] ?? '';
      const trimmed = rawValue.trim();
      if (trimmed === '') {
        row[columns[j]] = null;
      } else if (/^-?\d+$/.test(trimmed)) {
        row[columns[j]] = Number(trimmed);
      } else if (/^-?\d+\.\d+$/.test(trimmed)) {
        row[columns[j]] = Number(trimmed);
      } else if (trimmed.toLowerCase() === 'true') {
        row[columns[j]] = true;
      } else if (trimmed.toLowerCase() === 'false') {
        row[columns[j]] = false;
      } else {
        row[columns[j]] = trimmed;
      }
    }
    rows.push(row);
  }

  return { columns, rows };
}
