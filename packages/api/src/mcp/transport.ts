import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import type { McpDeps } from './server.js';
import { createMcpServer } from './server.js';
import { resolveMcpContext, setMcpContext, deleteMcpContext } from './auth.js';

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createMcpServer> }>();

export function registerMcpRoutes(app: FastifyInstance, deps: McpDeps): void {
  app.post('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(request.raw, reply.raw, request.body);
      return;
    }

    if (!sessionId && isInitializeRequest(request.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: async (sid) => {
          sessions.set(sid, { transport, server });
          // Resolve auth context from headers and store it
          try {
            const ctx = await resolveMcpContext(request.headers as any, deps.db);
            setMcpContext(sid, ctx);
          } catch (e) {
            // Auth failed — session will fail on tool calls
          }
        },
      });

      const server = createMcpServer(deps);
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

    reply.code(400).send({ error: 'Bad request: no valid session' });
  });

  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      reply.code(400).send({ error: 'Invalid session' });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(request.raw, reply.raw);
  });

  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      reply.code(400).send({ error: 'Invalid session' });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(request.raw, reply.raw);
    sessions.delete(sessionId);
    deleteMcpContext(sessionId);
  });
}
