import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

export default function SavedQueries() {
  const qc = useQueryClient();
  const { data: queries } = useQuery({
    queryKey: ['saved-queries'],
    queryFn: () => api.savedQueries.list(),
  });

  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.connections.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.savedQueries.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-queries'] }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Saved Queries</h2>
      <div className="space-y-2">
        {(queries || []).map((q: any) => {
          const conn = (connections || []).find((c: any) => c.id === q.connectionId);
          return (
            <div key={q.id} className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{q.name}</div>
                  <div className="text-xs text-gray-500">{conn?.name || `conn #${q.connectionId}`} · {new Date(q.updatedAt).toLocaleDateString()}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <a href={`/sql?saved=${q.id}`} className="text-sm text-blue-600 hover:underline">Open</a>
                  <button onClick={() => { if (confirm('Delete?')) deleteMutation.mutate(q.id); }} className="text-sm text-red-600 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
              <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-auto max-h-32 whitespace-pre-wrap">{q.sql}</pre>
            </div>
          );
        })}
      </div>
      {(!queries || queries.length === 0) && (
        <p className="text-gray-500 text-center py-8">No saved queries yet. Save one from the SQL workbench.</p>
      )}
    </div>
  );
}