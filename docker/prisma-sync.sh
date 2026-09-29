#!/usr/bin/env sh
set -eu

cd /app/packages/db

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required. Set it in the deployment environment." >&2
  exit 1
fi

export DATABASE_URL

DB_HOST=$(printf '%s' "$DATABASE_URL" | sed -E 's|^[a-z]+://[^@]*@||')
echo "Waiting for database at ${DB_HOST} to be reachable..."
for i in $(seq 1 30); do
  if bun -e 'const net = require("node:net"); const u = new URL(process.env.DATABASE_URL); const s = net.connect({ host: u.hostname, port: Number(u.port || 5432) }); s.on("connect", () => { s.destroy(); process.exit(0); }); s.on("error", () => { process.exit(1); }); s.setTimeout(5000, () => { s.destroy(); process.exit(1); });' >/dev/null 2>&1; then
    echo "Database is reachable."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Database not reachable after 30 attempts." >&2
    exit 1
  fi
  echo "Database not ready yet, retrying in 2s..."
  sleep 2
done

if ! bunx prisma db sign --no-advance-ref; then
  bunx prisma db sign --contract 095080b42c0e4a508cceacaabdb5fbcf86fe474ec8c63318070ecc8eadf375de --no-advance-ref
fi

# Build the DM indexes before the migration, so its createIndex operations find
# them already present and skip. One `db migrate` run is a single transaction and
# Postgres refuses CREATE INDEX CONCURRENTLY inside one, so without this the
# migration blocks message writes for the length of the build. The operations
# carry a to_regclass precheck, so this is idempotent and a no-op on a database
# that already has them. Best-effort: if it cannot run, the migration still
# applies, just while holding the lock.
bun /app/prebuild-dm-indexes.js || \
  echo "WARNING: index prebuild failed; the migration will build them under a write lock" >&2

bunx prisma db migrate --show
bunx prisma db migrate --advance-ref db
bunx prisma db verify
bun /app/sync-scores.js
echo "PRISMA_SYNC_OK: Prisma schema migration and trending-score sync complete."
