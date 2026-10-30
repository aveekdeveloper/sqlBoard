import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface TenantContext {
  id: string;       // tenant UUID
  slug: string;     // stable identifier (e.g., "acme")
  name: string;     // display name
  domain: string | null;  // app host for this tenant
  plan: string;     // free, pro, enterprise
  status: string;   // active, suspended, deleted
  kind: string;     // 'platform' | 'tenant'
}

export const DEFAULT_TENANT: TenantContext = {
  id: '00000000-0000-0000-0000-000000000000',
  slug: 'default',
  name: 'Default',
  domain: null,
  plan: 'free',
  status: 'active',
  kind: 'platform',
};

const _currentTenant = new AsyncLocalStorage<TenantContext>();

export function currentTenant(): TenantContext {
  return _currentTenant.getStore() ?? DEFAULT_TENANT;
}

export function enterTenant(tenant: TenantContext): void {
  _currentTenant.enterWith(tenant);
}

export async function runWithTenantAsync<T>(tenant: TenantContext, fn: () => Promise<T>): Promise<T> {
  return _currentTenant.run(tenant, fn);
}

export function isDefaultTenant(tenant: TenantContext): boolean {
  return tenant.slug === 'default';
}

export function isPlatformTenant(tenant: TenantContext): boolean {
  return tenant.kind === 'platform';
}

export function normalizeHost(host: string): string {
  host = (host || '').trim().toLowerCase();
  if (host.includes(':') && !host.startsWith('[')) {
    host = host.split(':')[0];
  }
  return host;
}

export function defaultDomains(baseDomain: string): Set<string> {
  const domains = new Set(['localhost', '127.0.0.1']);
  const base = baseDomain.trim().toLowerCase().replace(/\.$/, '');
  if (base) {
    domains.add(base);
    domains.add(`www.${base}`);
    domains.add(`app.${base}`);
  }
  return domains;
}

export function tenantDomain(slug: string, baseDomain: string): string | null {
  const base = baseDomain.trim().toLowerCase().replace(/\.$/, '');
  if (!base) return null;
  return `${slug}.${base}`;
}

export function isValidSlug(slug: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(slug) && slug.length > 0 && slug.length <= 64;
}

export function createTenantContext(partial: {
  id?: string;
  slug: string;
  name?: string;
  domain?: string | null;
  plan?: string;
  status?: string;
  kind?: string;
}): TenantContext {
  return {
    id: partial.id ?? randomUUID(),
    slug: partial.slug,
    name: partial.name ?? partial.slug,
    domain: partial.domain ?? null,
    plan: partial.plan ?? 'free',
    status: partial.status ?? 'active',
    kind: partial.kind ?? 'tenant',
  };
}
