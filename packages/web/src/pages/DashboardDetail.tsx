import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { api } from '../api/client.js';

const BACKENDS = ['echarts', 'vegalite', 'chartjs', 'plotly'];

export default function DashboardDetail() {
  const { id } = useParams();
  const dashId = Number(id);
  const qc = useQueryClient();
  const [backend, setBackend] = useState('echarts');
  const [pinning, setPinning] = useState(false);
  const [pinSql, setPinSql] = useState('');
  const [pinTitle, setPinTitle] = useState('');
  const [pinConnId, setPinConnId] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

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

  // Render charts when dashboard or backend changes
  useEffect(() => {
    if (!dashboard?.items || !canvasRef.current) return;
    const container = canvasRef.current;
    // Clear
    container.innerHTML = '';
    const instances: any[] = [];

    dashboard.items.forEach((item: any, i: number) => {
      const tile = document.createElement('div');
      tile.className = 'bg-white rounded-lg shadow-sm p-3';
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between mb-2';
      const title = document.createElement('span');
      title.className = 'font-medium text-sm truncate';
      title.textContent = item.title;
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.className = 'text-red-500 text-lg px-2';
      removeBtn.onclick = () => removeItem.mutate(item.id);
      header.appendChild(title);
      header.appendChild(removeBtn);

      const chartDiv = document.createElement('div');
      chartDiv.className = 'w-full h-64';
      tile.appendChild(header);
      tile.appendChild(chartDiv);
      container.appendChild(tile);

      // Compile and render
      (async () => {
        try {
          const res = await api.compile({ sql: item.sql, connectionId: item.connectionId, backends: [backend] });
          const spec = res.compiled?.[backend] || res.echarts;
          if (backend === 'echarts' && spec) {
            const inst = echarts.init(chartDiv);
            inst.setOption(spec, true);
            instances.push(inst);
            setTimeout(() => { try { inst.resize(); } catch (e) {} }, 50);
          } else if (backend === 'vegalite' && spec) {
            // @ts-ignore
            if (window.vegaEmbed) window.vegaEmbed(chartDiv, spec, { actions: false });
          } else if (backend === 'chartjs' && spec) {
            const canvas = document.createElement('canvas');
            chartDiv.appendChild(canvas);
            // @ts-ignore
            new window.Chart(canvas, spec);
          } else if (backend === 'plotly' && spec) {
            const w = window as any;
            if (w.Plotly) {
              if (spec.data && spec.layout) w.Plotly.newPlot(chartDiv, spec.data, spec.layout, { responsive: true });
              else w.Plotly.newPlot(chartDiv, spec);
            }
          }
        } catch (e: any) {
          chartDiv.innerHTML = `<div class="text-red-600 text-sm p-2">Error: ${e.message}</div>`;
        }
      })();
    });

    return () => {
      instances.forEach((inst) => { try { inst.dispose(); } catch (e) {} });
    };
  }, [dashboard, backend]);

  const asCode = (dashboard?.items || []).map((item: any, i: number) =>
    `-- ========== ${item.title} ==========\n${item.sql.trim()}\n`
  ).join('\n');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">{dashboard?.name || 'Dashboard'}</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={backend} onChange={(e) => setBackend(e.target.value)} className="border rounded px-3 py-2 text-sm">
            {BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button onClick={() => setPinning(!pinning)} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            {pinning ? 'Cancel' : '+ Pin chart'}
          </button>
        </div>
      </div>

      {pinning && (
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-3">
          <h3 className="font-medium">Pin a new chart</h3>
          <input value={pinTitle} onChange={(e) => setPinTitle(e.target.value)} placeholder="Chart title" className="w-full border rounded px-3 py-2" />
          <select value={pinConnId ?? ''} onChange={(e) => setPinConnId(Number(e.target.value))} className="w-full border rounded px-3 py-2">
            <option value="">Select connection...</option>
            {(connections || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <textarea value={pinSql} onChange={(e) => setPinSql(e.target.value)} placeholder="-- @viz: bar&#10;-- @x: month&#10;-- @y: revenue&#10;SELECT ..." rows={6} className="w-full border rounded px-3 py-2 font-mono text-sm" />
          <button
            onClick={() => {
              if (!pinTitle || !pinConnId || !pinSql) return;
              addItem.mutate({ title: pinTitle, sql: pinSql, connectionId: pinConnId, blockType: 'chart', layout: { x: 0, y: 0, w: 6, h: 4 } });
            }}
            disabled={addItem.isPending}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {addItem.isPending ? 'Pinning...' : 'Pin'}
          </button>
        </div>
      )}

      {/* Dashboard canvas */}
      <div ref={canvasRef} className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[200px]">
        {(!dashboard?.items || dashboard.items.length === 0) && (
          <div className="col-span-full text-center text-gray-400 py-12">
            No charts pinned yet. Click "+ Pin chart" to add one.
          </div>
        )}
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