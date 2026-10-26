declare module 'duckdb' {
  export interface DuckDbConnection {
    all(
      sql: string,
      callback: (err: Error | null, rows?: Array<Record<string, unknown>>) => void,
    ): void;
    run(sql: string, callback: (err: Error | null) => void): void;
    run(
      sql: string,
      params: unknown[],
      callback: (err: Error | null) => void,
    ): void;
  }

  export interface DuckDbDatabase {
    connect(callback: (err: Error | null, conn: DuckDbConnection) => void): void;
    close(callback?: (err: Error | null) => void): void;
  }

  export class Database implements DuckDbDatabase {
    constructor(path: string, callback?: (err: Error | null) => void);
    connect(callback: (err: Error | null, conn: DuckDbConnection) => void): void;
    close(callback?: (err: Error | null) => void): void;
  }

  const duckdb: { Database: typeof Database };
  export default duckdb;
}
