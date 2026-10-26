import type { DashboardBlockType, Layout, MetricFormat } from './api-types.js';

export interface ManifestConnection {
  id: number;
  name: string;
}

export interface ManifestSavedQuery {
  id: number;
  name: string;
  sql: string;
  connectionId: number;
}

export interface ManifestItem {
  id?: number;
  title: string;
  sql: string;
  connectionId: number;
  savedQueryId?: number | null;
  blockType: DashboardBlockType;
  config: Record<string, unknown> | null;
  layout: Layout;
}

export interface ManifestDashboard {
  name: string;
  description: string | null;
  items: ManifestItem[];
}

export interface ManifestDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  block?: string;
}

const BLOCK_LINE = /^--\s*@block:\s*(.*?)\s*$/;
const ANNOTATION_LINE = /^--\s*@([a-zA-Z0-9_]+):\s*(.*?)\s*$/;
const MANIFEST_KEYS = new Set(['type', 'layout', 'connection', 'block']);
const TRUTHY = new Set(['true', 'yes', '1', 'on']);

const DEFAULT_LAYOUT: Record<DashboardBlockType, Layout> = {
  chart: { x: 0, y: 0, w: 6, h: 8 },
  metric: { x: 0, y: 0, w: 3, h: 3 },
  table: { x: 0, y: 0, w: 6, h: 8 },
  text: { x: 0, y: 0, w: 12, h: 3 },
};

const oneLine = (value: string | null | undefined): string =>
  (value ?? '').replace(/\r?\n/g, ' ').trim();

const escapeMarkdownBody = (value: string): string =>
  value.replace(/\*\//g, '* /').trim();

function parseLayout(value: string | undefined): Layout | null {
  if (!value) return null;
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x, y, w, h] = parts.map((part) => Math.max(0, Math.round(part)));
  return { x, y, w: Math.max(1, Math.min(12, w)), h: Math.max(1, Math.min(60, h)) };
}

function layoutFor(
  raw: string | undefined,
  type: DashboardBlockType,
  bottom: number,
): { layout: Layout; diagnostic?: ManifestDiagnostic } {
  const parsed = parseLayout(raw);
  if (parsed) return { layout: parsed };
  const fallback = { ...DEFAULT_LAYOUT[type], y: bottom };
  if (raw?.trim()) {
    return {
      layout: fallback,
      diagnostic: {
        severity: 'warning',
        code: 'INVALID_LAYOUT',
        message: `'${raw.trim()}' is not a valid x,y,w,h layout; using ${fallback.x},${fallback.y},${fallback.w},${fallback.h}.`,
      },
    };
  }
  return { layout: fallback };
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return TRUTHY.has(value.trim().toLowerCase());
}

