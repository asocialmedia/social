#!/usr/bin/env bun

// Builds the DM indexes with CREATE INDEX CONCURRENTLY, outside the migration's
// transaction, so applying the migration does not take a write lock on
// `messages`.
//
// See packages/db/src/messages/prebuild-indexes.ts for why. Short version: one
// `prisma db migrate` run is a single transaction and Postgres refuses
// CONCURRENTLY inside one, so the migration's plain CREATE INDEX would block
// writes for the whole build. Each createIndex operation in the package carries
// a "does this index already exist" precheck, so a pre-built index is skipped
// and the migration does the rest as fast metadata-only DDL.
//
// Run this before applying the migration, ideally off-peak. It is idempotent.
//
// Usage:
//   bun scripts/maintenance/prebuild-dm-indexes.ts
//   DATABASE_URL=... bun scripts/maintenance/prebuild-dm-indexes.ts

import { prebuildDmIndexes } from "@asm/db";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  process.stdout.write(
    "Pre-building DM indexes with CREATE INDEX CONCURRENTLY\n"
  );
  const { built, present } = await prebuildDmIndexes(databaseUrl, {
    onLog: (message) => process.stdout.write(`${message}\n`),
  });
  for (const name of present) {
    process.stdout.write(`  present  ${name}\n`);
  }
  process.stdout.write(
    built.length === 0
      ? "Nothing to build; every index already exists.\n"
      : `Built ${built.length} index(es). The DM migration will now skip them.\n`
  );
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
