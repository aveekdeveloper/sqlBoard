import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { markdown as markdownLang } from '@codemirror/lang-markdown';
import {
  BarChart3,
  Gauge,
  Table2,
  Type as TypeIcon,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { api } from '../api/client.js';
import {
  BLOCK_META,
  BLOCK_TYPES,
  DEFAULT_MARKDOWN,
  DEFAULT_SQL,
  FORMAT_OPTIONS,
  createBlock,
  nextLayout,
  type DashboardBlockType,
  type DashboardDoc,
  type ManifestItem,
  type MetricFormat,
} from './model.js';
import { useDebouncedValue } from './queries.js';
import { Button, Dialog, Field, Segmented, Select, TextInput } from './ui.js';
import { BlockCard } from './BlockCard.js';

const TYPE_ICONS = {
  chart: BarChart3,
  metric: Gauge,
  table: Table2,
  text: TypeIcon,
} as const;

interface MetricDraft {
  metricColumn: string;
  priorColumn: string;
  sparklineColumn: string;
  format: MetricFormat;
  higherIsBetter: boolean;
  targetValue: string;
  targetDirection: 'above' | 'below';
  targetAmber: string;
  targetRed: string;
}

interface TableDraft {
  columns: string[];
  pageSize: string;
  maxRows: string;
  density: 'compact' | 'comfortable';
  rowNumbers: boolean;
}

const emptyMetric: MetricDraft = {
  metricColumn: '',
  priorColumn: '',
  sparklineColumn: '',
  format: 'number',
  higherIsBetter: true,
  targetValue: '',
  targetDirection: 'above',
  targetAmber: '0.9',
  targetRed: '0.7',
};

const emptyTable: TableDraft = {
  columns: [],
  pageSize: '25',
  maxRows: '1000',
  density: 'compact',
  rowNumbers: false,
};

function metricDraftFromConfig(item: ManifestItem | null): MetricDraft {
  const raw = (item?.config ?? {}) as Record<string, unknown>;
  const target = raw.target as Record<string, unknown> | undefined;
  const thresholds = target?.thresholds as Record<string, unknown> | undefined;
  const format = raw.format;
  return {
    metricColumn: typeof raw.metricColumn === 'string' ? raw.metricColumn : '',
    priorColumn: typeof raw.priorColumn === 'string' ? raw.priorColumn : '',
    sparklineColumn: typeof raw.sparklineColumn === 'string' ? raw.sparklineColumn : '',
    format:
      format === 'currency' || format === 'percent' || format === 'compact'
        ? format
        : 'number',
    higherIsBetter: raw.higherIsBetter !== false,
    targetValue: target?.value !== undefined ? String(target.value) : '',
    targetDirection: target?.direction === 'below' ? 'below' : 'above',
    targetAmber:
      thresholds?.amber !== undefined ? String(thresholds.amber) : '0.9',
    targetRed: thresholds?.red !== undefined ? String(thresholds.red) : '0.7',
  };
}

function tableDraftFromConfig(item: ManifestItem | null): TableDraft {
  const raw = (item?.config ?? {}) as Record<string, unknown>;
  return {
    columns: Array.isArray(raw.columns) ? (raw.columns as string[]) : [],
    pageSize: raw.pageSize !== undefined ? String(raw.pageSize) : '25',
    maxRows: raw.maxRows !== undefined ? String(raw.maxRows) : '1000',
    density: raw.density === 'comfortable' ? 'comfortable' : 'compact',
    rowNumbers: raw.rowNumbers === true,
  };
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function BlockEditor({
  open,
  initial,
  defaultType,
  doc,
  connections,
  savedQueries = [],
  onClose,
  onSave,
}: {
  open: boolean;
  initial: ManifestItem | null;
  defaultType: DashboardBlockType;
  doc: DashboardDoc;
  connections: Array<{ id: number; name: string }>;
  savedQueries?: Array<{ id: number; name: string; sql: string; connectionId: number }>;
  onClose: () => void;
  onSave: (item: ManifestItem) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DashboardBlockType>('chart');
  const [connectionId, setConnectionId] = useState(0);
  const [savedQueryId, setSavedQueryId] = useState<number | null>(null);
  const [sql, setSql] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [metric, setMetric] = useState<MetricDraft>(emptyMetric);
  const [table, setTable] = useState<TableDraft>(emptyTable);

  useEffect(() => {
    if (!open) return;
    const nextType = initial?.blockType ?? defaultType;
    const base =
      initial ??
      createBlock(doc, nextType, connections[0]?.id ?? 0);
    setTitle(base.title);
    setType(base.blockType);
    setConnectionId(base.connectionId || connections[0]?.id || 0);
    setSavedQueryId(base.savedQueryId ?? null);
    setSql(base.sql);
    setMarkdown(
      String((base.config as { markdown?: string } | null)?.markdown ?? DEFAULT_MARKDOWN),
    );
    setMetric(metricDraftFromConfig(base));
    setTable(tableDraftFromConfig(base));
  }, [open, initial, defaultType, doc, connections]);

  const debouncedSql = useDebouncedValue(sql, 450);
  const columnsQuery = useQuery({
    queryKey: ['editor-columns', connectionId, debouncedSql],
    queryFn: () =>
      api.connections.query(connectionId, debouncedSql, 5) as Promise<{
        columns: string[];
        rows: Record<string, unknown>[];
      }>,
    enabled:
      type !== 'text' && connectionId > 0 && debouncedSql.trim().length > 0 && open,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const availableColumns = columnsQuery.data?.columns ?? [];

  const previewItem = useMemo<ManifestItem>(() => {
    const base = initial ?? createBlock(doc, type, connectionId);
    return {
      ...base,
      title: title.trim() || 'Untitled block',
      blockType: type,
      connectionId: type === 'text' ? 0 : connectionId,
      savedQueryId: type === 'text' ? null : savedQueryId,
      sql: type === 'text' ? '' : sql,
      config: configFromState(),
      layout: initial?.layout ?? nextLayout(doc, type),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initial,
    doc,
    type,
    connectionId,
    title,
    sql,
    markdown,
    metric,
    table,
  ]);

  const preview = useDebouncedValue(previewItem, 500);
  const canSave =
    title.trim().length > 0 &&
    (type === 'text' || (connectionId > 0 && sql.trim().length > 0));

  function configFromState(): Record<string, unknown> | null {
    if (type === 'metric') {
      const targetValue = metric.targetValue.trim();
      return {
        ...(metric.metricColumn ? { metricColumn: metric.metricColumn } : {}),
        ...(metric.priorColumn ? { priorColumn: metric.priorColumn } : {}),
        ...(metric.sparklineColumn ? { sparklineColumn: metric.sparklineColumn } : {}),
        format: metric.format,
        higherIsBetter: metric.higherIsBetter,
        ...(targetValue !== ''
          ? {
              target: {
                value: toNumber(targetValue, 0),
                direction: metric.targetDirection,
                thresholds: {
                  amber: toNumber(metric.targetAmber, 0.9),
                  red: toNumber(metric.targetRed, 0.7),
                },
              },
            }
          : {}),
      };
    }
    if (type === 'table') {
      return {
        ...(table.columns.length > 0 ? { columns: table.columns } : {}),
        pageSize: Math.min(Math.max(toNumber(table.pageSize, 25), 5), 500),
        maxRows: Math.min(Math.max(toNumber(table.maxRows, 1000), 10), 5000),
        density: table.density,
        rowNumbers: table.rowNumbers,
      };
    }
    if (type === 'text') {
      return { markdown };
    }
    return null;
  }

  function changeType(nextType: DashboardBlockType) {
    setType(nextType);
    if (nextType === 'text') {
      setSql('');
      setMarkdown((current) => current || DEFAULT_MARKDOWN);
      return;
    }
    if (type === 'text' || sql.trim() === '' || Object.values(DEFAULT_SQL).includes(sql)) {
      setSql(DEFAULT_SQL[nextType]);
    }
    setConnectionId((current) => current || connections[0]?.id || 0);
  }

  function toggleColumn(column: string) {
    setTable((current) => ({
      ...current,
      columns: current.columns.includes(column)
        ? current.columns.filter((entry) => entry !== column)
        : [...current.columns, column],
    }));
  }

  function save() {
    if (!canSave) return;
    const base = initial ?? createBlock(doc, type, connectionId);
    onSave({
      ...base,
      title: title.trim(),
      blockType: type,
      connectionId: type === 'text' ? 0 : connectionId,
      savedQueryId: type === 'text' ? null : savedQueryId,
      sql: type === 'text' ? '' : sql,
      config: configFromState(),
      layout: initial?.layout ?? nextLayout(doc, type),
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? 'Edit block' : 'Add block'}
      description={
        initial
          ? 'Changes are kept in your draft until you commit or apply the dashboard.'
          : 'Pick a block type, bind a connection, and write the query.'
      }
      width="max-w-5xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {initial ? 'Save block' : 'Add block'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                Block type
              </span>
              <span className="text-[10px] text-ink-faint">
                {BLOCK_META[type].description}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {BLOCK_TYPES.map((option) => {
                const Icon = TYPE_ICONS[option];
                const active = option === type;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => changeType(option)}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-all ${
                      active
                        ? 'border-accent/40 bg-accent-soft/60 text-accent-ink'
                        : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <Icon size={14} strokeWidth={1.8} />
                    <span className="text-[11.5px] font-medium">{BLOCK_META[option].short}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="Title">
              <TextInput
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Monthly revenue"
              />
            </Field>
            {type !== 'text' && (
              <>
                <Field label="Connection">
                  <Select
                    value={connectionId || ''}
                    onChange={(event) => setConnectionId(Number(event.target.value))}
                  >
                    <option value="">Select…</option>
                    {connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {savedQueries.length > 0 && (
                  <Field label="Saved query (optional)">
                    <Select
                      value={savedQueryId ?? ''}
                      onChange={(event) => {
                        const id = event.target.value ? Number(event.target.value) : null;
                        setSavedQueryId(id);
                        const selected = savedQueries.find((q) => q.id === id);
                        if (selected) {
                          setConnectionId(selected.connectionId);
                          setSql(selected.sql);
                        }
                      }}
                    >
                      <option value="">None</option>
                      {savedQueries.map((query) => (
                        <option key={query.id} value={query.id}>
                          {query.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </>
            )}
          </div>

          {type === 'text' ? (
            <Field label="Markdown" hint="GFM subset. Raw HTML is stripped by the renderer.">
              <div className="overflow-hidden rounded-md border border-line bg-[#fdfbf6]">
                <CodeMirror
                  value={markdown}
                  height="230px"
                  theme="light"
                  extensions={[markdownLang()]}
                  basicSetup={{ lineNumbers: true, foldGutter: false }}
                  onChange={setMarkdown}
                />
              </div>
            </Field>
          ) : (
            <Field
              label="Query"
              hint="Chart annotations stay in the SQL. Metric and table annotations are written from the fields below."
            >
              <div className="overflow-hidden rounded-md border border-line bg-[#fdfbf6]">
                <CodeMirror
                  value={sql}
                  height="210px"
                  theme="light"
                  extensions={[sqlLang()]}
                  basicSetup={{ lineNumbers: true, foldGutter: false }}
                  onChange={setSql}
                />
              </div>
            </Field>
          )}

          {type === 'metric' && (
            <div className="space-y-3 rounded-lg border border-line bg-[#fbf9f4] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Metric binding
                </span>
                {columnsQuery.isFetching && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-ink-faint">
                    <Loader2 size={10} className="animate-spin" /> reading columns
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Value column">
                  <ColumnSelect
                    value={metric.metricColumn}
                    columns={availableColumns}
                    onChange={(value) => setMetric({ ...metric, metricColumn: value })}
                  />
                </Field>
                <Field label="Prior column">
                  <ColumnSelect
                    value={metric.priorColumn}
                    columns={availableColumns}
                    onChange={(value) => setMetric({ ...metric, priorColumn: value })}
                    optional
                  />
                </Field>
                <Field label="Sparkline column">
                  <ColumnSelect
                    value={metric.sparklineColumn}
                    columns={availableColumns}
                    onChange={(value) => setMetric({ ...metric, sparklineColumn: value })}
                    optional
                  />
                </Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
                <Field label="Number format">
                  <Select
                    value={metric.format}
                    onChange={(event) =>
                      setMetric({ ...metric, format: event.target.value as MetricFormat })
                    }
                  >
                    {FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="mt-4 flex items-center gap-2 text-[11.5px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={metric.higherIsBetter}
                    onChange={(event) =>
                      setMetric({ ...metric, higherIsBetter: event.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-line accent-[#1d5c4a]"
                  />
                  Higher values are better
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_130px_80px_80px]">
                <Field label="Target" hint="Optional. Adds a progress bar.">
                  <TextInput
                    value={metric.targetValue}
                    onChange={(event) => setMetric({ ...metric, targetValue: event.target.value })}
                    placeholder="e.g. 1000000"
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Direction">
                  <Select
                    value={metric.targetDirection}
                    onChange={(event) =>
                      setMetric({
                        ...metric,
                        targetDirection: event.target.value as 'above' | 'below',
                      })
                    }
                  >
                    <option value="above">At least</option>
                    <option value="below">At most</option>
                  </Select>
                </Field>
                <Field label="Amber at">
                  <TextInput
                    value={metric.targetAmber}
                    onChange={(event) => setMetric({ ...metric, targetAmber: event.target.value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Red at">
                  <TextInput
                    value={metric.targetRed}
                    onChange={(event) => setMetric({ ...metric, targetRed: event.target.value })}
                    inputMode="decimal"
                  />
                </Field>
              </div>
            </div>
          )}

          {type === 'table' && (
            <div className="space-y-3 rounded-lg border border-line bg-[#fbf9f4] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Table options
                </span>
                {columnsQuery.isFetching && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-ink-faint">
                    <Loader2 size={10} className="animate-spin" /> reading columns
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Page size">
                  <TextInput
                    value={table.pageSize}
                    onChange={(event) => setTable({ ...table, pageSize: event.target.value })}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Max rows" hint="Server cap">
                  <TextInput
                    value={table.maxRows}
                    onChange={(event) => setTable({ ...table, maxRows: event.target.value })}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Density">
                  <Segmented
                    size="sm"
                    value={table.density}
                    onChange={(density) => setTable({ ...table, density })}
                    options={[
                      { value: 'compact', label: 'Compact' },
                      { value: 'comfortable', label: 'Roomy' },
                    ]}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[11.5px] text-ink-soft">
                <input
                  type="checkbox"
                  checked={table.rowNumbers}
                  onChange={(event) => setTable({ ...table, rowNumbers: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-line accent-[#1d5c4a]"
                />
                Show row numbers
              </label>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                    Visible columns
                  </span>
                  <span className="text-[10px] text-ink-faint">
                    {availableColumns.length > 0
                      ? 'Empty means all columns'
                      : 'Run the query to load columns'}
                  </span>
                </div>
                {availableColumns.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {availableColumns.map((column) => {
                      const checked = table.columns.includes(column);
                      return (
                        <button
                          key={column}
                          type="button"
                          onClick={() => toggleColumn(column)}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10.5px] transition-colors ${
                            checked
                              ? 'border-accent/40 bg-accent-soft text-accent-ink'
                              : 'border-line bg-surface text-ink-muted hover:border-line-strong'
                          }`}
                        >
                          {column}
                          {checked && <ChevronDown size={10} />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10.5px] text-ink-faint">
                    Columns appear after the query succeeds.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Live preview
          </div>
          <div className="h-[330px]">
            <BlockCard
              item={preview}
              editing={false}
              connections={connections}
              bodyClassName={type === 'metric' ? 'px-4 pb-3' : 'px-2.5 pb-2.5'}
            />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
            Preview uses the current connection and query. Chart warnings appear in the code panel
            after applying.
          </p>
        </div>
      </div>
    </Dialog>
  );
}

function ColumnSelect({
  value,
  columns,
  onChange,
  optional = false,
}: {
  value: string;
  columns: string[];
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{optional ? 'None' : 'Auto-detect'}</option>
      {columns.map((column) => (
        <option key={column} value={column}>
          {column}
        </option>
      ))}
      {value && !columns.includes(value) && <option value={value}>{value}</option>}
    </Select>
  );
}
