# Spec Module 1: Connectors for data platforms (sqlboard)

**Status**: Draft plan (not yet implemented)
**Owner**: sqlboard
**Created**: 2026-10-27
**Source of inspiration**: semantix connector catalog (`backend/app/connectors/catalog.py`)
**Related**: sqlboard connection routes, engine factory, shared api-types

## 1. Goal

Upgrade sqlboard's connection layer from a minimal 5-type, hardcoded-form implementation to a richer, catalog-driven connector system comparable to semantix's, while keeping sqlboard's direct-engine execution model. sqlboard owns connecting to its data layer; connections must be robust, validated, and testable.

## 2. Current state (sqlboard)

- Connection types: `duckdb`, `sqlite`, `postgres`, `databricks`, `snowflake` (databricks/snowflake throw `NOT_IMPLEMENTED` in the engine factory).
- `CONNECTION_TYPES` array in `packages/web/src/pages/Connections.tsx` with `fields: ['host', 'port', ...]` — drives a generic form.
- `CreateConnectionRequestSchema` is a zod discriminated union in `packages/shared/src/api-types.ts`.
- Config stored encrypted (AES-256-GCM) in `connections.config_enc`.
- Engine factory caches engines per connection id; DuckDB is a singleton.
- `/api/connections/:id/test` lists tables (post-save).
- No DSN parsing, no field validation beyond zod, no name uniqueness check, no test-before-save.

## 3. What to borrow from semantix (concepts, not code)

### 3.1 Connector catalog with rich metadata

Replace the hardcoded `CONNECTION_TYPES` with a catalog (TypeScript, in `packages/shared/src/connectors.ts`) defining:

```ts
interface ConnectorField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'boolean' | 'url';
  required: boolean;
  default?: string;
  placeholder?: string;
  help?: string;
  options?: string[];
  min?: number;
  max?: number;
}

interface ConnectorDef {
  id: string;            // connection type key
  label: string;
  description: string;
  defaultName: string;
  fields: ConnectorField[];
  notes?: string;
  allowUrl?: boolean;     // offer "paste a connection URL"
}
```

The form UI and zod schema generation should be driven from this catalog (single source of truth). Field types map to zod validators (number → int + min/max, select → enum, required → min(1), etc.).

### 3.2 DSN / connection URL parsing

Add "paste a connection URL" support for postgres (and mysql if added):

- Accept `postgres://user:pass@host:port/db?sslmode=...` (and `postgresql://`, `postgresql+asyncpg://`).
- Parse with a URL parser (Node `URL` or a small DSN parser), resolve into structured fields.
- URL is authoritative when provided (overrides form fields).
- Validate scheme matches the selected connector type.

This is a high-value UX win for users copying from Aiven/Neon/Supabase/RDS.

### 3.3 Field validation

Port semantix's `validate_fields` logic:

- Required field check.
- Number type coercion + min/max bounds.
- Select option membership check.
- Trim strings; empty required → error.
- Default applied when not provided.
- `server_name` → default name when blank.

Surface validation errors in the form before submit (client-side) and on the server (422).

### 3.4 Test-before-save

Reorder the flow: test the connection *before* persisting.

- Add `POST /api/connections/validate` (or reuse `/test` with a payload) that accepts a full connection config, builds an ephemeral engine, probes it (list tables / `SELECT 1`), and returns `{ok, tableCount, tables}` or `{ok: false, error}`.
- The UI tests on "Test" click; "Save" is enabled only after a successful test (or allow save anyway with a warning).
- Keep the post-save `/test` for re-testing saved connections.

### 3.5 Name uniqueness

Return `409 CONFLICT` when a connection name already exists (semantix does this). Add a unique index on `connections.name` or check in the route.

### 3.6 Visibility (admin-only connections) — optional

Add a `visibility: 'all' | 'admins'` field. Admin-only connections hidden from non-admins in list and queries. Useful if sqlboard gains multi-tenant/RBAC depth. Defer unless needed.

