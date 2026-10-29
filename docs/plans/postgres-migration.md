# Plan: Migrate sqlboard metadata from libSQL/SQLite to PostgreSQL

**Status**: Implemented (see §13) — dual-backend: Postgres opt-in, libSQL default
**Owner**: sqlboard
**Created**: 2026-10-27
**Motivation**: Scale, multi-tenancy (schema-per-tenant), HA, managed backups, horizontal scaling

## 1. Why migrate

sqlboard currently uses libSQL (SQLite-compatible) for metadata (connections, dashboards, versions, users, sessions, audit log, tokens, uploads). This works for single-tenant/small-team deployments but has limits:

- **Single writer** — SQLite/libSQL has one writer at a time. Concurrent writes from multiple sqlboard replicas or tenants cause lock contention.
- **No row-level security** — tenant isolation is application-level (tenant_id filtering) or DB-per-tenant. Postgres RLS is the gold standard for SaaS.
- **No horizontal scaling** — file-backed DB can't be shared across instances without libSQL server (which adds a hop).
- **Schema-per-tenant** (semantix pattern) requires Postgres schemas. SQLite has no schemas.
- **Managed backups/HA** — Postgres providers (RDS, Neon, Supabase) handle this; SQLite needs Litestream or volume snapshots.

## 2. What changes

### 2.1 Database driver
- **From**: `@libsql/client` + `drizzle-orm/libsql`
- **To**: `pg` (node-postgres) + `drizzle-orm/pg-core`
- Connection pooling via `pg.Pool`

### 2.2 Schema (SQLite → Postgres)
| SQLite | Postgres |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `TEXT` | `TEXT` |
| `TEXT` (JSON) | `JSONB` |
| `TEXT` (timestamps) | `TIMESTAMPTZ` |
| `TEXT` (UUID) | `UUID` |
| No schemas | Schema-per-tenant (`t_acme`) |
| `CREATE TABLE IF NOT EXISTS` | Alembic/drizzle-kit migrations |

### 2.3 Query patterns
- All sync `.all()/.run()/.get()` → already async (libSQL migration done this)
- Drizzle query builder API is the same (`select()`, `insert()`, `update()`, `delete()`)
- Only the dialect import changes: `drizzle-orm/libsql` → `drizzle-orm/node-postgres`

### 2.4 Bootstrap → Migrations
- Replace `CREATE TABLE IF NOT EXISTS` with proper migration files (drizzle-kit or numbered SQL)
- Replace `ALTER TABLE ... ADD COLUMN` try/catch with migration scripts
- Add `drizzle-kit` for schema generation and migration

### 2.5 Multi-tenancy (schema-per-tenant)
- Adopt semantix pattern: control-plane registry in `tenancy_control` schema
- Per-tenant schema: `t_{slug}` (e.g., `t_acme`)
- `search_path` set per request (fail-closed, no `public` for non-default)
- JWT tenant claim + binding check (already partially implemented)

## 3. What stays the same

- **DuckDB** — still the analytics engine for uploaded data (DuckDB can query Postgres via extension, but keep file-based for now)
- **Storage abstraction** — S3/local still works (no DB dependency)
- **API routes** — same endpoints, same request/response shapes
- **Auth model** — scrypt passwords, API tokens, roles
- **ECharts compilation** — sqlFlint is DB-agnostic
- **Docker Compose** — add Postgres service, keep sqld as fallback

## 4. Options

| Option | Effort | Pros | Cons |
|---|---|---|---|
| **A. Full rewrite (SQLite → Postgres)** | 3-4 weeks | Clean, HA, managed DBs, RLS | Big bang, risk of regressions, DuckDB file still needs volume |
| **B. Abstraction layer (DBBackend interface)** | 1 week + 3-5 days per backend | Keeps SQLite default, Postgres opt-in, incremental | More code, two backends to maintain |
| **C. libSQL/Turso (managed SQLite)** | 2-3 days | Minimal changes, managed/replicated, keeps schema | Still SQLite semantics (single writer, no RLS) |
| **D. Hybrid (Postgres metadata + S3 DuckDB)** | 4-6 weeks | Fully cloud-native, no volumes | Biggest effort, DuckDB S3 latency |

