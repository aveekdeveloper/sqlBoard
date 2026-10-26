import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from 'lucide-react';
import { useBlockData } from './queries.js';
import { formatCellValue, type ManifestItem, type MetricFormat } from './model.js';
import { BlockEmpty, BlockError, BlockLoading } from './BlockState.js';

type SortState = { column: string; direction: 'asc' | 'desc' } | null;

function isNumericColumn(rows: Record<string, unknown>[], column: string): boolean {
  return rows.some((row) => {
    const value = row[column];
    if (typeof value === 'number') return true;
    return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
  });
}

function compareValues(left: unknown, right: unknown, numeric: boolean): number {
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : -1;
  if (right === null || right === undefined) return 1;
  if (numeric) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export default function TableBody({ item }: { item: ManifestItem }) {
  const { data, isLoading, isError, error, refetch } = useBlockData(item);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);

  const rawConfig = (item.config ?? {}) as Record<string, unknown>;
  const pageSize = Math.min(Math.max(Number(rawConfig.pageSize) || 25, 5), 500);
  const density = rawConfig.density === 'comfortable' ? 'comfortable' : 'compact';
  const rowNumbers = rawConfig.rowNumbers === true;
  const formats = (rawConfig.format ?? {}) as Record<string, MetricFormat>;
  const configuredColumns = Array.isArray(rawConfig.columns)
    ? (rawConfig.columns as string[])
    : [];
  const maxRows = Number(rawConfig.maxRows) || 1000;

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const allColumns = data?.columns ?? [];
  const columns = useMemo(() => {
    if (configuredColumns.length === 0) return allColumns;
    const present = configuredColumns.filter((column) => allColumns.includes(column));
    return present.length > 0 ? present : allColumns;
  }, [allColumns, configuredColumns]);

  const numericColumns = useMemo(
    () => new Set(columns.filter((column) => isNumericColumn(rows, column))),
    [columns, rows],
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const numeric = numericColumns.has(sort.column);
    const copy = rows.slice();
    copy.sort((left, right) => {
      const result = compareValues(left[sort.column], right[sort.column], numeric);
      return sort.direction === 'asc' ? result : -result;
    });
    return copy;
  }, [rows, sort, numericColumns]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [item.id, item.sql, item.connectionId, pageSize, maxRows]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (isLoading) return <BlockLoading variant="table" />;
  if (isError) {
    return (
      <BlockError
        message={error instanceof Error ? error.message : String(error)}
        onRetry={() => refetch()}
      />
    );
  }
  if (rows.length === 0) {
    return <BlockEmpty title="No rows returned" hint="Try widening the filters in the block SQL." />;
  }
  if (columns.length === 0) {
    return <BlockEmpty title="No columns to show" hint="Return at least one column from the query." />;
  }

  const start = (page - 1) * pageSize;
  const visibleRows = sortedRows.slice(start, start + pageSize);
  const capped = rows.length >= maxRows;
  const cellPadding = density === 'comfortable' ? 'px-3 py-2.5' : 'px-3 py-1.5';

  function toggleSort(column: string) {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: 'asc' };
      if (current.direction === 'asc') return { column, direction: 'desc' };
      return null;
    });
    setPage(1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto rounded-[7px] border border-line/80">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-[#faf8f2]">
            <tr>
              {rowNumbers && (
                <th className="w-10 border-b border-line px-2 py-2 text-right text-[10px] font-medium tabular text-ink-faint">
                  #
                </th>
              )}
              {columns.map((column) => {
                const sorted = sort?.column === column;
                const numeric = numericColumns.has(column);
                return (
                  <th
                    key={column}
                    className={`border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted ${
                      numeric ? 'text-right' : 'text-left'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className={`inline-flex max-w-full items-center gap-1 rounded-sm transition-colors hover:text-ink ${
                        numeric ? 'flex-row-reverse' : ''
                      }`}
                      title={`Sort by ${column}`}
                    >
                      <span className="truncate">{column}</span>
                      {sorted ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp size={11} strokeWidth={2} className="shrink-0 text-accent" />
                        ) : (
                          <ArrowDown size={11} strokeWidth={2} className="shrink-0 text-accent" />
                        )
                      ) : (
                        <ChevronsUpDown
                          size={11}
                          strokeWidth={1.8}
                          className="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={start + rowIndex}
                className="group border-b border-line/60 last:border-b-0 hover:bg-[#fbf9f4]"
              >
                {rowNumbers && (
                  <td className={`${cellPadding} text-right text-[10.5px] tabular text-ink-faint`}>
                    {start + rowIndex + 1}
                  </td>
                )}
                {columns.map((column) => {
                  const numeric = numericColumns.has(column);
                  const value = formatCellValue(row[column], formats[column]);
                  return (
                    <td
                      key={column}
                      className={`max-w-[320px] truncate ${cellPadding} ${
                        numeric ? 'text-right tabular text-ink-soft' : 'text-left text-ink-soft'
                      }`}
                      title={value}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 pt-2 text-[10.5px] text-ink-muted">
        <div className="flex min-w-0 items-center gap-2">
          <span className="tabular">
            {start + 1}–{Math.min(start + pageSize, sortedRows.length)} of{' '}
            {sortedRows.length}
          </span>
          {capped && (
            <span className="rounded-full bg-[#f1eee7] px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-ink-faint">
              capped at {maxRows}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="tabular mr-1 text-ink-faint">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="focus-ring flex h-6 w-6 items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-35"
            aria-label="Previous page"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page >= pageCount}
            className="focus-ring flex h-6 w-6 items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-35"
            aria-label="Next page"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
