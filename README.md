# sqlboard

Open-source BI for SQL-first teams and AI agents.

Connect your data (live warehouse or uploaded files), explore it as tables,
write SQL, turn queries into interactive charts via
[sql-to-flint](https://github.com/aveekdeveloper/SqlFlint), and build shared
dashboards. Every workflow is accessible through a REST API, so people and AI
agents can work with the same analytics environment.

Status: work in progress (v0.1 development). See the plan notes in this
repository's history for scope.

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

Sample data includes: sales (month, region, revenue), users (month, region, users), products (category, subcategory, sales). A sample dashboard with 4 charts and 4 saved queries are pre-created.

## Docker

```bash
docker compose up
```

Seed sample data by running:

```bash
docker compose exec sqlboard node packages/api/scripts/seed.cjs
```

## License

MIT
