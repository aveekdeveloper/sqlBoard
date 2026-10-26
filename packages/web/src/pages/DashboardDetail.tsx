import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as echarts from 'echarts';
import MetricTile from '../components/MetricTile.js';
import DigestStrip, { computeDigestSignals } from '../components/DigestStrip.js';
import { api } from '../api/client.js';

const BACKENDS = ['echarts', 'vegalite', 'chartjs', 'plotly'];

function ChartBlock({ item, backend }: { item: any; backend: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<any>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    let cancelled = false;

    async function render() {
      try {
        const res = await api.compile({ sql: item.sql, connectionId: item.connectionId, backends: [backend] });
        if (cancelled) return;
        const spec = res.compiled?.[backend] || res.echarts;
        if (!spec) return;
        if (!instRef.current) instRef.current = echarts.init(chartRef.current!);
        instRef.current.setOption(spec, true);
        setTimeout(() => { try { instRef.current?.resize(); } catch (e) {} }, 50);
      } catch (e: any) {
        if (chartRef.current) chartRef.current.innerHTML = `<div class="text-red-600 text-sm p-2">Error: ${e.message}</div>`;
      }
    }

    render();
    return () => { cancelled = true; if (instRef.current) { try { instRef.current.dispose(); } catch (e) {} instRef.current = null; } };
  }, [item, backend]);

  return <div ref={chartRef} className="w-full h-64" />;
}

