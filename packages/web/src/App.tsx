import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import Connections from './pages/Connections.js';
import SqlWorkbench from './pages/SqlWorkbench.js';
import Dashboards from './pages/Dashboards.js';
import DashboardDetail from './pages/DashboardDetail.js';
import SavedQueries from './pages/SavedQueries.js';

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
  { path: '/sql', label: 'SQL', icon: '📝' },
  { path: '/dashboards', label: 'Dashboards', icon: '📊' },
  { path: '/saved', label: 'Saved', icon: '💾' },
];

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error?.message || 'Login failed');
      return;
    }
    const data = await res.json();
    setToken(data.token);
    window.location.href = '/connections';
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 safe-area-top safe-area-bottom">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-semibold mb-1">sqlboard</h1>
        <p className="text-sm text-gray-500 mb-6">Open-source BI for SQL-first teams</p>
        <form onSubmit={submit} className="space-y-4">
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

function Shell({ children }: { children: React.ReactNode }) {
  const token = getToken();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace />;
  const isDashboardDetail = /^\/dashboards\/[^/]+\/?$/.test(location.pathname);
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
        <button
          onClick={() => { setToken(null); window.location.href = '/login'; }}
          className="ml-auto text-sm text-ink-muted hover:text-ink"
        >
          Sign out
        </button>
      </nav>

      {!isDashboardDetail && (
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-line bg-surface">
          <span className="font-semibold text-ink">sqlboard</span>
          <button
            onClick={() => { setToken(null); window.location.href = '/login'; }}
            className="text-sm text-ink-muted"
          >
            Sign out
          </button>
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
      <Route path="/saved" element={<Shell><SavedQueries /></Shell>} />
      <Route path="*" element={<Navigate to="/connections" replace />} />
    </Routes>
  );
}
