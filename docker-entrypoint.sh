#!/bin/sh
set -e
# Use a marker file instead of checking for the DB file, because with libSQL
# (DATABASE_URL=libsql://...) the DB lives on the remote server, not locally.
if [ ! -f "$DATA_DIR/.seeded" ]; then
  echo "Seeding initial data..."
  if node /app/packages/api/scripts/seed.cjs; then
    touch "$DATA_DIR/.seeded"
  else
    echo "Seeding failed, will retry on next start."
    exit 1
  fi
fi
exec node /app/packages/api/dist/index.js
