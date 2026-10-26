import {
  parseDashboardManifest,
  serializeDashboardManifest,
  type DashboardBlockType,
  type DashboardItemDto,
  type Layout,
  type ManifestConnection,
  type ManifestSavedQuery,
  type ManifestDashboard,
  type ManifestDiagnostic,
  type ManifestItem,
  type ManifestFilter,
  type MetricFormat,
} from '@sqlboard/shared';

export type { DashboardBlockType, Layout, ManifestDiagnostic, ManifestItem, MetricFormat };

export interface DashboardDoc {
  name: string;
  description: string | null;
  filters: ManifestFilter[];
  items: ManifestItem[];
}

export type BlockDraft = ManifestItem;

export interface BlockMeta {
  label: string;
  short: string;
  description: string;
  minW: number;
  minH: number;
  defaultLayout: Omit<Layout, 'x' | 'y'>;
}

export const BLOCK_META: Record<DashboardBlockType, BlockMeta> = {
  chart: {
    label: 'Chart',
    short: 'Chart',
    description: 'Annotated SQL rendered with ECharts.',
    minW: 4,
    minH: 6,
    defaultLayout: { w: 6, h: 8 },
  },
  metric: {
    label: 'Metric',
    short: 'KPI',
    description: 'One number, its movement, and optional target.',
    minW: 2,
    minH: 3,
    defaultLayout: { w: 3, h: 3 },
  },
  table: {
    label: 'Table',
    short: 'Table',
    description: 'Query rows with client-side sort and paging.',
    minW: 4,
    minH: 5,
    defaultLayout: { w: 6, h: 8 },
  },
  text: {
    label: 'Text',
    short: 'Text',
    description: 'Markdown commentary, sanitized and HTML-free.',
    minW: 3,
    minH: 2,
    defaultLayout: { w: 12, h: 3 },
  },
};

export const BLOCK_TYPES: DashboardBlockType[] = ['chart', 'metric', 'table', 'text'];

