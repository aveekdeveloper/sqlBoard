import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { ManifestItem } from './model.js';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  cached?: boolean;
  staleAt?: string | null;
}

export interface ChartDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  column?: string;
}

export interface ChartSpecResult {
  option: Record<string, unknown>;
  diagnostics: ChartDiagnostic[];
  rowCount: number | null;
}

export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function maxRowsFor(item: ManifestItem): number {
  if (item.blockType === 'table') {
    const configured = Number(item.config?.maxRows);
    return Number.isFinite(configured) ? Math.min(Math.max(configured, 10), 5000) : 1000;
  }
  return 5000;
}

export function useBlockData(item: ManifestItem, enabled = true) {
  const maxRows = maxRowsFor(item);
  return useQuery({
    queryKey: ['block-data', item.connectionId, item.sql, maxRows],
    queryFn: () => api.connections.query(item.connectionId, item.sql, maxRows) as Promise<QueryResult>,
    enabled: enabled && item.blockType !== 'text' && item.connectionId > 0 && item.sql.trim().length > 0,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useChartSpec(item: ManifestItem, enabled = true) {
  const hasTheme = /^\s*--\s*@theme\s*:/im.test(item.sql);
  return useQuery({
    queryKey: ['block-chart', item.connectionId, item.sql, hasTheme ? 'annotated' : 'swiss'],
    queryFn: async (): Promise<ChartSpecResult> => {
      const response = await api.compile({
        sql: item.sql,
        connectionId: item.connectionId,
        backends: ['echarts'],
        ...(hasTheme ? {} : { theme: 'swiss' }),
      });
      const option = response.compiled?.echarts ?? response.echarts;
      if (!option) {
        const firstError = (response.diagnostics ?? []).find(
          (diagnostic: ChartDiagnostic) => diagnostic.severity === 'error',
        );
        throw new Error(firstError?.message || 'The chart could not be compiled.');
      }
      return {
        option,
        diagnostics: response.diagnostics ?? [],
        rowCount: response.query?.rowCount ?? null,
      };
    },
    enabled:
      enabled &&
      item.blockType === 'chart' &&
      item.connectionId > 0 &&
      item.sql.trim().length > 0,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
