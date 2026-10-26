import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export default function Explore() {
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
  });

  const { data: tables } = useQuery({
    queryKey: ['tables', connectionId],
    queryFn: () => connectionId ? api.connections.tables(connectionId) : Promise.resolve([]),
    enabled: !!connectionId,
  });

  useEffect(() => {
    if (connections && connections.length > 0 && !connectionId) {
      setConnectionId(connections[0].id);
    }
  }, [connections, connectionId]);

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

  const columns = preview?.columns || [];
  const rows = preview?.rows || [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Explore</h2>

      <div className="flex gap-2 flex-wrap">
        <select
          value={connectionId ?? ''}
          onChange={(e) => { setConnectionId(Number(e.target.value)); setSelectedTable(null); setPreview(null); }}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">Select connection...</option>
          {(connections || []).map((c: any) => (
            <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Table list */}
        <div className="bg-white rounded-lg shadow-sm p-3">
          <h3 className="font-medium text-sm mb-2">Tables</h3>
          <div className="space-y-1 max-h-96 overflow-auto">
            {(tables || []).map((t: any) => (
              <button
                key={t.name}
                onClick={() => loadPreview(t.name)}
                className={`w-full text-left px-3 py-2 rounded text-sm ${selectedTable === t.name ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
              >
                {t.name}
                {t.columns && <span className="text-xs text-gray-400 ml-2">({t.columns.length} cols)</span>}
              </button>
            ))}
            {(!tables || tables.length === 0) && (
              <p className="text-sm text-gray-400 p-2">No tables found.</p>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="md:col-span-3 bg-white rounded-lg shadow-sm p-4">
          <h3 className="font-medium text-sm mb-2">
            {selectedTable ? `Preview: ${selectedTable}` : 'Select a table'}
            {preview?.rowCount !== undefined && <span className="text-gray-400 font-normal ml-2">({preview.rowCount} rows)</span>}
          </h3>
          <div className="overflow-auto max-h-96 border rounded">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 p-4">{preview?.error || 'No data to preview.'}</p>
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
                  {rows.slice(0, 100).map((row: any, i: number) => (
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
          {selectedTable && (
            <div className="mt-3">
              <a href={`/sql?table=${selectedTable}&conn=${connectionId}`} className="text-sm text-blue-600 hover:underline">
                Open in SQL workbench →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}