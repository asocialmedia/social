#!/usr/bin/env bun

// One-shot backfill for Post.trendingScore: computes the initial trending
// score for every non-gust post from its current aura / view / bookmark /
// comment signals using the pure computeTrendingScore() helper from @asm/db.
//
// Run:
//   bun scripts/backfill-trending-scores.ts
//
// Posts are walked with keyset pagination (order by id asc) in BATCH_SIZE
// chunks and each chunk is written with a single parameterized unnest UPDATE,
// so an interrupted run leaves no half-written batch behind. To resume after
// an interruption, rerun with the last post id printed by the previous run:
//   bun scripts/backfill-trending-scores.ts --after=<postId>

import { computeTrendingScore, prisma } from "@asm/db";

const BATCH_SIZE = 500;
const LOG_EVERY_BATCHES = 20;
const MS_PER_SECOND = 1000;
const RESUME_FLAG_PREFIX = "--after=";

function parseResumeAfterId(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (!arg.startsWith(RESUME_FLAG_PREFIX)) {
      continue;
    }
    const value = arg.slice(RESUME_FLAG_PREFIX.length);
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
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

if (import.meta.main) {
  const resumeAfterId = parseResumeAfterId(process.argv);
  if (resumeAfterId !== undefined) {
    console.log(`[backfill] resuming after post id: ${resumeAfterId}`);
  }

  let exitCode = 0;
  try {
    await backfillTrendingScores({ resumeAfterId });
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
