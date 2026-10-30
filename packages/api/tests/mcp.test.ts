import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type ServerContext } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/auth/session.js';
import { users } from '../src/db/schema.js';

const PASSWORD = 'test-password';

async function boot(dataDir: string): Promise<ServerContext> {
  const config = loadConfig({ dataDir, secretKey: 'test' });
  const ctx = await buildServer(config);
  await ctx.app.ready();
  return ctx;
}

async function seedUser(ctx: ServerContext, email: string, role: 'admin' | 'member' | 'viewer') {
  await ctx.db.insert(users).values({
    email,
    passwordHash: hashPassword(PASSWORD),
    role,
    tenantId: '00000000-0000-0000-0000-000000000000',
    createdAt: new Date().toISOString(),
  });
}

async function login(ctx: ServerContext, email: string): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

function parseSse(text: string): any {
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  if (!line) return null;
  return JSON.parse(line.replace(/^data:\s*/, ''));
}

describe('mcp transport', () => {
  let ctx: ServerContext;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = `./data-test-mcp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    ctx = await boot(dataDir);
    await seedUser(ctx, 'admin@test.dev', 'admin');
  });

  afterEach(async () => {
    await ctx.app.close();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  });

  it('rejects initialize without credentials with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe(-32001);
  });

  it('rejects initialize with a bad token with 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer sb_does_not_exist' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe(-32001);
  });

  it('initializes and serves list_dashboards with a valid session token', async () => {
    const token = await login(ctx, 'admin@test.dev');
    const init = await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'x-tenant': 'default' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    });
    expect(init.statusCode).toBe(200);
    const sid = init.headers['mcp-session-id'];
    expect(sid).toBeTruthy();

    await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'x-tenant': 'default', 'mcp-session-id': sid },
      payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });

    const call = await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'x-tenant': 'default', 'mcp-session-id': sid },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_dashboards', arguments: {} } },
    });
    expect(call.statusCode).toBe(200);
    const parsed = parseSse(call.payload);
    expect(parsed?.result?.isError).not.toBe(true);
  });

  it('returns 404 for an unknown session id', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': '00000000-0000-0000-0000-000000000000' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(res.statusCode).toBe(404);
  });
});