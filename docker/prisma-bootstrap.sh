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

echo "Ensuring single-admin and single-author constraints..."
cat > /tmp/single-slot-indexes.sql <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS "users_admin_role_unique"
ON "users" (role) WHERE role = 'admin';
-- At most one user may hold the author badge. grantBadge stores it in the
-- legacy `badge` column, so that path is covered by the column index; the
-- array-expression index additionally enforces it when 'author' is written
-- directly into the `badges` array, so both storage locations are guarded.
CREATE UNIQUE INDEX IF NOT EXISTS "users_author_badge_unique"
ON "users" (badge) WHERE badge = 'author';
CREATE UNIQUE INDEX IF NOT EXISTS "users_author_array_unique"
ON "users" ((CASE WHEN 'author' = ANY(badges) THEN 'author' ELSE NULL END));
SQL
bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file /tmp/single-slot-indexes.sql

echo "Prisma bootstrap complete"