function MetricBlock({ item }: { item: any }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.compile({ sql: item.sql, connectionId: item.connectionId });
        if (cancelled) return;
        // The compile endpoint also runs the query if connectionId is provided
        // For metrics, we need the raw query result. Use the query endpoint instead.
        const qRes = await api.connections.query(item.connectionId, item.sql);
        if (cancelled) return;
        setData(qRes);
      } catch (e) {
        console.error('Metric load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item]);

  const config = item.config || {};
  const result = data ? interpretMetricResult(data) : null;

  return (
    <MetricTile
      title={item.title}
      value={result?.value ?? null}
      prior={result?.prior ?? null}
      higherIsBetter={config.higherIsBetter ?? true}
      format={config.format || 'number'}
      target={config.target}
      sparkline={result?.sparkline}
      loading={loading}
    />
  );
}

function interpretMetricResult(qr: any): { value: number | null; prior: number | null; sparkline?: { t: string; v: number }[] } {
  const rows = qr?.rows || [];
  if (rows.length === 0) return { value: null, prior: null };

  // Single row with value + prior columns
  const first = rows[0];
  if (rows.length === 1) {
    const value = first.value ?? first.current ?? first.metric ?? first.result ?? first.amount ?? Object.values(first)[0];
    const prior = first.prior ?? first.previous ?? first.prior_value ?? first.prev ?? null;
    return { value: toNum(value), prior: toNum(prior) };
  }

  // Time series: date column + value column
  const cols = qr.columns || Object.keys(first);
  const timeCol = cols.find((c: string) => /month|date|day|week|quarter|year|time|period/i.test(c) && !Number.isFinite(Number(first[c])));
  const valueCol = cols.find((c: string) => /value|current|metric|result|amount|revenue|count/i.test(c)) || cols.find((c: string) => rows.some((r: any) => Number.isFinite(Number(r[c]))));
  if (timeCol && valueCol) {
    const points = rows.map((r: any) => ({ t: String(r[timeCol]), v: Number(r[valueCol]) })).filter((p: any) => Number.isFinite(p.v));
    const last = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : null;
    return { value: last?.v ?? null, prior: prev?.v ?? null, sparkline: points };
  }

  // Fallback: first numeric column
  const numCol = cols.find((c: string) => rows.some((r: any) => Number.isFinite(Number(r[c]))));
  return { value: numCol ? Number(rows[rows.length - 1][numCol]) : null, prior: null };
}

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function DashboardDetail() {
  const { id } = useParams();
  const dashId = Number(id);
  const qc = useQueryClient();
  const [backend, setBackend] = useState('echarts');
  const [pinning, setPinning] = useState(false);
  const [pinSql, setPinSql] = useState('');
  const [pinTitle, setPinTitle] = useState('');
  const [pinConnId, setPinConnId] = useState<number | null>(null);
  const [pinBlockType, setPinBlockType] = useState<'chart' | 'metric'>('chart');

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', dashId],
    queryFn: () => api.dashboards.get(dashId),
  });

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
  });

  const addItem = useMutation({
    mutationFn: (body: any) => api.dashboards.addItem(dashId, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboard', dashId] }); setPinning(false); },
  });

  const removeItem = useMutation({
    mutationFn: (itemId: number) => api.dashboards.removeItem(dashId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashId] }),
  });

  const asCode = (dashboard?.items || []).map((item: any) =>
    `-- ========== ${item.title} (${item.blockType}) ==========\n${item.sql.trim()}\n`
  ).join('\n');

  const metricItems = (dashboard?.items || []).filter((i: any) => i.blockType === 'metric');
  const digestSignals = metricItems.map((item: any) => {
    // placeholder — real digest would compute from metric results
    return null;
  }).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{dashboard?.name || 'Dashboard'}</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={backend} onChange={(e) => setBackend(e.target.value)} className="border rounded px-3 py-2 text-sm">
            {BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button onClick={() => setPinning(!pinning)} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            {pinning ? 'Cancel' : '+ Pin'}
          </button>
        </div>
      </div>

      {pinning && (
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
          <h3 className="font-medium">Pin a new block</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setPinBlockType('chart')}
              className={`px-3 py-1.5 rounded text-sm ${pinBlockType === 'chart' ? 'bg-blue-600 text-white' : 'border'}`}
            >
              Chart
            </button>
            <button
              onClick={() => setPinBlockType('metric')}
              className={`px-3 py-1.5 rounded text-sm ${pinBlockType === 'metric' ? 'bg-blue-600 text-white' : 'border'}`}
            >
              Metric
            </button>
          </div>
          <input value={pinTitle} onChange={(e) => setPinTitle(e.target.value)} placeholder="Title" className="w-full border rounded px-3 py-2" />
          <select value={pinConnId ?? ''} onChange={(e) => setPinConnId(Number(e.target.value))} className="w-full border rounded px-3 py-2">
            <option value="">Select connection...</option>
            {(connections || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <textarea value={pinSql} onChange={(e) => setPinSql(e.target.value)} placeholder="-- @viz: bar&#10;-- @x: month&#10;-- @y: revenue&#10;SELECT ..." rows={6} className="w-full border rounded px-3 py-2 font-mono text-sm" />
          {pinBlockType === 'metric' && (
            <p className="text-xs text-gray-500">Metric SQL: single value, or value+prior columns, or time series (date+value). Target/polarity set after pinning via edit.</p>
          )}
          <button
            onClick={() => {
              if (!pinTitle || !pinConnId || !pinSql) return;
              addItem.mutate({ title: pinTitle, sql: pinSql, connectionId: pinConnId, blockType: pinBlockType, layout: { x: 0, y: 0, w: pinBlockType === 'metric' ? 2 : 6, h: pinBlockType === 'metric' ? 2 : 4 } });
            }}
            disabled={addItem.isPending}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {addItem.isPending ? 'Pinning...' : 'Pin'}
          </button>
        </div>
      )}

      {/* Dashboard canvas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(!dashboard?.items || dashboard.items.length === 0) && (
          <div className="col-span-full text-center text-gray-400 py-12">
            No blocks yet. Click "+ Pin" to add a chart or metric.
          </div>
        )}
        {(dashboard?.items || []).map((item: any) => (
          <div key={item.id} className="bg-white rounded-lg shadow-sm p-3 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm truncate">{item.title}</span>
              <button onClick={() => removeItem.mutate(item.id)} className="text-red-500 text-lg px-2 hover:bg-red-50 rounded">×</button>
            </div>
            {item.blockType === 'metric' ? (
              <MetricBlock item={item} />
            ) : (
              <ChartBlock item={item} backend={backend} />
            )}
          </div>
        ))}
      </div>

      {/* Dashboard as code */}
      {dashboard?.items?.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-4">
          <h3 className="font-medium mb-2">Dashboard as code (annotated SQL)</h3>
          <pre className="p-3 bg-gray-50 rounded text-xs overflow-auto max-h-80 whitespace-pre-wrap">{asCode}</pre>
        </div>
      )}
    </div>
  );
}