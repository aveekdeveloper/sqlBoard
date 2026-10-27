import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type ServerContext } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/auth/session.js';
import { users } from '../src/db/schema.js';

const DATA = [
  { month: 'Jan', total: 5 },
  { month: 'Feb', total: 9 },
  { month: 'Mar', total: 3 },
];

const SQL = ['-- @chart: bar', '-- @x: month', '-- @y: total', 'SELECT 1'].join('\n');

let ctx: ServerContext;
let dataDir: string;
let token: string;

beforeEach(async () => {
  dataDir = `./data-test-compile-${process.pid}-${Date.now()}`;
  ctx = await buildServer(loadConfig({ dataDir, secretKey: 'test' }));
  await ctx.app.ready();
  await ctx.db
    .insert(users)
    .values({
      email: 'compile@test.dev',
      passwordHash: hashPassword('pw'),
      role: 'member',
      createdAt: new Date().toISOString(),
    });
  const login = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'compile@test.dev', password: 'pw' },
  });
  token = login.json().token;
});

afterEach(async () => {
  await ctx.app.close();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the file briefly */
  }
});

async function compile(sql: string, extra: Record<string, unknown> = {}) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/compile',
    headers: { authorization: `Bearer ${token}` },
    payload: { sql, data: DATA, backends: ['echarts'], ...extra },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('compile endpoint theming', () => {
  it('applies a named theme preset from the SQL annotation', async () => {
    const body = await compile(`-- @theme: nyt\n${SQL}`);
    expect(body.compiled.echarts.color[0].toLowerCase()).toBe('#2f6b9a');
  });

  it('applies a custom @colors palette to the returned ECharts option', async () => {
    const body = await compile(`${SQL}\n-- @colors: #111111, #222222, not-a-color`);
    expect(body.compiled.echarts.color).toEqual(['#111111', '#222222']);
    expect(body.echarts.color).toEqual(['#111111', '#222222']);
  });

  it('lets @colors win over the preset palette', async () => {
    const body = await compile(`-- @theme: economist\n${SQL}\n-- @colors: #abc, #123456`);
    expect(body.compiled.echarts.color).toEqual(['#abc', '#123456']);
  });

  it('uses the explicit theme option when the SQL has no annotation', async () => {
    const body = await compile(SQL, { theme: 'powerbi-light' });
    expect(body.compiled.echarts.color[0].toLowerCase()).toBe('#118dff');
  });
});
