import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import type { McpDeps } from './server.js';
import { createMcpServer } from './server.js';
import { resolveMcpContext, setMcpContext, deleteMcpContext } from './auth.js';
import { ApiError } from '../errors.js';

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer>; ctx: any }>();

function jsonRpcError(reply: any, status: number, id: unknown, code: number, message: string) {
  reply.code(status).send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

export function registerMcpRoutes(app: FastifyInstance, deps: McpDeps): void {
  app.post('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    const bodyId = (request.body as any)?.id ?? null;

    // Unknown session id -> 404 so clients re-initialize (per MCP spec).
    if (sessionId && !sessions.has(sessionId)) {
      jsonRpcError(reply, 404, bodyId, -32000, 'Session not found');
      return;
    }

    // Existing session.
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;

      // Re-resolve context if it was never stored (legacy/unauthenticated init).
      if (!session.ctx) {
        try {
          const ctx = await resolveMcpContext(request.headers as any, deps.db);
          session.ctx = ctx;
          setMcpContext(sessionId, ctx);
        } catch (e) {
          const msg = e instanceof ApiError ? e.message : (e as Error).message;
          const status = e instanceof ApiError ? e.statusCode : 401;
          jsonRpcError(reply, status >= 400 ? status : 401, bodyId, -32001, 'Unauthorized: ' + msg);
          return;
        }
      }

      // If the caller presents a (different) token, it must match the bound session.
      const rawAuth = request.headers['authorization'];
      const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
      if (typeof authHeader === 'string' && authHeader.trim() !== '') {
        try {
          const newCtx = await resolveMcpContext(request.headers as any, deps.db);
          if (
            newCtx.user.id !== session.ctx.user.id ||
            newCtx.tenant.id !== session.ctx.tenant.id
          ) {
            jsonRpcError(reply, 401, bodyId, -32001, 'Unauthorized: token does not match the bound session');
            return;
          }
        } catch (e) {
          const msg = e instanceof ApiError ? e.message : (e as Error).message;
          const status = e instanceof ApiError ? e.statusCode : 401;
          jsonRpcError(reply, status >= 400 ? status : 401, bodyId, -32001, 'Unauthorized: ' + msg);
          return;
        }
      }

      await session.transport.handleRequest(request.raw, reply.raw, request.body);
      return;
    }

    // New session: authenticate BEFORE creating it.
    if (!sessionId && isInitializeRequest(request.body)) {
      let ctx: any;
      try {
        ctx = await resolveMcpContext(request.headers as any, deps.db);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : (e as Error).message;
        const status = e instanceof ApiError ? e.statusCode : 401;
        app.log.warn({ err: msg }, 'MCP initialize rejected');
        jsonRpcError(reply, status >= 400 ? status : 401, bodyId, -32001, 'Unauthorized: ' + msg);
        return;
      }

      let server: ReturnType<typeof createMcpServer>;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: async (sid) => {
          sessions.set(sid, { transport, server, ctx });
          setMcpContext(sid, ctx);
        },
      });

      server = createMcpServer(deps);
      await server.connect(transport);

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          deleteMcpContext(transport.sessionId);
        }
      };

      await transport.handleRequest(request.raw, reply.raw, request.body);
      return;
    }

    jsonRpcError(reply, 400, bodyId, -32000, 'Bad request: no valid session');
  });

  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      jsonRpcError(reply, 404, null, -32000, 'Session not found');
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(request.raw, reply.raw);
  });

  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      jsonRpcError(reply, 404, null, -32000, 'Session not found');
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(request.raw, reply.raw);
    sessions.delete(sessionId);
    deleteMcpContext(sessionId);
  });
}