## 5. Recommendation

**Option B (abstraction layer)** as the first step, then **Option A (Postgres backend)** on top.

This means:
1. Define a `DatabaseBackend` interface (query, insert, update, delete, transaction, migrate).
2. Refactor existing SQLite/libSQL code behind it (no behavior change).
3. Add Postgres backend implementing the interface.
4. Config: `DATABASE_URL=postgres://...` → Postgres, `DATABASE_URL=libsql://...` → libSQL (default).

This avoids a big-bang rewrite and keeps libSQL as the default. Postgres becomes opt-in for SaaS/HA.

## 6. Phases

### Phase 1: DB abstraction layer (1 week)
- Create `packages/api/src/db/backend.ts` — interface defining all DB operations used by routes.
- Create `packages/api/src/db/sqlite-backend.ts` — wraps current libSQL client.
- Refactor routes to use `backend` instead of `deps.db` directly.
- No behavior change; all tests pass.

### Phase 2: Postgres backend (1-2 weeks)
- Create `packages/api/src/db/postgres-backend.ts` — wraps `pg.Pool`.
- Add Drizzle Postgres schema (`db/schema.pg.ts`).
- Add migration runner (drizzle-kit or numbered SQL files).
- Config: `DATABASE_URL=postgres://...` → Postgres backend.

### Phase 3: Multi-tenancy on Postgres (1 week)
- Adopt semantix schema-per-tenant pattern.
- Control-plane registry in `tenancy_control` schema.
- Per-tenant schema: `t_{slug}`.
- `search_path` per request (fail-closed).
- JWT tenant claim + binding check (upgrade from current `X-Tenant` header).

### Phase 4: DuckDB on Postgres (1-2 weeks, optional)
- DuckDB can query Postgres via the `postgres` extension.
- Or keep DuckDB file-based (simpler, already works).
- Recommendation: keep DuckDB file-based, store on S3 for backup.

### Phase 5: Migration tooling (3-5 days)
- `drizzle-kit generate` for schema diffs.
- `drizzle-kit migrate` for applying migrations.
- Seed script works with both backends.
- Data migration script: SQLite → Postgres (for existing deployments).

## 7. Schema changes (SQLite → Postgres)

