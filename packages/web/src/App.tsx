import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

function getToken(): string | null {
  return localStorage.getItem('sqlboard_token');
}

function setToken(token: string | null) {
  if (token) localStorage.setItem('sqlboard_token', token);
  else localStorage.removeItem('sqlboard_token');
}

export { getToken, setToken };

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
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>sqlboard</h1>
      <form onSubmit={submit}>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ width: '100%' }} />
        <label>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ width: '100%' }} />
        <button type="submit" style={{ marginTop: 12 }}>Sign in</button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </form>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div>
      <nav style={{ padding: 12, borderBottom: '1px solid #edebe9', display: 'flex', gap: 12 }}>
        <a href="/connections">Connections</a>
        <a href="/explore">Explore</a>
        <a href="/sql">SQL</a>
        <a href="/dashboards">Dashboards</a>
        <a href="/saved">Saved</a>
        <button onClick={() => { setToken(null); window.location.href = '/login'; }}>Sign out</button>
      </nav>
      {children}
    </div>
  );
}

function Connections() {
  return <div style={{ padding: 24 }}><h2>Connections</h2><p>Manage data connections. (v0.1 scaffold)</p></div>;
}

function Explore() {
  return <div style={{ padding: 24 }}><h2>Explore</h2><p>Browse tables and preview data. (v0.1 scaffold)</p></div>;
}

function SqlWorkbench() {
  return <div style={{ padding: 24 }}><h2>SQL workbench</h2><p>Write SQL, run, annotate, chart. (v0.1 scaffold)</p></div>;
}

function Dashboards() {
  return <div style={{ padding: 24 }}><h2>Dashboards</h2><p>List and create dashboards. (v0.1 scaffold)</p></div>;
}

function DashboardDetail() {
  return <div style={{ padding: 24 }}><h2>Dashboard</h2><p>Pin charts, backend selector, as-code view. (v0.1 scaffold)</p></div>;
}

function SavedQueries() {
  return <div style={{ padding: 24 }}><h2>Saved queries</h2><p>Saved queries list. (v0.1 scaffold)</p></div>;
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
