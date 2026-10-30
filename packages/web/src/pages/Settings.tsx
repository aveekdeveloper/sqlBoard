import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import {
  api,
  type ApiTokenDto,
  type ApiTokenScope,
  type CreatedApiToken,
} from '../api/client.js';
import { useAuth } from '../auth.js';

const SCOPE_LABEL: Record<ApiTokenScope, string> = {
  viewer: 'Viewer — read only',
  analyst: 'Analyst — read + save queries/dashboards',
  member: 'Member — read, write, connections',
  tenant_admin: 'Tenant admin — users, tokens, audit',
  platform_admin: 'Platform admin — tenants',
};

const ROLE_RANK_CLIENT: Record<ApiTokenScope, number> = {
  viewer: 0,
  analyst: 1,
  member: 2,
  tenant_admin: 3,
  platform_admin: 4,
};

const ROLE_CAPABILITIES: Record<ApiTokenScope, string[]> = {
  viewer: ['Read dashboards', 'Run queries', 'Preview tables'],
  analyst: ['Viewer +', 'Save queries/dashboards', 'Share dashboards'],
  member: ['Analyst +', 'Create/edit/delete connections', 'Validate connections'],
  tenant_admin: ['Member +', 'Manage users', 'Revoke tokens', 'Read audit log'],
  platform_admin: ['Tenant admin +', 'Create/update/delete tenants', 'Platform tokens (platform tenant only)'],
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function tokenStatus(token: ApiTokenDto): { label: string; tone: string } {
  if (token.revokedAt) return { label: 'Revoked', tone: 'text-signal' };
  if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) {
    return { label: 'Expired', tone: 'text-warning' };
  }
  return { label: 'Active', tone: 'text-[#3f7d5f]' };
}

