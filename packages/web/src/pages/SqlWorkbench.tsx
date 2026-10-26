import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import * as echarts from 'echarts';
import { api } from '../api/client.js';

export default function SqlWorkbench() {
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [sqlText, setSqlText] = useState('-- @viz: bar\n-- @x: month\n-- @y: revenue\n-- @groupby: region\nSELECT month, region, SUM(revenue) AS revenue FROM data GROUP BY month, region;');
  const [result, setResult] = useState<any>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [showGrammar, setShowGrammar] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
  });

  useEffect(() => {
    if (connections && connections.length > 0 && !connectionId) {
      setConnectionId(connections[0].id);
    }
  }, [connections, connectionId]);

  async function runQuery() {
    if (!connectionId) { setStatus('Select a connection first.'); return; }
    setStatus('Running...');
    try {
      const res = await api.connections.query(connectionId, sqlText);
      setResult(res);
      setStatus(`${res.rowCount} row${res.rowCount === 1 ? '' : 's'} returned${res.cached ? ' (cached)' : ''}.`);
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
      setTimeout(() => { try { chartInstance.current.resize(); } catch (e) {} }, 50);
    }
  }

  async function saveQuery() {
    if (!connectionId) { setStatus('Select a connection first.'); return; }
    const name = prompt('Query name:');
    if (!name) return;
    try {
      await api.savedQueries.create({ name, connectionId, sql: sqlText });
      setStatus(`Saved as "${name}".`);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  const columns = result?.columns || [];
  const rows = result?.rows || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">SQL Workbench</h2>
        <div className="flex gap-2 flex-wrap">
          <select
            value={connectionId ?? ''}
            onChange={(e) => setConnectionId(Number(e.target.value))}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="">Select connection...</option>
            {(connections || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
            ))}
          </select>
          <button onClick={runQuery} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            Run SQL
          </button>
          <button onClick={compileChart} disabled={compiling} className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50">
            {compiling ? 'Compiling...' : 'Compile & Chart'}
          </button>
          <button onClick={saveQuery} className="border rounded px-4 py-2 text-sm font-medium">
            Save
          </button>
        </div>
      </div>

      {status && <p className="text-sm text-gray-600 bg-gray-100 rounded px-3 py-2">{status}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* SQL Editor */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm">SQL + Annotations</h3>
            <button onClick={() => setShowGrammar(!showGrammar)} className="text-xs text-blue-600 hover:underline">
              {showGrammar ? 'Hide' : 'Show'} grammar
            </button>
          </div>
          <CodeMirror
            value={sqlText}
            height="320px"
            extensions={[sql()]}
            onChange={(val) => setSqlText(val)}
            className="border rounded"
          />
          {showGrammar && (
            <pre className="mt-3 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-60">
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

        {/* Results + Chart */}
        <div className="space-y-4">
          {/* Results table */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h3 className="font-medium text-sm mb-2">Results {rows.length > 0 && `(${rows.length})`}</h3>
            <div className="overflow-auto max-h-60 border rounded">
              {rows.length === 0 ? (
                <p className="text-sm text-gray-400 p-4">Run a query to see results.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {columns.map((c: string) => (
                        <th key={c} className="px-3 py-2 text-left font-medium border-b">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((row: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-gray-50">
                        {columns.map((c: string) => (
                          <td key={c} className="px-3 py-2 whitespace-nowrap">{String(row[c] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h3 className="font-medium text-sm mb-2">Chart</h3>
            <div ref={chartRef} className="w-full h-64 md:h-80" />
            {compileResult?.diagnostics?.length > 0 && (
              <div className="mt-3 space-y-1">
                {compileResult.diagnostics.map((d: any, i: number) => (
                  <div key={i} className={`text-xs px-2 py-1 rounded ${d.severity === 'error' ? 'bg-red-50 text-red-700' : d.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                    <span className="font-mono font-semibold">{d.code}</span> {d.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}