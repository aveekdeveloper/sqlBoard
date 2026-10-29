import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { dashboardToDoc } from '../dashboard/model.js';
import FilterBar from '../dashboard/FilterBar.js';
import type { FilterValue } from '../dashboard/filters.js';
import BlockBody from '../dashboard/BlockBody.js';


export default function DashboardView() {
  const { id } = useParams();
  const dashboardId = Number(id);
  const { data: dashboard, isLoading, error } = useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => api.dashboards.get(dashboardId),
    enabled: Number.isFinite(dashboardId) && dashboardId > 0,
  });

  const doc = useMemo(() => (dashboard ? dashboardToDoc(dashboard) : null), [dashboard]);
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue>>({});

  if (isLoading) return <div className="p-6 text-[12.5px] text-ink-muted">Loading dashboard…</div>;
  if (error || !doc) return <div className="p-6 text-[12.5px] text-signal">Could not load dashboard.</div>;

  const maxRow = doc.items.reduce((m, it) => Math.max(m, it.layout.y + it.layout.h), 0);

  return (
    <div className="min-h-screen bg-paper p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">{doc.name}</h1>
        {doc.description && <p className="mt-1 text-[12.5px] text-ink-muted">{doc.description}</p>}
      </div>
      <div className="mb-4">
        <FilterBar
          filters={doc.filters ?? []}
          values={filterValues}
          editing={false}
          onChange={(name, value) => setFilterValues((prev) => ({ ...prev, [name]: value }))}
          onClearAll={() => {
            const next: Record<string, FilterValue> = {};
            (doc.filters ?? []).forEach((f) => { next[f.name] = null; });
            setFilterValues(next);
          }}
        />
      </div>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridAutoRows: 'minmax(60px, auto)' }}
      >
        {doc.items.map((item, index) => {
          const l = item.layout;
          return (
            <div
              key={index}
              style={{
                gridColumn: `${l.x + 1} / span ${l.w}`,
                gridRow: `${l.y + 1} / span ${l.h}`,
                minHeight: l.h * 60,
              }}
              className="rounded-xl border border-line bg-surface p-2 shadow-card overflow-hidden"
            >
              <BlockBody item={item} filterValues={filterValues} />
            </div>
          );
        })}
      </div>
    </div>
  );
}