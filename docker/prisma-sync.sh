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

bunx prisma db migrate --show
bunx prisma db migrate --advance-ref db
bunx prisma db verify
echo "PRISMA_SYNC_OK: Prisma schema migration complete."
