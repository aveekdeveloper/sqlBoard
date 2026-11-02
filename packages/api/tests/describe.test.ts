import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type ServerContext } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/auth/session.js';
import { users } from '../src/db/schema.js';
import { SqliteFileEngine } from '../src/engines/sqlite-file.js';

function createSqliteFile(file: string): void {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      note TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE VIEW order_totals AS
      SELECT customer_id, SUM(total) AS total FROM orders GROUP BY customer_id;
  `);
  db.close();
}

describe('table describe', () => {
  let ctx: ServerContext;
  let dataDir: string;
  let sqlitePath: string;
  let token: string;
  let connectionIds: number[];

  beforeEach(async () => {
    dataDir = `./data-test-describe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    fs.mkdirSync(dataDir, { recursive: true });
    sqlitePath = path.join(dataDir, 'source.sqlite');
    createSqliteFile(sqlitePath);
    connectionIds = [];

    ctx = await buildServer(loadConfig({ dataDir, secretKey: 'test' }));
    await ctx.app.ready();
    await ctx.db.insert(users).values({
      email: 'describe@test.dev',
      passwordHash: hashPassword('pw'),
      role: 'member',
      createdAt: new Date().toISOString(),
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'describe@test.dev', password: 'pw' },
    });
    expect(login.statusCode).toBe(200);
    token = login.json().token as string;
  });

  afterEach(async () => {
    for (const id of connectionIds) {
      await ctx.engineFactory.closeConnection(id);
    }
    await ctx.app.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows may keep the database file open; the temp dir is disposable.
    }
  });

  async function createConnection(name: string): Promise<number> {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/connections',
      headers: { authorization: `Bearer ${token}` },
      payload: { type: 'sqlite', name, path: sqlitePath },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;
    connectionIds.push(id);
    return id;
  }

  it('describes a sqlite table with columns, primary key and foreign keys', async () => {
    const engine = new SqliteFileEngine(sqlitePath);
    try {
      const description = await engine.describeTable('orders');

      expect(description.name).toBe('orders');
      expect(description.kind).toBe('table');
      expect(description.primaryKey).toEqual(['id']);
      expect(description.columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'INTEGER', primaryKey: true }),
          expect.objectContaining({ name: 'customer_id', type: 'INTEGER', nullable: false }),
          expect.objectContaining({ name: 'total', type: 'REAL', default: '0' }),
          expect.objectContaining({ name: 'note', type: 'TEXT', nullable: true }),
        ]),
      );
      expect(description.foreignKeys).toEqual([
        expect.objectContaining({
          column: 'customer_id',
          referencedTable: 'customers',
          referencedColumn: 'id',
        }),
      ]);
    } finally {
      await engine.close();
    }
  });

  it('describes a sqlite view', async () => {
    const engine = new SqliteFileEngine(sqlitePath);
    try {
      const description = await engine.describeTable('order_totals');

      expect(description.kind).toBe('view');
      expect(description.columns.map((column) => column.name)).toEqual(['customer_id', 'total']);
    } finally {
      await engine.close();
    }
  });

  it('exposes describe through the connection API', async () => {
    const connectionId = await createConnection('describe-local');

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/connections/${connectionId}/tables/orders/describe`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('orders');
    expect(body.primaryKey).toEqual(['id']);
    expect(body.columns).toHaveLength(4);
    expect(body.foreignKeys).toHaveLength(1);
  });

  it('requires authentication for describe', async () => {
    const connectionId = await createConnection('describe-private');

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/connections/${connectionId}/tables/orders/describe`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown table', async () => {
    const connectionId = await createConnection('describe-missing');

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/connections/${connectionId}/tables/does_not_exist/describe`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
