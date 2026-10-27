# Spec Module 2: MCP support in sqlboard

**Status**: Draft plan (not yet implemented)
**Owner**: sqlboard
**Created**: 2026-10-27
**Related**: sqlboard P0 headless hardening, Spec Module 1 (connectors), semantix MCP gateway (`backend/app/mcp/gateway.py`)

## 1. Goal

Expose sqlboard's BI capabilities (connections, queries, compilation, dashboards, saved queries) as **MCP tools over streamable HTTP**, authenticated by the existing API token system, so that **semantix** (a trusted chat application) and other AI agents (Open WebUI, Claude Desktop, etc.) can consume sqlboard as a data/BI backend.

sqlboard is the *headless BI engine*; semantix is the *trusted chat app* that extends it. Rendering is owned by the consumer (semantix/AGUI), not by sqlboard — sqlboard returns data + manifests + compiled chart specs.

## 2. Decisions (resolved)

1. **Write tools ARE exposed over MCP**, gated by token scope (`viewer` = read, `member` = read+write, `admin` = full). This makes sqlboard fully agent-drivable.
2. **HTTP transport only** to start (streamable HTTP). Stdio is a later, optional phase. Matches the Dokploy deployment (separate containers).
3. **MCP exposes data + manifests, not rendering.** Rendering (AGUI or otherwise) is the consumer's concern. sqlboard returns manifests and compiled ECharts specs; the consumer renders.

## 3. Compatibility with semantix (verified)

- semantix uses the official MCP Python SDK: `streamable_http_client` + `ClientSession`, sends `headers` (decrypted) per server, 120s timeout, caches tools for 60s.
- semantix's `get_tool_args_for_query` prefers param names `sql` → `query` → `question`. sqlboard's `run_query` tool **must** accept `sql`.
- Semantix provisions sqlboard as an `http_mcp` server:
  `{transport: "http", url: "https://sqlboard.example.com/mcp", headers: {Authorization: "Bearer sb_..."}}`.
- No semantix code change required beyond provisioning; sqlboard only needs to expose a compatible streamable-HTTP MCP endpoint.

## 4. Architecture

- Add `@modelcontextprotocol/sdk` (v1.32.x) and `zod-to-json-schema` to `packages/api`.
- New module `packages/api/src/mcp/`:
  - `server.ts` — builds an `McpServer`, registers tools.
  - `transport.ts` — streamable HTTP handler mounted in Fastify at `/mcp`.
  - `auth.ts` — resolves the bearer token from the incoming HTTP request into an `AuthUser` (reuses `requireUser`), bound per MCP session via `AsyncLocalStorage`.
- Each tool handler calls existing engine/DB logic directly (not HTTP) and enforces role gating.
- Tool input schemas are derived from existing zod schemas via `zod-to-json-schema` (no drift).

## 5. Auth integration

- `/mcp` route in Fastify: extract `Authorization: Bearer sb_...`, resolve user via `requireUser`, return 401 if invalid.
- Auth is bound to the MCP session at first request (headers present). Subsequent requests in the same session reuse the bound user. If the token changes mid-session, reject.
- Sessions are keyed by `Mcp-Session-Id`; store `AuthUser` in a server-side `Map<sessionId, AuthUser>`. Delete on session close.
- Read tools: viewer+. Write tools: member+. Admin tools: admin+.

## 6. Tool surface

### Slice 1 — read + compile (Phase 1)
Data:
- `list_connections` → GET /api/connections
- `get_connection` → GET /api/connections/:id
- `test_connection` → POST /api/connections/:id/test
- `list_tables` → GET /api/connections/:id/tables
- `preview_table` → GET /api/connections/:id/tables/:name/preview (limit 100)
- `run_query` → POST /api/connections/:id/query (sql, maxRows; default cap 1000, truncate with note)

Compilation:
- `compile_chart` → POST /api/compile (sql, connectionId?, theme?, backends?) → ECharts spec + diagnostics

Saved queries:
- `list_saved_queries`, `get_saved_query`

Dashboards:
- `list_dashboards`, `get_dashboard` (returns manifest + diagnostics)

### Slice 2 — writes, role-gated (Phase 2)
Connections:
- `create_connection`, `delete_connection`

Saved queries:
- `create_saved_query`, `update_saved_query`, `delete_saved_query`

Dashboards:
- `create_dashboard`, `delete_dashboard`
- `apply_dashboard_state` (name, items, filters, theme, colors, baseVersion)
- `commit_dashboard_version` (message, baseVersion)
- `list_dashboard_versions`, `get_dashboard_version`

## 7. Phases

1. **MCP core (streamable HTTP)** — `/mcp` endpoint, token auth via ALS, Slice 1 tools, fix DuckDB timeout, 2–3 tests. ~2–3 days.
2. **Write tools** — Slice 2, role-gated. ~2 days.
3. **Stdio transport** (optional) — `--mcp-stdio` flag for Claude Desktop / local dev. HTTP-only is enough for Dokploy. ~1 day.
4. **Agent skill + docs** — document tool names/params in SKILL.md + README; example semantix provisioning. ~1 day.
5. **Export endpoint** (small) — `GET /api/dashboards/:id/code` returning serialized manifest text, so agents can fetch → edit → resubmit. ~0.5 day.

## 8. Compatibility notes with semantix

- Semantix `call_tool` has a 120s timeout → sqlboard's DuckDB queries must respect `queryTimeoutMs` (currently not enforced for DuckDB; fix in Phase 1).
- Semantix caches tools for 60s; tool list changes propagate within a minute.
- Semantix deny-lists tools by name pattern → keep tool names stable.
- Semantix's `get_tool_args_for_query` prefers `sql` param → `run_query` uses `sql`. ✓

## 9. Risks

- **Session/auth binding**: prevent cross-user session reuse. Bind `AuthUser` to `Mcp-Session-Id` in a server-side Map; reject if token changes mid-session; delete on close.
- **Result size**: MCP clients impose limits; `run_query` truncates at `maxRows` (default 1000) with a trailing note.
- **DuckDB timeout**: fix as part of Phase 1 so MCP's 120s cap isn't exceeded silently.
- **Role gating**: write tools must check `user.role` (not just token scope) — reuse existing `ROLE_RANK`.
- **Tool input validation**: reuse zod schemas, convert to JSON Schema for MCP `inputSchema`.

## 10. Open questions (resolved)

1. Write tools over MCP? → **Yes**, gated by token scope.
2. Stdio mode? → **HTTP only to start**; stdio as optional later phase.
3. Rendering over MCP? → **No**. MCP exposes data + manifests; rendering is the consumer's concern (semantix/AGUI).

## 11. Rendering and AGUI

AGUI (agent UI) is a consumer-side rendering concern. sqlboard will not render; it returns manifests (`get_dashboard`) and compiled chart specs (`compile_chart`). The consumer (semantix, Open WebUI, etc.) renders using its own UI layer, feeding it sqlboard's manifests and ECharts specs. This keeps sqlboard headless and renderer-agnostic.

## 12. What I'd do first (Phase 1)

Install SDK + zod-to-json-schema, add `/mcp` streamable HTTP endpoint with token auth, register the 8 read/compile tools, fix DuckDB timeout, add 2–3 tests, update SKILL.md. Then iterate on Phase 2.
