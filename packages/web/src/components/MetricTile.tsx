import { useMemo } from 'react';

interface MetricTileProps {
  title: string;
  value: number | null;
  prior: number | null;
  higherIsBetter: boolean;
  format?: 'number' | 'currency' | 'percent' | 'compact';
  target?: { value: number; direction: 'above' | 'below'; thresholds?: { amber: number; red: number } };
  sparkline?: { t: string; v: number }[];
  loading?: boolean;
}

function formatValue(value: number | null, format: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'currency': return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
    case 'percent': return `${value.toFixed(1)}%`;
    case 'compact': return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    default: return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }
}

function computeDelta(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function trafficLight(value: number | null, target?: MetricTileProps['target']): string {
  if (!target || value === null) return 'border-l-gray-300';
  const progress = target.direction === 'above' ? value / target.value : target.value / value;
  const amber = target.thresholds?.amber ?? 0.9;
  const red = target.thresholds?.red ?? 0.7;
  if (progress >= amber) return 'border-l-green-500';
  if (progress >= red) return 'border-l-amber-500';
  return 'border-l-red-500';
}

function Sparkline({ points, polarity }: { points: { t: string; v: number }[]; polarity: 'positive' | 'negative' | 'neutral' }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  const color = polarity === 'positive' ? '#16a34a' : polarity === 'negative' ? '#dc2626' : '#6b7280';
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export default function MetricTile({ title, value, prior, higherIsBetter, format = 'number', target, sparkline, loading }: MetricTileProps) {
  const delta = computeDelta(value, prior);
  const flat = delta === null || Math.abs(delta) < 0.05;
  const polarity = delta === null || flat ? 'neutral' : (delta > 0) === higherIsBetter ? 'positive' : 'negative';
  const deltaColor = polarity === 'positive' ? 'text-green-600' : polarity === 'negative' ? 'text-red-600' : 'text-gray-400';
  const traffic = trafficLight(value, target);

  const progress = target && value !== null && target.value !== 0
    ? (target.direction === 'above' ? value / target.value : target.value / value)
    : null;

  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 border-l-4 ${traffic}`}>
      <div className="text-sm font-medium text-gray-500 mb-1 truncate">{title}</div>
      {loading ? (
        <div className="animate-pulse h-8 bg-gray-200 rounded w-24" />
      ) : (
        <>
          <div className="flex items-end justify-between gap-2">
            <div className="text-2xl md:text-3xl font-semibold">{formatValue(value, format)}</div>
            {sparkline && sparkline.length > 1 && <Sparkline points={sparkline} polarity={polarity} />}
          </div>
          <div className="flex items-center gap-2 mt-1 text-sm">
            {delta === null ? (
              <span className="text-gray-400">No prior data</span>
            ) : flat ? (
              <span className="text-gray-400">— flat</span>
            ) : (
              <span className={deltaColor}>
                {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
              </span>
            )}
            {prior !== null && (
              <span className="text-gray-400 text-xs">vs {formatValue(prior, format)}</span>
            )}
          </div>
          {target && progress !== null && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Target: {formatValue(target.value, format)}</span>
                <span>{(progress * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${progress >= 0.9 ? 'bg-green-500' : progress >= 0.7 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(progress * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}