import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth.js';

const PAGE_SIZE = 8;

const SORT_OPTIONS = [
  { value: 'updatedAt', label: 'Recently updated' },
  { value: 'createdAt', label: 'Newest first' },
  { value: 'name', label: 'Name A-Z' },
];

export default function SavedQueries() {
  const qc = useQueryClient();
  const { canWrite } = useAuth();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [connectionFilter, setConnectionFilter] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortDir, setSortDir] = useState('desc');

  const { data: queries, isLoading } = useQuery({
    queryKey: ['saved-queries', tagFilter.join(','), connectionFilter, sortBy, sortDir],
    queryFn: () => api.savedQueries.list({
      tags: tagFilter.length > 0 ? tagFilter.join(',') : undefined,
      connectionId: connectionFilter ?? undefined,
      sortBy,
      sortDir,
    }),
  });

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
  });

  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.tags.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.savedQueries.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-queries'] });
      setStatus('Saved query deleted.');
    },
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => api.tags.create({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });

  const toggleTag = (name: string) => {
    setTagFilter((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = queries || [];
    if (!q) return list;
    return list.filter((item: any) =>
      String(item.name || '').toLowerCase().includes(q) ||
      String(item.sql || '').toLowerCase().includes(q) ||
      (item.tags || []).some((t: string) => t.toLowerCase().includes(q)),
    );
  }, [queries, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">Saved Queries</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Reopen saved SQL in the workbench or remove queries you no longer need.
        </p>
      </div>

      {status && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-muted">
          {status}
        </div>
      )}

      {/* Filter bar */}
      <div className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search saved queries..."
            className="focus-ring w-full rounded-md border border-line bg-paper px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint md:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <select
              value={connectionFilter ?? ''}
              onChange={(e) => { setConnectionFilter(e.target.value ? Number(e.target.value) : null); setPage(1); }}
              className="focus-ring rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink"
            >
              <option value="">All connections</option>
              {(connections || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="focus-ring rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="focus-ring rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] text-ink-soft hover:border-line-strong"
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {/* Tag filter chips */}
        {allTags && allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-faint mr-1">Tags:</span>
            <button
              onClick={() => { setTagFilter([]); setPage(1); }}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                tagFilter.length === 0
                  ? 'bg-accent-soft text-accent-ink'
                  : 'bg-paper text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
              }`}
            >
              All
            </button>
            {allTags.map((t: any) => (
              <button
                key={t.id}
                onClick={() => toggleTag(t.name)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  tagFilter.includes(t.name)
                    ? 'bg-accent-soft text-accent-ink'
                    : 'bg-paper text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
                }`}
                style={tagFilter.includes(t.name) && t.color ? { backgroundColor: t.color + '20', color: t.color } : undefined}
              >
                {t.name}
                {t.usageCount > 0 && <span className="ml-1 text-[9px] opacity-60">{t.usageCount}</span>}
              </button>
            ))}
            {canWrite && (
              <button
                onClick={() => {
                  const name = window.prompt('New tag name');
                  if (name && name.trim()) createTagMutation.mutate(name.trim());
                }}
                className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-[11px] font-medium text-ink-muted hover:border-line-strong hover:text-ink"
              >
                + New tag
              </button>
            )}
          </div>
        )}
      </div>

      <div className="text-[11.5px] text-ink-faint">
        {filtered.length} saved quer{filtered.length === 1 ? 'y' : 'ies'}
        {tagFilter.length > 0 && ` · filtered by ${tagFilter.length} tag${tagFilter.length === 1 ? '' : 's'}`}
      </div>

      <div className="space-y-2">
        {paged.map((q: any) => {
          const conn = (connections || []).find((c: any) => c.id === q.connectionId);
          return (
            <div
              key={q.id}
              className="rounded-xl border border-line bg-surface p-4 shadow-card"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="truncate text-[13px] font-medium text-ink">{q.name}</div>
                    {(q.tags || []).map((tag: string) => {
                      const tagInfo = (allTags || []).find((t: any) => t.name === tag);
                      return (
                        <span
                          key={tag}
                          className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-medium text-ink-muted"
                          style={tagInfo?.color ? { backgroundColor: tagInfo.color + '18', color: tagInfo.color } : undefined}
                        >
                          {tag}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink-muted">
                    {conn?.name || `conn #${q.connectionId}`} ·{' '}
                    {new Date(q.updatedAt).toLocaleDateString()}
                  </div>
                  <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-paper p-3 text-[11px] text-ink-soft whitespace-pre-wrap">
                    {q.sql}
                  </pre>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`/sql?saved=${q.id}`}
                    className="focus-ring rounded-md border border-accent/30 bg-accent-soft px-3 py-1.5 text-[12px] font-medium text-accent hover:bg-accent-soft/70"
                  >
                    Open in workbench
                  </a>
                  {canWrite && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this saved query?')) deleteMutation.mutate(q.id);
                      }}
                      className="focus-ring rounded-md border border-signal/25 bg-signal-soft px-3 py-1.5 text-[12px] font-medium text-signal hover:border-signal/50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="focus-ring rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:border-line-strong disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[11.5px] text-ink-muted">
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="focus-ring rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:border-line-strong disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 px-4 py-10 text-center text-[12.5px] text-ink-muted">
          {search || tagFilter.length > 0 || connectionFilter
            ? 'No saved queries match your filters.'
            : 'No saved queries yet. Save one from the SQL workbench.'}
        </div>
      )}
    </div>
  );
}