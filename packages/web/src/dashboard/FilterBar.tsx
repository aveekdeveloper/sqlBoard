import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { ManifestFilter } from '@sqlboard/shared';
import { formatFilterValue, type FilterValue } from './filters.js';

export default function FilterBar({
  filters,
  values,
  onChange,
}: {
  filters: ManifestFilter[];
  values: Record<string, FilterValue>;
  onChange: (name: string, value: FilterValue) => void;
}) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-card">
      {filters.map((filter) => (
        <FilterControl
          key={filter.name}
          filter={filter}
          value={values[filter.name]}
          onChange={(value) => onChange(filter.name, value)}
        />
      ))}
    </div>
  );
}

function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: ManifestFilter;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (filter.values && filter.values.length > 0) {
      setOptions(filter.values);
      if (value === undefined) onChange(filter.defaultValue ?? filter.values[0] ?? null);
      return;
    }
    if (!filter.sql || !filter.connectionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.connections
      .query(filter.connectionId, filter.sql)
      .then((res: any) => {
        if (cancelled) return;
        const cols = res?.columns || [];
        const rows = res?.rows || [];
        const firstCol = cols[0];
        const opts = rows.map((row: any) => String(row?.[firstCol] ?? '')).filter(Boolean);
        setOptions(opts);
        if (value === undefined) {
          onChange(filter.defaultValue ?? opts[0] ?? null);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load options');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, value, onChange]);

  const presentation = filter.presentation || filter.type;

  if (loading) {
    return (
      <div className="rounded-md border border-line bg-paper px-3 py-1.5 text-[11px] text-ink-faint">
        Loading {filter.name}…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-signal/25 bg-signal-soft px-3 py-1.5 text-[11px] text-signal">
        {filter.name}: {error}
      </div>
    );
  }

  if (presentation === 'tabs' || presentation === 'buttons') {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          {filter.name}
        </span>
        <div className="flex gap-1">
          {options.map((option) => {
            const active = value === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-ink text-surface'
                    : 'border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (filter.type === 'multiselect') {
    return (
      <label className="flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="font-semibold uppercase tracking-[0.1em]">{filter.name}</span>
        <select
          multiple
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(event) => {
            const selected = [...event.target.selectedOptions].map((option) => option.value);
            onChange(selected);
          }}
          className="focus-ring rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="flex items-center gap-2 text-[11px] text-ink-muted">
      <span className="font-semibold uppercase tracking-[0.1em]">{filter.name}</span>
      <select
        value={value === null ? '' : String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        className="focus-ring rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="text-[10px] text-ink-faint">{formatFilterValue(value)}</span>
    </label>
  );
}