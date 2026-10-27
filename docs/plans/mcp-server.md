# Spec Module 2: MCP support in sqlboard (per-tenant)

**Status**: Draft plan (not yet implemented)
**Owner**: sqlboard
**Created**: 2026-10-27
**Updated**: 2026-10-27 (per-tenant MCP, multi-tenancy integration)
**Related**: sqlboard P0 headless hardening, Spec Module 1 (connectors), multi-tenancy foundation (tenants table, tenant context), semantix MCP gateway (`backend/app/mcp/gateway.py`)

## 1. Goal

Expose sqlboard's BI capabilities (connections, queries, compilation, dashboards, saved queries) as **MCP tools over streamable HTTP**, authenticated by the existing API token system, so that **semantix** (a trusted chat application) and other AI agents (Open WebUI, Claude Desktop, etc.) can consume sqlboard as a data/BI backend.

sqlboard is the *headless BI engine*; semantix is the *trusted chat app* that extends it. Rendering is owned by the consumer (semantix/AGUI), not by sqlboard — sqlboard returns data + manifests + compiled chart specs.

**Per-tenant**: Each tenant gets its own MCP endpoint scope. Tools operate only on the resolved tenant's data. A token bound to tenant A cannot access tenant B's connections, dashboards, or queries.

## 2. Decisions (resolved)

