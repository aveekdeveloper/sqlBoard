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

function formatDate(value: unknown): string {
  if (typeof value !== 'string') return String(value ?? '');
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const month = d.toLocaleString('en', { month: 'short' });
  const year = d.getFullYear();
  const day = d.getDate();
  if (/^\d{4}-\d{2}$/.test(value)) return `${month} ${year}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${month} ${day}`;
  return `${month} ${day}, ${year}`;
}

function isDateLike(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^\d{4}-\d{2}(-\d{2})?/.test(val) || (!isNaN(Date.parse(val)) && val.includes('-'));
}

export function styleAxes(option: Record<string, unknown>, sql?: string): Record<string, unknown> {
  const annotations = parseAnnotations(sql || '');
  const xFormat = (annotations.xformat || annotations.xFormat || 'auto').toLowerCase();
  const yFormat = (annotations.yformat || annotations.yFormat || 'auto').toLowerCase();
  const rotateOverride = annotations.rotate ? Number(annotations.rotate) : null;

  const styleAxis = (axis: unknown, format: string) => {
    if (!axis || typeof axis !== 'object' || Array.isArray(axis)) return axis;
    const a = axis as Record<string, unknown>;
    const labels = Array.isArray(a.data) ? a.data : [];
    const maxLabelLen = labels.reduce((max: number, l: unknown) => Math.max(max, String(l ?? '').length), 0);
    const autoRotate = maxLabelLen > 12 ? 45 : maxLabelLen > 8 ? 30 : 0;
    const rotate = rotateOverride !== null && !isNaN(rotateOverride) ? rotateOverride : autoRotate;
    const isDate = labels.length > 0 && labels.some(isDateLike);
    const resolvedFormat = format === 'auto' ? (isDate ? 'date' : 'compact') : format;

    return {
      ...a,
      axisLabel: {
        ...(a.axisLabel as Record<string, unknown> | undefined),
        rotate,
        interval: 'auto',
        hideOverlap: true,
        formatter: (val: unknown) => {
          if (resolvedFormat === 'date') return formatDate(val);
          if (typeof val === 'number') return formatNumber(val, resolvedFormat);
          if (isDateLike(val)) return formatDate(val);
          return String(val ?? '');
        },
      },
    };
  };

  const xAxis = Array.isArray(option.xAxis)
    ? option.xAxis.map((a) => styleAxis(a, xFormat))
    : styleAxis(option.xAxis, xFormat);
  const yAxis = Array.isArray(option.yAxis)
    ? option.yAxis.map((a) => styleAxis(a, yFormat))
    : styleAxis(option.yAxis, yFormat);

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

function buildOption(raw: Record<string, unknown>, sql?: string): EChartsOption {
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
  } as Record<string, unknown>, sql), sql);

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
    return buildOption(data.option, item.sql);
  }, [data, item.sql]);

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
