import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { useChartSpec } from './queries.js';
import type { ManifestItem } from './model.js';
import { BlockEmpty, BlockError, BlockLoading } from './BlockState.js';

const FONT_STACK =
  "Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif";

function parseAnnotations(sql: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of (sql || '').split('\n')) {
    const match = line.match(/^--\s*@([a-zA-Z0-9_]+):\s*(.*?)\s*$/);
    if (match) result[match[1].toLowerCase()] = match[2];
  }
  return result;
}

function formatNumber(value: number, format: string): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (format === 'currency') {
    if (abs >= 1_000_000) return '$' + (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1_000) return '$' + (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    if (Number.isInteger(value)) return '$' + value.toLocaleString();
    return '$' + value.toFixed(2);
  }
  if (format === 'compact') {
    if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1_000) return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(2);
  }
  if (format === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(2);
  }
  // auto
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000) return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}

function formatDate(value: unknown, pattern?: string): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return String(value ?? '');
  const d = new Date(value as any);
  if (isNaN(d.getTime())) return String(value ?? '');
  if (pattern && pattern.trim()) {
    const p = pattern.trim();
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    const hour = d.getHours();
    const minute = d.getMinutes();
    const second = d.getSeconds();
    const shortMonth = d.toLocaleString('en', { month: 'short' });
    const longMonth = d.toLocaleString('en', { month: 'long' });
    if (p.includes('%')) {
      const tokens: Record<string, string> = {
        '%Y': String(year),
        '%y': String(year).slice(-2),
        '%m': pad(month + 1),
        '%-m': String(month + 1),
        '%b': shortMonth,
        '%B': longMonth,
        '%d': pad(day),
        '%-d': String(day),
        '%e': String(day),
        '%H': pad(hour),
        '%M': pad(minute),
        '%S': pad(second),
      };
      return p.replace(/%[A-Za-z-]+/g, (tok) => tokens[tok] ?? tok);
    }
    const replacements: Array<[RegExp, string]> = [
      [/YYYY/g, String(year)],
      [/YY/g, String(year).slice(-2)],
      [/MMMM/g, longMonth],
      [/MMM/g, shortMonth],
      [/MM/g, pad(month + 1)],
      [/M/g, String(month + 1)],
      [/DD/g, pad(day)],
      [/D/g, String(day)],
      [/HH/g, pad(hour)],
      [/mm/g, pad(minute)],
      [/ss/g, pad(second)],
    ];
    let out = p;
    for (const [re, val] of replacements) out = out.replace(re, val);
    return out;
  }
  const month = d.toLocaleString('en', { month: 'short' });
  const year = d.getFullYear();
  const day = d.getDate();
  if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) return `${month} ${year}`;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${month} ${day}`;
  return `${month} ${day}, ${year}`;
}

function isDateLike(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^\d{4}-\d{2}(-\d{2})?/.test(val) || (!isNaN(Date.parse(val)) && val.includes('-'));
}

export function styleAxes(
  option: Record<string, unknown>,
  sql?: string,
  overrides?: { timeFormat?: string; xFormat?: string; yFormat?: string },
): Record<string, unknown> {
  const annotations = parseAnnotations(sql || '');
  const xFormat = (overrides?.xFormat ?? annotations.xformat ?? annotations.xFormat ?? 'auto').toLowerCase();
  const yFormat = (overrides?.yFormat ?? annotations.yformat ?? annotations.yFormat ?? 'auto').toLowerCase();
  const timeFormat = overrides?.timeFormat ?? annotations.timeformat ?? annotations.timeFormat;
  const xRotateOverride = annotations.xrotate || annotations.xRotate
    ? Number(annotations.xrotate ?? annotations.xRotate)
    : (annotations.rotate ? Number(annotations.rotate) : null);
  const yRotateOverride = annotations.yrotate || annotations.yRotate
    ? Number(annotations.yrotate ?? annotations.yRotate)
    : (annotations.rotate ? Number(annotations.rotate) : null);

  const styleAxis = (axis: unknown, format: string, tf?: string, rotateOverride?: number | null) => {
    if (!axis || typeof axis !== 'object' || Array.isArray(axis)) return axis;
    const a = axis as Record<string, unknown>;
    const labels = Array.isArray(a.data) ? a.data : [];
    const maxLabelLen = labels.reduce((max: number, l: unknown) => Math.max(max, String(l ?? '').length), 0);
    const autoRotate = maxLabelLen > 12 ? 45 : maxLabelLen > 8 ? 30 : 0;
    const rotate = rotateOverride != null && !isNaN(rotateOverride) ? rotateOverride : autoRotate;
    const isDate = labels.length > 0 && labels.some(isDateLike);
    const resolvedFormat = format === 'auto' ? (isDate ? 'date' : 'compact') : format;

    return {
      ...a,
      axisLabel: {
        ...(a.axisLabel as Record<string, unknown> | undefined),
        rotate,
        interval: labels.length > 0 && labels.length <= 40 ? 0 : 'auto',
        hideOverlap: labels.length > 40,
        formatter: (val: unknown) => {
          if (resolvedFormat === 'date') return formatDate(val, tf);
          if (typeof val === 'number') return formatNumber(val, resolvedFormat);
          if (isDateLike(val)) {
            if (tf) return formatDate(val, tf);
            return formatDate(val);
          }
          return String(val ?? '');
        },
      },
    };
  };

  const xAxis = Array.isArray(option.xAxis)
    ? option.xAxis.map((a) => styleAxis(a, xFormat, timeFormat, xRotateOverride))
    : styleAxis(option.xAxis, xFormat, timeFormat, xRotateOverride);
  const yAxis = Array.isArray(option.yAxis)
    ? option.yAxis.map((a) => styleAxis(a, yFormat, timeFormat, yRotateOverride))
    : styleAxis(option.yAxis, yFormat, timeFormat, yRotateOverride);

  const xRotated = Array.isArray(xAxis)
    ? xAxis.some((a: any) => (a?.axisLabel?.rotate ?? 0) > 0)
    : (xAxis as any)?.axisLabel?.rotate > 0;
  const grid = option.grid && typeof option.grid === 'object' && !Array.isArray(option.grid)
    ? { ...(option.grid as object), bottom: xRotated ? 60 : 8 }
    : option.grid;

  return { ...option, xAxis, yAxis, grid };
}

export function styleBars(option: Record<string, unknown>, sql?: string): Record<string, unknown> {
  const annotations = parseAnnotations(sql || '');
  const barWidth = annotations.barwidth || annotations.barWidth;
  const barGap = annotations.bargap || annotations.barGap;
  const barCategoryGap = annotations.barcategorygap || annotations.barCategoryGap;

  if (!barWidth && !barGap && !barCategoryGap) return option;

  const patchSeries = (s: any) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return s;
    const type = String(s.type || '').toLowerCase();
    if (type !== 'bar') return s;
    const patched = { ...s };
    if (barWidth) patched.barWidth = barWidth;
    if (barGap) patched.barGap = barGap;
    if (barCategoryGap) patched.barCategoryGap = barCategoryGap;
    return patched;
  };

  const series = Array.isArray(option.series)
    ? option.series.map(patchSeries)
    : patchSeries(option.series);

  return { ...option, series };
}

function styleLegend(legend: unknown): unknown {
  if (!legend) return legend;
  if (Array.isArray(legend)) {
    return legend.map((entry) => styleLegend(entry));
  }
  if (typeof legend !== 'object') return legend;
  return {
    ...(legend as Record<string, unknown>),
    itemWidth: 8,
    itemHeight: 8,
    itemGap: 12,
    icon: 'circle',
    textStyle: {
      fontFamily: FONT_STACK,
      fontSize: 10.5,
      color: '#5d5a53',
      ...((legend as Record<string, unknown>).textStyle as Record<string, unknown> | undefined),
    },
  };
}

function styleTooltip(tooltip: unknown): unknown {
  if (!tooltip || typeof tooltip !== 'object' || Array.isArray(tooltip)) {
    return tooltip ?? { show: false };
  }
  return {
    ...(tooltip as Record<string, unknown>),
    confine: true,
    backgroundColor: '#17181a',
    borderWidth: 0,
    padding: [8, 10],
    extraCssText:
      'border-radius: 8px; box-shadow: 0 12px 30px -12px rgba(23,24,26,0.45);',
    textStyle: {
      color: '#fffdf8',
      fontFamily: FONT_STACK,
      fontSize: 11,
      ...((tooltip as Record<string, unknown>).textStyle as Record<string, unknown> | undefined),
    },
  };
}

function buildOption(
  raw: Record<string, unknown>,
  sql?: string,
  overrides?: { timeFormat?: string; xFormat?: string; yFormat?: string },
): EChartsOption {
  const {
    title: _title,
    subtitle: _subtitle,
    backgroundColor: _background,
    width: _width,
    height: _height,
    legend,
    tooltip,
    grid,
    ...rest
  } = raw as Record<string, unknown>;

  const baseGrid =
    grid && typeof grid === 'object' && !Array.isArray(grid)
      ? { containLabel: true, left: 10, right: 14, top: 16, bottom: 8, ...(grid as object) }
      : (grid as object | undefined);

  const styled = styleAxes(styleBars({
    ...rest,
    backgroundColor: 'transparent',
    animationDuration: 420,
    animationEasing: 'cubicOut',
    textStyle: {
      fontFamily: FONT_STACK,
      ...(rest.textStyle as Record<string, unknown> | undefined),
    },
    ...(baseGrid ? { grid: baseGrid } : {}),
    legend: styleLegend(legend),
    tooltip: styleTooltip(tooltip),
    media: [
      {
        query: { maxWidth: 430 },
        option: {
          legend: { show: false, itemWidth: 7, itemHeight: 7 },
          ...(baseGrid ? { grid: { left: 6, right: 10 } } : {}),
        },
      },
      {
        query: { maxHeight: 250 },
        option: {
          legend: { show: false },
          ...(baseGrid ? { grid: { top: 10, bottom: 4 } } : {}),
        },
      },
      {
        query: { maxWidth: 300 },
        option: {
          tooltip: { confine: true },
        },
      },
    ],
  } as Record<string, unknown>, sql), sql, overrides);

  return styled as EChartsOption;
}

export default function ChartBody({
  item,
  filterValues,
}: {
  item: ManifestItem;
  filterValues?: Record<string, any>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { data, isLoading, isError, error, refetch } = useChartSpec(item, true, filterValues);

  const option = useMemo(() => {
    if (!data?.option) return null;
    const cfg = (item.config ?? {}) as Record<string, unknown>;
    return buildOption(data.option, item.sql, {
      timeFormat: typeof cfg.timeFormat === 'string' ? cfg.timeFormat : undefined,
      xFormat: typeof cfg.xFormat === 'string' ? cfg.xFormat : undefined,
      yFormat: typeof cfg.yFormat === 'string' ? cfg.yFormat : undefined,
    });
  }, [data, item.sql, item.config]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!option || !chartRef.current) return;
    chartRef.current.setOption(option, { notMerge: true, lazyUpdate: false });
    chartRef.current.resize();
  }, [option]);

  const empty = data?.rowCount === 0;
  const chartError = isError ? (error instanceof Error ? error.message : String(error)) : null;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ visibility: option && !empty ? 'visible' : 'hidden' }}
      />
      {isLoading && (
        <div className="absolute inset-0">
          <BlockLoading variant="chart" />
        </div>
      )}
      {chartError && !isLoading && (
        <div className="absolute inset-0">
          <BlockError message={chartError} onRetry={() => refetch()} />
        </div>
      )}
      {!isLoading && !chartError && empty && (
        <div className="absolute inset-0">
          <BlockEmpty title="No rows returned" hint="The query ran, but there is nothing to plot yet." />
        </div>
      )}
    </div>
  );
}