1. **Write tools ARE exposed over MCP**, gated by token scope (`viewer` = read, `member` = read+write, `admin` = full). This makes sqlboard fully agent-drivable.
2. **HTTP transport only** to start (streamable HTTP). Stdio is a later, optional phase. Matches the Dokploy deployment (separate containers).
3. **MCP exposes data + manifests, not rendering.** Rendering (AGUI or otherwise) is the consumer's concern. sqlboard returns manifests and compiled ECharts specs; the consumer renders.
4. **Per-tenant scoping**: The MCP endpoint resolves the tenant from the request (X-Tenant header or token's tenant claim). All tools operate within that tenant's scope. No cross-tenant access.
5. **No subdomain routing**: Tenant is specified via `X-Tenant` header or login form, not subdomain.

## 3. Compatibility with semantix (verified)

- semantix uses the official MCP Python SDK: `streamable_http_client` + `ClientSession`, sends `headers` (decrypted) per server, 120s timeout, caches tools for 60s.
- semantix's `get_tool_args_for_query` prefers param names `sql` → `query` → `question`. sqlboard's `run_query` tool **must** accept `sql`.
- Semantix provisions sqlboard as an `http_mcp` server:
  `{transport: "http", url: "https://sqlboard.example.com/mcp", headers: {Authorization: "Bearer sb_...", "X-Tenant": "acme"}}`.
- The `X-Tenant` header tells sqlboard which tenant scope to use. Semantix sets this when provisioning.
- No semantix code change required beyond provisioning; sqlboard only needs to expose a compatible streamable-HTTP MCP endpoint.

## 4. Architecture

- Add `@modelcontextprotocol/sdk` (v1.32.x) and `zod-to-json-schema` to `packages/api`.
- New module `packages/api/src/mcp/`:
  - `server.ts` — builds an `McpServer`, registers tools.
  - `transport.ts` — streamable HTTP handler mounted in Fastify at `/mcp`.
  - `auth.ts` — resolves the bearer token from the incoming HTTP request into an `AuthUser` (reuses `requireUser`), bound per MCP session via `AsyncLocalStorage`.
  - `context.ts` — tenant + user context for tool handlers (uses existing `currentTenant()` from `core/tenancy.ts`).
- Each tool handler calls existing engine/DB logic directly (not HTTP) and enforces role gating.
- Tool input schemas are derived from existing zod schemas via `zod-to-json-schema` (no drift).
- **Per-tenant**: Tools use `currentTenant()` to scope all DB queries. The tenant is resolved from the `X-Tenant` header (already implemented in `onRequest` hook).

## 5. Auth integration

- `/mcp` route in Fastify: extract `Authorization: Bearer sb_...`, resolve user via `requireUser`, return 401 if invalid.
- Tenant resolved from `X-Tenant` header (existing middleware). If tenancy is disabled, default tenant is used.
- Auth is bound to the MCP session at first request (headers present). Subsequent requests in the same session reuse the bound user. If the token changes mid-session, reject.
- Sessions are keyed by `Mcp-Session-Id`; store `AuthUser` + `TenantContext` in a server-side `Map<sessionId, {user, tenant}>`. Delete on session close.
- Read tools: viewer+. Write tools: member+. Admin tools: admin+.
- **Tenant binding on token**: API tokens carry `tenantId`. A token bound to tenant A cannot access tenant B (enforced by `requireUser` filtering users by `tenantId === currentTenant().id`).

## 6. Tool surface

### Slice 1 — read + compile (Phase 1)
Data:
- `list_connections` → GET /api/connections (filtered by tenant)
- `get_connection` → GET /api/connections/:id (tenant-scoped)
- `test_connection` → POST /api/connections/:id/test
- `list_tables` → GET /api/connections/:id/tables
- `preview_table` → GET /api/connections/:id/tables/:name/preview (limit 100)
- `run_query` → POST /api/connections/:id/query (sql, maxRows; default cap 1000, truncate with note)

Compilation:
- `compile_chart` → POST /api/compile (sql, connectionId?, theme?, backends?) → ECharts spec + diagnostics

Saved queries:
- `list_saved_queries`, `get_saved_query` (tenant-scoped)

Dashboards:
- `list_dashboards`, `get_dashboard` (returns manifest + diagnostics, tenant-scoped)

### Slice 2 — writes, role-gated (Phase 2)
Connections:
- `create_connection`, `delete_connection` (tenant-scoped)

Saved queries:
- `create_saved_query`, `update_saved_query`, `delete_saved_query` (tenant-scoped)

Dashboards:
- `create_dashboard`, `delete_dashboard` (tenant-scoped)
- `apply_dashboard_state` (name, items, filters, theme, colors, baseVersion)
- `commit_dashboard_version` (message, baseVersion)
- `list_dashboard_versions`, `get_dashboard_version`

### Tenant management (Phase 2, admin-only)
- `list_tenants` → GET /api/tenants
- `create_tenant` → POST /api/tenants (creates tenant + seeds admin user)
- `get_tenant` → GET /api/tenants/:id

## 7. Per-tenant MCP provisioning

### Semantix provisioning
In semantix, add sqlboard as an `http_mcp` connector:
```json
{
  "transport": "http",
  "url": "https://sqlboard.example.com/mcp",
  "headers": {
    "Authorization": "Bearer sb_...",
    "X-Tenant": "acme"
  }
}
```

Semantix creates one MCP server entry per tenant (or one with `X-Tenant` header). Each tenant's sqlboard token is scoped to that tenant.

### Open WebUI provisioning
Open WebUI Python tools would include the `X-Tenant` header in their requests to sqlboard. The dashboarding skill would need to specify the tenant slug.

### Tenant auto-provisioning (future)
When a new tenant is created in sqlboard, optionally auto-generate an API token for that tenant and return it. This token can then be used to provision the MCP connection in semantix automatically.

## 8. Phases

1. **MCP core (streamable HTTP)** — `/mcp` endpoint, token auth via ALS, Slice 1 tools, fix DuckDB timeout, 2–3 tests. ~2–3 days.
2. **Write tools** — Slice 2, role-gated. ~2 days.
3. **Tenant management tools** — list/create/get tenant (admin-only). ~1 day.
4. **Stdio transport** (optional) — `--mcp-stdio` flag for Claude Desktop / local. HTTP-only is enough for Dokploy. ~1 day.
5. **Agent skill + docs** — document tool names/params in SKILL.md + README; example semantix provisioning with `X-Tenant`. ~1 day.
6. **Export endpoint** (small) — `GET /api/dashboards/:id/code` returning serialized manifest text, so agents can fetch → edit → resubmit. ~0.5 day.

## 9. Compatibility notes with semantix

- Semantix `call_tool` has a 120s timeout → sqlboard's DuckDB queries must respect `queryTimeoutMs` (currently not enforced for DuckDB; fix in Phase 1).
- Semantix caches tools for 60s; tool list changes propagate within a minute.
- Semantix deny-lists tools by name pattern → keep tool names stable.
- Semantix's `get_tool_args_for_query` prefers `sql` param → `run_query` uses `sql`. ✓
- Semantix sends `headers` (decrypted) per server → `X-Tenant` header is supported. ✓
- Semantix's `_session` uses `streamable_http_client` with `http_client` (httpx) → compatible with Fastify's streamable HTTP transport. ✓

## 10. Risks

- **Session/auth binding**: prevent cross-user session reuse. Bind `AuthUser` + `TenantContext` to `Mcp-Session-Id` in a server-side Map; reject if token or tenant changes mid-session; delete on close.
- **Result size**: MCP clients impose limits; `run_query` truncates at `maxRows` (default 1000) with a trailing note.
- **DuckDB timeout**: fix as part of Phase 1 so MCP's 120s cap isn't exceeded silently.
- **Role gating**: write tools must check `user.role` (not just token scope) — reuse existing `ROLE_RANK`.
- **Tool input validation**: reuse zod schemas, convert to JSON Schema for MCP `inputSchema`.
- **Tenant isolation**: ensure all tool handlers use `currentTenant()` to scope queries. No cross-tenant data leakage.
- **MCP session + tenancy**: a session bound to tenant A must not be reused for tenant B. The `X-Tenant` header must match the session's bound tenant.

## 11. Rendering and AGUI

AGUI (agent UI) is a consumer-side rendering concern. sqlboard will not render; it returns manifests (`get_dashboard`) and compiled chart specs (`compile_chart`). The consumer (semantix, Open WebUI, etc.) renders using its own UI layer, feeding it sqlboard's manifests and ECharts specs. This keeps sqlboard headless and renderer-agnostic.

Per-tenant: each tenant's MCP tools return only that tenant's data. The consumer (semantix) renders per-tenant dashboards using the returned manifests.

## 12. What I'd do first (Phase 1)

Install SDK + zod-to-json-schema, add `/mcp` streamable HTTP endpoint with token auth, register the 8 read/compile tools (tenant-scoped), fix DuckDB timeout, add 2–3 tests, update SKILL.md. Then iterate on Phase 2.
