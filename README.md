# sqlboard

Open-source BI for SQL-first teams and AI agents.

Connect your data (live warehouse or uploaded files), explore it as tables,
write SQL, turn queries into interactive charts via
[sql-to-flint](https://github.com/aveekdeveloper/SqlFlint), and build shared
dashboards. Every workflow is accessible through a REST API, so people and AI
agents can work with the same analytics environment.

Status: work in progress (v0.1 development). See the plan notes in this
repository's history for scope.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vite + React 18 + TypeScript, Tailwind, CodeMirror 6 |
| Backend | Node 22 + Fastify + TypeScript |
| Metadata | SQLite (better-sqlite3, WAL mode) |
| Analytics + cache | DuckDB (read pool, serialized writes) |
| Visualization | sql-to-flint -> Flint (ECharts / Vega-Lite / Chart.js / Plotly) |
| Deployment | Single Docker image |

## License

MIT
