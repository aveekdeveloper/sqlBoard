export type Polarity = 'higher_is_better' | 'lower_is_better';

export interface MetricTarget {
  value: number;
  direction: 'above' | 'below';
  thresholds?: { amber: number; red: number };
}

export interface MetricPoint {
  t: string;
  v: number;
}

export type MetricResult =
  | { kind: 'value'; value: number | null }
  | { kind: 'value_prior'; value: number | null; prior: number | null }
  | { kind: 'series'; points: MetricPoint[] };

export interface DeltaState {
  status: 'none' | 'flat' | 'up' | 'down';
  positive: boolean;
  deltaPct: number | null;
}

export const FLAT_DELTA_PCT = 0.05;

const isNumeric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }
  return isNumeric(value) ? value : null;
};

export function computeDeltaPct(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function isFlatDelta(deltaPct: number | null): boolean {
  return deltaPct === null || Math.abs(deltaPct) < FLAT_DELTA_PCT;
}

export function deltaState(
  deltaPct: number | null,
  polarity: Polarity,
): DeltaState {
  if (deltaPct === null) {
    return { status: 'none', positive: false, deltaPct: null };
  }
  if (isFlatDelta(deltaPct)) {
    return { status: 'flat', positive: false, deltaPct };
  }
  const up = deltaPct > 0;
  return {
    status: up ? 'up' : 'down',
    positive: up === (polarity === 'higher_is_better'),
    deltaPct,
  };
}

export function trafficLight(
  value: number | null,
  target: MetricTarget | undefined,
): 'green' | 'amber' | 'red' | 'none' {
  if (!target || value === null || !Number.isFinite(value) || target.value === 0) {
    return 'none';
  }
  const amber = target.thresholds?.amber ?? 0.9;
  const red = target.thresholds?.red ?? 0.7;
  const progress =
    target.direction === 'above' ? value / target.value : target.value / value;
  if (!Number.isFinite(progress)) return 'none';
  if (progress >= amber) return 'green';
  if (progress >= red) return 'amber';
  return 'red';
}

export function seriesToValuePrior(
  points: MetricPoint[],
): { value: number | null; prior: number | null } {
  if (points.length === 0) return { value: null, prior: null };
  const latest = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : undefined;
  return { value: latest.v, prior: previous ? previous.v : null };
}

const VALUE_COLUMN_PATTERNS = [/^value$/, /^current$/, /^metric$/, /^result$/, /^amount$/];
const PRIOR_COLUMN_PATTERNS = [/^prior/, /previous/, /_prev$/, /_prior$/];
const TIME_COLUMN_PATTERNS = [
  /month/,
  /date/,
  /day/,
  /week/,
  /quarter/,
  /year/,
  /time/,
  /period/,
];

const findColumn = (
  columns: string[],
  rows: Record<string, unknown>[],
  patterns: RegExp[],
): string | undefined =>
  columns.find(
    (column) =>
      patterns.some((pattern) => pattern.test(column.toLowerCase())) &&
      rows.some((row) => toNumber(row[column]) !== null),
  );

export function interpretMetricRows(
  rows: Array<Record<string, unknown>>,
): MetricResult {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { kind: 'value', value: null };
  }

  const columns = Object.keys(rows[0]);
  const priorColumn = findColumn(columns, rows, PRIOR_COLUMN_PATTERNS);
  const valueColumn =
    findColumn(columns, rows, VALUE_COLUMN_PATTERNS) ??
    columns.find((column) => rows.some((row) => toNumber(row[column]) !== null));
  const timeColumn = columns.find(
    (column) =>
      TIME_COLUMN_PATTERNS.some((pattern) => pattern.test(column.toLowerCase())) &&
      !Number.isFinite(Number(rows[0][column])),
  );

  if (!valueColumn) {
    return { kind: 'value', value: null };
  }

  if (rows.length === 1 || !timeColumn) {
    const value = toNumber(rows[0][valueColumn]);
    if (priorColumn) {
      return { kind: 'value_prior', value, prior: toNumber(rows[0][priorColumn]) };
    }
    return { kind: 'value', value };
  }

  const points: MetricPoint[] = rows
    .map((row) => ({ t: String(row[timeColumn]), v: toNumber(row[valueColumn]) }))
    .filter((point): point is MetricPoint => point.v !== null)
    .sort((left, right) => left.t.localeCompare(right.t));

  return { kind: 'series', points };
}
