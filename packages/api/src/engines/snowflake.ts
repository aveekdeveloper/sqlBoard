import snowflake from 'snowflake-sdk';
import {
  escapeLiteral,
  quoteIdentifier,
  splitTableName,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableDescription,
  type TableInfo,
} from './query-engine.js';

export interface SnowflakeConfig {
  account: string;
  user: string;
  password: string;
  warehouse?: string;
  database?: string;
  schema?: string;
}

export class SnowflakeEngine implements QueryEngine {
  readonly type = 'snowflake' as const;

  private conn: snowflake.Connection | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly config: SnowflakeConfig, private readonly timeoutMs: number = 30000) {
    snowflake.configure({ logLevel: 'ERROR', logFilePath: undefined, additionalLogToConsole: false });
  }

  private async ensureReady(): Promise<void> {
    if (this.conn) return;
    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        const connection = snowflake.createConnection({
          account: this.config.account,
          username: this.config.user,
          password: this.config.password,
          warehouse: this.config.warehouse,
          database: this.config.database,
          schema: this.config.schema,
        });
        connection.connect((err) => {
          if (err) {
            reject(new Error(err.message));
            return;
          }
          this.conn = connection;
          resolve();
        });
      });
    }
    await this.ready;
  }

  private async execute(sql: string): Promise<Array<Record<string, unknown>>> {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      this.conn!.execute({
        sqlText: sql,
        complete: (err, _stmt, rows) => {
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve((rows ?? []) as Array<Record<string, unknown>>);
        },
      });
    });
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const rows = await Promise.race([
        this.execute(sql),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Snowflake query timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
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
      `SELECT table_name FROM information_schema.tables WHERE table_schema = CURRENT_SCHEMA() ORDER BY table_name`,
    );
    return rows.map((r) => ({ name: String(r.table_name ?? r.TABLE_NAME) }));
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    const safe = Math.max(1, Math.min(limit, 5000));
    return this.run(`SELECT * FROM ${table} LIMIT ${safe}`);
  }

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;
    const schema = parts.length >= 2 ? parts[parts.length - 2] : this.config.schema;
    const database = parts.length >= 3 ? parts[parts.length - 3] : this.config.database;
    const infoSchema = database
      ? `${quoteIdentifier(database)}.INFORMATION_SCHEMA`
      : 'INFORMATION_SCHEMA';
    const nameLit = escapeLiteral(tableName);
    const schemaLit = schema ? escapeLiteral(schema) : null;
    const schemaFilter = schemaLit ? ` AND table_schema = ${schemaLit}` : '';
    const constraintSchemaFilter = schemaLit ? ` AND tc.table_schema = ${schemaLit}` : '';

    const columnRows = await this.run(
      `SELECT column_name, data_type, is_nullable, column_default, comment
       FROM ${infoSchema}.COLUMNS
       WHERE UPPER(table_name) = UPPER(${nameLit})${schemaFilter}
       ORDER BY ordinal_position`,
    );

    const columns = columnRows.rows.map((row) => ({
      name: String(row.COLUMN_NAME ?? row.column_name),
      type: String(row.DATA_TYPE ?? row.data_type ?? 'unknown'),
      nullable: String(row.IS_NULLABLE ?? row.is_nullable ?? 'YES').toUpperCase() === 'YES',
      default: row.COLUMN_DEFAULT == null ? null : String(row.COLUMN_DEFAULT),
      comment:
        row.COMMENT == null || String(row.COMMENT) === '' ? null : String(row.COMMENT),
    }));

    let kind: TableDescription['kind'] = 'unknown';
    let comment: string | null = null;
    try {
      const meta = await this.run(
        `SELECT table_type, comment FROM ${infoSchema}.TABLES
         WHERE UPPER(table_name) = UPPER(${nameLit})${schemaFilter}
         LIMIT 1`,
      );
      const tableType = String(meta.rows[0]?.TABLE_TYPE ?? '');
      comment =
        meta.rows[0]?.COMMENT == null || String(meta.rows[0].COMMENT) === ''
          ? null
          : String(meta.rows[0].COMMENT);
      kind = /VIEW/i.test(tableType) ? 'view' : tableType ? 'table' : 'unknown';
    } catch {
      // Table metadata is best-effort.
    }

    const primaryKey: string[] = [];
    const foreignKeys: NonNullable<TableDescription['foreignKeys']> = [];
    try {
      const pkRows = await this.run(
        `SELECT kcu.column_name
         FROM ${infoSchema}.TABLE_CONSTRAINTS tc
         JOIN ${infoSchema}.KEY_COLUMN_USAGE kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND UPPER(tc.table_name) = UPPER(${nameLit})${constraintSchemaFilter}
         ORDER BY kcu.ordinal_position`,
      );
      for (const row of pkRows.rows) primaryKey.push(String(row.COLUMN_NAME));
    } catch {
      // Constraint metadata is best-effort.
    }

    try {
      const fkRows = await this.run(
        `SELECT kcu.constraint_name, kcu.column_name,
                ccu.table_schema AS ref_schema, ccu.table_name AS ref_table,
                ccu.column_name AS ref_column
         FROM ${infoSchema}.TABLE_CONSTRAINTS tc
         JOIN ${infoSchema}.KEY_COLUMN_USAGE kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         JOIN ${infoSchema}.CONSTRAINT_COLUMN_USAGE ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND UPPER(tc.table_name) = UPPER(${nameLit})${constraintSchemaFilter}
         ORDER BY kcu.constraint_name, kcu.ordinal_position`,
      );
      for (const row of fkRows.rows) {
        foreignKeys.push({
          column: String(row.COLUMN_NAME),
          referencedTable: `${String(row.REF_SCHEMA)}.${String(row.REF_TABLE)}`,
          referencedColumn: String(row.REF_COLUMN),
          constraintName: String(row.CONSTRAINT_NAME),
        });
      }
    } catch {
      // Constraint metadata is best-effort.
    }

    return {
      name: tableName,
      schema: schema ?? null,
      catalog: database ?? null,
      kind,
      comment,
      columns,
      primaryKey,
      foreignKeys,
    };
  }

  async close(): Promise<void> {
    if (this.conn) {
      await new Promise<void>((resolve) => {
        this.conn!.destroy((err) => {
          if (err) console.error('snowflake close error:', err.message);
          resolve();
        });
      });
      this.conn = null;
      this.ready = null;
    }
  }
}
