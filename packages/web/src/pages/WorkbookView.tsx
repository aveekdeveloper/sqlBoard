import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { dashboardToDoc } from '../dashboard/model.js';
import FilterBar from '../dashboard/FilterBar.js';
import BlockBody from '../dashboard/BlockBody.js';
import type { FilterValue } from '../dashboard/filters.js';

export default function WorkbookView() {
  const { id } = useParams();
  const workbookId = Number(id);
  const { data: workbook, isLoading } = useQuery({
    queryKey: ['workbook', workbookId],
    queryFn: () => api.workbooks.get(workbookId),
    enabled: Number.isFinite(workbookId) && workbookId > 0,
  });

  const [active, setActive] = useState(0);
  const dashboardId = workbook?.dashboards?.[active]?.id;

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => api.dashboards.get(dashboardId),
    enabled: !!dashboardId,
  });

  const doc = useMemo(() => (dashboard ? dashboardToDoc(dashboard) : null), [dashboard]);
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue>>({});

  if (isLoading || !workbook) return <div className="p-6 text-[12.5px] text-ink-muted">Loading workbook…</div>;

  return (
    <div className="min-h-screen bg-paper p-4 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">{workbook.name}</h1>
        <span className="text-[10.5px] text-ink-faint">{workbook.dashboards?.length ?? 0} dashboards</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(workbook.dashboards || []).map((d: any, i: number) => (
          <button
            key={d.id}
            onClick={() => { setActive(i); setFilterValues({}); }}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              active === i ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
            }`}
          >
            {d.name}
          </button>
        ))}
      </div>
      {doc && (
        <>
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
        </>
      )}
    </div>
  );
}