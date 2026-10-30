import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, badRequest, notFound } from '../errors.js';
import { workbooks, workbookDashboards, dashboards } from '../db/schema.js';
import type { DrizzleDb } from '../db/client.js';
import { currentTenant } from '../core/tenancy.js';

interface Deps { db: DrizzleDb }

export function registerWorkbookRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/workbooks', async (request: any) => {
    const tenant = currentTenant();
    const rows = await deps.db.select().from(workbooks).where(eq(workbooks.tenantId, tenant.id));
    const counts = new Map<number, number>();
    for (const r of await deps.db.select().from(workbookDashboards)) {
      counts.set(r.workbookId, (counts.get(r.workbookId) || 0) + 1);
    }
    return rows
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((r: any) => ({ id: r.id, name: r.name, description: r.description, dashboardCount: counts.get(r.id) || 0, createdAt: r.createdAt, updatedAt: r.updatedAt }));
  });

  app.post('/api/workbooks', async (request: any, reply: any) => {
    const tenant = currentTenant();
    const parsed = z.object({ name: z.string().min(1), description: z.string().optional(), dashboardIds: z.array(z.number().int()).optional() }).safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid workbook', parsed.error.flatten());
    const now = new Date().toISOString();
    const [inserted] = await deps.db.insert(workbooks).values({ name: parsed.data.name, description: parsed.data.description ?? null, tenantId: tenant.id, createdAt: now, updatedAt: now }).returning();
    if (parsed.data.dashboardIds?.length) {
      await deps.db.insert(workbookDashboards).values(parsed.data.dashboardIds.map((id, i) => ({ workbookId: inserted.id, dashboardId: id, position: i })));
    }
    reply.code(201);
    return { id: inserted.id, name: inserted.name };
  });

  app.get('/api/workbooks/:id', async (request: any) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const tenant = currentTenant();
    const rows = await deps.db.select().from(workbooks).where(eq(workbooks.id, numericId));
    const wb = rows[0];
    if (!wb || wb.tenantId !== tenant.id) throw notFound(`Workbook ${id} not found`);
    const assoc = await deps.db.select().from(workbookDashboards).where(eq(workbookDashboards.workbookId, numericId));
    const ordered = assoc.sort((a: any, b: any) => a.position - b.position);
    const dashIds = ordered.map((a: any) => a.dashboardId);
    const dashRows = dashIds.length ? await deps.db.select().from(dashboards).where(inArray(dashboards.id, dashIds)) : [];
    const dashMap = new Map(dashRows.map((d: any) => [d.id, d]));
    const dashboardsOut = ordered.map((a: any) => dashMap.get(a.dashboardId)).filter(Boolean).map((d: any) => ({ id: d.id, name: d.name, description: d.description }));
    return { id: wb.id, name: wb.name, description: wb.description, dashboards: dashboardsOut, createdAt: wb.createdAt, updatedAt: wb.updatedAt };
  });

  app.patch('/api/workbooks/:id', async (request: any) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const tenant = currentTenant();
    const rows = await deps.db.select().from(workbooks).where(eq(workbooks.id, numericId));
    const wb = rows[0];
    if (!wb || wb.tenantId !== tenant.id) throw notFound(`Workbook ${id} not found`);
    const parsed = z.object({ name: z.string().min(1).optional(), description: z.string().nullable().optional(), dashboardIds: z.array(z.number().int()).optional() }).safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid workbook', parsed.error.flatten());
    const patch: any = { updatedAt: new Date().toISOString() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    await deps.db.update(workbooks).set(patch).where(eq(workbooks.id, numericId));
    if (parsed.data.dashboardIds !== undefined) {
      await deps.db.delete(workbookDashboards).where(eq(workbookDashboards.workbookId, numericId));
      if (parsed.data.dashboardIds.length) {
        await deps.db.insert(workbookDashboards).values(parsed.data.dashboardIds.map((id, i) => ({ workbookId: numericId, dashboardId: id, position: i })));
      }
    }
    return { id: numericId };
  });

  app.delete('/api/workbooks/:id', async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const tenant = currentTenant();
    const rows = await deps.db.select().from(workbooks).where(eq(workbooks.id, numericId));
    const wb = rows[0];
    if (!wb || wb.tenantId !== tenant.id) throw notFound(`Workbook ${id} not found`);
    await deps.db.delete(workbookDashboards).where(eq(workbookDashboards.workbookId, numericId));
    await deps.db.delete(workbooks).where(eq(workbooks.id, numericId));
    reply.code(204);
  });
}