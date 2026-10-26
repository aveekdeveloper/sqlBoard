import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import * as echarts from 'echarts';
import { api } from '../api/client.js';

export default function SqlWorkbench() {
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
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
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
    if (!savedId) return;
    api.savedQueries
      .list()
      .then((queries) => {
        const q = (queries || []).find((x: any) => String(x.id) === savedId);
        if (q) {
          setConnectionId(q.connectionId);
          setSqlText(q.sql);
          setStatus(`Loaded saved query "${q.name}".`);
        }
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
      renderChart(res);
      const errCount = res.diagnostics.filter((d: any) => d.severity === 'error').length;
      const warnCount = res.diagnostics.filter((d: any) => d.severity === 'warning').length;
      setStatus(`Compiled: ${res.flint?.chart_spec?.chartType || '?'} · ${errCount} error(s), ${warnCount} warning(s).`);
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setCompiling(false);
    }
  }

  function renderChart(res: any) {
    if (!chartRef.current) return;
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }
    const spec = res.compiled?.echarts || res.echarts;
    if (spec && chartInstance.current) {
      chartInstance.current.setOption(spec, true);
      setTimeout(() => {
        try {
          chartInstance.current.resize();
        } catch (e) {}
      }, 50);
    }
  }

  async function saveQuery() {
    if (!connectionId) {
      setStatus('Select a connection first.');
      return;
    }
    const name = prompt('Query name:');
    if (!name) return;
    try {
      await api.savedQueries.create({ name, connectionId, sql: sqlText });
      setStatus(`Saved as "${name}".`);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t: any) => String(t.name).toLowerCase().includes(q));
  }, [tables, tableFilter]);

  const columns = result?.columns || [];
  const rows = result?.rows || [];
  const previewColumns = preview?.columns || [];
  const previewRows = preview?.rows || [];

  return (
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
          {tables.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setSqlText((prev) => {
                    const trimmed = prev.trim();
                    if (trimmed === '' || trimmed.startsWith('--')) {
                      return `SELECT * FROM ${e.target.value} LIMIT 100;`;
                    }
                    return prev + `\n-- ${e.target.value}`;
                  });
                }
              }}
              className="focus-ring rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink"
            >
              <option value="">Insert table...</option>
              {tables.map((t: any) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
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
          <button
            onClick={saveQuery}
            className="focus-ring rounded-md border border-line bg-surface px-4 py-2 text-[12.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
          >
            Save
          </button>
        </div>
      </div>

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
                <h4 className="truncate text-[12px] font-semibold text-ink">{selectedTable}</h4>
                <button
                  onClick={() => setSqlText(`SELECT * FROM ${selectedTable} LIMIT 100;`)}
                  className="text-[10.5px] font-medium text-accent hover:underline"
                >
                  Use in editor
                </button>
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
              <button
                onClick={() => setShowGrammar(!showGrammar)}
                className="text-[11px] font-medium text-accent hover:underline"
              >
                {showGrammar ? 'Hide' : 'Show'} grammar
              </button>
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              <CodeMirror
                value={sqlText}
                height="320px"
                extensions={[sql()]}
                onChange={(val) => setSqlText(val)}
              />
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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                Results {rows.length > 0 && `(${rows.length})`}
              </h3>
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
            </div>

            <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                Chart
              </h3>
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
          </div>
        </div>
      </div>
    </div>
  );
}