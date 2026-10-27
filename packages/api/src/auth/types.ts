import type { AuthUser } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the global auth hook in server.ts. */
    user?: AuthUser;
  }
}

export {};
