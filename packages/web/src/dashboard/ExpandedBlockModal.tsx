import { useBlockData } from './queries.js';
import BlockBody from './BlockBody.js';
import type { ManifestItem } from './model.js';
import type { FilterValue } from './filters.js';

export default function ExpandedBlockModal({
  item,
  filterValues,
  onClose,
}: {
  item: ManifestItem;
  filterValues?: Record<string, FilterValue>;
  onClose: () => void;
}) {
  const dataQuery = useBlockData(item, true, filterValues);
  const rows = dataQuery.data?.rows ?? [];
  const columns = dataQuery.data?.columns ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-6xl max-h-[90vh] overflow-auto rounded-xl border border-line bg-surface p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-ink">{item.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[12px] text-ink-muted hover:bg-[#f1eee7] hover:text-ink"
          >
            ✕ Close
          </button>
        </div>
        <div className="h-[55vh] w-full rounded-lg border border-line bg-paper p-2">
          <BlockBody item={item} filterValues={filterValues} />
        </div>
        {item.blockType === 'chart' && (
          <div className="mt-4">
            <h4 className="mb-2 text-[12px] font-semibold text-ink">Underlying data</h4>
            {dataQuery.isLoading ? (
              <p className="text-[12px] text-ink-muted">Loading data…</p>
            ) : rows.length === 0 ? (
              <p className="text-[12px] text-ink-muted">No data.</p>
            ) : (
              <div className="max-h-64 overflow-auto rounded-md border border-line">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-paper">
                    <tr>
                      {columns.map((c: string) => (
                        <th key={c} className="border-b border-line px-3 py-2 text-left font-medium text-ink-muted">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((row: any, i: number) => (
                      <tr key={i} className="border-b border-line/60 hover:bg-[#f7f4ed]">
                        {columns.map((c: string) => (
                          <td key={c} className="whitespace-nowrap px-3 py-2 text-ink-soft">
                            {String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > 200 && (
              <p className="mt-1 text-[10.5px] text-ink-faint">Showing 200 of {rows.length} rows.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}