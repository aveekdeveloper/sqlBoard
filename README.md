# sqlboard

**sqlboard** is a headless BI dashboard layer built for AI agents and SQL-first teams.

It treats dashboards as **code**: a dashboard is a SQL-first manifest where every block
(chart, metric, table, or markdown note) is defined by SQL plus a few annotations.
There is no drag-and-drop-only state and no opaque UI model — the dashboard you see is
the same text an agent can read, diff, commit, and restore. Visualizations are
**code-native** (ECharts specs compiled from SQL annotations) and the whole stack is
built on top of [sqlFlint](https://github.com/aveekdeveloper/SqlFlint).

## Why sqlboard

- **Headless by design.** Every action — create a connection, run a query, build a
  dashboard, commit a version — is available through a REST API, so agents and humans
  share one analytics environment.
- **SQL-first manifests.** Dashboards serialize to a single SQL-first document:
  ```sql
  -- @dashboard: Sample Sales Dashboard
  -- @description: Revenue, users, and product sales overview
  -- @grid: 12

  -- @block: Monthly Revenue by Region
  -- @type: chart
  -- @layout: 0,0,6,4
  -- @connection: Sample Data (DuckDB)
  -- @viz: bar
  -- @x: month
  -- @y: revenue
  -- @groupby: region
  SELECT month, region, SUM(revenue) AS revenue
  FROM sales GROUP BY month, region ORDER BY month, region;
  ```
- **Code-native visualizations.** Charts are compiled by sqlFlint from SQL annotations
  (`@viz`, `@x`, `@y`, `@groupby`, …). The same annotations drive both the renderer
  and the dashboard.
- **Git-style version history.** Apply, commit, and restore create versions with diffs.
  Layout drags persist instantly without creating versions; content changes stay in a
  draft until committed.
- **Four block types.** `chart`, `metric` (one KPI per block), `table` (client-side
  sort/pagination, capped rows), and `text` (sanitized GFM markdown).
- **12-column grid.** Blocks are draggable and resizable on desktop; mobile is
  read-only and auto-stacked.

## Packages

| Package | Description |
|---|---|
| `packages/shared` | Manifest parse/serialize, block types, config schemas |
| `packages/api` | Fastify REST API, DuckDB/Postgres/SQLite connectors, versioning |
| `packages/web` | React dashboard UI, SQL workbench, code editor side panel |

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Seed sample data + admin user (admin@example.com / admin)
DATA_DIR=./data npm run seed

# 3. Start the API
DATA_DIR=./data SECRET_KEY=change-me npm run dev -w packages/api

# 4. Start the web app (in another terminal)
npm run dev -w packages/web
```

Open http://localhost:5173 and log in with `admin@example.com` / `admin`.

Sample data includes: `sales` (month, region, revenue), `users` (month, region, users),
`products` (category, subcategory, sales). A sample dashboard with 4 charts and 4 saved
queries are pre-created.

## Docker

```bash
docker compose up
```

Seed sample data by running:

```bash
docker compose exec sqlboard node packages/api/scripts/seed.cjs
```

## For agents

sqlboard is designed to be driven programmatically:

- `POST /api/auth/login` — obtain a bearer token.
- `GET/POST /api/connections` — manage data sources.
- `POST /api/connections/:id/query` — run SQL.
- `POST /api/compile` — compile SQL + annotations into an ECharts spec via sqlFlint.
- `GET/PATCH/DELETE /api/dashboards/:id` and `/api/dashboards/:id/layout` — manage dashboards.
- `POST /api/dashboards/:id/apply` (state) and `/api/dashboards/:id/versions` — versioned dashboard updates.
- `GET/POST/PATCH/DELETE /api/saved-queries` — reusable, versioned SQL snippets.

Every dashboard is also a SQL-first manifest, so an agent can fetch the manifest text,
edit it, and apply it back through the same API.

## License

MIT