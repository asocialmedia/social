#!/usr/bin/env bun

import { and, computeTrendingScore, fromPrismaDateTime, prisma } from "@asm/db";

const BATCH_SIZE = 500;
const LOG_EVERY_BATCHES = 20;
const MS_PER_SECOND = 1000;
const RESUME_FLAG_PREFIX = "--after=";

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

export async function syncTrendingScores(
  options: { resumeAfterId?: string } = {}
): Promise<{ batches: number; postsUpdated: number }> {
  const startedAtMs = Date.now();
  let batches = 0;
  let postsSynced = 0;
  let cursorId = options.resumeAfterId;

  if (cursorId !== undefined) {
    const resumeAfterId = cursorId;
    const anchorPost = await prisma.orm.public.Posts.select("id")
      .where((post) => post.id.eq(resumeAfterId))
      .first();
    if (anchorPost === null) {
      throw new Error(
        `Cannot resume: no post exists with id "${cursorId}" (--after). Omit --after to sync from the beginning.`
      );
    }
  }

  while (true) {
    const activeCursorId = cursorId;
    const batch = await prisma.transaction(async (transaction) => {
      const posts = await transaction.orm.public.Posts.select(
        "aura",
        "createdAt",
        "id",
        "viewCount"
      )
        .include("bookmarks", (bookmarks) =>
          bookmarks.combine({ total: bookmarks.count() })
        )
        .include("comments", (comments) => comments.count())
        .where((post) =>
          activeCursorId === undefined
            ? post.isGust.eq(false)
            : and(post.isGust.eq(false), post.id.gt(activeCursorId))
        )
        .orderBy((post) => post.id.asc())
        .limit(BATCH_SIZE)
        .all();

      if (posts.length === 0) {
        return { posts, updatedCount: 0 };
      }

      const scoredPosts = posts.map((post) => ({
        id: post.id,
        score: computeTrendingScore({
          aura: post.aura,
          bookmarkCount: post.bookmarks.total,
          commentCount: post.comments,
          createdAt: fromPrismaDateTime(post.createdAt),
          viewCount: post.viewCount,
        }),
      }));
      let updatedCount = 0;

      for (const scoredPost of scoredPosts) {
        updatedCount += await transaction.orm.public.Posts.where((post) =>
          post.id.eq(scoredPost.id)
        ).updateAndCount({ trendingScore: scoredPost.score });
      }

      return { posts, updatedCount };
    });

    if (batch.posts.length === 0) {
      break;
    }

    postsSynced += batch.updatedCount;
    batches += 1;

    const lastPostInBatch = batch.posts.at(-1);
    if (lastPostInBatch === undefined) {
      break;
    }
    cursorId = lastPostInBatch.id;

    if (batches % LOG_EVERY_BATCHES === 0) {
      console.log(
        `[sync-scores] ${batches} batches done, ${postsSynced} posts updated; last processed post id: ${cursorId}`
      );
      console.log(
        `[sync-scores] to resume from here: bun scripts/sync-trending-scores.ts --after=${cursorId}`
      );
    }

    if (batch.posts.length < BATCH_SIZE) {
      break;
    }
  }

  const elapsedSeconds = ((Date.now() - startedAtMs) / MS_PER_SECOND).toFixed(
    2
  );
  console.log(
    `[sync-scores] complete: ${postsSynced} posts updated across ${batches} batches in ${elapsedSeconds}s`
  );

  return { batches, postsUpdated: postsSynced };
}

export async function ensureTrendingScoresSynced(
  options: { resumeAfterId?: string } = {}
): Promise<{ ran: boolean; batches: number; postsUpdated: number }> {
  const result = await syncTrendingScores({
    resumeAfterId: options.resumeAfterId,
  });
  return { ran: true, ...result };
}

if (import.meta.main) {
  const resumeAfterId = parseFlag(process.argv, RESUME_FLAG_PREFIX);
  if (resumeAfterId !== undefined) {
    console.log(`[sync-scores] resuming after post id: ${resumeAfterId}`);
  }

  let exitCode = 0;
  try {
    await ensureTrendingScoresSynced({ resumeAfterId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sync-scores] failed: ${message}`);
    exitCode = 1;
  } finally {
    await prisma.close();
  }
  process.exit(exitCode);
}
