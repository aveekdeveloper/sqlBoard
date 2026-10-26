---
name: sqlboard-author
description: Use sqlboard to connect data, run SQL, compile charts, and build dashboards. Use when the user wants to explore data, write SQL, create charts from SQL, or build a dashboard. Covers the REST API workflow for connecting, querying, compiling, and pinning charts.
---

# sqlboard authoring

sqlboard is a lightweight BI server. People and AI agents use the same REST API.

## Core workflow

1. **Authenticate** — `POST /api/auth/login` with `{ email, password }` → `{ token }`. Use `Authorization: Bearer <token>` on all subsequent calls.
2. **Connect data** — `POST /api/connections` with a connection config, or `POST /api/uploads` with a multipart file (CSV/Parquet/JSON). Test with `POST /api/connections/:id/test`.
3. **Explore** — `GET /api/connections/:id/tables` to list tables, `GET /api/connections/:id/tables/:name/preview` for sample rows.
4. **Query** — `POST /api/connections/:id/query` with `{ sql }` → `{ columns, rows, rowCount }`.
5. **Compile** — `POST /api/compile` with `{ sql, data, theme?, backends? }` → `{ flint, echarts, compiled, diagnostics }`. Fix diagnostics, recompile.
6. **Save query** — `POST /api/saved-queries` with `{ name, connectionId, sql }`.
7. **Create dashboard** — `POST /api/dashboards` with `{ name, description }`.
8. **Pin chart** — `POST /api/dashboards/:id/items` with `{ title, sql, connectionId, blockType: "chart", layout }`.
9. **Pin metric** — same endpoint with `blockType: "metric"` and a `config` with `{ higherIsBetter, format, target }`.

## Annotation grammar

See the sql-to-flint grammar (sql-to-flint ships its own skill). Key annotations:

- `-- @viz: bar | line | area | scatter | pie | heatmap` (or any Flint template)
- `-- @x`, `-- @y`, `-- @groupby`, `-- @stack`, `-- @title`, `-- @theme`
- `-- @semantic: col: Type` (override inferred types)
- `-- @flint: { partial spec }` (escape hatch)

## Metric SQL contract

A metric query returns either:
- 1 row, 1 numeric column → big number (KPI)
- 1 row with `value` + `prior` columns → value + delta (percent, polarity-aware)
- N rows with a date column + value column → sparkline + latest + delta

Target, polarity, and format are set in the metric block config, not in SQL.

## Diagnostics as feedback

The compile endpoint returns `{ diagnostics: [{ severity, code, message }] }`. Codes include `MISSING_COLUMN`, `NO_DATA`, `NO_MEASURE`, `CHART_TYPE_UNKNOWN`, `DUPLICATE_CELLS`, `PIE_NEGATIVE`, `DEFAULT_ENCODINGS`, etc. Fix and recompile.

## Anti-patterns

- Never hand-write ECharts options or Flint specs — use annotations.
- Aggregate in SQL (`GROUP BY`), not in application code.
- Trust semantic inference; override with `@semantic` only when wrong.
- Keep the `GROUP BY` in SQL for aggregations.

## References

- sql-to-flint skill: `node_modules/sql-to-flint/agent-skills/sql-to-flint-author/SKILL.md`
- sql-to-flint grammar: `node_modules/sql-to-flint/docs/viz-grammar.md`
- OpenAPI docs: `http://<host>:3001/docs`
