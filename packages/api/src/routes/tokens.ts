import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DrizzleDb } from '../db/client.js';
import { apiTokens } from '../db/schema.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import { generateApiToken, hashApiToken, type AuthUser } from '../auth/session.js';
import { ROLE_RANK, toRole } from '../auth/roles.js';

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['viewer', 'member', 'admin']).optional(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'missing credentials');
  }
  return request.user;
}

export function registerTokenRoutes(app: FastifyInstance, deps: { db: DrizzleDb }): void {
  app.get('/api/tokens', async (request) => {
    const user = currentUser(request);
    const rows = deps.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, user.id))
      .all();

    return rows
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((row) => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scope: toRole(row.scope),
        expiresAt: row.expiresAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      }));
  });

  app.post('/api/tokens', async (request, reply) => {
    const user = currentUser(request);
    const parsed = CreateTokenSchema.safeParse(request.body);
    if (!parsed.success) throw badRequest('Invalid API token', parsed.error.flatten());

    const scope = parsed.data.scope ?? 'viewer';
    if (ROLE_RANK[scope] > ROLE_RANK[user.role]) {
      throw badRequest(`A ${user.role} cannot create a ${scope} token`);
    }

    const token = generateApiToken();
    const now = new Date();
    const expiresAt =
      parsed.data.expiresInDays == null
        ? null
        : new Date(now.getTime() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const inserted = deps.db
      .insert(apiTokens)
      .values({
        userId: user.id,
        name: parsed.data.name,
        tokenHash: hashApiToken(token),
        prefix: `${token.slice(0, 11)}…`,
        scope,
        expiresAt,
        createdAt: now.toISOString(),
      })
      .returning()
      .get();

    reply.code(201);
    return {
      id: inserted.id,
      name: inserted.name,
      // Returned exactly once. Only the hash is stored.
      token,
      prefix: inserted.prefix,
      scope: toRole(inserted.scope),
      expiresAt: inserted.expiresAt,
      createdAt: inserted.createdAt,
    };
  });

  app.delete('/api/tokens/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    const rows = deps.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, Number(id)))
      .all();
    const token = rows[0];
    if (!token) throw notFound(`API token ${id} not found`);
    if (token.userId !== user.id && user.role !== 'admin') {
      throw new ApiError(403, 'FORBIDDEN', 'cannot revoke another user’s token');
    }

    if (!token.revokedAt) {
      deps.db
        .update(apiTokens)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(apiTokens.id, token.id))
        .run();
    }
    reply.code(204);
  });
}