function parseFormat(value: string | undefined): Record<string, MetricFormat> | undefined {
  if (!value?.trim()) return undefined;
  const output: Record<string, MetricFormat> = {};
  for (const entry of value.split(',')) {
    const index = entry.indexOf(':');
    if (index === -1) continue;
    const column = entry.slice(0, index).trim();
    const format = entry.slice(index + 1).trim() as MetricFormat;
    if (column && ['number', 'currency', 'percent', 'compact'].includes(format)) {
      output[column] = format;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function metricConfig(annotations: Record<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (annotations.metric) config.metricColumn = annotations.metric;
  if (annotations.prior) config.priorColumn = annotations.prior;
  if (annotations.sparkline) config.sparklineColumn = annotations.sparkline;
  if (annotations.format) config.format = annotations.format;
  if (annotations.higherisbetter !== undefined) {
    config.higherIsBetter = booleanValue(annotations.higherisbetter) ?? true;
  }
  const target = numberValue(annotations.target);
  if (target !== undefined) {
    const thresholds: Record<string, number> = {};
    const amber = numberValue(annotations.targetamber);
    const red = numberValue(annotations.targetred);
    if (amber !== undefined) thresholds.amber = amber;
    if (red !== undefined) thresholds.red = red;
    config.target = {
      value: target,
      direction: annotations.targetdirection === 'below' ? 'below' : 'above',
      ...(Object.keys(thresholds).length > 0 ? { thresholds } : {}),
    };
  }
  return config;
}

function tableConfig(annotations: Record<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (annotations.columns) {
    config.columns = annotations.columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
  }
  const pageSize = numberValue(annotations.pagesize);
  if (pageSize !== undefined) config.pageSize = pageSize;
  if (annotations.density === 'comfortable' || annotations.density === 'compact') {
    config.density = annotations.density;
  }
  const maxRows = numberValue(annotations.maxrows);
  if (maxRows !== undefined) config.maxRows = maxRows;
  const format = parseFormat(annotations.format);
  if (format) config.format = format;
  if (annotations.rownumbers !== undefined) {
    config.rowNumbers = booleanValue(annotations.rownumbers) ?? false;
  }
  return config;
}

function inferType(annotations: Record<string, string>, body: string): DashboardBlockType {
  const explicit = annotations.type?.trim().toLowerCase();
  if (explicit === 'chart' || explicit === 'metric' || explicit === 'table' || explicit === 'text') {
    return explicit;
  }
  if (annotations.metric) return 'metric';
  if (annotations.columns && !annotations.viz) return 'table';
  if (body.trimStart().startsWith('/*')) return 'text';
  return 'chart';
}

function configFor(
  type: DashboardBlockType,
  annotations: Record<string, string>,
  markdown: string,
): Record<string, unknown> | null {
  if (type === 'metric') return metricConfig(annotations);
  if (type === 'table') return tableConfig(annotations);
  if (type === 'text') return { markdown };
  return null;
}

function configAnnotations(type: DashboardBlockType, config: Record<string, unknown> | null): string[] {
  if (!config) return [];
  const lines: string[] = [];
  const push = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    lines.push(`-- @${key}: ${oneLine(String(value))}`);
  };

  if (type === 'metric') {
    push('metric', config.metricColumn);
    push('prior', config.priorColumn);
    push('sparkline', config.sparklineColumn);
    push('format', config.format);
    if (config.higherIsBetter !== undefined) push('higherIsBetter', config.higherIsBetter);
    const target = config.target as
      | { value?: number; direction?: string; thresholds?: { amber?: number; red?: number } }
      | undefined;
    if (target?.value !== undefined) {
      push('target', target.value);
      push('targetDirection', target.direction ?? 'above');
      if (target.thresholds?.amber !== undefined) push('targetAmber', target.thresholds.amber);
      if (target.thresholds?.red !== undefined) push('targetRed', target.thresholds.red);
    }
  }

  if (type === 'table') {
    const columns = config.columns as string[] | undefined;
    if (columns?.length) push('columns', columns.join(', '));
    push('pageSize', config.pageSize);
    push('density', config.density);
    push('maxRows', config.maxRows);
    const format = config.format as Record<string, string> | undefined;
    if (format && Object.keys(format).length > 0) {
      push(
        'format',
        Object.entries(format)
          .map(([column, value]) => `${column}: ${value}`)
          .join(', '),
      );
    }
    if (config.rowNumbers !== undefined) push('rowNumbers', config.rowNumbers);
  }

  return lines;
}

export function serializeDashboardManifest(
  dashboard: ManifestDashboard,
  connections: ManifestConnection[],
  savedQueries: ManifestSavedQuery[] = [],
): string {
  const byId = new Map(connections.map((connection) => [connection.id, connection.name]));
  const lines: string[] = [
    `-- @dashboard: ${oneLine(dashboard.name) || 'Untitled dashboard'}`,
  ];
  if (dashboard.description) lines.push(`-- @description: ${oneLine(dashboard.description)}`);
  lines.push('-- @grid: 12');

  for (const item of dashboard.items) {
    const connection = byId.get(item.connectionId) ?? `connection-${item.connectionId}`;
    lines.push('');
    lines.push(`-- @block: ${oneLine(item.title) || 'Untitled block'}`);
    lines.push(`-- @type: ${item.blockType}`);
    lines.push(
      `-- @layout: ${item.layout.x},${item.layout.y},${item.layout.w},${item.layout.h}`,
    );
    if (item.blockType !== 'text') {
      lines.push(`-- @connection: ${oneLine(connection)}`);
      const savedQuery = savedQueries.find((query) => query.id === item.savedQueryId);
      if (savedQuery) lines.push(`-- @saved-query: ${oneLine(savedQuery.name)}`);
    }
    lines.push(...configAnnotations(item.blockType, item.config));

    if (item.blockType === 'text') {
      const markdown = escapeMarkdownBody(
        String((item.config as { markdown?: string } | null)?.markdown ?? ''),
      );
      lines.push('/*');
      if (markdown) lines.push(markdown);
      lines.push('*/');
    } else {
      lines.push(item.sql.trim());
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function parseDashboardManifest(
  code: string,
  connections: ManifestConnection[],
  savedQueries: ManifestSavedQuery[] = [],
): { dashboard: ManifestDashboard; diagnostics: ManifestDiagnostic[] } {
  const diagnostics: ManifestDiagnostic[] = [];
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const blockStarts: number[] = [];

  lines.forEach((line, index) => {
    if (BLOCK_LINE.test(line)) blockStarts.push(index);
  });

  const headerEnd = blockStarts[0] ?? lines.length;
  const header = lines.slice(0, headerEnd).join('\n');
  const dashboardAnnotations: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const match = line.match(ANNOTATION_LINE);
    if (match) dashboardAnnotations[match[1].toLowerCase()] = match[2];
  }

  const name = dashboardAnnotations.dashboard?.trim() || 'Untitled dashboard';
  const description = dashboardAnnotations.description?.trim() || null;
  const byName = new Map<string, ManifestConnection>();
  for (const connection of connections) {
    const key = connection.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, connection);
  }
  const savedByName = new Map<string, ManifestSavedQuery>();
  for (const savedQuery of savedQueries) {
    const key = savedQuery.name.trim().toLowerCase();
    if (!savedByName.has(key)) savedByName.set(key, savedQuery);
  }

  const items: ManifestItem[] = [];
  let bottom = 0;

  blockStarts.forEach((start, blockIndex) => {
    const end = blockStarts[blockIndex + 1] ?? lines.length;
    const segment = lines.slice(start, end);
    const title = segment[0].match(BLOCK_LINE)?.[1]?.trim() || `Block ${blockIndex + 1}`;

    let cursor = 1;
    const annotations: Record<string, string> = {};
    const rawAnnotationLines: string[] = [];
    for (; cursor < segment.length; cursor += 1) {
      const line = segment[cursor];
      if (line.trim() === '') {
        rawAnnotationLines.push(line);
        continue;
      }
      if (!line.trimStart().startsWith('--')) break;
      const match = line.match(ANNOTATION_LINE);
      if (match) annotations[match[1].toLowerCase()] = match[2];
      rawAnnotationLines.push(line);
    }

    const body = segment.slice(cursor).join('\n').trim();
    const type = inferType(annotations, body);
    if (!annotations.type) {
      diagnostics.push({
        severity: 'info',
        code: 'BLOCK_TYPE_INFERRED',
        message: `Block '${title}' has no @type; treating it as '${type}'.`,
        block: title,
      });
    }

    if (type === 'metric' && annotations.viz) {
      diagnostics.push({
        severity: 'error',
        code: 'VIZ_ON_METRIC',
        message: `Metric block '${title}' must not use @viz; use @metric to bind the value column.`,
        block: title,
      });
    }
    if (type !== 'metric' && annotations.metric) {
      diagnostics.push({
        severity: 'error',
        code: 'METRIC_ON_NON_METRIC',
        message: `@metric is only valid on @type: metric blocks ('${title}').`,
        block: title,
      });
    }
    if (type === 'text' && annotations.viz) {
      diagnostics.push({
        severity: 'warning',
        code: 'VIZ_ON_TEXT',
        message: `Text block '${title}' ignores @viz.`,
        block: title,
      });
    }

    let markdown = '';
    if (type === 'text') {
      const open = body.indexOf('/*');
      const close = body.lastIndexOf('*/');
      if (open !== -1 && close > open) {
        markdown = body.slice(open + 2, close).replace(/^\n/, '').trim();
      } else {
        markdown = body;
        diagnostics.push({
          severity: 'warning',
          code: 'TEXT_NOT_COMMENTED',
          message: `Text block '${title}' should wrap markdown in /* ... */.`,
          block: title,
        });
      }
    }

    const keptAnnotations =
      type === 'chart'
        ? rawAnnotationLines.filter((line) => {
            const match = line.match(ANNOTATION_LINE);
            return !match || !MANIFEST_KEYS.has(match[1].toLowerCase());
          })
        : [];
    const savedQueryName = (annotations.savedquery ?? annotations.saved_query)?.trim();
    const savedQuery = savedQueryName ? savedByName.get(savedQueryName.toLowerCase()) : undefined;
    let sql =
      type === 'text'
        ? ''
        : [...keptAnnotations, body].join('\n').trim();
    if (type !== 'text' && savedQuery && !sql.trim()) sql = savedQuery.sql;

    if (type !== 'text' && type !== 'chart' && !sql) {
      diagnostics.push({
        severity: 'error',
        code: 'MISSING_SQL',
        message: `Block '${title}' has no SQL.`,
        block: title,
      });
    }

    const connectionName = annotations.connection?.trim() ?? '';
    let connectionId = 0;
    let savedQueryId: number | undefined = savedQuery?.id;
    if (type !== 'text') {
      if (!connectionName) {
        diagnostics.push({
          severity: 'error',
          code: 'MISSING_CONNECTION',
          message: `Block '${title}' needs @connection with a connection name.`,
          block: title,
        });
      } else {
        const connection = byName.get(connectionName.toLowerCase());
        if (connection) {
          connectionId = connection.id;
        } else {
          diagnostics.push({
            severity: 'error',
            code: 'UNKNOWN_CONNECTION',
            message: `Connection '${connectionName}' was not found (block '${title}').`,
            block: title,
          });
        }
      }
      if (savedQueryName) {
        const resolved = savedByName.get(savedQueryName.toLowerCase());
        if (resolved) {
          savedQueryId = resolved.id;
          if (!connectionName) connectionId = resolved.connectionId;
        } else {
          diagnostics.push({
            severity: 'error',
            code: 'UNKNOWN_SAVED_QUERY',
            message: `Saved query '${savedQueryName}' was not found (block '${title}').`,
            block: title,
          });
        }
      }
    }

    const { layout, diagnostic } = layoutFor(annotations.layout, type, bottom);
    if (diagnostic) diagnostics.push({ ...diagnostic, block: title });
    bottom = Math.max(bottom, layout.y + layout.h);

    if (type === 'metric' && !annotations.metric) {
      diagnostics.push({
        severity: 'warning',
        code: 'METRIC_COLUMN_MISSING',
        message: `Metric block '${title}' has no @metric; the first numeric column will be used.`,
        block: title,
      });
    }
    if (type === 'table' && annotations.columns) {
      const selected = annotations.columns.split(',').map((column) => column.trim()).filter(Boolean);
      if (selected.length === 0) {
        diagnostics.push({
          severity: 'warning',
          code: 'EMPTY_COLUMNS',
          message: `Table block '${title}' has an empty @columns list.`,
          block: title,
        });
      }
    }

    items.push({
      title,
      sql,
      connectionId,
      savedQueryId: type === 'text' ? null : savedQueryId ?? null,
      blockType: type,
      config: configFor(type, annotations, markdown),
      layout,
    });
  });

  if (blockStarts.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'NO_BLOCKS',
      message: 'The manifest has no -- @block: sections.',
    });
  }

  return {
    dashboard: { name, description, items },
    diagnostics,
  };
}
