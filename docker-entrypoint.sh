#!/bin/sh
set -e

# Wait for sqld to be ready (up to 30s)
for i in $(seq 1 30); do
  if wget -q --spider http://sqld:8080/ 2>/dev/null; then
    break
  fi
  echo "Waiting for sqld... ($i/30)"
  sleep 1
done

# Use a marker file instead of checking for the DB file, because with libSQL
# (DATABASE_URL=http://...) the DB lives on the remote server, not locally.
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
