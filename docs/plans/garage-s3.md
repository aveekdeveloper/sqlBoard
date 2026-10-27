# Spec: Garage S3 integration branch

**Status**: Draft plan
**Owner**: sqlboard
**Created**: 2026-10-27
**Branch**: `feature/garage-s3`
**Base**: `main` (current HEAD)
**Goal**: Replace local file storage with S3-compatible (Garage) object storage, enabling horizontal scaling, per-tenant file isolation, and removing the last local-file dependency.

## 1. Why

sqlboard currently stores uploaded files and DuckDB data on local disk (`/data/uploads`, `/data/sqlboard.duckdb`). This is the last blocker for:
- Horizontal scaling (multiple sqlboard replicas sharing data)
- Multi-tenant SaaS (per-tenant file isolation)
- Disaster recovery (backups to S3)

Garage is an S3-compatible object store that runs on Dokploy (self-hosted, lightweight).

## 2. Architecture

```
Dokploy
├── sqlboard (N replicas, stateless)
├── sqld (libSQL server) — metadata DB
├── garage (S3-compatible) — file storage
└── traefik (built-in) — routing, TLS

sqlboard → Garage S3 (uploads, DuckDB snapshots)
sqlboard → sqld (metadata, connections, dashboards)
```

### Storage layout in Garage

```
sqlboard-bucket/
├── uploads/{tenant_slug}/{timestamp}_{filename}   # uploaded CSV/Parquet/JSON
├── duckdb/{tenant_slug}/sqlboard.duckdb           # per-tenant DuckDB file
└── backups/{tenant_slug}/sqlboard.db              # DB backups (optional)
```

Single-tenant mode (no tenant): `uploads/`, `duckdb/`, `backups/` (no tenant prefix).

## 3. Phases

### Phase 1: S3 client + config (1 day)
- Add `@aws-sdk/client-s3` to api deps.
- Add config fields: `s3Endpoint`, `s3AccessKey`, `s3SecretKey`, `s3Bucket`, `s3Region`, `s3ForcePathStyle`.
- Env vars: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`.
- Create `packages/api/src/storage/s3.ts` with upload/download/delete/presign helpers.
- Fallback: if `S3_ENDPOINT` is not set, use local filesystem (backward compat).

### Phase 2: Upload to S3 (2 days)
- Modify `POST /api/uploads` to upload file to S3 instead of local disk.
- Store S3 key in `uploads` table (add `storage_key` column, keep `filename` for display).
- DuckDB ingest: read from S3 URL (`s3://bucket/key`) instead of local file path.
- Delete upload: delete from S3 + DB row.

### Phase 3: DuckDB on S3 (2 days)
- Configure DuckDB with S3 credentials via `SET s3_endpoint`, `SET s3_access_key_id`, etc.
- Per-tenant DuckDB file path: `s3://bucket/duckdb/{tenant}/sqlboard.duckdb`.
- Or keep DuckDB local but sync to S3 periodically (simpler, less latency).
- Recommendation: Keep DuckDB local for performance, sync snapshots to S3 for backup/sharing.

### Phase 4: Docker Compose + Garage (1 day)
- Add Garage service to `docker-compose.libsql.yml`.
- Add Garage env vars to sqlboard service.
- Add Garage init script (create bucket, create API key).
- Document Dokploy setup for Garage.

### Phase 5: Backups (1 day, optional)
- Add `POST /api/admin/backup` endpoint that backs up the DB to S3.
- Or use Litestream for continuous SQLite replication.
- Dokploy scheduled backup of sqld volume is simpler.

## 4. Code changes

### New files
- `packages/api/src/storage/s3.ts` — S3 client wrapper (upload, download, delete, list, presign)
- `packages/api/src/storage/index.ts` — storage abstraction (S3 or local filesystem)

### Modified files
- `packages/api/src/config.ts` — add S3 config fields
- `packages/api/src/routes/connections.ts` — upload handler uses S3
- `packages/api/src/engines/duckdb.ts` — read from S3 URLs, S3 config
- `packages/api/src/db/schema.ts` — add `storage_key` to uploads table
- `packages/api/src/db/client.ts` — migration for storage_key column
- `packages/web/src/pages/Connections.tsx` — upload progress, S3 key display
- `Dockerfile` — no changes needed (S3 client is pure JS)
- `docker-compose.libsql.yml` — add Garage service

