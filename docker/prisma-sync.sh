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

# Do NOT gate on `db sign` here.
#
# `db sign` verifies that the live database ALREADY satisfies a contract. Run
# before `db migrate`, it can only ever pass when there is nothing to migrate,
# so it inverted the deploy: the one situation that needs this container (a
# contract change is waiting to be applied) is exactly the one where sign is
# guaranteed to fail. A pending migration is reported as CONTRACT.
# SCHEMA_VERIFICATION_FAILED, exit 4 - not as a migration to run.
#
# The hardcoded fallback contract made it worse. It was pinned to one hash
# (095080b4..., the 20260924T1818_production_baseline state), so once the
# database moved past that hash the fallback compared it against a stale
# contract and failed too - 48 failures, exit 4. Under `set -eu` that second
# failure terminated the script, so the prebuild, `db migrate --show`,
# `db migrate` and `db verify` below never ran. The schema silently stayed one
# migration behind while the app image deployed and queried the new columns,
# which is the `column message_conversation_keys.version does not exist` flood.
#
# The contract is the source of truth and `db migrate` replays the reviewed
# graph to it. Verification belongs AFTER the apply, and `db verify` below
# already does exactly that. A signature is for adopting an unmanaged database,
# not for a pipeline that owns its migrations.

# Build the DM indexes before the migration, so its createIndex operations find
# them already present and skip. One `db migrate` run is a single transaction and
# Postgres refuses CREATE INDEX CONCURRENTLY inside one, so without this the
# migration blocks message writes for the length of the build. The operations
# carry a to_regclass precheck, so this is idempotent and a no-op on a database
# that already has them.
#
# A failure that leaves an INVALID index is fatal, not best-effort. Postgres
# keeps a half-built concurrent index under its name, so it satisfies the
# to_regclass precheck: the migration would skip the rebuild, report success,
# and leave the table without a usable index. The prebuild reports that case
# explicitly, so stop here rather than migrate over it.
if ! bun /app/prebuild-dm-indexes.js; then
  echo "ERROR: index prebuild failed. Refusing to migrate, because a failed" >&2
  echo "       concurrent build leaves an INVALID index that still satisfies the" >&2
  echo "       migration's existence precheck, which would skip the rebuild and" >&2
  echo "       finish with an unusable index. Drop the listed indexes and re-run." >&2
  exit 1
fi

# Preview the pending route, then apply it. `--show` is read-only, so a
# destructive or unreachable plan is visible here before anything is applied.
bunx prisma db migrate --show

# One apply, and its own report. `--json` emits NDJSON, not a single document: a
# run that applies a migration also prints step-started and step-finished records
# ahead of the final result, while a no-op run prints only the result. So parse
# line by line and take the record whose kind is "result".
#
# This has to be the same invocation that applies. Asking a second time would
# always report 0, because the first call already advanced the marker, and the
# trending-score sync below would then be skipped on precisely the deploy that
# changed the schema.
#
# Capturing the report also means a migrate failure stops the script here
# (set -e) instead of falling through into a score sync that would run against
# a half-migrated database.
MIGRATE_REPORT="$(bunx prisma db migrate --json --advance-ref db)"
MIGRATIONS_APPLIED="$(printf '%s\n' "$MIGRATE_REPORT" | bun -e '
const lines = (await Bun.stdin.text()).split("\n").filter((line) => line.trim() !== "");
let applied = 0;
let sawResult = false;
for (const line of lines) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    continue;
  }
  if (record.kind === "result") {
    sawResult = true;
    applied = Number(record.envelope?.result?.migrationsApplied ?? 0);
  }
}
if (!sawResult) {
  process.stderr.write("No result record in `prisma db migrate --json` output; refusing to guess whether a migration ran.\n");
  process.exit(1);
}
process.stdout.write(String(applied));
')"

# Verification runs AFTER the apply, which is the only order in which it can
# mean anything. This is the drift gate the removed sign gate was trying to be:
# it compares the live schema against the contract that was just applied, so a
# partial apply or an out-of-band change fails the deploy loudly instead of
# leaving the app querying columns that do not exist.
bunx prisma db verify

# Recompute trending scores only when this run actually applied a migration.
# The sync walks every post, so running it on every deploy would be a large,
# pointless write amplification on a merge that changed no schema.
if [ "$MIGRATIONS_APPLIED" -gt 0 ]; then
  echo "Applied ${MIGRATIONS_APPLIED} migration(s); recomputing trending scores."
  bun /app/sync-scores.js
else
  echo "No migration applied; schema already current, skipping the trending-score sync."
fi

echo "PRISMA_SYNC_OK: Prisma schema migration and trending-score sync complete."
