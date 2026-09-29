// Pre-builds the indexes that the DM migration would otherwise create while
// holding a write lock.
//
// Why this exists: one `prisma db migrate` run is a single transaction, and
// Postgres refuses CREATE INDEX CONCURRENTLY inside one. So the migration
// package issues a plain CREATE INDEX, which takes a SHARE lock that blocks
// writes to the target table for the whole build, and the surrounding
// transaction holds it for the remainder of the run. On `messages` that is a
// long stall on a live table.
//
// The fix is not to weaken the migration. Every `createIndex` operation in the
// package's ops.json carries a precheck of
//   SELECT (to_regclass($1)) IS NULL
// so an index that already exists is SKIPPED. Build it here instead, with
// CONCURRENTLY and outside any transaction, and the migration finds the work
// already done, applies only the metadata-only DDL, and stays a fast
// transaction. The contract still declares the index and the migration's
// postcheck still proves it is present, so nothing goes unverified.
//
// Safe to run at any time and as often as needed: every statement is guarded by
// IF NOT EXISTS, so a second run is a no-op.

import { Client } from "pg";

// Only the indexes whose columns already exist before the migration can be
// built here, and those are exactly the ones worth pre-building.
//
// The migration also creates message_conversation_members_userId_mutedAt_idx
// and message_hidden_userId_idx, but they cannot be pre-built: the first is on
// a mutedAt column the migration adds, the second on a table the migration
// creates. Neither is a lock risk worth solving - one is a handful of rows per
// conversation, the other is an empty new table - so both are left to the
// migration, where they cost nothing.
const INDEXES = [
  {
    // The one that matters, and the only table here large enough for the lock to
    // hurt. Serves every history read: those filter on conversationId and cursor
    // on id. The existing (conversationId, createdAt) index cannot serve an
    // id-ordered range scan, so Postgres fell back to walking the primary key
    // backwards and discarding every row of another conversation. Measured on a
    // 2M row table: a small DM page went 178ms -> 0.64ms.
    name: "messages_conversationId_id_idx",
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversationId_id_idx" ON "messages" ("conversationId", "id")',
  },
  {
    // Two rows per 1:1 conversation, so the build is instant either way. Listed
    // for completeness so the whole pre-migration set is covered by one command.
    name: "message_conversation_keys_conversationId_ownerUserId_idx",
    sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_conversation_keys_conversationId_ownerUserId_idx" ON "message_conversation_keys" ("conversationId", "ownerUserId")',
  },
] as const;

export interface PrebuildIndexesResult {
  built: string[];
  present: string[];
}

// The slice of pg's Client this function uses, so a test can drive the same
// code path without a database.
export interface PrebuildQueryClient {
  connect: () => Promise<unknown>;
  end: () => Promise<unknown>;
  query: <T>(text: string, params?: string[]) => Promise<{ rows: T[] }>;
}

export interface PrebuildIndexesOptions {
  onLog?: (message: string) => void;
  createClient?: (databaseUrl: string) => PrebuildQueryClient;
}

export async function prebuildDmIndexes(
  databaseUrl: string,
  options: PrebuildIndexesOptions = {}
): Promise<PrebuildIndexesResult> {
  const onLog =
    options.onLog ??
    (() => {
      /* empty */
    });
  // One connection, and deliberately no BEGIN: CONCURRENTLY is illegal inside a
  // transaction block, so this has to run in autocommit.
  const client = options.createClient
    ? options.createClient(databaseUrl)
    : new Client({ connectionString: databaseUrl });
  await client.connect();
  const built: string[] = [];
  const present: string[] = [];
  try {
    for (const index of INDEXES) {
      // The existence probe has to settle before we decide whether to build.
      // oxlint-disable-next-line no-await-in-loop -- see the build below.
      const existing = await client.query<{ result: boolean }>(
        'SELECT (to_regclass($1)) IS NOT NULL AS "result"',
        [`"public"."${index.name}"`]
      );
      if (existing.rows[0]?.result === true) {
        // The migration skips an index that already exists, so there is nothing
        // to do and nothing to log beyond accounting for it.
        present.push(index.name);
        continue;
      }
      const startedAt = Date.now();
      onLog(`  building ${index.name} concurrently...`);
      // Index builds are I/O bound and deliberately sequential: running them
      // together would have several concurrent builds competing for the same
      // I/O on a database that is, by assumption, in production.
      // oxlint-disable-next-line no-await-in-loop -- deliberate, see above.
      await client.query(index.sql);
      built.push(index.name);
      onLog(
        `  built    ${index.name} in ${(
          (Date.now() - startedAt) /
          1000
        ).toFixed(1)}s`
      );
    }
    // A CONCURRENTLY build that fails leaves an INVALID index behind. That
    // index satisfies to_regclass, so the migration's precheck would treat the
    // work as done and silently skip the rebuild. Catch it here, where it is
    // still visible and still fixable.
    const invalid = await client.query<{ indexname: string }>(
      `SELECT c.relname AS "indexname"
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT i.indisvalid
          AND n.nspname = 'public'`
    );
    if (invalid.rows.length > 0) {
      throw new Error(
        `These indexes failed to build and are INVALID (drop them and re-run): ${invalid.rows
          .map((row) => row.indexname)
          .join(", ")}`
      );
    }
  } finally {
    await client.end();
  }
  return { built, present };
}