### New env vars
```
S3_ENDPOINT=http://garage:3900
S3_ACCESS_KEY=<garage-key-id>
S3_SECRET_KEY=<garage-key-secret>
S3_BUCKET=sqlboard
S3_REGION=garage
S3_FORCE_PATH_STYLE=true
```

## 5. Storage abstraction

```ts
interface StorageBackend {
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  presign(key: string, expiresIn?: number): Promise<string>;
}

// S3 implementation (Garage/MinIO/AWS)
class S3Storage implements StorageBackend { ... }

// Local filesystem implementation (fallback)
class LocalStorage implements StorageBackend { ... }

// Factory
function createStorage(config: SqlboardConfig): StorageBackend {
  if (config.s3Endpoint) return new S3Storage(config);
  return new LocalStorage(config.uploadsDir);
}
```

## 6. DuckDB S3 integration

DuckDB supports S3 via the `httpfs` extension. To read from S3:

```sql
INSTALL httpfs;
LOAD httpfs;
SET s3_endpoint = 'garage:3900';
SET s3_access_key_id = '...';
SET s3_secret_access_key = '...';
SET s3_use_ssl = false;
SET s3_url_style = 'path';

-- Then read directly:
SELECT * FROM read_csv('s3://sqlboard/uploads/sales.csv');
```

For the ingest flow:
1. Upload file to S3 (via StorageBackend)
2. DuckDB reads from S3 URL: `CREATE TABLE x AS SELECT * FROM read_csv('s3://bucket/key')`

This removes the need for local file paths entirely.

## 7. Per-tenant isolation

With multi-tenancy (from connectors spec), file paths include tenant slug:
```
s3://sqlboard/uploads/{tenant_slug}/{timestamp}_{filename}
s3://sqlboard/duckdb/{tenant_slug}/sqlboard.duckdb
```

Garage buckets can be per-tenant or shared with prefixes. Shared bucket with prefixes is simpler and sufficient.

## 8. Garage setup on Dokploy

```yaml
services:
  garage:
    image: dxflrs/garage:v1.0.0
    container_name: sqlboard-garage
    environment:
      - GARAGE_RPC_SECRET=<random-32-byte-hex>
      - GARAGE_ADMIN_TOKEN=<admin-token>
    volumes:
      - garage-data:/data
      - garage-meta:/meta
    ports:
      - "3900:3900"   # S3 API
      - "3901:3901"   # Admin API
      - "3902:3902"   # Web (optional)
    restart: unless-stopped
```

After Garage starts:
1. Create a bucket: `garage bucket create sqlboard`
2. Create an API key: `garage key create sqlboard-key`
3. Assign key to bucket: `garage bucket allow sqlboard --read --write --key sqlboard-key`
4. Set the key ID and secret in sqlboard's env vars

## 9. What stays local (for now)

- **DuckDB file** (per-tenant) — can stay local for performance, synced to S3 for backup
- **SQLite/libSQL DB** — stays in sqld (already externalized)
- **Uploads** — move to S3 (this is the main change)

## 10. Phases (effort)

1. **S3 client + config** (1 day) — storage abstraction, env vars, fallback to local
2. **Upload to S3** (2 days) — modify upload route, DuckDB ingest from S3
3. **Docker Compose + Garage** (1 day) — add Garage service, init script, docs
4. **DuckDB S3 reads** (2 days) — configure DuckDB httpfs, read from S3 URLs
5. **Backups** (1 day, optional) — DB backup to S3
6. **Per-tenant isolation** (1 day) — tenant-prefixed paths

**Total: ~8 days for full Garage S3 integration**

## 11. Risks

- **DuckDB S3 performance**: Reading from S3 is slower than local disk. For small files (< 100MB), negligible. For large datasets, consider caching.
- **Garage maturity**: Garage is newer than MinIO. Consider MinIO if Garage has issues.
- **S3 credentials in DuckDB**: Credentials are passed via SQL `SET` commands, which could leak in logs. Use DuckDB's secret manager instead.
- **Backward compat**: Local filesystem fallback must work for dev (no S3 configured).

## 12. Open questions

1. Should uploads go directly to S3 (client-side presigned URLs) or through sqlboard (server-side upload)? (Lean: server-side for v1, presigned later for large files)
2. Per-tenant buckets or shared bucket with prefixes? (Lean: shared bucket with prefixes — simpler, Garage handles it fine)
3. Should DuckDB stay local (with S3 sync) or move fully to S3? (Lean: stay local for performance, sync to S3 for backup)
4. MinIO vs Garage? (Lean: Garage — lighter, designed for self-hosted, good Dokploy fit)
