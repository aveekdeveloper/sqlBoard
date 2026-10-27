import type {
  ApplyDashboardState,
  ConnectionDto,
  DashboardDto,
  DashboardItemDto,
  DashboardVersionDetailDto,
  DashboardVersionDto,
  DashboardBlockType,
  Layout,
  MetricFormat,
} from '@sqlboard/shared';

const BASE = '';

export type DashboardDetailDto = DashboardDto & {
  items: DashboardItemDto[];
  latestVersion: number;
};
export type DashboardWithVersion = DashboardDetailDto & { version: DashboardVersionDto };
export type DashboardVersionSummary = DashboardVersionDto & { codeText: string };

export interface DashboardItemInput {
  title: string;
  sql: string;
  connectionId: number;
  blockType: DashboardBlockType;
  config?: Record<string, unknown> | null;
  layout: Layout;
}

export type { DashboardBlockType, Layout, MetricFormat };

export function getToken(): string | null {
  return localStorage.getItem('sqlboard_token');
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem('sqlboard_token', token);
  else localStorage.removeItem('sqlboard_token');
}

export function getTenant(): string | null {
  try {
    const raw = localStorage.getItem('sqlboard_tenant');
    if (!raw) return null;
    return JSON.parse(raw)?.slug ?? null;
  } catch {
    return null;
  }
}

export function setTenant(tenant: any) {
  if (tenant) localStorage.setItem('sqlboard_tenant', JSON.stringify(tenant));
  else localStorage.removeItem('sqlboard_tenant');
}

export interface SessionUser {
  id: number;
  email: string;
  role: 'admin' | 'member' | 'viewer';
}

export type ApiTokenScope = SessionUser['role'];

