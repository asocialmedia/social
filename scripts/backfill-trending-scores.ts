#!/usr/bin/env bun

// One-shot backfill for Post.trendingScore: computes the initial trending
// score for every non-gust post from its current aura / view / bookmark /
// comment signals using the pure computeTrendingScore() helper from @asm/db.
//
// Run:
//   bun scripts/backfill-trending-scores.ts
//
// The run is guarded by a row in the self-managed backfill_markers table, so
// wiring it into the deploy pipeline is safe: every container runs this on
// boot and exactly one of them does the work once; everyone after that skips
// in milliseconds. --force reruns the sweep regardless of the marker.
//
// Posts are walked with keyset pagination (order by id asc) in BATCH_SIZE
// chunks and each chunk is written with a single parameterized unnest UPDATE,
// so an interrupted run leaves no half-written batch behind. To resume after
// an interruption, rerun with the last post id printed by the previous run:
//   bun scripts/backfill-trending-scores.ts --after=<postId>
// A completed resume still records the marker.

import { computeTrendingScore, prisma } from "@asm/db";

const BATCH_SIZE = 500;
const LOG_EVERY_BATCHES = 20;
const MS_PER_SECOND = 1000;
const RESUME_FLAG_PREFIX = "--after=";
const FORCE_FLAG = "--force";
// Bump the suffix whenever this backfill's semantics change and it needs to
// run again for rows written before the change.
const MARKER_NAME = "trending-scores-initial-v1";
// Postgres advisory lock key (arbitrary bigint): serializes concurrent deploy
// containers so only one performs the check-and-backfill.
const ADVISORY_LOCK_KEY = 742_193_001;

