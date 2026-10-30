---
name: sqlboard-author
description: Use sqlboard to connect data, run SQL, compile charts, and build dashboards. Use when the user wants to explore data, write SQL, create charts from SQL, or build a dashboard. Covers the REST API workflow for connecting, querying, compiling, and pinning charts, plus the dashboard manifest grammar, tags, workbooks, and MCP tools.
---

# sqlboard authoring

sqlboard is a lightweight, SQL-first BI server. People and AI agents use the same REST API. Dashboards are SQL-first manifests; blocks (chart/metric/table/text) are code-native.

## Core workflow

1. **Authenticate** — agents should use a scoped API token: `POST /api/tokens` with `{ name, scope, expiresInDays }` from a signed-in session, then send `Authorization: Bearer sb_…` on every call. Tokens are shown once and can be revoked. `POST /api/auth/login` still works for interactive sessions. All `/api/*` routes except `/api/health` and `/api/auth/login` require credentials; writes require the member role.
2. **Connect data** — `POST /api/connections` with a connection config, or `POST /api/uploads` with a multipart file (CSV/Parquet/JSON). Test with `POST /api/connections/:id/test`.
3. **Explore** — `GET /api/connections/:id/tables` to list tables, `GET /api/connections/:id/tables/:name/preview` for sample rows.
4. **Query** — `POST /api/connections/:id/query` with `{ sql }` → `{ columns, rows, rowCount }`.
5. **Compile** — `POST /api/compile` with `{ sql, data, theme?, backends? }` → `{ flint, echarts, compiled, diagnostics }`. Fix diagnostics, recompile.
6. **Save query** — `POST /api/saved-queries` with `{ name, connectionId, sql, tags? }`.
7. **Create dashboard** — `POST /api/dashboards` with `{ name, description, tags? }`.
8. **Apply blocks** — `PUT /api/dashboards/:id/state` with `{ name, items: [{ title, sql, connectionId, blockType, config?, layout }], filters?, theme?, colors?, baseVersion }`. `blockType` is `chart`, `metric`, `table`, or `text`. Pass the latest version as `baseVersion`; a stale write returns `409 VERSION_CONFLICT`.
9. **Commit** — `POST /api/dashboards/:id/versions` with `{ message, baseVersion }` to record a manual version. Applying state already creates a version.
10. **Restore** — `POST /api/dashboards/:id/versions/:version/restore`.

## Annotation grammar (chart SQL)

See the sql-to-flint grammar (sql-to-flint ships its own skill). Key annotations:

- `-- @viz: bar | line | area | scatter | pie | heatmap` (or any Flint template)
- `-- @x`, `-- @y`, `-- @groupby`, `-- @stack`, `-- @title`, `-- @theme`
- `-- @colors: #006BA2, #DB444B` (sqlboard palette override; applied server-side on `/api/compile`, wins over `@theme`)
- `-- @semantic: col: Type` (override inferred types)
- `-- @flint: { partial spec }` (escape hatch)
- `-- @xFormat`, `-- @yFormat` (axis number format: auto/date/number/currency/compact)
- `-- @timeFormat` (date axis format, e.g. `%Y-%m` or `MMM yyyy`)
- `-- @rotate`, `-- @xRotate`, `-- @yRotate` (axis label rotation)
- `-- @barWidth`, `-- @barGap`, `-- @barCategoryGap` (bar styling)

## Dashboard manifest grammar

Dashboards are exchanged as a single `.sql` manifest (export/import/copy). Structure:

