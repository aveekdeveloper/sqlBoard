import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DrizzleDb } from '../db/client.js';
import { apiTokens, sessions, tenants, users } from '../db/schema.js';
import { ApiError, badRequest } from '../errors.js';
import { currentTenant } from '../core/tenancy.js';
import { ROLE_RANK, effectiveRole, toRole, type Role } from './roles.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_USED_THROTTLE_MS = 60 * 1000;

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  tokenId?: number;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  if (computed.length !== storedBuf.length) return false;
  return timingSafeEqual(computed, storedBuf);
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateApiToken(): string {
  return `sb_${randomBytes(24).toString('base64url')}`;
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function registerAuthRoutes(app: FastifyInstance, db: DrizzleDb): void {
  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { email?: string; password?: string; tenant?: string } | undefined;
    if (!body?.email || !body?.password) {
      throw badRequest('email and password are required');
    }

    const tenantSlug = body.tenant?.trim() || currentTenant().slug;

    // Look up tenant
    const tenantRows = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug)).all();
    const tenant = tenantRows[0];
    if (!tenant || tenant.status === 'deleted') {
      throw badRequest('unknown tenant');
    }

    const rows = await db.select().from(users).where(eq(users.email, body.email)).all();
    const user = rows.find((u) => u.tenantId === tenant.id);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw badRequest('invalid credentials');
    }

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    await db.insert(sessions).values({ token, userId: user.id, expiresAt, createdAt: now.toISOString() });

    reply.code(200);
    return {
      token,
      user: { id: user.id, email: user.email, role: toRole(user.role) },
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      expiresAt,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = extractToken(request);
    if (token && !token.startsWith('sb_')) {
      await db.delete(sessions).where(eq(sessions.token, token));
    }
    reply.code(204);
  });

  app.get('/api/auth/me', async (request) => {
    const user = await requireUser(request, db);
    return { id: user.id, email: user.email, role: user.role };
  });

  // List tenants the current user belongs to
  app.get('/api/auth/tenants', async (request) => {
    const user = await requireUser(request, db);
    const userRows = await db.select().from(users).where(eq(users.email, user.email)).all();
    const tenantIds = userRows.map((u) => u.tenantId);
    const tenantRows = await db.select().from(tenants).all();
    return tenantRows
      .filter((t) => tenantIds.includes(t.id) && t.status !== 'deleted')
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        plan: t.plan,
        current: t.id === currentTenant().id,
      }));
  });

  // Switch tenant (re-issue token bound to new tenant)
  app.post('/api/auth/switch-tenant', async (request, reply) => {
    const user = await requireUser(request, db);
    const body = request.body as { tenant?: string } | undefined;
    if (!body?.tenant) throw badRequest('tenant is required');

    const tenantRows = await db.select().from(tenants).where(eq(tenants.slug, body.tenant)).all();
    const tenant = tenantRows[0];
    if (!tenant || tenant.status === 'deleted') throw badRequest('unknown tenant');

    const userRows = await db.select().from(users).where(eq(users.email, user.email)).all();
    const tenantUser = userRows.find((u) => u.tenantId === tenant.id);
    if (!tenantUser) throw new ApiError(403, 'FORBIDDEN', 'not a member of this tenant');

    const oldToken = extractToken(request);
    if (oldToken && !oldToken.startsWith('sb_')) {
      await db.delete(sessions).where(eq(sessions.token, oldToken));
    }

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    await db.insert(sessions).values({ token, userId: tenantUser.id, expiresAt, createdAt: now.toISOString() });

    reply.code(200);
    return {
      token,
      user: { id: tenantUser.id, email: tenantUser.email, role: toRole(tenantUser.role) },
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      expiresAt,
    };
  });
}

export async function requireUser(
  request: { headers: Record<string, string | string[] | undefined> },
  db: DrizzleDb,
): Promise<AuthUser> {
  const token = extractToken(request);
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'missing credentials');
  if (token.startsWith('sb_')) return resolveApiToken(db, token);

  const rows = await db.select().from(sessions).where(eq(sessions.token, token)).all();
  const session = rows[0];
  if (!session || new Date(session.expiresAt) < new Date()) {
    throw new ApiError(401, 'UNAUTHORIZED', 'session expired or invalid');
  }

  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).all();
  const user = userRows.find((u) => u.tenantId === currentTenant().id) ?? userRows[0];
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'user not found');

  return { id: user.id, email: user.email, role: toRole(user.role) };
}

async function resolveApiToken(db: DrizzleDb, token: string): Promise<AuthUser> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashApiToken(token)))
    .all();
  const apiToken = rows[0];
  if (!apiToken || apiToken.revokedAt) {
    throw new ApiError(401, 'UNAUTHORIZED', 'invalid or revoked API token');
  }
  if (apiToken.expiresAt && Date.parse(apiToken.expiresAt) <= Date.now()) {
    throw new ApiError(401, 'UNAUTHORIZED', 'API token expired');
  }

  const userRows = await db.select().from(users).where(eq(users.id, apiToken.userId)).all();
  const user = userRows.find((u) => u.tenantId === currentTenant().id) ?? userRows[0];
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'user not found');

  const now = Date.now();
  if (!apiToken.lastUsedAt || now - Date.parse(apiToken.lastUsedAt) > LAST_USED_THROTTLE_MS) {
    try {
      await db.update(apiTokens)
        .set({ lastUsedAt: new Date(now).toISOString() })
        .where(eq(apiTokens.id, apiToken.id));
    } catch {
      // Usage tracking must never block a request.
    }
  }

  return {
    id: user.id,
    email: user.email,
    role: effectiveRole(user.role, apiToken.scope),
    tokenId: apiToken.id,
  };
}

function extractToken(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const auth = request.headers.authorization;
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function requireRole(role: Role) {
  return async (
    request: { headers: Record<string, string | string[] | undefined> },
    db: DrizzleDb,
  ) => {
    const user = await requireUser(request, db);
    if (ROLE_RANK[user.role] < ROLE_RANK[role]) {
      throw new ApiError(403, 'FORBIDDEN', `requires ${role} role`);
    }
    return user;
  };
}
