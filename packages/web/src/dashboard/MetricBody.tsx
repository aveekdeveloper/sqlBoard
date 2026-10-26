import { useId, useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useBlockData } from './queries.js';
import { formatMetricValue, type ManifestItem } from './model.js';
import { BlockEmpty, BlockError, BlockLoading } from './BlockState.js';

interface TargetConfig {
  value: number;
  direction: 'above' | 'below';
  thresholds?: { amber: number; red: number };
}

interface MetricConfig {
  metricColumn?: string;
  priorColumn?: string;
  sparklineColumn?: string;
  higherIsBetter: boolean;
  format: 'number' | 'currency' | 'percent' | 'compact';
  target?: TargetConfig;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readConfig(item: ManifestItem): MetricConfig {
  const raw = (item.config ?? {}) as Record<string, unknown>;
  const targetRaw = raw.target as Record<string, unknown> | undefined;
  const thresholds = targetRaw?.thresholds as Record<string, unknown> | undefined;
  const targetValue = numeric(targetRaw?.value);
  const target: TargetConfig | undefined =
    targetValue === null
      ? undefined
      : {
          value: targetValue,
          direction: targetRaw?.direction === 'below' ? 'below' : 'above',
          thresholds:
            numeric(thresholds?.amber) !== null || numeric(thresholds?.red) !== null
              ? {
                  amber: numeric(thresholds?.amber) ?? 0.9,
                  red: numeric(thresholds?.red) ?? 0.7,
                }
              : undefined,
        };

  const format = raw.format;
  return {
    metricColumn: typeof raw.metricColumn === 'string' ? raw.metricColumn : undefined,
    priorColumn: typeof raw.priorColumn === 'string' ? raw.priorColumn : undefined,
    sparklineColumn: typeof raw.sparklineColumn === 'string' ? raw.sparklineColumn : undefined,
    higherIsBetter: raw.higherIsBetter !== false,
    format:
      format === 'currency' || format === 'percent' || format === 'compact' ? format : 'number',
    target,
  };
}

function targetProgress(value: number | null, target: TargetConfig): number {
  if (value === null) return 0;
  if (target.direction === 'above') {
    if (target.value === 0) return value > 0 ? 1 : 0;
    return value / target.value;
  }
  if (value <= 0) return 1;
  return target.value / value;
}

function TargetBar({
  value,
  target,
  format,
}: {
  value: number | null;
  target: TargetConfig;
  format: string;
}) {
  const ratio = targetProgress(value, target);
  const amberAt = target.thresholds?.amber ?? 0.9;
  const redAt = target.thresholds?.red ?? 0.7;
  const tone =
    ratio >= amberAt ? 'bg-positive' : ratio >= redAt ? 'bg-warning' : 'bg-signal';

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[10px] text-ink-faint">
        <span className="truncate">
          Target <span className="tabular text-ink-muted">{formatMetricValue(target.value, format)}</span>
        </span>
        <span className="tabular shrink-0">{Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[#ece8df]">
        <div
          className={`h-full rounded-full ${tone} transition-[width] duration-500 ease-smooth`}
          style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Sparkline({
  points,
  positive,
}: {
  points: Array<{ label: string; value: number }>;
  positive: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (points.length < 2) return null;

  const sampled =
    points.length > 64
      ? points.filter((_, index) => index % Math.ceil(points.length / 64) === 0)
      : points;
  const values = sampled.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 96;
  const height = 30;
  const coordinates = sampled.map((point, index) => {
    const x = (index / (sampled.length - 1)) * width;
    const y = height - ((point.value - min) / range) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = coordinates.join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const last = coordinates[coordinates.length - 1].split(',');
  const color = positive ? '#2f6b4f' : '#c8412f';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[30px] w-[96px] shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#spark-${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="1.9" fill={color} />
    </svg>
  );
}

export default function MetricBody({ item }: { item: ManifestItem }) {
  const config = useMemo(() => readConfig(item), [item]);
  const { data, isLoading, isError, error, refetch } = useBlockData(item);

  if (isLoading) return <BlockLoading variant="metric" />;
  if (isError) {
    return (
      <BlockError
        message={error instanceof Error ? error.message : String(error)}
        onRetry={() => refetch()}
      />
    );
  }

  const rows = data?.rows ?? [];
  const columns = data?.columns ?? [];
  if (rows.length === 0) {
    return <BlockEmpty title="No value returned" hint="The query returned no rows." />;
  }

  const numericColumns = columns.filter((column) =>
    rows.some((row) => numeric(row[column]) !== null),
  );
  const metricColumn =
    config.metricColumn && columns.includes(config.metricColumn)
      ? config.metricColumn
      : numericColumns[0] ?? columns[0];
  const labelColumn = columns.find((column) => !numericColumns.includes(column));

  if (!metricColumn) {
    return <BlockEmpty title="No numeric column" hint="Return one numeric column from the query." />;
  }

  const priorColumn =
    config.priorColumn && columns.includes(config.priorColumn)
      ? config.priorColumn
      : columns.find(
          (column) =>
            column !== metricColumn &&
            numericColumns.includes(column) &&
            /prior|previous|prev|baseline|last|comparison/i.test(column),
        );

  const lastRow = rows[rows.length - 1];
  const value = numeric(lastRow[metricColumn]);
  const prior =
    priorColumn !== undefined
      ? numeric(lastRow[priorColumn])
      : rows.length > 1
        ? numeric(rows[rows.length - 2][metricColumn])
        : null;

  const sparklineColumn =
    config.sparklineColumn && columns.includes(config.sparklineColumn)
      ? config.sparklineColumn
      : rows.length > 1
        ? metricColumn
        : null;
  const sparkline =
    sparklineColumn !== null
      ? rows
          .map((row, index) => ({
            label: labelColumn ? String(row[labelColumn] ?? index + 1) : String(index + 1),
            value: numeric(row[sparklineColumn]),
          }))
          .filter((point): point is { label: string; value: number } => point.value !== null)
      : [];

  const delta =
    value !== null && prior !== null && prior !== 0
      ? ((value - prior) / Math.abs(prior)) * 100
      : null;
  const flat = delta === null || Math.abs(delta) < 0.05;
  const positive = delta !== null && !flat && (delta > 0) === config.higherIsBetter;
  const deltaTone = flat
    ? 'bg-[#f1eee7] text-ink-muted'
    : positive
      ? 'bg-accent-soft text-accent-ink'
      : 'bg-signal-soft text-signal';
  const sparkPositive =
    value !== null && prior !== null ? value >= prior === config.higherIsBetter : true;

  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-2 py-0.5">
      <div className="min-w-0">
        <div className="truncate text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-faint">
          {config.metricColumn ? 'Bound metric' : 'Latest'} · {metricColumn}
        </div>
        <div className="mt-1.5 flex flex-wrap items-end gap-x-2 gap-y-1">
          <span className="tabular text-[clamp(25px,2.1vw,40px)] font-semibold leading-[0.95] tracking-[-0.035em] text-ink">
            {formatMetricValue(value, config.format)}
          </span>
          {delta === null ? (
            <span className="mb-0.5 text-[10.5px] text-ink-faint">no prior</span>
          ) : (
            <span
              className={`mb-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium tabular ${deltaTone}`}
            >
              {flat ? (
                <Minus size={10} strokeWidth={2.4} />
              ) : delta > 0 ? (
                <ArrowUpRight size={10} strokeWidth={2.4} />
              ) : (
                <ArrowDownRight size={10} strokeWidth={2.4} />
              )}
              {flat ? 'flat' : `${Math.abs(delta).toFixed(1)}%`}
            </span>
          )}
        </div>
        <div className="mt-1.5 truncate text-[10.5px] text-ink-muted">
          {prior === null ? (
            'No comparison period'
          ) : (
            <>
              vs <span className="tabular">{formatMetricValue(prior, config.format)}</span>
            </>
          )}
        </div>
      </div>

      {(config.target || sparkline.length > 1) && (
        <div className="flex min-w-0 items-end justify-between gap-3">
          {config.target ? (
            <TargetBar value={value} target={config.target} format={config.format} />
          ) : (
            <span />
          )}
          {sparkline.length > 1 && <Sparkline points={sparkline} positive={sparkPositive} />}
        </div>
      )}
    </div>
  );
}