### Users
```sql
-- SQLite
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, ...)

-- Postgres
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Connections
```sql
-- Postgres
CREATE TABLE connections (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_enc TEXT NOT NULL,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Dashboards (JSONB for filters/colors)
```sql
-- Postgres
CREATE TABLE dashboards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  filters JSONB,
  theme TEXT,
  colors JSONB,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Tenant registry (control plane)
```sql
CREATE SCHEMA IF NOT EXISTS tenancy_control;
CREATE TABLE tenancy_control.tenant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  schema_name TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  domain TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  owner_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 8. Multi-tenancy on Postgres (semantix pattern)

Adopted from semantix's `core/tenancy.py`:

1. **Control-plane engine**: Separate connection pool for reading tenant registry.
2. **Tenant resolution**: By host header → domain lookup (with 60s cache). Fail-closed (unknown → 404).
3. **Search path**: `SET search_path TO "t_{slug}", "ds_cache_{slug}"` per request. No `public` for non-default tenants.
4. **JWT tenant claim**: Token carries `tenant` slug. Binding check rejects cross-tenant auth.
5. **Tenancy toggle**: `TENANCY_ENABLED` env var. Off by default → single-tenant (public schema).
6. **Per-tenant schemas**: `t_{slug}` for tenant data, `ds_cache_{slug}` for dashboard cache.

### Adaptations for sqlboard
- sqlboard uses session tokens (not JWT). Add `tenant` to the session or store it in the sessions table.
- sqlboard uses Drizzle ORM (not SQLAlchemy). Use `db.execute(sql\`SET search_path TO ...\`)` per request.
- sqlboard's DuckDB is file-based. Keep it file-based (per-tenant file or shared with tenant prefix).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Big-bang rewrite breaks existing deployments | Use abstraction layer (Option B). SQLite stays default. Postgres is opt-in. |
| Migration from SQLite to Postgres | Provide data migration script. Test with existing data. |
| Async refactor introduces bugs | All routes already async (libSQL migration done). Only DB calls change. |
| Schema evolution | drizzle-kit for migrations. No more ad-hoc ALTER TABLE. |
| DuckDB file storage | Keep file-based. Store on volume or S3. |
| Performance regression | Connection pooling (pg.Pool). Benchmark before/after. |
| Multi-tenant complexity | Tenancy toggle (off by default). Single-tenant installs unaffected. |

## 10. Effort estimate

| Phase | Effort |
|---|---|
| Phase 1: DB abstraction layer | 1 week |
| Phase 2: Postgres backend | 1-2 weeks |
| Phase 3: Multi-tenancy on Postgres | 1 week |
| Phase 4: DuckDB on Postgres (optional) | 1-2 weeks |
| Phase 5: Migration tooling | 3-5 days |
| **Total** | **4-6 weeks** |

## 11. What to do first

1. **Define the `DatabaseBackend` interface** — extract all DB operations used by routes into an interface.
2. **Refactor SQLite code** behind the interface — no behavior change, all tests pass.
3. **Add Postgres backend** — implement the interface with `pg.Pool`.
4. **Add `DATABASE_URL` support** — `postgres://...` → Postgres, `libsql://...` or `file:...` → SQLite/libSQL.
5. **Migration tooling** — drizzle-kit for schema generation.
6. **Multi-tenancy** — adopt semantix pattern on Postgres.

## 12. Open questions

1. Should Postgres be the only backend, or should SQLite remain as a fallback? (Lean: SQLite stays default for self-hosted; Postgres opt-in for SaaS)
2. Use drizzle-kit or custom migration files? (Lean: drizzle-kit for schema generation, custom SQL for data migrations)
3. Per-tenant schemas (semantix pattern) or DB-per-tenant? (Lean: schema-per-tenant on Postgres — simpler, shared connection pool)
4. Should DuckDB move to Postgres or stay file-based? (Lean: stay file-based — DuckDB's strength is local analytics)
5. Managed Postgres (Neon/Supabase) or self-hosted? (Lean: support both — connection string is the only config)

## 13. Implementation status (2026-10-29)

Shipped:

- **Backend selection**: `packages/api/src/db/client.ts` opens libSQL (`file:`/`http:`/`libsql:`) or
  Postgres (`postgres://`/`postgresql://`) from `DATABASE_URL`. Both return a Drizzle instance, so
  routes are backend-agnostic; libSQL stays the default for local dev.
- **Schema**: `schema.ts` (SQLite definitions) drives runtime queries for both backends —
  drizzle's `node-postgres` driver accepts the SQLite table objects and emits valid SQL.
  `schema.pg.ts` (postgres-core) is used for Postgres bootstrap/seeding and typed inserts.
- **Bootstrap**: `CREATE TABLE IF NOT EXISTS` (plus unique indexes) runs on boot for both
  backends; Postgres uses `SERIAL`, `UUID`, `TIMESTAMPTZ`, `gen_random_uuid()`.
  No drizzle-kit migrations yet (dev stage; no migration/back-compat required).
- **Multi-tenancy**: shared tables with `tenant_id` + application-level filtering, not
  schema-per-tenant. Tenant resolved from `X-Tenant` header or host/domain, fail-closed (404),
  AsyncLocalStorage entered around the `onRequest` hook's `done()`. Cross-tenant sessions → 403,
  cross-tenant API tokens → 401.
- **Deployment**: `docker-compose.yml` runs Postgres 16 + sqlboard, waiting on a Postgres
  healthcheck; `.env.example` documents `POSTGRES_PASSWORD`/`SECRET_KEY` and the libSQL fallback.
- **Seeds**: `scripts/seed.cjs` and `scripts/seed-admin.cjs` import the built `dist` modules, so
  they work against either backend.

Deferred:

- drizzle-kit migration tooling and a SQLite → Postgres data migration script.
- Schema-per-tenant (`t_{slug}`, per-request `search_path`) and Postgres RLS.
- DuckDB remains file-based.

