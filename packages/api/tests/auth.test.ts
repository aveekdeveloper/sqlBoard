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
  await ctx.db
    .insert(users)
    .values({
      email,
      passwordHash: hashPassword(PASSWORD),
      role,
      createdAt: new Date().toISOString(),
    });
}

async function login(ctx: ServerContext, email: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

describe('auth and api tokens', () => {
  let ctx: ServerContext;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = `./data-test-auth-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    ctx = await boot(dataDir);
  });

  afterEach(async () => {
    await ctx.app.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows may keep the database file open; the temp dir is disposable.
    }
  });

  it('keeps health public and protects the rest of the API', async () => {
    const health = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);

    const dashboards = await ctx.app.inject({ method: 'GET', url: '/api/dashboards' });
    expect(dashboards.statusCode).toBe(401);
    expect(dashboards.json().error.code).toBe('UNAUTHORIZED');
  });

  it('serves OpenAPI without a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBeTruthy();
    expect(doc.paths['/api/dashboards']).toBeTruthy();
  });

  it('accepts a session token and records the author on writes', async () => {
    await seedUser(ctx, 'admin@test.dev', 'admin');
    const token = await login(ctx, 'admin@test.dev');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Auth test' },
    });
    expect(created.statusCode).toBe(201);

    const state = await ctx.app.inject({
      method: 'PUT',
      url: `/api/dashboards/${created.json().id}/state`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Auth test', items: [], baseVersion: 1 },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().version.version).toBe(2);
    expect(state.json().version.authorId).toBe(1);

    const conflict = await ctx.app.inject({
      method: 'PUT',
      url: `/api/dashboards/${created.json().id}/state`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Stale write', items: [], baseVersion: 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('VERSION_CONFLICT');
  });

  it('mints a scoped token, enforces its role, and revokes it', async () => {
    await seedUser(ctx, 'admin@test.dev', 'admin');
    const session = await login(ctx, 'admin@test.dev');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'agent', scope: 'viewer', expiresInDays: 30 },
    });
    expect(created.statusCode).toBe(201);
    const { token, id } = created.json();
    expect(token.startsWith('sb_')).toBe(true);

    const read = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);

    const write = await ctx.app.inject({
      method: 'POST',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'agent write' },
    });
    expect(write.statusCode).toBe(403);

    const revoked = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${id}`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(revoked.statusCode).toBe(204);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('tolerates an empty JSON body on bodyless DELETE requests', async () => {
    await seedUser(ctx, 'admin@test.dev', 'admin');
    const session = await login(ctx, 'admin@test.dev');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'cli', scope: 'viewer' },
    });
    const { token, id } = created.json();

    // Many HTTP clients (and agents) set the JSON content type even with no body.
    const revoked = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${id}`,
      headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
    });
    expect(revoked.statusCode).toBe(204);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('still rejects malformed JSON', async () => {
    await seedUser(ctx, 'admin@test.dev', 'admin');
    const session = await login(ctx, 'admin@test.dev');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('viewer can run queries and compile but cannot write', async () => {
    await seedUser(ctx, 'viewer@test.dev', 'viewer');
    const session = await login(ctx, 'viewer@test.dev');

    const read = await ctx.app.inject({
      method: 'GET',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${session}` },
    });
    expect(read.statusCode).toBe(200);

    const compile = await ctx.app.inject({
      method: 'POST',
      url: '/api/compile',
      headers: { authorization: `Bearer ${session}` },
      payload: { sql: '-- @chart: bar\\n-- @x: n\\n-- @y: v\\nSELECT 1', data: [{ n: 'a', v: 1 }] },
    });
    expect(compile.statusCode).toBe(200);

    const write = await ctx.app.inject({
      method: 'POST',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'blocked' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('does not let a token outrank its owner', async () => {
    await seedUser(ctx, 'viewer@test.dev', 'viewer');
    const session = await login(ctx, 'viewer@test.dev');

    const escalated = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'too strong', scope: 'admin' },
    });
    expect(escalated.statusCode).toBe(400);

    const own = await ctx.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'read only', scope: 'viewer' },
    });
    expect(own.statusCode).toBe(201);

    const write = await ctx.app.inject({
      method: 'POST',
      url: '/api/dashboards',
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'blocked' },
    });
    expect(write.statusCode).toBe(403);
  });
});
