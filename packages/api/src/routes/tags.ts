import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DrizzleDb } from '../db/client.js';
import { tags } from '../db/schema.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import { currentTenant } from '../core/tenancy.js';

const CreateTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().optional(),
});

const UpdateTagSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().trim().nullable().optional(),
});

export function registerTagRoutes(app: FastifyInstance, deps: { db: DrizzleDb }): void {
  app.get('/api/tags', async (request: any) => {
    const tenant = currentTenant();
    const rows = await deps.db.select().from(tags).where(eq(tags.tenantId, tenant.id));
    // Attach usage counts
    const { savedQueryTags, dashboardTags } = await import('../db/schema.js');
    const sqAssocs = await deps.db.select().from(savedQueryTags);
    const dAssocs = await deps.db.select().from(dashboardTags);
    return rows.map((t: any) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      createdAt: t.createdAt,
      usageCount: sqAssocs.filter((a: any) => a.tagId === t.id).length + dAssocs.filter((a: any) => a.tagId === t.id).length,
    }));
  });

  app.post('/api/tags', async (request: any, reply: any) => {
    const tenant = currentTenant();
    const parsed = CreateTagSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid tag', parsed.error.flatten());

    const existing = await deps.db.select().from(tags).where(eq(tags.tenantId, tenant.id));
    if (existing.find((t: any) => t.name.toLowerCase() === parsed.data.name.toLowerCase())) {
      throw new ApiError(409, 'CONFLICT', `Tag "${parsed.data.name}" already exists`);
    }

    const palette = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    const color = parsed.data.color || palette[Math.floor(Math.random() * palette.length)];
    const now = new Date().toISOString();
    const [inserted] = await deps.db.insert(tags).values({
      name: parsed.data.name,
      color,
      tenantId: tenant.id,
      createdAt: now,
    }).returning();

    reply.code(201);
    return { id: inserted.id, name: inserted.name, color: inserted.color, createdAt: inserted.createdAt };
  });

  app.patch('/api/tags/:id', async (request: any) => {
    const tenant = currentTenant();
    const { id } = request.params as { id: string };
    const parsed = UpdateTagSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid tag update', parsed.error.flatten());

    const rows = await deps.db.select().from(tags).where(eq(tags.id, Number(id)));
    const tag = rows[0];
    if (!tag || tag.tenantId !== tenant.id) throw notFound(`Tag ${id} not found`);

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.color !== undefined) patch.color = parsed.data.color;

    if (Object.keys(patch).length > 0) {
      await deps.db.update(tags).set(patch).where(eq(tags.id, Number(id)));
    }

    const [updated] = await deps.db.select().from(tags).where(eq(tags.id, Number(id)));
    return { id: updated!.id, name: updated!.name, color: updated!.color, createdAt: updated!.createdAt };
  });

  app.delete('/api/tags/:id', async (request: any, reply: any) => {
    const tenant = currentTenant();
    const { id } = request.params as { id: string };
    const rows = await deps.db.select().from(tags).where(eq(tags.id, Number(id)));
    const tag = rows[0];
    if (!tag || tag.tenantId !== tenant.id) throw notFound(`Tag ${id} not found`);

    // Cascade: remove associations
    const { savedQueryTags, dashboardTags } = await import('../db/schema.js');
    await deps.db.delete(savedQueryTags).where(eq(savedQueryTags.tagId, Number(id)));
    await deps.db.delete(dashboardTags).where(eq(dashboardTags.tagId, Number(id)));
    await deps.db.delete(tags).where(eq(tags.id, Number(id)));
    reply.code(204);
  });
}