```
-- @dashboard: My Dashboard
-- @description: Optional description
-- @grid: 12
-- @theme: powerbi-light
-- @colors: #006BA2, #DB444B

-- @filter: Region
-- @type: select
-- @connection: 1
-- @sql: SELECT DISTINCT region FROM sales ORDER BY region
-- @default: NA

-- @block: Revenue by Month
-- @type: chart
-- @layout: 0,0,6,4
-- @connection: 1
-- @theme: powerbi-light
-- @timeFormat: %Y-%m
SELECT month, SUM(revenue) AS revenue FROM sales GROUP BY month;

-- @block: Total Revenue
-- @type: metric
-- @layout: 6,0,3,3
-- @connection: 1
-- @metric: revenue
-- @format: currency
SELECT SUM(revenue) AS revenue FROM sales;

-- @block: Top Products
-- @type: table
-- @layout: 0,4,6,5
-- @connection: 1
-- @columns: product, sales
-- @pageSize: 10
SELECT product, SUM(sales) AS sales FROM products GROUP BY product;

-- @block: Notes
-- @type: text
-- @layout: 6,4,6,5
/*
Markdown notes here.
*/
```

### Block types
- `chart` — compiled via sql-to-flint; SQL carries annotations.
- `metric` — big number / KPI; config via `@metric`, `@prior`, `@sparkline`, `@format`, `@target*`.
- `table` — tabular; config via `@columns`, `@pageSize`, `@density`, `@maxRows`, `@format`, `@rowNumbers`.
- `text` — markdown in `/* ... */`.

### Filters
- Types: `select`, `multiselect`, `tabs`, `buttons`, `date`, `daterange`.
- SQL contract: `WHERE ({FilterName} IS NULL OR col = {FilterName})`.
- "All" maps to `null`.

### Metric SQL contract
A metric query returns either:
- 1 row, 1 numeric column → big number (KPI)
- 1 row with `value` + `prior` columns → value + delta (percent, polarity-aware)
- N rows with a date column + value column → sparkline + latest + delta

Target, polarity, and format are set in the metric block config, not in SQL.

## Diagnostics as feedback
The compile endpoint returns `{ diagnostics: [{ severity, code, message }] }`. Codes include `MISSING_COLUMN`, `NO_DATA`, `NO_MEASURE`, `CHART_TYPE_UNKNOWN`, `DUPLICATE_CELLS`, `PIE_NEGATIVE`, `DEFAULT_ENCODINGS`, `AMBIGUOUS_NUMERIC`, etc. Fix and recompile.

## Tags
- Per-tenant, auto-colored, max 10 per entity, cascade delete.
- Filter dashboards/queries with `?tags=a,b` (OR logic).
- Manage via `/api/tags` and assign via dashboard/query create or update (`tags: ["name"]`).

## Workbooks
- Group existing dashboards into a tabbed workbook: `POST /api/workbooks` with `{ name, dashboardIds }`.
- View at `/workbooks/:id`; edit/reorder via `PATCH /api/workbooks/:id`.

## Export / Import / Copy
- Export: `GET /api/dashboards/:id/code` → `.sql` manifest.
- Copy: `POST /api/dashboards/:id/copy` → clones dashboard.
- Import: `POST /api/dashboards/import` with `{ code, name? }` → creates dashboard from manifest.

## Full-page view
- Read-only view at `/dashboards/:id/view`.

## Anti-patterns
- Never hand-write ECharts options or Flint specs — use annotations.
- Aggregate in SQL (`GROUP BY`), not in application code.
- Trust semantic inference; override with `@semantic` only when wrong.
- Keep the `GROUP BY` in SQL for aggregations.

## MCP tools
See `docs/plans/mcp-server.md`. Read tools: `list_connections`, `get_connection`, `list_tables`, `preview_table`, `run_query`, `compile_chart`, `list_saved_queries`, `get_saved_query`, `list_dashboards`, `get_dashboard`.
Write tools: `create_connection`, `create_saved_query`, `create_dashboard`, `apply_dashboard_state`, `commit_dashboard_version`, `create_tenant` (admin).
All tools are tenant-scoped via `X-Tenant` header.

## References
- sql-to-flint skill: `node_modules/sql-to-flint/agent-skills/sql-to-flint-author/SKILL.md`
- sql-to-flint grammar: `node_modules/sql-to-flint/docs/viz-grammar.md`
- OpenAPI (live): `http://<host>:3001/openapi.json`
- API reference UI: `http://<host>:3001/docs`
- MCP plan: `docs/plans/mcp-server.md`