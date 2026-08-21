#!/usr/bin/env sh
set -eu

cd /app/packages/db

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required. Set it in the Dokploy application environment."
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
    echo "Database not reachable after 30 attempts."
    exit 1
  fi
  echo "Database not ready yet (attempt ${i}/30), retrying in 2s..."
  sleep 2
done

PRISMA_CONFIG_PATH="prisma.config.ts"
SCHEMA_PATH="prisma/schema.prisma"

echo "Generating Prisma client..."
bunx prisma generate --config "$PRISMA_CONFIG_PATH"

echo "Checking schema drift between database and Prisma schema..."
set +e
bunx prisma migrate diff --from-config-datasource --to-schema "$SCHEMA_PATH" --exit-code >/dev/null 2>&1
diff_status=$?
set -e

if [ "$diff_status" -eq 0 ]; then
  echo "PRISMA_SYNC_OK: no schema drift detected, database is in sync."
  exit 0
fi

if [ "$diff_status" -ne 2 ]; then
  echo "Schema drift check failed with exit code ${diff_status}."
  exit "$diff_status"
fi

echo "Schema drift detected. Pushing Prisma schema..."
bunx prisma db push --config "$PRISMA_CONFIG_PATH"

echo "Ensuring case-insensitive username uniqueness index..."
cat > /tmp/username-unique.sql <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_unique"
ON "users" (LOWER("username"));
SQL
bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file /tmp/username-unique.sql

echo "Ensuring single-admin and single-author constraints..."
cat > /tmp/single-slot-indexes.sql <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS "users_admin_role_unique"
ON "users" (role) WHERE role = 'admin';
CREATE UNIQUE INDEX IF NOT EXISTS "users_author_badge_unique"
ON "users" (badge) WHERE badge = 'author';
SQL
bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file /tmp/single-slot-indexes.sql

echo "PRISMA_SYNC_OK: Prisma schema sync complete."