function parseFlag(argv: string[], prefix: string): string | undefined {
  for (const arg of argv) {
    if (!arg.startsWith(prefix)) {
      continue;
    }
    const value = arg.slice(prefix.length);
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
}

async function ensureMarkerTable(): Promise<void> {
  // Self-managed on purpose: the schema lives outside prisma/schema.prisma so
  // this ops bookkeeping never shows up in client types or db push diffs.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS backfill_markers (
      name TEXT PRIMARY KEY,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function hasMarker(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM backfill_markers WHERE name = ${name}
  `;
  return rows.length > 0;
}

async function recordMarker(name: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO backfill_markers (name) VALUES (${name})
    ON CONFLICT (name) DO NOTHING
  `;
}

// Backfills trendingScore for all non-gust posts in chunks, resuming after
// `resumeAfterId` when provided. Returns the number of batches processed and
// posts updated so tests/wrappers can assert on the outcome.
export async function backfillTrendingScores(options: {
  resumeAfterId?: string;
}): Promise<{ batches: number; postsUpdated: number }> {
  const startedAtMs = Date.now();
  let batches = 0;
  let postsBackfilled = 0;

  // findMany with a cursor pointing at a nonexistent id makes Prisma throw,
  // so verify the resume anchor exists up front and fail with a clear message.
  if (options.resumeAfterId !== undefined) {
    const anchorPost = await prisma.post.findUnique({
      select: { id: true },
      where: { id: options.resumeAfterId },
    });
    if (anchorPost === null) {
      throw new Error(
        `Cannot resume: no post exists with id "${options.resumeAfterId}" (--after). Omit --after to backfill from the beginning.`
      );
    }
  }

  // Keyset cursor: undefined on the very first page, afterwards the id of the
  // last post of the previously fetched page (skipped via `skip: 1`).
  let cursorId = options.resumeAfterId;

  while (true) {
    // eslint-disable-next-line no-await-in-loop -- keyset pagination must fetch each batch sequentially
    const posts = await prisma.post.findMany({
      ...(cursorId === undefined ? {} : { cursor: { id: cursorId }, skip: 1 }),
      orderBy: { id: "asc" },
      select: {
        _count: { select: { bookmarks: true, comments: true } },
        aura: true,
        createdAt: true,
        id: true,
        viewCount: true,
      },
      take: BATCH_SIZE,
      where: { isGust: false },
    });

    if (posts.length === 0) {
      break;
    }

    const scoredPosts = posts.map((post) => ({
      id: post.id,
      score: computeTrendingScore({
        aura: post.aura,
        bookmarkCount: post._count.bookmarks,
        commentCount: post._count.comments,
        createdAt: post.createdAt,
        viewCount: post.viewCount,
      }),
    }));

    const ids = scoredPosts.map((post) => post.id);
    const scores = scoredPosts.map((post) => post.score);

    // eslint-disable-next-line no-await-in-loop -- batches are written in order so an interrupt leaves a clean resume point
    const updatedCount = await prisma.$executeRaw`
      UPDATE posts AS p
      SET "trendingScore" = v.score
      FROM unnest(
        ${ids}::text[],
        ${scores}::float8[]
      ) AS v(id, score)
      WHERE p.id = v.id
    `;
    postsBackfilled += updatedCount;
    batches += 1;

    const lastPostInBatch = posts.at(-1);
    if (lastPostInBatch === undefined) {
      break;
    }
    cursorId = lastPostInBatch.id;

    if (batches % LOG_EVERY_BATCHES === 0) {
      console.log(
        `[backfill] ${batches} batches done, ${postsBackfilled} posts updated; last processed post id: ${cursorId}`
      );
      console.log(
        `[backfill] to resume from here: bun scripts/backfill-trending-scores.ts --after=${cursorId}`
      );
    }

    if (posts.length < BATCH_SIZE) {
      break;
    }
  }

  const elapsedSeconds = ((Date.now() - startedAtMs) / MS_PER_SECOND).toFixed(
    2
  );
  console.log(
    `[backfill] complete: ${postsBackfilled} posts updated across ${batches} batches in ${elapsedSeconds}s`
  );

  return { batches, postsUpdated: postsBackfilled };
}

// Deploy-safe entrypoint: marker-checked, lock-guarded, single-run. Returns
// whether actual work happened so callers can log accordingly.

const LOCK_WAIT_MS = 1000;
const LOCK_MAX_WAIT_MS = 30_000;

// pg_advisory_lock() returns void, which the pg driver adapter cannot
// deserialize through $queryRaw ("Failed to deserialize column of type
// 'void'"), so the try variant - which returns a real boolean - is used
// instead, wrapped in a short bounded wait to preserve the old
// lose-and-recheck behaviour across concurrent deploy containers.
async function tryAcquireBackfillLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked
  `;
  return rows[0]?.locked === true;
}

async function acquireBackfillLock(): Promise<boolean> {
  let waitedMs = 0;
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- polling is inherently sequential
    const locked = await tryAcquireBackfillLock();
    if (locked) {
      return true;
    }
    if (waitedMs >= LOCK_MAX_WAIT_MS) {
      return false;
    }
    // oxlint-disable-next-line no-await-in-loop -- polling is inherently sequential
    await Bun.sleep(LOCK_WAIT_MS);
    waitedMs += LOCK_WAIT_MS;
  }
}

export async function ensureTrendingScoresBackfilled(options: {
  force?: boolean;
  resumeAfterId?: string;
}): Promise<{ ran: boolean; batches: number; postsUpdated: number }> {
  await ensureMarkerTable();

  // Advisory lock across containers: the loser polls briefly, then sees the
  // winner's marker and skips without touching data.
  const locked = await acquireBackfillLock();
  if (!locked) {
    throw new Error(
      "Could not acquire the backfill advisory lock within 30s - another container is likely mid-backfill. Retry shortly."
    );
  }
  try {
    if (!options.force && (await hasMarker(MARKER_NAME))) {
      console.log("[backfill] already completed previously, skipping");
      return { batches: 0, postsUpdated: 0, ran: false };
    }

    const result = await backfillTrendingScores({
      resumeAfterId: options.resumeAfterId,
    });
    await recordMarker(MARKER_NAME);
    return { ran: true, ...result };
  } finally {
    // pg_advisory_unlock returns boolean, so it deserializes cleanly too.
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY}) AS unlocked`;
  }
}

if (import.meta.main) {
  const resumeAfterId = parseFlag(process.argv, RESUME_FLAG_PREFIX);
  const force = process.argv.includes(FORCE_FLAG);
  if (resumeAfterId !== undefined) {
    console.log(`[backfill] resuming after post id: ${resumeAfterId}`);
  }
  if (force) {
    console.log("[backfill] --force set, ignoring any completion marker");
  }

  let exitCode = 0;
  try {
    await ensureTrendingScoresBackfilled({ force, resumeAfterId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[backfill] failed: ${message}`);
    exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
  // Importing the @asm/db barrel leaves background handles (queue/pool
  // singletons) open, so exit explicitly once the work and disconnect finish.
  process.exit(exitCode);
}
