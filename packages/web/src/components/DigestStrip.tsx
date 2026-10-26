import { useMemo } from 'react';

interface DigestSignal {
  label: string;
  deltaPct: number;
  positive: boolean;
}

interface DigestStripProps {
  signals: DigestSignal[];
}

export default function DigestStrip({ signals }: DigestStripProps) {
  if (!signals || signals.length === 0) return null;

  const negatives = signals.filter((s) => !s.positive).sort((a, b) => a.deltaPct - b.deltaPct);
  const positives = signals.filter((s) => s.positive).sort((a, b) => b.deltaPct - a.deltaPct);
  const sorted = [...negatives, ...positives].slice(0, 6);

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {sorted.map((s, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
            s.positive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {s.positive ? '▲' : '▼'} {s.label} {Math.abs(s.deltaPct).toFixed(1)}%
        </span>
      ))}
    </div>
  );
}

export function computeDigestSignals(
  metrics: { label: string; deltaPct: number | null; higherIsBetter: boolean }[],
): DigestSignal[] {
  return metrics
    .filter((m) => m.deltaPct !== null && Math.abs(m.deltaPct) >= 0.05)
    .map((m) => ({
      label: m.label,
      deltaPct: m.deltaPct!,
      positive: (m.deltaPct! > 0) === m.higherIsBetter,
    }));
}