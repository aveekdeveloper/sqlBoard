#!/bin/sh
set -e
if [ ! -f "$DATA_DIR/sqlboard.db" ]; then
  echo "Seeding initial data..."
  node /app/packages/api/scripts/seed.cjs
fi
exec node /app/packages/api/dist/index.js