export interface ApiTokenDto {
  id: number;
  name: string;
  prefix: string;
  scope: ApiTokenScope;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiToken {
  id: number;
  name: string;
  token: string;
  prefix: string;
  scope: ApiTokenScope;
  expiresAt: string | null;
  createdAt: string;
}

export function getStoredUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem('sqlboard_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.email !== 'string') return null;
    return parsed as SessionUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: SessionUser | null) {
  if (user) localStorage.setItem('sqlboard_user', JSON.stringify(user));
  else localStorage.removeItem('sqlboard_user');
}

function clearSession(): void {
  setToken(null);
  setStoredUser(null);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const tenant = getTenant();
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenant) headers['X-Tenant'] = tenant;

  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    if (res.status === 401) {
      clearSession();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?expired=1';
      }
    }

    const message =
      res.status === 403
        ? body?.error?.message || 'You do not have permission to do that.'
        : body?.error?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; version: string }>('/api/health'),
  login: (email: string, password: string) =>
    request<{ token: string; user: { id: number; email: string; role: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<SessionUser>('/api/auth/me'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  connections: {
    list: () => request<ConnectionDto[]>('/api/connections'),
    get: (id: number) => request<any>(`/api/connections/${id}`),
    create: (body: any) => request<any>('/api/connections', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: any) => request<any>(`/api/connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    test: (id: number) => request<any>(`/api/connections/${id}/test`, { method: 'POST' }),
    delete: (id: number) => request<void>(`/api/connections/${id}`, { method: 'DELETE' }),
    tables: (id: number) => request<any[]>(`/api/connections/${id}/tables`),
    preview: (id: number, table: string) => request<any>(`/api/connections/${id}/tables/${encodeURIComponent(table)}/preview`),
    query: (id: number, sql: string, maxRows?: number) =>
      request<any>(`/api/connections/${id}/query`, { method: 'POST', body: JSON.stringify({ sql, maxRows }) }),
  },

  uploads: {
    list: () => request<any[]>('/api/uploads'),
    upload: async (file: File) => {
      const token = getToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    delete: (id: number) => request<void>(`/api/uploads/${id}`, { method: 'DELETE' }),
  },

  savedQueries: {
    list: (params?: { tags?: string; connectionId?: number; sortBy?: string; sortDir?: string }) => {
      const qs = new URLSearchParams();
      if (params?.tags) qs.set('tags', params.tags);
      if (params?.connectionId) qs.set('connectionId', String(params.connectionId));
      if (params?.sortBy) qs.set('sortBy', params.sortBy);
      if (params?.sortDir) qs.set('sortDir', params.sortDir);
      const q = qs.toString();
      return request<any[]>(`/api/saved-queries${q ? `?${q}` : ''}`);
    },
    get: (id: number) => request<any>(`/api/saved-queries/${id}`),
    create: (body: { name: string; connectionId: number; sql: string }) =>
      request<any>('/api/saved-queries', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name?: string; connectionId?: number; sql?: string; message?: string }) =>
      request<any>(`/api/saved-queries/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    listVersions: (id: number) => request<any[]>(`/api/saved-queries/${id}/versions`),
    restoreVersion: (id: number, version: number) =>
      request<any>(`/api/saved-queries/${id}/restore/${version}`, { method: 'POST' }),
    delete: (id: number) => request<void>(`/api/saved-queries/${id}`, { method: 'DELETE' }),
  },

  dashboards: {
    list: (params?: { tags?: string; sortBy?: string; sortDir?: string }) => {
      const qs = new URLSearchParams();
      if (params?.tags) qs.set('tags', params.tags);
      if (params?.sortBy) qs.set('sortBy', params.sortBy);
      if (params?.sortDir) qs.set('sortDir', params.sortDir);
      const q = qs.toString();
      return request<any[]>(`/api/dashboards${q ? `?${q}` : ''}`);
    },
    get: (id: number) => request<DashboardDetailDto>(`/api/dashboards/${id}`),
    create: (body: { name: string; description?: string }) =>
      request<DashboardDto>('/api/dashboards', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name?: string; description?: string | null }) =>
      request<DashboardDetailDto>(`/api/dashboards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: number) => request<void>(`/api/dashboards/${id}`, { method: 'DELETE' }),
    addItem: (dashboardId: number, body: DashboardItemInput) =>
      request<DashboardItemDto>(`/api/dashboards/${dashboardId}/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateItem: (dashboardId: number, itemId: number, body: Partial<DashboardItemInput>) =>
      request<DashboardItemDto>(`/api/dashboards/${dashboardId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    removeItem: (dashboardId: number, itemId: number) =>
      request<void>(`/api/dashboards/${dashboardId}/items/${itemId}`, { method: 'DELETE' }),
    saveLayout: (dashboardId: number, items: Array<{ id: number; layout: Layout }>) =>
      request<DashboardDetailDto>(`/api/dashboards/${dashboardId}/layout`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      }),
    applyState: (dashboardId: number, body: ApplyDashboardState) =>
      request<DashboardWithVersion>(`/api/dashboards/${dashboardId}/state`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    listVersions: (dashboardId: number) =>
      request<DashboardVersionSummary[]>(`/api/dashboards/${dashboardId}/versions`),
    getVersion: (dashboardId: number, version: number) =>
      request<DashboardVersionDetailDto>(`/api/dashboards/${dashboardId}/versions/${version}`),
    commitVersion: (dashboardId: number, message: string) =>
      request<DashboardVersionDto>(`/api/dashboards/${dashboardId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    restoreVersion: (dashboardId: number, version: number) =>
      request<DashboardWithVersion>(
        `/api/dashboards/${dashboardId}/versions/${version}/restore`,
        { method: 'POST' },
      ),
  },

  tokens: {
    list: () => request<ApiTokenDto[]>('/api/tokens'),
    create: (body: { name: string; scope?: ApiTokenScope; expiresInDays?: number | null }) =>
      request<CreatedApiToken>('/api/tokens', { method: 'POST', body: JSON.stringify(body) }),
    revoke: (id: number) => request<void>(`/api/tokens/${id}`, { method: 'DELETE' }),
  },

  tags: {
    list: () => request<any[]>('/api/tags'),
    create: (body: { name: string; color?: string }) =>
      request<any>('/api/tags', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name?: string; color?: string | null }) =>
      request<any>(`/api/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: number) => request<void>(`/api/tags/${id}`, { method: 'DELETE' }),
  },

  compile: (body: { sql: string; connectionId?: number; data?: any[]; theme?: string; backend?: string; backends?: string[] }) =>
    request<any>('/api/compile', { method: 'POST', body: JSON.stringify(body) }),
};