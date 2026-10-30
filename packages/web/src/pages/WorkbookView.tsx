import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth.js';
import { dashboardToDoc } from '../dashboard/model.js';
import FilterBar from '../dashboard/FilterBar.js';
import BlockBody from '../dashboard/BlockBody.js';
import type { FilterValue } from '../dashboard/filters.js';

export default function WorkbookView() {
  const { id } = useParams();
  const workbookId = Number(id);
  const { canWrite } = useAuth();
  const qc = useQueryClient();
  const { data: workbook, isLoading } = useQuery({
    queryKey: ['workbook', workbookId],
    queryFn: () => api.workbooks.get(workbookId),
    enabled: Number.isFinite(workbookId) && workbookId > 0,
  });

  const { data: allDashboards } = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => api.dashboards.list(),
    enabled: canWrite,
  });

  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [dashSearch, setDashSearch] = useState('');
  const dashboardId = workbook?.dashboards?.[active]?.id;

  const dashboardIds = (workbook?.dashboards || []).map((d: any) => d.id);

  async function saveOrder(nextIds: number[]) {
    await api.workbooks.update(workbookId, { dashboardIds: nextIds });
    await qc.invalidateQueries({ queryKey: ['workbook', workbookId] });
  }

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
        {canWrite && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="ml-auto rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
          >
            {editing ? 'Done' : 'Edit workbook'}
          </button>
        )}
      </div>

      {editing && canWrite && (
        <div className="mb-4 rounded-xl border border-line bg-surface p-3 shadow-card space-y-3">
          <div className="flex gap-2">
            <input
              value={dashSearch}
              onChange={(e) => setDashSearch(e.target.value)}
              placeholder="Search dashboards to add..."
              className="focus-ring flex-1 rounded-md border border-line bg-paper px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-faint"
            />
          </div>
          <div className="max-h-40 overflow-auto rounded-md border border-line">
            {(allDashboards || [])
              .filter((d: any) => !dashboardIds.includes(d.id) && d.name.toLowerCase().includes(dashSearch.toLowerCase()))
              .map((d: any) => (
                <div key={d.id} className="flex items-center justify-between border-b border-line/60 px-3 py-2 text-[12.5px]">
                  <span className="text-ink">{d.name}</span>
                  <button
                    onClick={async () => {
                      await saveOrder([...dashboardIds, d.id]);
                    }}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
                  >
                    Add
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(workbook.dashboards || []).map((d: any, i: number) => (
          <div key={d.id} className="flex items-center gap-1">
            <button
              onClick={() => { setActive(i); setFilterValues({}); }}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                active === i ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
              }`}
            >
              {d.name}
            </button>
            {editing && canWrite && (
              <>
                <button
                  onClick={async () => {
                    if (i === 0) return;
                    const next = [...dashboardIds];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    await saveOrder(next);
                    setActive(i - 1);
                  }}
                  className="rounded px-1 text-[10px] text-ink-muted hover:text-ink"
                  title="Move left"
                >
                  ←
                </button>
                <button
                  onClick={async () => {
                    if (i === dashboardIds.length - 1) return;
                    const next = [...dashboardIds];
                    [next[i], next[i + 1]] = [next[i + 1], next[i]];
                    await saveOrder(next);
                    setActive(i + 1);
                  }}
                  className="rounded px-1 text-[10px] text-ink-muted hover:text-ink"
                  title="Move right"
                >
                  →
                </button>
                <button
                  onClick={async () => {
                    const next = dashboardIds.filter((x: number) => x !== d.id);
                    await saveOrder(next);
                    setActive(0);
                  }}
                  className="rounded px-1 text-[10px] text-signal hover:text-signal"
                  title="Remove"
                >
                  ×
                </button>
              </>
            )}
          </div>
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