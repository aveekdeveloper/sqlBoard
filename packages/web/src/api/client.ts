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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
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
  me: () => request<{ id: number; email: string; role: string }>('/api/auth/me'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  connections: {
    list: () => request<ConnectionDto[]>('/api/connections'),
    get: (id: number) => request<any>(`/api/connections/${id}`),
    create: (body: any) => request<any>('/api/connections', { method: 'POST', body: JSON.stringify(body) }),
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
    list: () => request<any[]>('/api/saved-queries'),
    create: (body: { name: string; connectionId: number; sql: string }) =>
      request<any>('/api/saved-queries', { method: 'POST', body: JSON.stringify(body) }),
    delete: (id: number) => request<void>(`/api/saved-queries/${id}`, { method: 'DELETE' }),
  },

  dashboards: {
    list: () => request<DashboardDto[]>('/api/dashboards'),
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

  compile: (body: { sql: string; connectionId?: number; data?: any[]; theme?: string; backend?: string; backends?: string[] }) =>
    request<any>('/api/compile', { method: 'POST', body: JSON.stringify(body) }),
};