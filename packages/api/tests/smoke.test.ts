import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

describe('sqlboard api smoke', () => {
  it('boots and serves health', async () => {
    const config = loadConfig({ dataDir: './data-test-smoke', secretKey: 'test' });
    const ctx = await buildServer(config);
    await ctx.app.ready();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    await ctx.app.close();
  });
});
