import SqlWorkbench from './pages/SqlWorkbench.js';

import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import Connections from './pages/Connections.js';

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
  { path: '/explore', label: 'Explore', icon: '🔍' },
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
  return (
    <div className="min-h-screen flex flex-col safe-area-top safe-area-bottom safe-area-x">
      <nav className="hidden md:flex items-center gap-1 px-4 py-2 border-b border-gray-200 bg-white">
        <span className="font-semibold mr-4">sqlboard</span>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              location.pathname.startsWith(item.path)
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {item.label}
          </Link>
        ))}
        <button
          onClick={() => { setToken(null); window.location.href = '/login'; }}
          className="ml-auto text-sm text-gray-500 hover:text-gray-700"
        >
          Sign out
        </button>
      </nav>

      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <span className="font-semibold">sqlboard</span>
        <button
          onClick={() => { setToken(null); window.location.href = '/login'; }}
          className="text-sm text-gray-500"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          {children}
        </div>
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around py-1 safe-area-bottom z-50">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex flex-col items-center py-1 px-2 text-xs ${
              location.pathname.startsWith(item.path) ? 'text-blue-600' : 'text-gray-500'
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

function Explore() {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Explore</h2>
      <p className="text-gray-500">Browse tables and preview data.</p>
    </div>
  );
}

function Dashboards() {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Dashboards</h2>
      <p className="text-gray-500">Create and manage dashboards.</p>
    </div>
  );
}

function DashboardDetail() {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Dashboard</h2>
      <p className="text-gray-500">Pin charts, select backend, view as code.</p>
    </div>
  );
}

function SavedQueries() {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Saved Queries</h2>
      <p className="text-gray-500">Saved queries list.</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/connections" element={<Shell><Connections /></Shell>} />
      <Route path="/explore" element={<Shell><Explore /></Shell>} />
      <Route path="/sql" element={<Shell><SqlWorkbench /></Shell>} />
      <Route path="/dashboards" element={<Shell><Dashboards /></Shell>} />
      <Route path="/dashboards/:id" element={<Shell><DashboardDetail /></Shell>} />
      <Route path="/saved" element={<Shell><SavedQueries /></Shell>} />
      <Route path="*" element={<Navigate to="/connections" replace />} />
    </Routes>
  );
}
