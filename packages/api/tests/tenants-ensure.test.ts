import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { tenants } from '../src/db/schema.js';

const SERVICE_TOKEN = 'test-service-token';
const DATA_DIR = `./data-test-tenants-ensure-${process.pid}`;
const SLUG = 'acme-ensure-test';

let ctx: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  process.env.BI_SERVICE_TOKEN = SERVICE_TOKEN;
  const config = loadConfig({
    dataDir: DATA_DIR,
    secretKey: 'test',
    tenancyEnabled: true,
    baseDomain: 'example.com',
  });
  ctx = await buildServer(config);
  await ctx.app.ready();
});

afterAll(async () => {
  await ctx.app.close();
  delete process.env.BI_SERVICE_TOKEN;
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    // Windows keeps the DuckDB file locked briefly after shutdown; the
    // directory is gitignored, so a failed cleanup is harmless.
  }
});

function ensure(payload: Record<string, unknown>, token?: string | null) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/internal/tenants/ensure',
    headers: token === null ? {} : { 'x-service-token': token ?? SERVICE_TOKEN },
    payload,
  });
}

describe('POST /api/internal/tenants/ensure', () => {
  it('rejects a missing service token', async () => {
    const res = await ensure({ slug: SLUG, name: 'Acme' }, null);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong service token', async () => {
    const res = await ensure({ slug: SLUG, name: 'Acme' }, 'wrong-token');
    expect(res.statusCode).toBe(401);
  });

  it('creates a tenant once and is idempotent', async () => {
    const created = await ensure({
      slug: SLUG,
      name: 'Acme',
      ownerEmail: 'owner@example.com',
    });
    expect(created.statusCode).toBe(201);
    const first = created.json().tenant;
    expect(first).toMatchObject({
      slug: SLUG,
      name: 'Acme',
      status: 'active',
      kind: 'tenant',
      ownerEmail: 'owner@example.com',
    });

    const again = await ensure({ slug: SLUG, name: 'Acme Renamed' });
    expect(again.statusCode).toBe(200);
    const second = again.json().tenant;
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Acme');

    const rows = await ctx.db.select().from(tenants).where(eq(tenants.slug, SLUG));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
  });

  it('rejects an invalid slug', async () => {
    const res = await ensure({ slug: 'bad slug', name: 'Bad' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/internal/tenants/status', () => {
  it('returns the tenant for an existing slug', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/internal/tenants/status?slug=${SLUG}`,
      headers: { 'x-service-token': SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenant).toMatchObject({
      slug: SLUG,
      status: 'active',
      kind: 'tenant',
    });
  });

  it('returns null for a missing slug', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/internal/tenants/status?slug=missing-tenant',
      headers: { 'x-service-token': SERVICE_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenant).toBeNull();
  });

  it('rejects a missing service token', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/internal/tenants/status?slug=${SLUG}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
