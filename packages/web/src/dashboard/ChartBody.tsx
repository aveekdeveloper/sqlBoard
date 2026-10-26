import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { useChartSpec } from './queries.js';
import type { ManifestItem } from './model.js';
import { BlockEmpty, BlockError, BlockLoading } from './BlockState.js';

const FONT_STACK =
  "Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif";

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

function buildOption(raw: Record<string, unknown>): EChartsOption {
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

  return {
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
  } as EChartsOption;
}

export default function ChartBody({ item }: { item: ManifestItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { data, isLoading, isError, error, refetch } = useChartSpec(item);

  const option = useMemo(() => (data?.option ? buildOption(data.option) : null), [data]);

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
