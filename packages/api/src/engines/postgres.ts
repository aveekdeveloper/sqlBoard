import { Pool } from 'pg';
import { queryFailed } from '../errors.js';
import {
  escapeLiteral,
  quoteQualifiedIdentifier,
  splitTableName,
  toQueryResult,
  type QueryEngine,
  type QueryResult,
  type RunOptions,
  type TableDescription,
  type TableInfo,
} from './query-engine.js';

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export class PostgresEngine implements QueryEngine {
  readonly type = 'postgres' as const;

  private readonly pool: Pool;

  constructor(config: PostgresConfig, timeoutMs: number) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      statement_timeout: timeoutMs,
      max: 5,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async run(sql: string, options?: RunOptions): Promise<QueryResult> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql);
      const rows = result.rows as Array<Record<string, unknown>>;
      const limited = options?.maxRows ? rows.slice(0, options.maxRows) : rows;
      return toQueryResult(limited);
    } catch (error) {
      throw queryFailed(`Postgres query failed: ${String((error as Error).message)}`);
    } finally {
      client.release();
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = await this.run(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tables: TableInfo[] = [];
    for (const row of rows.rows) {
      const name = String(row.table_name);
      const columns = await this.run(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ${`'${name.replace(/'/g, "''")}'`}
         ORDER BY ordinal_position`,
      );
      tables.push({ name, columns: columns.rows.map((c) => String(c.column_name)) });
    }
    return tables;
  }

  async preview(table: string, limit = 100): Promise<QueryResult> {
    return this.run(
      `SELECT * FROM ${quoteQualifiedIdentifier(table)} LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
    );
  }

  async describeTable(table: string): Promise<TableDescription> {
    const parts = splitTableName(table);
    const tableName = parts[parts.length - 1] ?? table;
    let schemaName = parts.length >= 2 ? parts[parts.length - 2] : undefined;
    if (!schemaName) {
      const current = await this.run('SELECT current_schema() AS schema_name');
      schemaName = String(current.rows[0]?.schema_name ?? 'public');
    }
    const nameLit = escapeLiteral(tableName);
    const schemaLit = escapeLiteral(schemaName);

    const meta = await this.run(
      `SELECT c.relkind AS relkind, obj_description(c.oid, 'pg_class') AS comment
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = ${nameLit} AND n.nspname = ${schemaLit}
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       LIMIT 1`,
    );

    const columnRows = await this.run(
      `SELECT
         a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS data_type,
         NOT a.attnotnull AS is_nullable,
         pg_get_expr(d.adbin, d.adrelid) AS column_default,
         col_description(a.attrelid, a.attnum) AS comment,
         EXISTS (
           SELECT 1 FROM pg_index i
           WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)
         ) AS is_primary_key
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE c.relname = ${nameLit} AND n.nspname = ${schemaLit}
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
    );

    const columns = columnRows.rows.map((row) => ({
      name: String(row.column_name),
      type: String(row.data_type ?? 'unknown'),
      nullable: Boolean(row.is_nullable),
      primaryKey: Boolean(row.is_primary_key),
      default: row.column_default == null ? null : String(row.column_default),
      comment: row.comment == null ? null : String(row.comment),
    }));

    const foreignKeys: NonNullable<TableDescription['foreignKeys']> = [];
    try {
      const fkRows = await this.run(
        `SELECT
           con.conname AS constraint_name,
           att.attname AS column_name,
           fn.nspname AS ref_schema,
           fc.relname AS ref_table,
           fatt.attname AS ref_column
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
         JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
         JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = fk.attnum
         JOIN pg_class fc ON fc.oid = con.confrelid
         JOIN pg_namespace fn ON fn.oid = fc.relnamespace
         WHERE con.contype = 'f' AND c.relname = ${nameLit} AND n.nspname = ${schemaLit}
         ORDER BY con.conname, k.ord`,
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
      // Foreign-key metadata is best-effort; some managed databases restrict it.
    }

    const relkind = meta.rows[0]?.relkind ? String(meta.rows[0].relkind) : undefined;
    const kind: TableDescription['kind'] =
      relkind === 'v'
        ? 'view'
        : relkind === 'm'
          ? 'materialized_view'
          : relkind
            ? 'table'
            : 'unknown';

    return {
      name: tableName,
      schema: schemaName,
      kind,
      comment: meta.rows[0]?.comment == null ? null : String(meta.rows[0].comment),
      columns,
      primaryKey: columns.filter((column) => column.primaryKey).map((column) => column.name),
      foreignKeys,
    };
  }
}
