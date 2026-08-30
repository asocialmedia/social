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

if [ "$diff_status" -ne 2 ] && [ "$diff_status" -ne 0 ]; then
  echo "Schema drift check failed with exit code ${diff_status}."
  exit "$diff_status"
fi

# Prisma's enum-alter strategy fails when rows still carry a dropped value,
# and its db push demands --accept-data-loss just to drop the enum VARIANTS.
# Both hazards are handled here, manually and safely, before push:
#   1) rows using the retired CODE media type are removed (DOCUMENT stays a
#      supported, first-class type - only CODE was dropped from the schema),
#   2) the enum itself is swapped via rename-and-replace (zero data loss,
#      no --accept-data-loss ever needed).
# The whole step only runs on drift; a synced database cannot contain them.
if [ "$diff_status" -eq 2 ]; then
  # Row cleanup and the MediaType swap share one explicit transaction: if the
  # conversion fails, the deletion rolls back with it instead of leaving the
  # database half-migrated.
  echo "Removing the retired CODE media type and swapping legacy enum variants atomically..."
  bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file /dev/stdin <<'SQL'
BEGIN;

-- Drop orphaned shadow enum types ("*_new") left behind by previously
-- interrupted Prisma enum rebuilds. Without this, the next push fails on
-- CREATE TYPE ... already exists, or worse, casts against a stale value set.
-- Only types with zero column attachments are touched; anything still
-- referenced is left alone so a genuinely in-progress swap never gets nuked.
DO $$
DECLARE
  shadow_type TEXT;
BEGIN
  FOR shadow_type IN
    SELECT t.typname
    FROM pg_type t
    WHERE t.typtype = 'e'
      AND t.typname ~ '_new$'
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a WHERE a.atttypid = t.oid
      )
  LOOP
    RAISE NOTICE 'Dropping orphaned shadow enum type %', shadow_type;
    EXECUTE format('DROP TYPE %I', shadow_type);
  END LOOP;
END $$;

DO $$
DECLARE
  legacy_variants INTEGER;
BEGIN
  SELECT COUNT(*) INTO legacy_variants
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'MediaType'
    AND e.enumlabel IN ('CODE');

  -- Everything is guarded: once the swap has run, the legacy literals are no
  -- longer valid enum inputs at all, so an unguarded DELETE would fail to
  -- parse on every subsequent sync.
  IF legacy_variants > 0 THEN
    DELETE FROM post_media WHERE type = 'CODE';

    ALTER TYPE "MediaType" RENAME TO "MediaType_legacy";
    CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT');
    ALTER TABLE post_media ALTER COLUMN "type" DROP DEFAULT;
    ALTER TABLE post_media ALTER COLUMN "type"
      TYPE "MediaType" USING "type"::text::"MediaType";
    DROP TYPE "MediaType_legacy";
  END IF;
END $$;

COMMIT;
SQL

  # The pg_trgm search indexes are NOT schema-owned: packages/db/src/search.ts
  # creates them at runtime (ensureSearchIndexes) because Prisma cannot express
  # GIN/trgm indexes in the schema. Introspection therefore reports them as
  # unknown objects, and every sync's diff demands DROP INDEX for them - which
  # would trip the destructive-diff guard below forever. Drop them explicitly
  # here instead: dropping an index touches no row data (lossless), and the
  # search code recreates them via CREATE INDEX IF NOT EXISTS on the first
  # query after boot, so search only runs unindexed for seconds.
  echo "Dropping runtime-managed trgm search indexes (recreated by app runtime)..."
  DROP_TRGM_SQL="$(mktemp "${TMPDIR:-/tmp}/drop-trgm.XXXXXX.sql")"
  trap 'rm -f "$DROP_TRGM_SQL"' EXIT
  cat > "$DROP_TRGM_SQL" <<'SQL'
DROP INDEX IF EXISTS "idx_users_username_trgm";
DROP INDEX IF EXISTS "idx_users_displayname_trgm";
DROP INDEX IF EXISTS "idx_users_displayusername_trgm";
DROP INDEX IF EXISTS "idx_posts_content_trgm";
SQL
  bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file "$DROP_TRGM_SQL"
  rm -f "$DROP_TRGM_SQL"

  # Prisma db push refuses to apply additive changes that introduce unique
  # constraints on fresh columns: its "might be data loss" heuristic cannot
  # prove the brand-new columns hold no duplicates, so it demands
  # --accept-data-loss even when the diff drops nothing. The production-safe
  # path around that wall, without ever passing the flag:
  #   1) materialize the exact SQL the push would run (recomputed now, after
  #      the legacy enum swap above has settled the enum surface),
  #   2) refuse loudly if that SQL is destructive in any way,
  #   3) apply it in one implicit transaction - a unique-constraint build
  #      that hits duplicate data fails the WHOLE batch and the database is
  #      left untouched, and
  #   4) let db push confirm the database is in sync (no flags).
  echo "Materializing schema drift as SQL..."
  bunx prisma migrate diff \
    --config "$PRISMA_CONFIG_PATH" \
    --from-config-datasource \
    --to-schema "$SCHEMA_PATH" \
    --script > /tmp/push.sql
  if grep -qiE '(DROP TABLE|DROP COLUMN|DROP INDEX|DROP TYPE|DELETE FROM|TRUNCATE)' /tmp/push.sql; then
    echo "Refusing to apply a destructive schema diff. Review manually:" >&2
    cat /tmp/push.sql >&2
    exit 1
  fi
  echo "Applying additive schema diff atomically..."
  bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file /tmp/push.sql

  echo "Confirming schema is in sync..."
  bunx prisma db push --config "$PRISMA_CONFIG_PATH"
else
  echo "No schema drift detected, database is in sync."
fi

# Index creation is idempotent and cheap, so it runs on EVERY invocation:
# drift-based gating would leave freshly created databases missing these
# until the next schema change.
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

echo "Normalizing OAuth account issuers..."
cat > /tmp/normalize-account-issuers.sql <<'SQL'
UPDATE "accounts"
SET "issuer" = 'https://accounts.google.com'
WHERE "providerId" = 'google' AND ("issuer" = '' OR "issuer" IS NULL OR "issuer" = 'google');

UPDATE "accounts"
SET "issuer" = 'reddit'
WHERE "providerId" = 'reddit' AND ("issuer" = '' OR "issuer" IS NULL);

UPDATE "accounts"
SET "issuer" = "providerId"
WHERE ("issuer" = '' OR "issuer" IS NULL);
SQL
bunx prisma db execute --config "$PRISMA_CONFIG_PATH" --file /tmp/normalize-account-issuers.sql

# One-shot data synchronizations run here on every sync invocation. Each one guards
# itself (marker table + advisory lock) so exactly zero or one of them does
# work per deployment fleet, and failures never block app deploys: the next
# sync retries until the marker lands.
echo "Running score synchronization..."
if [ -f /app/sync-scores.js ] && bun /app/sync-scores.js; then
  echo "Trending-score sync step OK."
elif [ -f /app/backfill.js ] && bun /app/backfill.js; then
  echo "Trending-score sync (legacy fallback) step OK."
else
  echo "WARNING: trending-score sync failed; it will retry on the next sync deploy." >&2
fi

echo "PRISMA_SYNC_OK: Prisma schema sync complete."
