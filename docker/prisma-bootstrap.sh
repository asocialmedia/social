#!/usr/bin/env sh
set -eu

PRISMA_CONFIG_PATH="packages/db/prisma.config.ts"

echo "Generating Prisma client..."
bunx prisma generate --config "$PRISMA_CONFIG_PATH"

echo "Pushing Prisma schema..."
# Dev bootstrap: the local database may contain data from older schemas, so accept
# destructive changes (dropped columns/tables) instead of failing the init job.
bunx prisma db push --config "$PRISMA_CONFIG_PATH" --accept-data-loss

echo "Ensuring case-insensitive username uniqueness index..."
cat > /tmp/username-unique.sql <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_unique"
ON "users" (LOWER("username"));
SQL
bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file /tmp/username-unique.sql

echo "Prisma bootstrap complete"
