import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth.js';

const PAGE_SIZE = 9;

export default function Dashboards() {
  const [name, setName] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const { canWrite } = useAuth();

  const { data: dashboards } = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => api.dashboards.list(),
  });

  const createMutation = useMutation({
    mutationFn: (n: string) => api.dashboards.create({ name: n }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboards'] }); setShowForm(false); setName(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.dashboards.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = dashboards || [];
    if (!q) return list;
    return list.filter((d: any) =>
      String(d.name || '').toLowerCase().includes(q) ||
      String(d.description || '').toLowerCase().includes(q),
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
          <button
            onClick={() => setShowForm(!showForm)}
            className="focus-ring rounded-md bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-soft"
          >
            {showForm ? 'Cancel' : '+ New dashboard'}
          </button>
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

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search dashboards..."
          className="focus-ring w-full rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint md:max-w-sm"
        />
        <div className="text-[11.5px] text-ink-faint">
          {filtered.length} dashboard{filtered.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {paged.map((d: any) => (
          <div key={d.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <a href={`/dashboards/${d.id}`} className="text-[13px] font-medium text-accent hover:underline">
              {d.name}
            </a>
            {d.description && (
              <p className="mt-1 text-[12px] text-ink-muted">{d.description}</p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10.5px] text-ink-faint">
                {new Date(d.createdAt).toLocaleDateString()}
              </span>
              {canWrite && (
                <button
                  onClick={() => { if (confirm('Delete this dashboard?')) deleteMutation.mutate(d.id); }}
                  className="text-[11.5px] font-medium text-signal hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

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