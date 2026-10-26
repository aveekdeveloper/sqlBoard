import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { DrizzleDb } from '../db/client.js';
import { users, sessions } from '../db/schema.js';
import { ApiError, badRequest } from '../errors.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashPassword(password: string): string {
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

export function registerAuthRoutes(app: FastifyInstance, db: DrizzleDb): void {
  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { email?: string; password?: string } | undefined;
    if (!body?.email || !body?.password) {
      throw badRequest('email and password are required');
    }

    const rows = db.select().from(users).where(eq(users.email, body.email)).all();
    const user = rows[0];
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw badRequest('invalid credentials');
    }

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    db.insert(sessions)
      .values({ token, userId: user.id, expiresAt, createdAt: now.toISOString() })
      .run();

    reply.code(200);
    return {
      token,
      user: { id: user.id, email: user.email, role: user.role },
      expiresAt,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = extractToken(request);
    if (token) {
      db.delete(sessions).where(eq(sessions.token, token)).run();
    }
    reply.code(204);
  });

  app.get('/api/auth/me', async (request) => {
    const user = await requireUser(request, db);
    return { id: user.id, email: user.email, role: user.role };
  });
}

export async function requireUser(
  request: { headers: Record<string, string | string[] | undefined> },
  db: DrizzleDb,
): Promise<{ id: number; email: string; role: string }> {
  const token = extractToken(request);
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'missing session token');

  const rows = db.select().from(sessions).where(eq(sessions.token, token)).all();
  const session = rows[0];
  if (!session || new Date(session.expiresAt) < new Date()) {
    throw new ApiError(401, 'UNAUTHORIZED', 'session expired or invalid');
  }

  const userRows = db.select().from(users).where(eq(users.id, session.userId)).all();
  const user = userRows[0];
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'user not found');

  return { id: user.id, email: user.email, role: user.role };
}

function extractToken(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const auth = request.headers.authorization;
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function requireRole(role: 'admin' | 'member' | 'viewer') {
  const rank: Record<string, number> = { viewer: 0, member: 1, admin: 2 };
  return async (
    request: { headers: Record<string, string | string[] | undefined> },
    db: DrizzleDb,
  ) => {
    const user = await requireUser(request, db);
    if (rank[user.role] < rank[role]) {
      throw new ApiError(403, 'FORBIDDEN', `requires ${role} role`);
    }
    return user;
  };
}