export default function Settings() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiTokenScope>('viewer');
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = useState(false);

  const tokensQuery = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.tokens.list(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.tokens.create({
        name: name.trim(),
        scope,
        expiresInDays: expiresInDays === 'never' ? null : Number(expiresInDays),
      }),
    onSuccess: (token) => {
      setCreated(token);
      setCopied(false);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['tokens'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => api.tokens.revoke(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tokens'] }),
  });

  const userRank = role ? (ROLE_RANK_CLIENT[role as ApiTokenScope] ?? 0) : 0;
  const scopeOptions: ApiTokenScope[] = (['viewer', 'analyst', 'member', 'tenant_admin', 'platform_admin'] as ApiTokenScope[]).filter(
    (r) => ROLE_RANK_CLIENT[r] <= userRank,
  );

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      // Clipboard permissions can be denied; the value is still selectable.
    }
  }

  const tokens = (tokensQuery.data ?? []).filter((token) => !!token && typeof token.id === 'number');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">Settings</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Account details, agent credentials, and the machine-readable API.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-[13px] font-semibold text-ink">Account</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 text-[12.5px] sm:grid-cols-2">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">Email</div>
            <div className="mt-0.5 text-ink">{user?.email ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">Role</div>
            <div className="mt-0.5 capitalize text-ink">{role ?? '—'}</div>
          </div>
        </div>
        {role === 'viewer' && (
          <p className="mt-3 rounded-md border border-line bg-paper px-3 py-2 text-[11.5px] text-ink-muted">
            Viewers can read dashboards and run queries. Editing requires the member role.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-[13px] font-semibold text-ink">Roles & permissions</h3>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">
          Fixed role ladder. A token can never exceed your own role.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead className="bg-paper text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Capabilities</th>
              </tr>
            </thead>
            <tbody>
              {(['viewer', 'analyst', 'member', 'tenant_admin', 'platform_admin'] as ApiTokenScope[]).map((r) => (
                <tr key={r} className="border-t border-line">
                  <td className="px-3 py-2 font-medium text-ink">{SCOPE_LABEL[r]}</td>
                  <td className="px-3 py-2 text-ink-muted">{ROLE_CAPABILITIES[r].join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex items-start gap-2">
          <KeyRound size={15} className="mt-0.5 text-ink-muted" />
          <div>
            <h3 className="text-[13px] font-semibold text-ink">API tokens</h3>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
              Long-lived credentials for agents and scripts. A token can never grant more access
              than your own role. Only the hash is stored; the secret is shown once.
            </p>
          </div>
        </div>

        {created && (
          <div className="mt-4 rounded-lg border border-[#ecd9b6] bg-[#fbf3e5] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-medium text-warning">
                Copy “{created.name}” now — it will not be shown again.
              </span>
              <button
                type="button"
                onClick={copyToken}
                className="focus-ring inline-flex items-center gap-1 rounded-md border border-[#ecd9b6] bg-surface px-2 py-1 text-[11px] font-medium text-warning"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <code className="mt-2 block overflow-x-auto rounded-md bg-surface px-2.5 py-2 font-mono text-[11.5px] text-ink">
              {created.token}
            </code>
            <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-muted">
              <span>
                Scope: <span className="capitalize">{created.scope}</span> · Expires:{' '}
                {formatDate(created.expiresAt)}
              </span>
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="font-medium text-ink-muted underline decoration-line underline-offset-2 hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
          className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Token name, e.g. openwebui-agent"
            maxLength={80}
            required
            className="focus-ring rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint"
          />
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as ApiTokenScope)}
            className="focus-ring rounded-md border border-line bg-surface px-2 py-2 text-[12px] text-ink"
            aria-label="Token scope"
          >
            {scopeOptions.map((option) => (
              <option key={option} value={option}>
                {SCOPE_LABEL[option]}
              </option>
            ))}
          </select>
          <select
            value={expiresInDays}
            onChange={(event) => setExpiresInDays(event.target.value)}
            className="focus-ring rounded-md border border-line bg-surface px-2 py-2 text-[12px] text-ink"
            aria-label="Token expiry"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="never">No expiry</option>
          </select>
          <button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            className="focus-ring rounded-md bg-ink px-3 py-2 text-[12px] font-medium text-surface hover:bg-ink-soft disabled:opacity-40"
          >
            {createMutation.isPending ? 'Creating…' : 'Create token'}
          </button>
        </form>

        {createMutation.isError && (
          <p className="mt-2 text-[11.5px] text-signal">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : 'Could not create the token.'}
          </p>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <thead className="bg-paper text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Token</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Scope</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Last used</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Expires</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const status = tokenStatus(token);
                return (
                  <tr key={token.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{token.name}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px] text-ink-muted">
                      {token.prefix}
                    </td>
                    <td className="hidden px-3 py-2 capitalize text-ink-muted sm:table-cell">
                      {token.scope}
                    </td>
                    <td className="hidden px-3 py-2 text-ink-muted md:table-cell">
                      {formatDate(token.lastUsedAt)}
                    </td>
                    <td className="hidden px-3 py-2 text-ink-muted md:table-cell">
                      {token.expiresAt ? formatDate(token.expiresAt) : 'Never'}
                    </td>
                    <td className={`px-3 py-2 font-medium ${status.tone}`}>{status.label}</td>
                    <td className="px-3 py-2 text-right">
                      {!token.revokedAt && (
                        <button
                          type="button"
                          title="Revoke token"
                          onClick={() => {
                            if (confirm(`Revoke “${token.name}”? Any agent using it will stop working.`)) {
                              revokeMutation.mutate(token.id);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-muted hover:text-signal"
                        >
                          <Trash2 size={11} />
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {tokensQuery.isLoading && (
            <div className="px-3 py-6 text-center text-[11.5px] text-ink-faint">Loading tokens…</div>
          )}
          {!tokensQuery.isLoading && tokens.length === 0 && (
            <div className="px-3 py-6 text-center text-[11.5px] text-ink-faint">
              No tokens yet. Create one to connect an agent.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-[13px] font-semibold text-ink">API</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
          Every action in the app is available over HTTP. Use a token with the{' '}
          <code className="rounded bg-paper px-1 py-0.5 font-mono text-[10.5px]">
            Authorization: Bearer &lt;token&gt;
          </code>{' '}
          header.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
          >
            <ExternalLink size={12} />
            API reference
          </a>
          <a
            href="/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
          >
            <ExternalLink size={12} />
            OpenAPI JSON
          </a>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-md bg-paper px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-muted">
{`curl -H "Authorization: Bearer sb_..." \\
  ${typeof window !== 'undefined' ? window.location.origin : ''}/api/dashboards`}
        </pre>
      </section>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex items-start gap-2">
          <KeyRound size={15} className="mt-0.5 text-ink-muted" />
          <div>
            <h3 className="text-[13px] font-semibold text-ink">MCP server (for AI agents)</h3>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
              sqlboard exposes a Model Context Protocol endpoint so any LLM harness
              (semantix, Open WebUI, Claude Desktop, etc.) can use it as a
              headless BI engine. Authenticate with an API token and optionally
              set the{' '}
              <code className="rounded bg-paper px-1 py-0.5 font-mono text-[10.5px]">
                X-Tenant
              </code>{' '}
              header for multi-tenant scoping.
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
              Endpoint
            </span>
            <code className="flex-1 overflow-x-auto rounded-md bg-paper px-2.5 py-1.5 font-mono text-[11px] text-ink">
              ${typeof window !== 'undefined' ? window.location.origin : ''}/mcp
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
              Relative
            </span>
            <code className="flex-1 overflow-x-auto rounded-md bg-paper px-2.5 py-1.5 font-mono text-[11px] text-ink">
              /mcp
            </code>
          </div>
        </div>

        <div className="mt-3">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            Semantix / Open WebUI provisioning
          </div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-paper px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-muted">
{`{
  "transport": "http",
  "url": "${typeof window !== 'undefined' ? window.location.origin : ''}/mcp",
  "headers": {
    "Authorization": "Bearer sb_...",
    "X-Tenant": "default"
  }
}`}
          </pre>
        </div>

        <div className="mt-3">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            Test with curl
          </div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-paper px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-muted">
{`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/mcp \\
  -H "Authorization: Bearer sb_..." \\
  -H "X-Tenant: default" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'`}
          </pre>
        </div>

        <McpToolsList />
      </section>
    </div>
  );
}

function McpToolsList() {
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let sessionId: string | null = null;
    (async () => {
      try {
        const token = localStorage.getItem('sqlboard_token');
        const tenant = localStorage.getItem('sqlboard_tenant');
        const tenantSlug = tenant ? JSON.parse(tenant)?.slug : 'default';
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (tenantSlug) headers['X-Tenant'] = tenantSlug;

        const initRes = await fetch('/mcp', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sqlboard-settings', version: '1.0' } },
          }),
        });
        sessionId = initRes.headers.get('mcp-session-id');
        if (!sessionId) throw new Error('No session ID returned');

        const listRes = await fetch('/mcp', {
          method: 'POST',
          headers: { ...headers, 'mcp-session-id': sessionId },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
        });
        const text = await listRes.text();
        const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) throw new Error('No data in response');
        const parsed = JSON.parse(dataLine.replace('data: ', ''));
        setTools(parsed.result?.tools || []);

        // Close session
        await fetch('/mcp', { method: 'DELETE', headers: { ...headers, 'mcp-session-id': sessionId } });
      } catch (e: any) {
        setError(e.message || 'Failed to load tools');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="mt-3 text-[11.5px] text-ink-faint">Loading available tools…</div>
    );
  }
  if (error) {
    return (
      <div className="mt-3 rounded-md border border-line bg-paper px-3 py-2 text-[11.5px] text-signal">
        Could not load tools: {error}
      </div>
    );
  }

  const grouped: Record<string, any[]> = {};
  for (const t of tools) {
    const group = t.name.startsWith('create_') || t.name.startsWith('apply_') || t.name.startsWith('commit_') || t.name.startsWith('delete_')
      ? 'Write'
      : t.name.startsWith('list_') || t.name.startsWith('get_')
        ? 'Read'
        : 'Other';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(t);
  }

  return (
    <div className="mt-3">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
        Available tools ({tools.length})
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tools.map((t) => (
          <div
            key={t.name}
            className="rounded-md border border-line bg-paper px-2.5 py-2"
          >
            <div className="font-mono text-[11px] font-medium text-ink">{t.name}</div>
            <div className="mt-0.5 text-[10.5px] text-ink-muted line-clamp-2">
              {t.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
