#!/bin/sh
set -e

# Seed only if not already seeded. The seed script has its own retry logic
# (30 attempts, 2s each) to wait for sqld to be ready.
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
