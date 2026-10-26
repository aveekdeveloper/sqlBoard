import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const CONNECTION_TYPES = [
  { value: 'duckdb', label: 'File upload (CSV/Parquet/JSON)', fields: [] },
  { value: 'sqlite', label: 'SQLite file', fields: ['path'] },
  { value: 'postgres', label: 'PostgreSQL', fields: ['host', 'port', 'database', 'user', 'password'] },
  { value: 'databricks', label: 'Databricks', fields: ['host', 'httpPath', 'token'] },
  { value: 'snowflake', label: 'Snowflake', fields: ['account', 'user', 'password', 'warehouse', 'database', 'schema'] },
];

export default function Connections() {
  const [connections, setConnections] = useState<any[]>([]);
  const [uploads, setUploads] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState('postgres');
  const [form, setForm] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState<number | null>(null);

  async function load() {
    try {
      setConnections(await api.connections.list());
      setUploads(await api.uploads.list());
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function createConnection(e: React.FormEvent) {
    e.preventDefault();
    setStatus('');
    try {
      const body: any = { type, name: form.name || 'Untitled' };
      if (type === 'sqlite') body.path = form.path;
      if (type === 'postgres') {
        body.host = form.host; body.port = Number(form.port || 5432);
        body.database = form.database; body.user = form.user; body.password = form.password;
        body.ssl = form.ssl === 'true';
      }
      if (type === 'databricks') {
        body.host = form.host; body.httpPath = form.httpPath; body.token = form.token;
      }
      if (type === 'snowflake') {
        body.account = form.account; body.user = form.user; body.password = form.password;
        body.warehouse = form.warehouse; body.database = form.database; body.schema = form.schema;
      }
      await api.connections.create(body);
      setShowForm(false);
      setForm({});
      await load();
      setStatus('Connection created.');
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function testConnection(id: number) {
    setTesting(id);
    setStatus('');
    try {
      const res = await api.connections.test(id);
      setStatus(`Connection ${id}: OK (${res.tableCount} tables)`);
    } catch (e: any) {
      setStatus(`Connection ${id}: ${e.message}`);
    } finally {
      setTesting(null);
    }
  }

  async function deleteConnection(id: number) {
    if (!confirm('Delete this connection?')) return;
    try {
      await api.connections.delete(id);
      await load();
      setStatus('Connection deleted.');
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('Uploading...');
    try {
      const res = await api.uploads.upload(file);
      setStatus(`Uploaded ${res.filename} (${res.rowCount} rows) as table "${res.tableName}".`);
      await load();
    } catch (e: any) {
      setStatus(e.message);
    }
    e.target.value = '';
  }

  const selectedType = CONNECTION_TYPES.find((t) => t.value === type)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Connections</h2>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
          {showForm ? 'Cancel' : '+ New connection'}
        </button>
      </div>

      {status && <p className="text-sm text-gray-600 bg-gray-100 rounded px-3 py-2">{status}</p>}

      {showForm && (
        <form onSubmit={createConnection} className="bg-white rounded-lg shadow-sm p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select value={type} onChange={(e) => { setType(e.target.value); setForm({}); }} className="w-full border rounded px-3 py-2">
              {CONNECTION_TYPES.filter((t) => t.value !== 'duckdb').map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded px-3 py-2" required />
          </div>
          {selectedType.fields.includes('host') && (
            <div>
              <label className="block text-sm font-medium mb-1">Host</label>
              <input value={form.host || ''} onChange={(e) => setForm({ ...form, host: e.target.value })} className="w-full border rounded px-3 py-2" required />
            </div>
          )}
          {selectedType.fields.includes('port') && (
            <div>
              <label className="block text-sm font-medium mb-1">Port</label>
              <input value={form.port || '5432'} onChange={(e) => setForm({ ...form, port: e.target.value })} type="number" className="w-full border rounded px-3 py-2" />
            </div>
          )}
          {selectedType.fields.includes('database') && (
            <div>
              <label className="block text-sm font-medium mb-1">Database</label>
              <input value={form.database || ''} onChange={(e) => setForm({ ...form, database: e.target.value })} className="w-full border rounded px-3 py-2" required />
            </div>
          )}
          {selectedType.fields.includes('user') && (
            <div>
              <label className="block text-sm font-medium mb-1">User</label>
              <input value={form.user || ''} onChange={(e) => setForm({ ...form, user: e.target.value })} className="w-full border rounded px-3 py-2" required />
            </div>
          )}
          {selectedType.fields.includes('password') && (
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" className="w-full border rounded px-3 py-2" />
            </div>
          )}
          {selectedType.fields.includes('path') && (
            <div>
              <label className="block text-sm font-medium mb-1">File path</label>
              <input value={form.path || ''} onChange={(e) => setForm({ ...form, path: e.target.value })} className="w-full border rounded px-3 py-2" required />
            </div>
          )}
          {selectedType.fields.includes('httpPath') && (
            <div>
              <label className="block text-sm font-medium mb-1">HTTP Path</label>
              <input value={form.httpPath || ''} onChange={(e) => setForm({ ...form, httpPath: e.target.value })} className="w-full border rounded px-3 py-2" required />
            </div>
          )}
          {selectedType.fields.includes('token') && (
            <div>
              <label className="block text-sm font-medium mb-1">Token (PAT)</label>
              <input value={form.token || ''} onChange={(e) => setForm({ ...form, token: e.target.value })} type="password" className="w-full border rounded px-3 py-2" required />
            </div>
          )}
          {selectedType.fields.includes('account') && (
            <div>
              <label className="block text-sm font-medium mb-1">Account</label>
              <input value={form.account || ''} onChange={(e) => setForm({ ...form, account: e.target.value })} className="w-full border rounded px-3 py-2" required />
            </div>
          )}
          {selectedType.fields.includes('warehouse') && (
            <div>
              <label className="block text-sm font-medium mb-1">Warehouse (optional)</label>
              <input value={form.warehouse || ''} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} className="w-full border rounded px-3 py-2" />
            </div>
          )}
          {selectedType.fields.includes('schema') && (
            <div>
              <label className="block text-sm font-medium mb-1">Schema (optional)</label>
              <input value={form.schema || ''} onChange={(e) => setForm({ ...form, schema: e.target.value })} className="w-full border rounded px-3 py-2" />
            </div>
          )}
          <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">Create</button>
        </form>
      )}

      {/* File upload */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="font-medium mb-2">Upload a file</h3>
        <p className="text-sm text-gray-500 mb-3">CSV, Parquet, or JSON — loaded into DuckDB as a table.</p>
        <input type="file" accept=".csv,.parquet,.json" onChange={handleUpload} className="text-sm" />
      </div>

      {/* Connection list */}
      <div className="space-y-2">
        {connections.map((c) => (
          <div key={c.id} className="bg-white rounded-lg shadow-sm p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{c.name}</div>
              <div className="text-sm text-gray-500">{c.type} · {c.configSummary}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => testConnection(c.id)}
                disabled={testing === c.id}
                className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50"
              >
                {testing === c.id ? 'Testing...' : 'Test'}
              </button>
              <button onClick={() => deleteConnection(c.id)} className="text-sm border rounded px-3 py-1.5 text-red-600 hover:bg-red-50">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Uploads list */}
      {uploads.length > 0 && (
        <div>
          <h3 className="font-medium mb-2">Uploaded files</h3>
          <div className="space-y-2">
            {uploads.map((u) => (
              <div key={u.id} className="bg-white rounded-lg shadow-sm p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.filename}</div>
                  <div className="text-sm text-gray-500">table: {u.tableName} · {u.rowCount} rows · {(u.sizeBytes / 1024).toFixed(1)} KB</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}