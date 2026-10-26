import { describe, expect, it } from 'vitest';
import {
  computeDeltaPct,
  deltaState,
  interpretMetricRows,
  isFlatDelta,
  seriesToValuePrior,
  trafficLight,
} from '../src/index.js';

describe('computeDeltaPct', () => {
  it('computes percent delta against absolute prior', () => {
    expect(computeDeltaPct(20, 10)).toBe(100);
    expect(computeDeltaPct(15, 10)).toBeCloseTo(50);
    expect(computeDeltaPct(5, 10)).toBe(-50);
    expect(computeDeltaPct(10, -10)).toBe(200);
  });

  it('returns null for non-finite input and zero prior', () => {
    expect(computeDeltaPct(Number.NaN, 10)).toBeNull();
    expect(computeDeltaPct(10, 0)).toBeNull();
  });
});

describe('deltaState', () => {
  it('marks up and down with polarity-aware positivity', () => {
    const up = deltaState(10, 'higher_is_better');
    expect(up.status).toBe('up');
    expect(up.positive).toBe(true);

    const upBad = deltaState(10, 'lower_is_better');
    expect(upBad.status).toBe('up');
    expect(upBad.positive).toBe(false);

    const down = deltaState(-10, 'lower_is_better');
    expect(down.status).toBe('down');
    expect(down.positive).toBe(true);
  });

  it('suppresses flat deltas and missing priors', () => {
    expect(deltaState(0.01, 'higher_is_better').status).toBe('flat');
    expect(deltaState(null, 'higher_is_better').status).toBe('none');
    expect(isFlatDelta(0.01)).toBe(true);
    expect(isFlatDelta(null)).toBe(true);
  });
});

describe('trafficLight', () => {
  const target = { value: 100, direction: 'above' as const };

  it('colors by progress bands for above targets', () => {
    expect(trafficLight(105, target)).toBe('green');
    expect(trafficLight(85, target)).toBe('amber');
    expect(trafficLight(50, target)).toBe('red');
  });

  it('handles below targets and missing values', () => {
    expect(trafficLight(80, { value: 100, direction: 'below' })).toBe('green');
    expect(trafficLight(115, { value: 100, direction: 'below' })).toBe('amber');
    expect(trafficLight(null, target)).toBe('none');
    expect(trafficLight(50, undefined)).toBe('none');
  });
});

describe('interpretMetricRows', () => {
  it('reads a single value', () => {
    const result = interpretMetricRows([{ value: 42 }]);
    expect(result).toEqual({ kind: 'value', value: 42 });
  });

  it('reads value plus prior columns', () => {
    const result = interpretMetricRows([{ value: 42, prior: 40 }]);
    expect(result).toEqual({ kind: 'value_prior', value: 42, prior: 40 });
  });

  it('reads a time series and sorts it', () => {
    const result = interpretMetricRows([
      { month: '2026-02', value: 30 },
      { month: '2026-01', value: 10 },
    ]);
    expect(result.kind).toBe('series');
    if (result.kind === 'series') {
      expect(result.points).toEqual([
        { t: '2026-01', v: 10 },
        { t: '2026-02', v: 30 },
      ]);
      expect(seriesToValuePrior(result.points)).toEqual({ value: 30, prior: 10 });
    }
  });

  it('falls back to the first numeric column without named hints', () => {
    const result = interpretMetricRows([{ revenue: 1200 }]);
    expect(result).toEqual({ kind: 'value', value: 1200 });
  });

  it('returns null value for empty rows', () => {
    expect(interpretMetricRows([])).toEqual({ kind: 'value', value: null });
  });

  it('normalizes bigint values', () => {
    const result = interpretMetricRows([{ value: 12n }]);
    expect(result).toEqual({ kind: 'value', value: 12 });
  });
});
