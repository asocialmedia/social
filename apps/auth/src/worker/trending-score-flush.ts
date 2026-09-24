import {
  and,
  computeTrendingScore,
  fromPrismaDateTime,
  prisma,
  toPrismaDateTime,
} from "@asm/db";
import { publishTrendingSnapshot } from "@asm/db/recommendation/trending-snapshot";

import { resolveLogger, withSpan } from "./log";
import type { WorkerLogger } from "./log";

const BATCH_SIZE = 500;
// Posts older than this decay out of contention anyway; skipping them keeps
// the recompute window (and the table scan) small.
const WINDOW_DAYS = 7;

export interface TrendingScoreFlushResult {
  batches: number;
  postsUpdated: number;
  publishedToSnapshot: number;
}

interface TrendingBatchState {
  batches: number;
  postsUpdated: number;
}

export async function flushTrendingScores(
  logger?: WorkerLogger,
  now?: Date
): Promise<TrendingScoreFlushResult> {
  const log = resolveLogger(logger);
  return await withSpan("trending-score-flush", async () => {
    // One clock for the whole run: window math AND every score decay use
    // the same instant so historical runs and tests stay deterministic.
    const effectiveNow = now ?? new Date();
    const windowStart = new Date(
      effectiveNow.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    const scoredEntries: { id: string; score: number }[] = [];
    const flushNextBatch = async (
      cursorId: string | undefined,
      batches: number,
      postsUpdated: number
    ): Promise<TrendingBatchState> => {
      let postsQuery = prisma.orm.public.Posts.select(
        "aura",
        "createdAt",
        "id",
        "viewCount"
      )
        .include("bookmarks", (bookmarks) => bookmarks.count())
        .include("comments", (comments) => comments.count())
        .where((post) =>
          and(
            post.createdAt.gte(toPrismaDateTime(windowStart)),
            post.rootPostId.isNull()
          )
        )
        .orderBy((post) => post.id.asc())
        .limit(BATCH_SIZE);
      if (cursorId) {
        postsQuery = postsQuery.cursor({ id: cursorId });
      }
      const posts = await postsQuery.all();
      if (posts.length === 0) {
        return { batches, postsUpdated };
      }

      const scored = posts.map((post) => ({
        id: post.id,
        score: computeTrendingScore({
          aura: post.aura,
          bookmarkCount: post.bookmarks,
          commentCount: post.comments,
          createdAt: fromPrismaDateTime(post.createdAt),
          now: effectiveNow,
          viewCount: post.viewCount,
        }),
      }));
      await prisma.transaction(async (tx) => {
        let updates: Promise<unknown> = Promise.resolve();
        for (const entry of scored) {
          updates = updates.then(() =>
            tx.orm.public.Posts.where({ id: entry.id }).update({
              trendingScore: entry.score,
            })
          );
        }
        await updates;
      });

      scoredEntries.push(...scored);
      const nextState = {
        batches: batches + 1,
        postsUpdated: postsUpdated + posts.length,
      };
      const nextCursor = posts.at(-1)?.id;
      if (posts.length < BATCH_SIZE || !nextCursor) {
        return nextState;
      }
      return flushNextBatch(
        nextCursor,
        nextState.batches,
        nextState.postsUpdated
      );
    };

    const { batches, postsUpdated } = await flushNextBatch(undefined, 0, 0);

    // Best-effort: the trending route falls back to live Postgres ordering
    // whenever no snapshot is available, so a failed publish only costs
    // scroll stability until the next run, never availability.
    let publishedToSnapshot = 0;
    try {
      publishedToSnapshot = await publishTrendingSnapshot(scoredEntries);
    } catch (error) {
      log.warn({ error }, "trending snapshot publish failed");
    }

    log.info(
      { batches, postsUpdated, publishedToSnapshot },
      "trending scores flushed"
    );
    return { batches, postsUpdated, publishedToSnapshot };
  });
}
