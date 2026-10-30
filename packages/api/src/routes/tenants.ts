import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomBytes, scryptSync, randomUUID } from 'node:crypto';
import type { DrizzleDb } from '../db/client.js';
import { tenants, users } from '../db/schema.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import { hashPassword } from '../auth/session.js';
import { currentTenant, createTenantContext, enterTenant, isValidSlug } from '../core/tenancy.js';

const CreateTenantSchema = z.object({
  slug: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9-]+$/, 'slug must be alphanumeric with hyphens'),
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).default('free'),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  adminRole: z.enum(['tenant_admin', 'member']).default('tenant_admin'),
});

const UpdateTenantSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  domain: z.string().trim().nullable().optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
});

function requireAdmin(request: FastifyRequest) {
  if (!request.user || request.user.role !== 'platform_admin') {
    throw new ApiError(403, 'FORBIDDEN', 'platform admin role required');
  }
  if (currentTenant().kind !== 'platform') {
    throw new ApiError(403, 'FORBIDDEN', 'platform admin actions are only available in the platform tenant');
  }
}

export function registerTenantRoutes(app: FastifyInstance, deps: { db: DrizzleDb }): void {
  // List tenants (admin only)
  app.get('/api/tenants', async (request: any) => {
    requireAdmin(request);
    const rows = await deps.db.select().from(tenants);
    return rows
      .filter((t: any) => t.status !== 'deleted')
      .map((t: any) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        domain: t.domain,
        plan: t.plan,
        status: t.status,
        ownerEmail: t.ownerEmail,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
  });

  // Get tenant (admin only)
  app.get('/api/tenants/:id', async (request: any) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const rows = await deps.db.select().from(tenants).where(eq(tenants.id, id));
    const t = rows[0];
    if (!t) throw notFound(`Tenant ${id} not found`);
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      domain: t.domain,
      plan: t.plan,
      status: t.status,
      ownerEmail: t.ownerEmail,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });

  // Create tenant (admin only)
  app.post('/api/tenants', async (request: any, reply: any) => {
    requireAdmin(request);
    const parsed = CreateTenantSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid tenant payload', parsed.error.flatten());

    const data = parsed.data;

    // Check slug uniqueness
    const existing = await deps.db.select().from(tenants).where(eq(tenants.slug, data.slug));
    if (existing.length > 0) {
      throw new ApiError(409, 'CONFLICT', `Tenant with slug "${data.slug}" already exists`);
    }

    // Check domain uniqueness if provided
    if (data.domain) {
      const domainExisting = await deps.db.select().from(tenants).where(eq(tenants.domain, data.domain));
      if (domainExisting.length > 0) {
        throw new ApiError(409, 'CONFLICT', `Domain "${data.domain}" is already in use`);
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    await deps.db.insert(tenants).values({
      id,
      slug: data.slug,
      name: data.name,
      domain: data.domain ?? null,
      plan: data.plan,
      status: 'active',
      kind: 'tenant',
      ownerEmail: data.adminEmail,
      createdAt: now,
      updatedAt: now,
    });

    // Seed admin user for this tenant
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(data.adminPassword, salt, 64).toString('hex');
    const [createdUser] = await deps.db.insert(users).values({
      email: data.adminEmail,
      passwordHash: `${salt}:${hash}`,
      role: data.adminRole,
      tenantId: id,
      createdAt: now,
    }).returning();

    reply.code(201);
    return {
      tenant: {
        id,
        slug: data.slug,
        name: data.name,
        domain: data.domain ?? null,
        plan: data.plan,
        status: 'active',
        ownerEmail: data.adminEmail,
        createdAt: now,
        updatedAt: now,
      },
      admin: {
        id: createdUser.id,
        email: data.adminEmail,
        role: data.adminRole,
        tenantId: id,
      },
    };
  });

  // Update tenant (admin only)
  app.patch('/api/tenants/:id', async (request: any) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const parsed = UpdateTenantSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid tenant update', parsed.error.flatten());

    const rows = await deps.db.select().from(tenants).where(eq(tenants.id, id));
    const existing = rows[0];
    if (!existing) throw notFound(`Tenant ${id} not found`);

    const data = parsed.data;
    const now = new Date().toISOString();

    // Check domain uniqueness if changed
    if (data.domain !== undefined && data.domain !== existing.domain) {
      if (data.domain) {
        const domainExisting = await deps.db.select().from(tenants).where(eq(tenants.domain, data.domain));
        if (domainExisting.length > 0) {
          throw new ApiError(409, 'CONFLICT', `Domain "${data.domain}" is already in use`);
        }
      }
    }

    const patch: Record<string, unknown> = { updatedAt: now };
    if (data.name !== undefined) patch.name = data.name;
    if (data.domain !== undefined) patch.domain = data.domain;
    if (data.plan !== undefined) patch.plan = data.plan;
    if (data.status !== undefined) patch.status = data.status;

    await deps.db.update(tenants).set(patch).where(eq(tenants.id, id));

    const [updated] = await deps.db.select().from(tenants).where(eq(tenants.id, id));
    return {
      id: updated!.id,
      slug: updated!.slug,
      name: updated!.name,
      domain: updated!.domain,
      plan: updated!.plan,
      status: updated!.status,
      ownerEmail: updated!.ownerEmail,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    };
  });

  // Soft delete tenant (admin only)
  app.delete('/api/tenants/:id', async (request: any, reply: any) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const rows = await deps.db.select().from(tenants).where(eq(tenants.id, id));
    if (rows.length === 0) throw notFound(`Tenant ${id} not found`);
    if (rows[0].kind === 'platform') throw new ApiError(403, 'FORBIDDEN', 'cannot delete the platform tenant');

    const now = new Date().toISOString();
    await deps.db.update(tenants).set({ status: 'deleted', updatedAt: now }).where(eq(tenants.id, id));
    reply.code(204);
  });
}
