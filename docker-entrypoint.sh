#!/bin/sh
set -e

# Seed initial data. The seed script is idempotent: it skips the admin user
# if any users exist, skips the DuckDB connection if one exists, etc. Running
# it on every start protects against stale `.seeded` markers or mismatched
# volumes (e.g. a fresh Postgres volume paired with an old /data volume).
echo "Seeding initial data..."
node /app/packages/api/scripts/seed.cjs

exec node /app/packages/api/dist/index.js