// oxlint-disable-next-line typescript/triple-slash-reference -- Consumers typecheck workspace sources without including this package's ambient declarations.
/// <reference path="../../../sql.d.ts" />
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

import prebuildSql from "../../../sql/messages/prebuild-indexes.sql" with { type: "text" };
import { readSqlBundle } from "./sql-template";

const {
  prebuild: {
    prebuildConversationKeysIndexSql,
    prebuildConversationShortCodeIndexSql,
    indexExistsSql,
    indexColumnsExistSql,
    invalidIndexesSql,
    prebuildMessageHistoryIndexSql,
    prebuildSearchOrphanTermsIndexSql,
    prebuildSearchOutboxIndexSql,
  },
} = readSqlBundle(prebuildSql, {
  prebuild: [
    "prebuildConversationKeysIndexSql",
    "prebuildConversationShortCodeIndexSql",
    "indexExistsSql",
    "indexColumnsExistSql",
    "invalidIndexesSql",
    "prebuildMessageHistoryIndexSql",
    "prebuildSearchOrphanTermsIndexSql",
    "prebuildSearchOutboxIndexSql",
  ],
} as const);

// Build indexes only when their table and columns exist. A database upgrading
// from main has no search tables or inviteShortCode column yet; the migration
// creates those objects and their indexes in its own transaction.
const INDEXES = [
  {
    // The one that matters, and the only table here large enough for the lock to
    // hurt. Serves every history read: those filter on conversationId and cursor
    // on id. The existing (conversationId, createdAt) index cannot serve an
    // id-ordered range scan, so Postgres fell back to walking the primary key
    // backwards and discarding every row of another conversation. Measured on a
    // 2M row table: a small DM page went 178ms -> 0.64ms.
    columns: ["conversationId", "id"],
    name: "messages_conversationId_id_idx",
    sql: prebuildMessageHistoryIndexSql,
    table: "messages",
  },
  {
    // The term dictionary can hold millions of normalized terms; this partial
    // index keeps global-deletion cleanup limited to terms with no documents.
    columns: ["conversationId", "documentFrequency"],
    name: "message_search_terms_orphaned_f61e9e26",
    sql: prebuildSearchOrphanTermsIndexSql,
    table: "message_search_terms",
  },
  {
    // Snapshot checks probe later revisions by message ID. This avoids a
    // sequential outbox scan for every candidate in large conversations.
    columns: ["messageId", "changeSequence"],
    name: "message_search_outbox_message_sequence_idx",
    sql: prebuildSearchOutboxIndexSql,
    table: "message_search_outbox",
  },
  {
    // Two rows per 1:1 conversation, so the build is instant either way. Listed
    // for completeness so the whole pre-migration set is covered by one command.
    columns: ["conversationId", "ownerUserId"],
    name: "message_conversation_keys_conversationId_ownerUserId_idx",
    sql: prebuildConversationKeysIndexSql,
    table: "message_conversation_keys",
  },
  {
    // The short-code join door's live lookup. `message_conversations` is the
    // hottest table in the den feature - every send bumps its `updatedAt` under
    // a lock - so a SHARE lock held for the whole build would stall every
    // conversation read for the duration. Nullable column, so a fresh build on
    // a table with millions of DM rows is still only an index over the dens,
    // but the lock alone is the reason this is here and not left to the
    // migration transaction.
    columns: ["inviteShortCode"],
    name: "message_conversations_inviteShortCode_key",
    sql: prebuildConversationShortCodeIndexSql,
    table: "message_conversations",
  },
] as const;

export interface PrebuildIndexesResult {
  built: string[];
  present: string[];
  deferred: string[];
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
      // No operation.
    });
  // One connection, and deliberately no BEGIN: CONCURRENTLY is illegal inside a
  // transaction block, so this has to run in autocommit.
  const client = options.createClient
    ? options.createClient(databaseUrl)
    : new Client({ connectionString: databaseUrl });
  await client.connect();
  const built: string[] = [];
  const present: string[] = [];
  const deferred: string[] = [];
  const invalidIndexes: string[] = [];
  let buildFailure: unknown = null;
  try {
    for (const index of INDEXES) {
      // The existence probe has to settle before we decide whether to build.
      // oxlint-disable-next-line no-await-in-loop -- see the build below.
      const existing = await client.query<{ result: boolean }>(indexExistsSql, [
        `"public"."${index.name}"`,
      ]);
      if (existing.rows[0]?.result === true) {
        // The migration skips an index that already exists, so there is nothing
        // to do and nothing to log beyond accounting for it.
        present.push(index.name);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- Check the live schema before starting this index build.
      const available = await client.query<{ result: boolean }>(
        indexColumnsExistSql,
        [`"public"."${index.table}"`, JSON.stringify(index.columns)]
      );
      if (available.rows[0]?.result !== true) {
        deferred.push(index.name);
        onLog(`  deferred ${index.name}; its table or columns await migration`);
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
  } catch (buildError) {
    // Report the build failure, but only after the INVALID sweep below, because
    // a failed CONCURRENTLY build is the thing that leaves an invalid index
    // behind and that is the more actionable message.
    buildFailure = buildError;
  } finally {
    // A CONCURRENTLY build that fails leaves an INVALID index behind, and an
    // invalid index still satisfies to_regclass. The migration's precheck asks
    // only whether the name exists, so it would skip the rebuild and the deploy
    // would finish with an index Postgres will not use. This runs in `finally`
    // so it also fires when a build threw part-way, which is exactly when the
    // leftover is most likely.
    try {
      const invalid = await client.query<{ indexname: string }>(
        invalidIndexesSql
      );
      if (invalid.rows.length > 0) {
        invalidIndexes.push(...invalid.rows.map((row) => row.indexname));
      }
    } catch {
      // The sweep is a diagnostic. If it cannot run, fall through to reporting
      // whatever the build itself reported rather than masking it.
    }
    await client.end();
  }
  if (invalidIndexes.length > 0) {
    throw new Error(
      `These indexes failed to build and are INVALID (drop them and re-run): ${invalidIndexes.join(", ")}`
    );
  }
  if (buildFailure) {
    throw buildFailure;
  }
  return { built, deferred, present };
}

// The stable messages/prebuild-indexes.ts launcher calls this for the schema-sync image.
// Bun bundles the text SQL imports alongside `pg`, which the image depends on; it does
// not need the rest of @asm/db. Locally it is reached through
// `bun run db:prebuild-dm-indexes`, which supplies the env file.
export async function runPrebuildDmIndexes(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  process.stdout.write(
    "Pre-building DM indexes with CREATE INDEX CONCURRENTLY\n"
  );
  const { built, present, deferred } = await prebuildDmIndexes(databaseUrl, {
    onLog: (message) => process.stdout.write(`${message}\n`),
  });
  for (const name of present) {
    process.stdout.write(`  present  ${name}\n`);
  }
  process.stdout.write(
    `Built ${built.length} index(es); ${present.length} already present; ${deferred.length} deferred to migration.\n`
  );
}
