import { useRef, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Copy, Download, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth.js';

const PAGE_SIZE = 9;

export default function Dashboards() {
  const [name, setName] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortDir, setSortDir] = useState('desc');
  const qc = useQueryClient();
  const { canWrite } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: dashboards } = useQuery({
    queryKey: ['dashboards', tagFilter.join(','), sortBy, sortDir],
    queryFn: () => api.dashboards.list({
      tags: tagFilter.length > 0 ? tagFilter.join(',') : undefined,
      sortBy,
      sortDir,
    }),
  });

  const { data: workbooks } = useQuery({
    queryKey: ['workbooks'],
    queryFn: () => api.workbooks.list(),
  });

  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.tags.list(),
  });

  const createMutation = useMutation({
    mutationFn: (n: string) => api.dashboards.create({ name: n }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboards'] }); setShowForm(false); setName(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.dashboards.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => api.tags.create({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });

  const updateTagsMutation = useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) =>
      api.dashboards.update(id, { tags }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });

  const toggleTag = (name: string) => {
    setTagFilter((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = dashboards || [];
    if (!q) return list;
    return list.filter((d: any) =>
      String(d.name || '').toLowerCase().includes(q) ||
      String(d.description || '').toLowerCase().includes(q) ||
      (d.tags || []).some((t: string) => t.toLowerCase().includes(q)),
    );
  }, [dashboards, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">Dashboards</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Create, open, and manage your dashboards.
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(!showForm)}
              className="focus-ring rounded-md bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-soft"
            >
              {showForm ? 'Cancel' : '+ New dashboard'}
            </button>
            <button
              onClick={async () => {
                const name = window.prompt('Workbook name');
                if (!name) return;
                const ids = window.prompt('Dashboard IDs (comma-separated)');
                const dashboardIds = ids ? ids.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : [];
                try {
                  const wb = await api.workbooks.create({ name, dashboardIds });
                  qc.invalidateQueries({ queryKey: ['workbooks'] });
                  window.location.href = `/workbooks/${wb.id}`;
                } catch (e: any) {
                  window.alert(e?.message || 'Create workbook failed.');
                }
              }}
              className="focus-ring rounded-md border border-line bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
            >
              + New workbook
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="focus-ring rounded-md border border-line bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,.txt"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImporting(true);
                try {
                  const code = await file.text();
                  const res = await api.dashboards.importCode({ code });
                  qc.invalidateQueries({ queryKey: ['dashboards'] });
                  if (res?.dashboard?.id) window.location.href = `/dashboards/${res.dashboard.id}`;
                } catch (err: any) {
                  window.alert(err?.message || 'Import failed.');
                } finally {
                  setImporting(false);
                  e.target.value = '';
                }
              }}
            />
          </div>
        )}
      </div>

      {showForm && canWrite && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMutation.mutate(name.trim()); }}
          className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dashboard name"
            className="focus-ring flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint"
            required
          />
          <button
            type="submit"
            className="focus-ring rounded-md bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-soft"
          >
            Create
          </button>
        </form>
      )}

      <div className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search dashboards..."
            className="focus-ring w-full rounded-md border border-line bg-paper px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint md:max-w-sm"
          />
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="focus-ring rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink"
            >
              <option value="updatedAt">Recently updated</option>
              <option value="createdAt">Newest first</option>
              <option value="name">Name A-Z</option>
            </select>
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="focus-ring rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] text-ink-soft hover:border-line-strong"
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>

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
          {allTags && allTags.map((t: any) => (
            <span
              key={t.id}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                tagFilter.includes(t.name)
                  ? 'bg-accent-soft text-accent-ink'
                  : 'bg-paper text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
              }`}
              style={tagFilter.includes(t.name) && t.color ? { backgroundColor: t.color + '20', color: t.color } : undefined}
            >
              <button type="button" onClick={() => toggleTag(t.name)} className="focus:outline-none">
                {t.name}
              </button>
              {canWrite && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete tag "${t.name}"? It will be removed from all dashboards and queries.`)) {
                      api.tags.delete(t.id).then(() => qc.invalidateQueries({ queryKey: ['tags'] }));
                    }
                  }}
                  className="ml-0.5 text-[9px] hover:text-signal"
                  aria-label={`Delete ${t.name}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {canWrite && (
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTag.trim()) {
                  e.preventDefault();
                  createTagMutation.mutate(newTag.trim());
                  setNewTag('');
                }
              }}
              placeholder="+ new tag"
              className="w-28 rounded-full border border-dashed border-line bg-surface px-2.5 py-0.5 text-[11px] text-ink placeholder:text-ink-faint"
            />
          )}
        </div>
      </div>

      <div className="text-[11.5px] text-ink-faint">
        {filtered.length} dashboard{filtered.length === 1 ? '' : 's'}
        {tagFilter.length > 0 && ` · filtered by ${tagFilter.length} tag${tagFilter.length === 1 ? '' : 's'}`}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {paged.map((d: any) => (
          <div key={d.id} className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-card">
            <a href={`/dashboards/${d.id}`} className="text-[13px] font-medium text-accent hover:underline">
              {d.name}
            </a>
            {d.description && (
              <p className="mt-1 text-[12px] text-ink-muted">{d.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {(d.tags || []).map((tag: string) => {
                const tagInfo = (allTags || []).find((t: any) => t.name === tag);
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[10px] font-medium text-ink-muted"
                    style={tagInfo?.color ? { backgroundColor: tagInfo.color + '18', color: tagInfo.color } : undefined}
                  >
                    {tag}
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = (d.tags || []).filter((t: string) => t !== tag);
                          updateTagsMutation.mutate({ id: d.id, tags: next });
                        }}
                        className="ml-0.5 text-[9px] hover:text-signal"
                        aria-label={`Remove ${tag}`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              {canWrite && (
                <select
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) return;
                    const current = d.tags || [];
                    if (current.includes(name)) return;
                    updateTagsMutation.mutate({ id: d.id, tags: [...current, name] });
                  }}
                  className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-ink-muted"
                  aria-label="Add tag"
                >
                  <option value="">+ tag</option>
                  {(allTags || [])
                    .filter((t: any) => !(d.tags || []).includes(t.name))
                    .map((t: any) => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                </select>
              )}
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-3">
              <span className="text-[10.5px] text-ink-faint">
                {new Date(d.createdAt).toLocaleDateString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      const code = await api.dashboards.exportCode(d.id);
                      const blob = new Blob([code], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `dashboard-${d.id}.sql`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e: any) {
                      window.alert(e?.message || 'Export failed.');
                    }
                  }}
                  className="rounded-md p-1.5 text-ink-soft hover:bg-[#f1eee7] hover:text-ink"
                  title="Export"
                  aria-label="Export dashboard"
                >
                  <Download size={14} />
                </button>
                {canWrite && (
                  <button
                    onClick={async () => {
                      try {
                        const res = await api.dashboards.copy(d.id);
                        window.location.href = `/dashboards/${res.dashboard.id}`;
                      } catch (e: any) {
                        window.alert(e?.message || 'Copy failed.');
                      }
                    }}
                    className="rounded-md p-1.5 text-ink-soft hover:bg-[#f1eee7] hover:text-ink"
                    title="Copy"
                    aria-label="Copy dashboard"
                  >
                    <Copy size={14} />
                  </button>
                )}
                {canWrite && (
                  <button
                    onClick={() => { if (confirm('Delete this dashboard?')) deleteMutation.mutate(d.id); }}
                    className="rounded-md p-1.5 text-signal hover:bg-signal-soft"
                    title="Delete"
                    aria-label="Delete dashboard"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {workbooks && workbooks.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink">Workbooks</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workbooks.map((wb: any) => (
              <div key={wb.id} className="flex flex-col rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <BookOpen size={16} />
                  </span>
                  <a href={`/workbooks/${wb.id}`} className="truncate text-[13px] font-medium text-accent hover:underline">
                    {wb.name}
                  </a>
                </div>
                {wb.description && <p className="mt-2 text-[12px] text-ink-muted">{wb.description}</p>}
                <div className="mt-auto flex items-center justify-between pt-3">
                  <span className="text-[10.5px] text-ink-faint">{wb.dashboardCount} dashboards</span>
                  {canWrite && (
                    <button
                      onClick={() => { if (confirm('Delete this workbook?')) api.workbooks.delete(wb.id).then(() => qc.invalidateQueries({ queryKey: ['workbooks'] })); }}
                      className="rounded-md p-1.5 text-signal hover:bg-signal-soft"
                      title="Delete workbook"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 px-4 py-10 text-center text-[12.5px] text-ink-muted">
          {search ? 'No dashboards match your search.' : 'No dashboards yet. Create one to get started.'}
        </div>
      )}

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
    </div>
  );
}