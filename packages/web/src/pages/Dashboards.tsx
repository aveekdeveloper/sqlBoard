import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

export default function Dashboards() {
  const [name, setName] = useState('');
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();

  const { data: dashboards } = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => api.dashboards.list(),
  });

  const createMutation = useMutation({
    mutationFn: (n: string) => api.dashboards.create({ name: n }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboards'] }); setShowForm(false); setName(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.dashboards.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">Dashboards</h2>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
          {showForm ? 'Cancel' : '+ New dashboard'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMutation.mutate(name.trim()); }} className="bg-white rounded-lg shadow-sm p-4 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dashboard name" className="flex-1 border rounded px-3 py-2" required />
          <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">Create</button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(dashboards || []).map((d: any) => (
          <div key={d.id} className="bg-white rounded-lg shadow-sm p-4">
            <a href={`/dashboards/${d.id}`} className="font-medium text-blue-600 hover:underline">{d.name}</a>
            {d.description && <p className="text-sm text-gray-500 mt-1">{d.description}</p>}
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-gray-400">{new Date(d.createdAt).toLocaleDateString()}</span>
              <button onClick={() => { if (confirm('Delete this dashboard?')) deleteMutation.mutate(d.id); }} className="text-xs text-red-600 hover:underline">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {(!dashboards || dashboards.length === 0) && (
        <p className="text-gray-500 text-center py-8">No dashboards yet. Create one to get started.</p>
      )}
    </div>
  );
}