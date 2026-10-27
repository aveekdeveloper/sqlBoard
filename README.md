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

sqlboard is designed to be driven programmatically. Every `/api/*` route except
`/api/health` and `/api/auth/login` requires a bearer credential.

**Get a credential.** Sign in with a human account once, then mint a scoped API token
in **Settings → API tokens** (or `POST /api/tokens`):

```bash
curl -X POST http://localhost:5173/api/tokens \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"agent","scope":"member","expiresInDays":90}'
```

The response contains `token` (`sb_…`) exactly once; only its hash is stored. A token
can never grant more than the role of the user who created it. Revoke it with
`DELETE /api/tokens/:id`.

- `POST /api/auth/login` — obtain a session token.
- `GET/POST /api/tokens`, `DELETE /api/tokens/:id` — agent credentials.
- `GET/POST /api/connections` — manage data sources.
- `POST /api/connections/:id/query` — run SQL.
- `POST /api/compile` — compile SQL + annotations into an ECharts spec via sqlFlint.
- `GET/PATCH/DELETE /api/dashboards/:id` and `/api/dashboards/:id/layout` — manage dashboards.
- `PUT /api/dashboards/:id/state` and `/api/dashboards/:id/versions` — versioned dashboard updates.
- `GET/POST/PATCH/DELETE /api/saved-queries` — reusable, versioned SQL snippets.

Every dashboard is also a SQL-first manifest, so an agent can fetch the manifest text,
edit it, and apply it back through the same API.

**Concurrency.** Pass `baseVersion` on `PUT /state` or `POST /versions` to make the write
conditional. A stale write returns `409 VERSION_CONFLICT` instead of forking history.

**Discovery.** The live OpenAPI document is served at `/openapi.json` and browsable at
`/docs`. `GET /api/health` is public.

## Chart theming

Themes are annotations in the chart's SQL, so a theme travels with the code:

```sql
-- @chart: bar
-- @x: month
-- @y: revenue
-- @theme: economist          -- nyt | swiss | powerbi-light | economist | …
-- @colors: #006BA2, #DB444B -- optional custom palette, wins over @theme
```

Named presets are compiled by sqlFlint into the returned ECharts option. Custom
`@colors` palettes are applied by sqlboard on the server, so `POST /api/compile` and
the rendered dashboard always return the same colors. The dashboard Theme editor
writes these annotations into every chart block for you.

## Deployment

### Docker Compose (self-hosted)

```bash
cp .env.example .env
# edit .env and set a strong SECRET_KEY
docker compose up -d --build
```

The container seeds sample data on first boot (admin `admin@example.com` / `admin`),
serves the API and the web UI on port `3001`, and persists all state in the
`sqlboard-data` volume. Back up that volume (it contains `sqlboard.db`,
`sqlboard.duckdb`, and `uploads/`).

### Dokploy

1. In Dokploy, create an application from this repository (GitHub).
2. Build type: **Dockerfile** (or Docker Compose — both work).
3. Set environment variables in the Dokploy UI:
   - `SECRET_KEY` — a long random string. **Required.** Used to encrypt connection
     credentials at rest; changing it later invalidates stored connections.
   - `CACHE_TTL_MINUTES`, `MAX_CACHE_ROWS`, `QUERY_TIMEOUT_MS` (optional).
4. Add a persistent volume mounted at `/data` (Dokploy → Storage). This holds the
   SQLite database, DuckDB file, and uploaded files.
5. Assign a domain in Dokploy; Traefik terminates TLS and proxies to port `3001`.
6. Deploy. The first boot seeds the admin user and sample dashboard. Subsequent
   deploys keep the data volume.

Notes:
- Single replica only: SQLite + DuckDB are file-backed, so do not scale horizontally.
- Back up `/data` regularly.
- To reset to a clean state, delete the volume and redeploy (data is lost).

## License

MIT