import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Connections from './pages/Connections.js';
import SqlWorkbench from './pages/SqlWorkbench.js';
import Dashboards from './pages/Dashboards.js';
import DashboardDetail from './pages/DashboardDetail.js';
import DashboardView from './pages/DashboardView.js';
import SharedDashboard from './pages/SharedDashboard.js';
import SavedQueries from './pages/SavedQueries.js';
import Settings from './pages/Settings.js';
import { getTenant, setStoredUser, setTenant } from './api/client.js';
import { api } from './api/client.js';
import { useAuth } from './auth.js';

function getToken(): string | null {
  return localStorage.getItem('sqlboard_token');
}

function setToken(token: string | null) {
  if (token) localStorage.setItem('sqlboard_token', token);
  else localStorage.removeItem('sqlboard_token');
}

export { getToken, setToken };

const NAV_ITEMS = [
  { path: '/connections', label: 'Connections', icon: '🔌' },
  { path: '/sql', label: 'SQL Workbench', icon: '📝' },
  { path: '/saved', label: 'Saved Queries', icon: '💾' },
  { path: '/dashboards', label: 'Dashboards', icon: '📊' },
  { path: '/settings', label: 'Settings', icon: '⚙️' },
];

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenant, setTenant] = useState(() => new URLSearchParams(window.location.search).get('tenant') || '');
  const [error, setError] = useState('');
  const expired = new URLSearchParams(window.location.search).get('expired') === '1';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, tenant: tenant.trim() || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error?.message || 'Login failed');
      return;
    }
    const data = await res.json();
    setToken(data.token);
    setStoredUser(data.user);
    if (data.tenant) setTenant(data.tenant);
    window.location.href = '/connections';
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 safe-area-top safe-area-bottom">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-semibold mb-1">sqlboard</h1>
        <p className="text-sm text-gray-500 mb-6">Open-source BI for SQL-first teams</p>
        {expired && !error && (
          <p className="mb-4 rounded-md border border-[#ecd9b6] bg-[#fbf3e5] px-3 py-2 text-sm text-warning">
            Your session expired. Sign in again.
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tenant (optional)</label>
            <input
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              type="text"
              placeholder="default"
              autoComplete="organization"
              className="w-full border border-gray-300 rounded px-3 py-2 text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
              className="w-full border border-gray-300 rounded px-3 py-2 text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded px-3 py-2 text-base"
            />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white rounded py-2.5 font-medium">
            Sign in
          </button>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </form>
      </div>
    </div>
  );
}

function TenantSwitcher({ role }: { role: string | null }) {
  const [current, setCurrent] = useState<string>(() => getTenant() || 'default');
  const [tenants, setTenants] = useState<Array<{ slug: string; name: string }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (role !== 'admin') return;
    let cancelled = false;
    api.tenants
      .list()
      .then((rows) => {
        if (cancelled) return;
        setTenants(rows.map((r: any) => ({ slug: r.slug, name: r.name })));
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  function switchTo(slug: string) {
    if (!slug || slug === current) return;
    setTenant({ slug });
    setStoredUser(null);
    setToken(null);
    window.location.href = `/login?tenant=${encodeURIComponent(slug)}`;
  }

  const options = tenants.length > 0 ? tenants : [{ slug: current, name: current }];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted hover:text-ink"
        title="Switch tenant"
      >
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">tenant</span>
        <span className="text-ink">{current}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-line bg-surface p-2 shadow-card">
          <div className="mb-1 text-[10px] uppercase tracking-[0.08em] text-ink-faint">
            Switch tenant
          </div>
          {options.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => {
                setOpen(false);
                switchTo(t.slug);
              }}
              className={`block w-full rounded px-2 py-1 text-left text-[12px] hover:bg-paper ${
                t.slug === current ? 'font-semibold text-ink' : 'text-ink-muted'
              }`}
            >
              {t.name} ({t.slug})
            </button>
          ))}
          <div className="mt-2 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                const slug = window.prompt('Tenant slug');
                if (slug) switchTo(slug.trim());
              }}
              className="w-full rounded px-2 py-1 text-left text-[12px] text-ink-muted hover:bg-paper"
            >
              Other…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const token = getToken();
  const location = useLocation();
  const { user, role } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  const isDashboardDetail = /^\/dashboards\/[^/]+\/?$/.test(location.pathname);

  function signOut() {
    setToken(null);
    setStoredUser(null);
    setTenant(null);
    window.location.href = '/login';
  }

  return (
    <div
      className={`flex flex-col safe-area-top safe-area-bottom safe-area-x ${
        isDashboardDetail ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'
      }`}
    >
      <nav className="hidden md:flex items-center gap-1 px-4 py-2 border-b border-line bg-surface">
        <span className="font-semibold mr-4 text-ink">sqlboard</span>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              location.pathname.startsWith(item.path)
                ? 'bg-accent-soft text-accent-ink'
                : 'text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
            }`}
          >
            {item.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <TenantSwitcher role={role} />
          {user?.email && (
            <span className="hidden text-[11.5px] text-ink-faint lg:inline">{user.email}</span>
          )}
          {role && (
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-ink-muted">
              {role}
            </span>
          )}
          <button onClick={signOut} className="text-sm text-ink-muted hover:text-ink">
            Sign out
          </button>
        </div>
      </nav>

      {!isDashboardDetail && (
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-line bg-surface">
          <span className="font-semibold text-ink">sqlboard</span>
          <div className="flex items-center gap-2">
            <TenantSwitcher role={role} />
            <button
              onClick={signOut}
              className="text-sm text-ink-muted"
            >
              Sign out
            </button>
          </div>
        </header>
      )}

      <main
        className={
          isDashboardDetail
            ? 'min-h-0 flex-1 overflow-hidden pb-16 md:pb-0'
            : 'flex-1 overflow-auto pb-16 md:pb-0'
        }
      >
        {isDashboardDetail ? (
          <div className="h-full">{children}</div>
        ) : (
          <div className="max-w-7xl mx-auto p-4 md:p-6">{children}</div>
        )}
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line flex justify-around py-1 safe-area-bottom z-50">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex flex-col items-center py-1 px-2 text-xs ${
              location.pathname.startsWith(item.path) ? 'text-accent' : 'text-ink-muted'
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}


export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/connections" element={<Shell><Connections /></Shell>} />
      <Route path="/explore" element={<Navigate to="/sql" replace />} />
      <Route path="/sql" element={<Shell><SqlWorkbench /></Shell>} />
      <Route path="/dashboards" element={<Shell><Dashboards /></Shell>} />
      <Route path="/dashboards/:id" element={<Shell><DashboardDetail /></Shell>} />
      <Route path="/dashboards/:id/view" element={<DashboardView />} />
      <Route path="/share/:token" element={<SharedDashboard />} />
      <Route path="/saved" element={<Shell><SavedQueries /></Shell>} />
      <Route path="/settings" element={<Shell><Settings /></Shell>} />
      <Route path="*" element={<Navigate to="/connections" replace />} />
    </Routes>
  );
}