export const FORMAT_OPTIONS: Array<{ value: MetricFormat; label: string }> = [
  { value: 'number', label: 'Number' },
  { value: 'compact', label: 'Compact' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
];

export const DEFAULT_SQL: Record<Exclude<DashboardBlockType, 'text'>, string> = {
  chart:
    '-- @viz: bar\n-- @x: category\n-- @y: value\nSELECT category, value\nFROM your_table\nORDER BY value DESC\nLIMIT 20;',
  metric:
    '-- @metric: revenue\n-- @format: currency\nSELECT SUM(revenue) AS revenue\nFROM your_table;',
  table: 'SELECT *\nFROM your_table\nLIMIT 100;',
};

export const DEFAULT_MARKDOWN = `## Context

Write the story around the numbers. **Bold**, *italic*, lists and tables are supported.

- What changed
- Why it matters
`;

export const blockKey = (index: number): string => `block-${index}`;
export const blockIndexFromKey = (key: string): number => Number(key.replace('block-', ''));

export function dashboardToDoc(
  dashboard: {
    name: string;
    description: string | null;
    items: DashboardItemDto[];
    filters?: ManifestFilter[] | Record<string, unknown>[];
  },
): DashboardDoc {
  return {
    name: dashboard.name,
    description: dashboard.description,
    filters: (dashboard.filters ?? []) as ManifestFilter[],
    items: dashboard.items.map((item) => ({
      id: item.id,
      title: item.title,
      sql: item.sql,
      connectionId: item.connectionId,
      savedQueryId: item.savedQueryId ?? null,
      blockType: item.blockType,
      config: item.config ?? null,
      layout: normalizeLayout(item.layout),
    })),
  };
}

export function serializeDoc(
  doc: DashboardDoc,
  connections: ManifestConnection[],
  savedQueries: ManifestSavedQuery[] = [],
): string {
  return serializeDashboardManifest(doc, connections, savedQueries);
}

export function parseDoc(
  code: string,
  connections: ManifestConnection[],
  savedQueries: ManifestSavedQuery[] = [],
): { doc: DashboardDoc; diagnostics: ManifestDiagnostic[] } {
  const { dashboard, diagnostics } = parseDashboardManifest(code, connections, savedQueries);
  return { doc: dashboard, diagnostics };
}

export function normalizeLayout(layout: Layout): Layout {
  return {
    x: clamp(Math.round(layout.x), 0, 11),
    y: Math.max(0, Math.round(layout.y)),
    w: clamp(Math.round(layout.w), 1, 12),
    h: clamp(Math.round(layout.h), 1, 60),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function bottomOf(doc: DashboardDoc): number {
  return doc.items.reduce((max, item) => Math.max(max, item.layout.y + item.layout.h), 0);
}

export function nextLayout(doc: DashboardDoc, type: DashboardBlockType): Layout {
  const meta = BLOCK_META[type];
  return {
    x: 0,
    y: bottomOf(doc),
    ...meta.defaultLayout,
  };
}

export function defaultConfig(type: DashboardBlockType): Record<string, unknown> | null {
  if (type === 'metric') {
    return { higherIsBetter: true, format: 'number' };
  }
  if (type === 'table') {
    return { pageSize: 25, density: 'compact', maxRows: 1000 };
  }
  if (type === 'text') {
    return { markdown: DEFAULT_MARKDOWN };
  }
  return null;
}

export function createBlock(
  doc: DashboardDoc,
  type: DashboardBlockType,
  connectionId: number,
): ManifestItem {
  const title =
    type === 'chart'
      ? 'Untitled chart'
      : type === 'metric'
        ? 'Untitled metric'
        : type === 'table'
          ? 'Untitled table'
          : 'Untitled note';
  return {
    title,
    sql: type === 'text' ? '' : DEFAULT_SQL[type],
    connectionId: type === 'text' ? 0 : connectionId,
    blockType: type,
    config: defaultConfig(type),
    layout: nextLayout(doc, type),
  };
}

/**
 * Code edits do not carry database ids. Re-attach them from the previous
 * document so drag/resize can persist against the right rows.
 */
export function attachIds(items: ManifestItem[], previous: ManifestItem[]): ManifestItem[] {
  const used = new Set<number>();
  const byId = new Map<number, ManifestItem>();
  for (const item of previous) {
    if (item.id !== undefined) {
      byId.set(item.id, item);
      used.add(item.id);
    }
  }

  return items.map((item, index) => {
    if (item.id !== undefined) return item;

    const candidates = [
      previous.find(
        (candidate) =>
          candidate.id !== undefined &&
          !used.has(candidate.id) &&
          candidate.title === item.title &&
          candidate.blockType === item.blockType,
      ),
      previous.find(
        (candidate) =>
          candidate.id !== undefined &&
          !used.has(candidate.id) &&
          candidate.sql === item.sql &&
          candidate.blockType === item.blockType,
      ),
      previous[index]?.id !== undefined &&
      !used.has(previous[index].id as number) &&
      previous[index].blockType === item.blockType
        ? previous[index]
        : undefined,
    ];

    const match = candidates.find((candidate) => candidate?.id !== undefined);
    if (!match || match.id === undefined) return item;
    used.add(match.id);
    return { ...item, id: match.id };
  });
}

export function withItemAt(
  doc: DashboardDoc,
  index: number,
  item: ManifestItem,
): DashboardDoc {
  const items = doc.items.slice();
  items[index] = { ...item, id: items[index]?.id ?? item.id };
  return { ...doc, items };
}

export function withoutItemAt(doc: DashboardDoc, index: number): DashboardDoc {
  return { ...doc, items: doc.items.filter((_, itemIndex) => itemIndex !== index) };
}

export function appendItem(doc: DashboardDoc, item: ManifestItem): DashboardDoc {
  return { ...doc, items: [...doc.items, item] };
}

export function withLayouts(
  doc: DashboardDoc,
  layouts: Record<string, Layout>,
): DashboardDoc {
  return {
    ...doc,
    items: doc.items.map((item, index) => {
      const layout = layouts[blockKey(index)];
      return layout ? { ...item, layout: normalizeLayout(layout) } : item;
    }),
  };
}

export function resolveConnectionName(
  connectionId: number,
  connections: ManifestConnection[],
): string {
  return connections.find((connection) => connection.id === connectionId)?.name ?? '—';
}

export function formatMetricValue(value: number | null, format: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      }).format(value);
    case 'percent':
      return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
    case 'compact':
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value);
    default:
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }
}

export function formatCellValue(value: unknown, format?: MetricFormat): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && format) return formatMetricValue(value, format);
  if (typeof value === 'number') {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const seconds = Math.round((then - Date.now()) / 1000);
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, secondsPerUnit] of table) {
    if (Math.abs(seconds) >= secondsPerUnit || unit === 'second') {
      return formatter.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }
  return iso;
}

export function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
