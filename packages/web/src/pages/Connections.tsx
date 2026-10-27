import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth.js';

const CONNECTION_TYPES = [
  { value: 'duckdb', label: 'File upload (CSV/Parquet/JSON)', fields: [] },
  { value: 'sqlite', label: 'SQLite file', fields: ['path'] },
  { value: 'postgres', label: 'PostgreSQL', fields: ['host', 'port', 'database', 'user', 'password'] },
  { value: 'mysql', label: 'MySQL', fields: ['host', 'port', 'database', 'user', 'password'] },
  { value: 'clickhouse', label: 'ClickHouse', fields: ['host', 'port', 'database', 'user', 'password'] },
  { value: 'trino', label: 'Trino', fields: ['host', 'port', 'catalog', 'schema', 'user', 'password'] },
  { value: 'databricks', label: 'Databricks', fields: ['host', 'httpPath', 'token'] },
  { value: 'snowflake', label: 'Snowflake', fields: ['account', 'user', 'password', 'warehouse', 'database', 'schema'] },
];

export default function Connections() {
  const { canWrite } = useAuth();
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
      if (type === 'mysql') {
        body.host = form.host; body.port = Number(form.port || 3306);
        body.database = form.database; body.user = form.user; body.password = form.password;
        body.ssl = form.ssl === 'true';
      }
      if (type === 'clickhouse') {
        body.host = form.host; body.port = Number(form.port || 8123);
        body.database = form.database || 'default'; body.user = form.user || 'default'; body.password = form.password || '';
        body.ssl = form.ssl === 'true';
      }
      if (type === 'trino') {
        body.host = form.host; body.port = Number(form.port || 8080);
        body.catalog = form.catalog || 'hive'; body.schema = form.schema || 'default';
        body.user = form.user; body.password = form.password || '';
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
  const inputClass =
    'focus-ring w-full rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">Connections</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Manage database connections and uploaded files.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="focus-ring rounded-md bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-soft"
          >
            {showForm ? 'Cancel' : '+ New connection'}
          </button>
        )}
      </div>

      {status && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-muted">
          {status}
        </div>
      )}

      {showForm && canWrite && (
        <form onSubmit={createConnection} className="rounded-xl border border-line bg-surface p-4 shadow-card space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setForm({}); }}
              className={inputClass}
            >
              {CONNECTION_TYPES.filter((t) => t.value !== 'duckdb').map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Name
            </label>
            <input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
              required
            />
          </div>
          {selectedType.fields.includes('host') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Host</label>
              <input value={form.host || ''} onChange={(e) => setForm({ ...form, host: e.target.value })} className={inputClass} required />
            </div>
          )}
          {selectedType.fields.includes('port') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Port</label>
              <input value={form.port || (type === 'mysql' ? '3306' : type === 'clickhouse' ? '8123' : type === 'trino' ? '8080' : type === 'postgres' ? '5432' : '')} onChange={(e) => setForm({ ...form, port: e.target.value })} type="number" className={inputClass} />
            </div>
          )}
          {selectedType.fields.includes('database') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Database</label>
              <input value={form.database || ''} onChange={(e) => setForm({ ...form, database: e.target.value })} className={inputClass} required={type !== 'clickhouse'} />
            </div>
          )}
          {selectedType.fields.includes('user') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">User</label>
              <input value={form.user || ''} onChange={(e) => setForm({ ...form, user: e.target.value })} className={inputClass} required={type !== 'clickhouse'} />
            </div>
          )}
          {selectedType.fields.includes('password') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Password</label>
              <input value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" className={inputClass} />
            </div>
          )}
          {selectedType.fields.includes('path') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">File path</label>
              <input value={form.path || ''} onChange={(e) => setForm({ ...form, path: e.target.value })} className={inputClass} required />
            </div>
          )}
          {selectedType.fields.includes('httpPath') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">HTTP Path</label>
              <input value={form.httpPath || ''} onChange={(e) => setForm({ ...form, httpPath: e.target.value })} className={inputClass} required />
            </div>
          )}
          {selectedType.fields.includes('token') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Token (PAT)</label>
              <input value={form.token || ''} onChange={(e) => setForm({ ...form, token: e.target.value })} type="password" className={inputClass} required />
            </div>
          )}
          {selectedType.fields.includes('account') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Account</label>
              <input value={form.account || ''} onChange={(e) => setForm({ ...form, account: e.target.value })} className={inputClass} required />
            </div>
          )}
          {selectedType.fields.includes('warehouse') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Warehouse (optional)</label>
              <input value={form.warehouse || ''} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} className={inputClass} />
            </div>
          )}
          {selectedType.fields.includes('catalog') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Catalog</label>
              <input value={form.catalog || ''} onChange={(e) => setForm({ ...form, catalog: e.target.value })} className={inputClass} required />
            </div>
          )}
          {selectedType.fields.includes('schema') && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Schema (optional)</label>
              <input value={form.schema || ''} onChange={(e) => setForm({ ...form, schema: e.target.value })} className={inputClass} />
            </div>
          )}
          {selectedType.fields.includes('ssl') && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
              <input
                type="checkbox"
                checked={form.ssl === 'true'}
                onChange={(e) => setForm({ ...form, ssl: String(e.target.checked) })}
                className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
              />
              Use SSL
            </label>
          )}
          <button
            type="submit"
            className="focus-ring rounded-md bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-soft"
          >
            Create
          </button>
        </form>
      )}

      {/* File upload */}
      {canWrite && (
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Upload a file</h3>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            CSV, Parquet, or JSON — loaded into DuckDB as a table.
          </p>
          <input
            type="file"
            accept=".csv,.parquet,.json"
            onChange={handleUpload}
            className="mt-3 block text-[12px] text-ink-soft file:mr-3 file:rounded-md file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-ink"
          />
        </div>
      )}

      {/* Connection list */}
      <div className="space-y-2">
        {connections.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">{c.name}</div>
              <div className="text-[11.5px] text-ink-muted">
                {c.type} · {c.configSummary}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => testConnection(c.id)}
                disabled={testing === c.id}
                className="focus-ring rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:border-line-strong hover:text-ink disabled:opacity-50"
              >
                {testing === c.id ? 'Testing...' : 'Test'}
              </button>
              {canWrite && (
                <button
                  onClick={() => deleteConnection(c.id)}
                  className="focus-ring rounded-md border border-signal/25 bg-signal-soft px-3 py-1.5 text-[12px] font-medium text-signal hover:border-signal/50"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {connections.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-[12.5px] text-ink-muted">
            No connections yet. Create one or upload a file.
          </div>
        )}
      </div>

      {/* Uploads list */}
      {uploads.length > 0 && (
        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Uploaded files
          </h3>
          <div className="space-y-2">
            {uploads.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{u.filename}</div>
                  <div className="text-[11.5px] text-ink-muted">
                    table: {u.tableName} · {u.rowCount} rows · {(u.sizeBytes / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete ${u.filename}?`)) return;
                    try {
                      await api.uploads.delete(u.id);
                      setStatus(`Deleted ${u.filename}.`);
                      await load();
                    } catch (e: any) {
                      setStatus(e.message);
                    }
                  }}
                  className="shrink-0 text-[12px] font-medium text-signal hover:underline"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}