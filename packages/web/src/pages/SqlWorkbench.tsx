import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { keymap } from '@codemirror/view';
import * as echarts from 'echarts';
import { api } from '../api/client.js';
import { useAuth } from '../auth.js';
import HistoryDialog from '../dashboard/HistoryDialog.js';
import { styleAxes, styleBars } from '../dashboard/ChartBody.js';

export default function SqlWorkbench() {
  const { canWrite } = useAuth();
  const [searchParams] = useSearchParams();
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [sqlText, setSqlText] = useState(
    '-- @viz: bar\n-- @x: month\n-- @y: revenue\n-- @groupby: region\nSELECT month, region, SUM(revenue) AS revenue FROM data GROUP BY month, region;',
  );
  const [result, setResult] = useState<any>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [showGrammar, setShowGrammar] = useState(false);
  const [tables, setTables] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [tableFilter, setTableFilter] = useState('');
  const [savedQueryId, setSavedQueryId] = useState<number | null>(null);
  const [savedQueryName, setSavedQueryName] = useState('');
  const [savedQueryVersion, setSavedQueryVersion] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [expanded, setExpanded] = useState<'preview' | 'results' | 'chart' | null>(null);
  const [activeTab, setActiveTab] = useState<'results' | 'chart'>('results');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const expandedChartRef = useRef<HTMLDivElement>(null);
  const expandedChartInstance = useRef<any>(null);

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
  });

  const versionsQuery = useQuery({
    queryKey: ['saved-query-versions', savedQueryId],
    queryFn: () => api.savedQueries.listVersions(savedQueryId!),
    enabled: !!savedQueryId && historyOpen,
  });

  useEffect(() => {
    if (connections && connections.length > 0 && !connectionId && !searchParams.get('saved')) {
      const connParam = searchParams.get('conn');
      const defaultConn = connParam ? Number(connParam) : connections[0].id;
      setConnectionId(defaultConn);
    }
  }, [connections, connectionId, searchParams]);

  useEffect(() => {
    const savedId = searchParams.get('saved');
    if (!savedId) {
      setSavedQueryId(null);
      setSavedQueryName('');
      setSavedQueryVersion(0);
      return;
    }
    api.savedQueries
      .get(Number(savedId))
      .then((q: any) => {
        setConnectionId(q.connectionId);
        setSqlText(q.sql);
        setSavedQueryId(q.id);
        setSavedQueryName(q.name);
        setSavedQueryVersion(q.latestVersion ?? 0);
        setStatus(`Loaded saved query "${q.name}".`);
      })
      .catch(() => {});
  }, [searchParams]);

  useEffect(() => {
    if (!connectionId) return;
    api.connections
      .tables(connectionId)
      .then(setTables)
      .catch(() => setTables([]));
    setSelectedTable(null);
    setPreview(null);
  }, [connectionId]);

  useEffect(() => {
    const tableParam = searchParams.get('table');
    if (tableParam) {
      setSqlText(`SELECT * FROM ${tableParam} LIMIT 100;`);
    }
  }, [searchParams]);

  async function loadPreview(table: string) {
    if (!connectionId) return;
    setSelectedTable(table);
    try {
      const res = await api.connections.preview(connectionId, table);
      setPreview(res);
    } catch (e: any) {
      setPreview({ error: e.message });
    }
  }

  async function runQuery() {
    if (!connectionId) {
      setStatus('Select a connection first.');
      return;
    }
    setStatus('Running...');
    try {
      const res = await api.connections.query(connectionId, sqlText);
      setResult(res);
      setStatus(
        `${res.rowCount} row${res.rowCount === 1 ? '' : 's'} returned${res.cached ? ' (cached)' : ''}.`,
      );
    } catch (e: any) {
      setStatus(e.message);
      setResult(null);
    }
  }

  async function compileChart() {
    if (!result || !result.rows || result.rows.length === 0) {
      setStatus('Run a query first to get data.');
      return;
    }
    setCompiling(true);
    setStatus('Compiling...');
    try {
      const res = await api.compile({
        sql: sqlText,
        data: result.rows,
        backends: ['echarts', 'vegalite', 'chartjs', 'plotly'],
      });
      setCompileResult(res);
      renderChart(res, chartRef.current, chartInstance);
      const errCount = res.diagnostics.filter((d: any) => d.severity === 'error').length;
      const warnCount = res.diagnostics.filter((d: any) => d.severity === 'warning').length;
      setStatus(`Compiled: ${res.flint?.chart_spec?.chartType || '?'} · ${errCount} error(s), ${warnCount} warning(s).`);
      setActiveTab('chart');
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setCompiling(false);
    }
  }

  function renderChart(res: any, container: HTMLDivElement | null, instanceRef: React.MutableRefObject<any>) {
    if (!container) return;
    if (instanceRef.current && instanceRef.current.getDom && instanceRef.current.getDom() !== container) {
      try { instanceRef.current.dispose(); } catch (e) {}
      instanceRef.current = null;
    }
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(container);
    }
    const spec = res.compiled?.echarts || res.echarts;
    if (spec && instanceRef.current) {
      instanceRef.current.setOption(styleAxes(styleBars(spec as Record<string, unknown>, sqlText), sqlText), true);
      setTimeout(() => {
        try {
          instanceRef.current.resize();
        } catch (e) {}
      }, 50);
    } else {
      console.log('renderChart no spec', res);
    }
  }

  async function saveQuery() {
    if (!connectionId) {
      setStatus('Select a connection first.');
      return;
    }

    if (savedQueryId) {
      try {
        const updated = await api.savedQueries.update(savedQueryId, {
          sql: sqlText,
          connectionId,
          message: `Update ${savedQueryName || 'query'}`,
        });
        setSavedQueryVersion(updated.latestVersion ?? savedQueryVersion);
        setStatus(`Saved as v${updated.latestVersion ?? savedQueryVersion}.`);
      } catch (e: any) {
        setStatus(e.message);
      }
      return;
    }

    const name = prompt('Query name:');
    if (!name) return;
    try {
      const existing = await api.savedQueries.list();
      const conflict = (existing || []).find((q: any) => q.name === name);
      if (conflict) {
        const overwrite = window.confirm(
          `A saved query named "${name}" already exists. Overwrite it?`,
        );
        if (!overwrite) {
          setStatus(`A saved query named "${name}" already exists.`);
          return;
        }
        const updated = await api.savedQueries.update(conflict.id, {
          name,
          connectionId,
          sql: sqlText,
          message: `Update ${name}`,
        });
        setSavedQueryId(conflict.id);
        setSavedQueryName(name);
        setSavedQueryVersion(updated.latestVersion ?? 0);
        setStatus(`Saved as v${updated.latestVersion ?? 0}.`);
        return;
      }
      const created = await api.savedQueries.create({ name, connectionId, sql: sqlText });
      setSavedQueryId(created.id);
      setSavedQueryName(created.name);
      setSavedQueryVersion(created.latestVersion ?? 1);
      setStatus(`Saved as "${created.name}" (v${created.latestVersion ?? 1}).`);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function restoreVersion(version: number) {
    if (!savedQueryId) return;
    setRestoring(true);
    try {
      const updated = await api.savedQueries.restoreVersion(savedQueryId, version);
      setSqlText(updated.sql);
      setSavedQueryVersion(updated.latestVersion ?? savedQueryVersion);
      setStatus(`Restored v${version} as v${updated.latestVersion}.`);
      setHistoryOpen(false);
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setRestoring(false);
    }
  }

  const loadVersionCode = (code: string) => {
    setSqlText(code);
    setHistoryOpen(false);
    setStatus('Version loaded into editor.');
  };

  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t: any) => String(t.name).toLowerCase().includes(q));
  }, [tables, tableFilter]);

  const columns = result?.columns || [];
  const rows = result?.rows || [];
  const previewColumns = preview?.columns || [];
  const previewRows = preview?.rows || [];

  const runKeymap = useMemo(() => keymap.of([{
    key: 'Ctrl-Enter',
    run: () => { runQuery(); return true; },
  }, {
    key: 'Mod-s',
    run: () => { if (canWrite) saveQuery(); return true; },
  }]), [canWrite]);

  // Re-render chart when chart tab becomes active
  useEffect(() => {
    if (activeTab === 'chart' && compileResult && chartRef.current) {
      renderChart(compileResult, chartRef.current, chartInstance);
    }
  }, [activeTab, compileResult]);

  // Re-render expanded chart when opened
  useEffect(() => {
    if (expanded === 'chart' && compileResult && expandedChartRef.current) {
      renderChart(compileResult, expandedChartRef.current, expandedChartInstance);
    }
  }, [expanded, compileResult]);

  return (
    <>
      <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-ink">SQL Workbench</h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Explore schemas, write annotated SQL, run queries, and compile charts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={connectionId ?? ''}
            onChange={(e) => setConnectionId(Number(e.target.value))}
            className="focus-ring rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink"
          >
            <option value="">Select connection...</option>
            {(connections || []).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </select>
          <button
            onClick={runQuery}
            className="focus-ring rounded-md bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-soft"
          >
            Run SQL
          </button>
          <button
            onClick={compileChart}
            disabled={compiling}
            className="focus-ring rounded-md border border-accent/30 bg-accent-soft px-4 py-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft/70 disabled:opacity-50"
          >
            {compiling ? 'Compiling...' : 'Compile & Chart'}
          </button>
          {canWrite && (
            <button
              onClick={saveQuery}
              className="focus-ring rounded-md border border-line bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
            >
              Save
            </button>
          )}
          {savedQueryId && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="focus-ring rounded-md border border-line bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
            >
              History
            </button>
          )}
        </div>
      </div>

      {savedQueryId && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-muted">
          Editing saved query: <span className="font-medium text-ink">{savedQueryName}</span>
          {savedQueryVersion > 0 && <span className="ml-2 text-ink-faint">v{savedQueryVersion}</span>}
        </div>
      )}

      {status && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-muted">
          {status}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Schema browser */}
        <aside className="rounded-xl border border-line bg-surface p-3 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Tables
            </h3>
            <span className="text-[10.5px] text-ink-faint">{tables.length}</span>
          </div>
          <input
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="Filter tables..."
            className="focus-ring mb-3 w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint"
          />
          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {filteredTables.length === 0 && (
              <p className="px-2 py-3 text-[12px] text-ink-faint">No tables found.</p>
            )}
            {filteredTables.map((t: any) => (
              <button
                key={t.name}
                onClick={() => loadPreview(t.name)}
                title={t.name}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                  selectedTable === t.name
                    ? 'bg-accent-soft text-accent-ink'
                    : 'text-ink-soft hover:bg-[#f1eee7] hover:text-ink'
                }`}
              >
                <span className="truncate">{t.name}</span>
                {t.columns && (
                  <span className="ml-2 shrink-0 text-[10px] text-ink-faint">
                    {t.columns.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {selectedTable && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="truncate text-[12px] font-semibold text-ink" title={selectedTable}>
                  {selectedTable}
                </h4>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => setExpanded('preview')}
                    className="text-[10.5px] font-medium text-accent hover:underline"
                    title="Expand preview"
                  >
                    ⤢
                  </button>
                  <button
                    onClick={() => setSqlText(`SELECT * FROM ${selectedTable} LIMIT 100;`)}
                    className="text-[10.5px] font-medium text-accent hover:underline"
                  >
                    Use in editor
                  </button>
                </div>
              </div>
              <div className="max-h-64 overflow-auto rounded-md border border-line">
                {preview?.error ? (
                  <p className="p-3 text-[12px] text-signal">{preview.error}</p>
                ) : previewRows.length === 0 ? (
                  <p className="p-3 text-[12px] text-ink-faint">No data to preview.</p>
                ) : (
                  <table className="w-full text-[11.5px]">
                    <thead className="sticky top-0 bg-paper">
                      <tr>
                        {previewColumns.map((c: string) => (
                          <th
                            key={c}
                            className="border-b border-line px-2.5 py-1.5 text-left font-medium text-ink-muted"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 100).map((row: any, i: number) => (
                        <tr key={i} className="border-b border-line/60 hover:bg-[#f7f4ed]">
                          {previewColumns.map((c: string) => (
                            <td key={c} className="whitespace-nowrap px-2.5 py-1.5 text-ink-soft">
                              {String(row[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {preview?.rowCount !== undefined && (
                <p className="mt-2 text-[10.5px] text-ink-faint">
                  {preview.rowCount} row{preview.rowCount === 1 ? '' : 's'}
                </p>
              )}
            </div>
          )}
        </aside>

        {/* Editor + results */}
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                SQL + Annotations
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-[10.5px] text-ink-faint">Ctrl+Enter to run · Ctrl+S to save</span>
                <button
                  onClick={() => setShowGrammar(!showGrammar)}
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  {showGrammar ? 'Hide' : 'Show'} grammar
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <CodeMirror
                value={sqlText}
                height="320px"
                extensions={[sql(), runKeymap]}
                onChange={(val) => setSqlText(val)}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={runQuery}
                className="focus-ring rounded-md bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-soft"
              >
                ▶ Run SQL
              </button>
              <button
                onClick={compileChart}
                disabled={compiling}
                className="focus-ring rounded-md border border-accent/30 bg-accent-soft px-4 py-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft/70 disabled:opacity-50"
              >
                {compiling ? 'Compiling...' : 'Compile & Chart'}
              </button>
              {canWrite && (
                <button
                  onClick={saveQuery}
                  className="focus-ring rounded-md border border-line bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
                >
                  Save
                </button>
              )}
            </div>
            {showGrammar && (
              <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-paper p-3 text-[11px] text-ink-soft">
{`-- @viz: bar | line | area | scatter | pie | heatmap
-- @x: column          -- @y: column
-- @groupby: column    -- @stack: true | false | name
-- @title: Title       -- @theme: powerbi-light | nyt | economist
-- @semantic: col: Type, other: Type
-- @flint: {"chart_spec":{"title":"Custom"}}

No annotations? The compiler infers: temporal->x, first measure->y,
first category->series, default bar/line.`}
              </pre>
            )}
          </div>

          {/* Results / Chart tabs */}
          <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('results')}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    activeTab === 'results'
                      ? 'bg-accent-soft text-accent-ink'
                      : 'text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
                  }`}
                >
                  Results {rows.length > 0 && `(${rows.length})`}
                </button>
                <button
                  onClick={() => setActiveTab('chart')}
                  className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    activeTab === 'chart'
                      ? 'bg-accent-soft text-accent-ink'
                      : 'text-ink-muted hover:bg-[#f1eee7] hover:text-ink'
                  }`}
                >
                  Chart
                </button>
              </div>
              <button
                onClick={() => setExpanded(activeTab === 'chart' ? 'chart' : 'results')}
                className="text-[11px] font-medium text-accent hover:underline"
                title="Expand to full screen"
              >
                ⤢ Expand
              </button>
            </div>

            {activeTab === 'results' ? (
              <div className="max-h-72 overflow-auto rounded-md border border-line">
                {rows.length === 0 ? (
                  <p className="p-4 text-[12px] text-ink-faint">Run a query to see results.</p>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-paper">
                      <tr>
                        {columns.map((c: string) => (
                          <th
                            key={c}
                            className="border-b border-line px-3 py-2 text-left font-medium text-ink-muted"
                          >
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
                )}
              </div>
            ) : (
              <div>
                <div ref={chartRef} className="h-64 w-full md:h-80" />
                {compileResult?.diagnostics?.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {compileResult.diagnostics.map((d: any, i: number) => (
                      <div
                        key={i}
                        className={`rounded-md px-2 py-1 text-[11px] ${
                          d.severity === 'error'
                            ? 'bg-signal-soft text-signal'
                            : d.severity === 'warning'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        <span className="font-mono font-semibold">{d.code}</span> {d.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Expanded modal */}
    {expanded && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setExpanded(null)}>
        <div
          className="relative max-h-[90vh] w-full max-w-6xl overflow-auto rounded-xl border border-line bg-surface p-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink">
              {expanded === 'preview' && `Preview: ${selectedTable}`}
              {expanded === 'results' && `Results (${rows.length} rows)`}
              {expanded === 'chart' && 'Chart'}
            </h3>
            <button
              onClick={() => setExpanded(null)}
              className="rounded-md px-2 py-1 text-[12px] text-ink-muted hover:bg-[#f1eee7] hover:text-ink"
            >
              ✕ Close
            </button>
          </div>

          {expanded === 'preview' && (
            <div className="overflow-auto rounded-md border border-line">
              {previewRows.length === 0 ? (
                <p className="p-4 text-[12px] text-ink-faint">No data to preview.</p>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-paper">
                    <tr>
                      {previewColumns.map((c: string) => (
                        <th key={c} className="border-b border-line px-3 py-2 text-left font-medium text-ink-muted">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row: any, i: number) => (
                      <tr key={i} className="border-b border-line/60 hover:bg-[#f7f4ed]">
                        {previewColumns.map((c: string) => (
                          <td key={c} className="whitespace-nowrap px-3 py-2 text-ink-soft">
                            {String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {expanded === 'results' && (
            <div className="overflow-auto rounded-md border border-line">
              {rows.length === 0 ? (
                <p className="p-4 text-[12px] text-ink-faint">Run a query to see results.</p>
              ) : (
                <table className="w-full text-[12px]">
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
                    {rows.map((row: any, i: number) => (
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
              )}
            </div>
          )}

          {expanded === 'chart' && (
            <div>
              <div ref={expandedChartRef} className="h-[70vh] w-full" />
              {compileResult?.diagnostics?.length > 0 && (
                <div className="mt-3 space-y-1">
                  {compileResult.diagnostics.map((d: any, i: number) => (
                    <div
                      key={i}
                      className={`rounded-md px-2 py-1 text-[11px] ${
                        d.severity === 'error'
                          ? 'bg-signal-soft text-signal'
                          : d.severity === 'warning'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      <span className="font-mono font-semibold">{d.code}</span> {d.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )}

    <HistoryDialog
      open={historyOpen}
      onClose={() => setHistoryOpen(false)}
      versions={(versionsQuery.data || []).map((v: any) => ({
        id: v.id,
        dashboardId: 0,
        version: v.version,
        parentVersion: v.parentVersion,
        message: v.message,
        authorId: null,
        kind: v.kind,
        snapshotJson: '',
        codeText: v.sql,
        createdAt: v.createdAt,
      })) as any}
      loading={versionsQuery.isLoading}
      restoring={restoring}
      onRestore={(version: number) => void restoreVersion(version)}
      onLoadCode={loadVersionCode}
      onNotify={(message: string) => setStatus(message)}
    />
    </>
  );
}