## 4. Engine coverage expansion

Current engines: duckdb, sqlite (file), postgres. Missing vs. semantix: mysql, clickhouse, trino, sqlserver, oracle, druid, generic_sql, generic_odbc, databricks_sql.

**Recommended priority for sqlboard (Node ecosystem):**

1. **MySQL** — `mysql2` package; straightforward.
2. **ClickHouse** — `@clickhouse/client` or HTTP interface.
3. **Trino** — HTTP-based (Trino REST API) or `trino-client`.
4. **SQLite file** — already done (read-only).
5. Defer: Oracle, SQL Server, ODBC, Druid — require native drivers; high maintenance. Add only on demand.

For each new engine: implement `QueryEngine` interface, add to `EngineFactory.build`, add zod schema in shared, add catalog entry.

## 5. Read-only enforcement

- SQLite file engine already opens `readonly: true`.
- DuckDB: default queries to read-only where possible (DuckDB supports `SET access_mode = 'read_only'` for file-based DBs; for in-memory/uploaded tables, enforce at the route level by rejecting statements not starting with SELECT/WITH/EXPLAIN).
- Postgres: optionally `SET TRANSACTION READ ONLY` (or rely on a read-only DB user).
- Add a `readOnly: boolean` config per connection (default true) and reject write statements when enabled. Surface as a toggle in the catalog field (`readOnly`).

## 6. Timeouts and resource limits

- **DuckDB**: currently no timeout. Add a statement timeout via `SET statement_timeout`? DuckDB doesn't have a direct equivalent; use a worker-thread or `setTimeout` cancellation. At minimum, document the gap and rely on `maxRows` + query complexity. Consider running DuckDB queries in a worker with a timeout.
- **Postgres**: already uses `statement_timeout` from config.
- **SQLite**: synchronous, fast; add a busy timeout.
- **Resource limits**: `maxRows` (execution cap) already; add `queryTimeoutMs` enforcement for all engines; add max result size (bytes) to prevent huge payloads.

## 7. What NOT to share (architecture)

- Do **not** share the Python engines (SQLAlchemy, pyodbc, etc.) — sqlboard is Node-based. Porting means rewriting.
- Do **not** share the MCP provisioning model — sqlboard connects directly; semantix provisions MCP servers. Different execution models.
- The connector *catalog concept* (field definitions, validation, DSN parsing) is the right thing to share as a pattern, not as code (different languages).

## 8. What sqlboard could expose to semantix (connection reuse)

See Spec Module 2 (MCP support). The cleanest reuse path is for sqlboard to expose its connections as MCP tools (`list_connections`, `run_query`, etc.), so semantix provisions sqlboard as an `http_mcp` server and never duplicates credentials. Direct DB-level sharing is not viable (different schemas/encryption).

## 9. Phases

1. **Catalog + validation** — port ConnectorDef/ConnectorField to `packages/shared/src/connectors.ts`, drive the form from it, add field validation (client + server). ~2 days.
2. **DSN paste** — add URL parsing for postgres (and mysql), authoritative when provided. ~1 day.
3. **Test-before-save + name uniqueness** — reorder flow, add 409 on duplicate. ~1 day.
4. **Read-only toggle + timeouts** — per-connection `readOnly`, enforce for DuckDB/Postgres, add DuckDB timeout. ~2 days.
5. **New engines** — MySQL, ClickHouse (on demand). ~1–2 days each.

## 10. Open questions

1. Should sqlboard support the full semantix connector list, or only the high-value ones (postgres, mysql, clickhouse, duckdb, sqlite)? (Lean: high-value first; defer native-driver connectors.)
2. Is per-connection visibility (admin-only) needed, or is sqlboard's role model (viewer/member/admin) sufficient? (Lean: role model is sufficient for v1.)
3. Should connection configs be exportable (JSON) for backup/migration? (Lean: yes, encrypted or plaintext-with-warning, as a later convenience.)
