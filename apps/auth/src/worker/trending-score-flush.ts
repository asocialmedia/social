import { computeTrendingScore, prisma } from "@asm/db";

import { resolveLogger, withSpan } from "./log";
import type { WorkerLogger } from "./log";

const BATCH_SIZE = 500;
// Posts older than this decay out of contention anyway; skipping them keeps
// the recompute window (and the table scan) small.
const WINDOW_DAYS = 7;

export interface TrendingScoreFlushResult {
  batches: number;
  postsUpdated: number;
}

// Recomputes the time-decayed trending score for every post created within
// the window, in id-keyset batches, writing scores with one parameterized
// bulk UPDATE per batch (never a whole-table scan).
export async function flushTrendingScores(
  logger?: WorkerLogger,
  now?: Date
): Promise<TrendingScoreFlushResult> {
  const log = resolveLogger(logger);
  return await withSpan("trending-score-flush", async () => {
    const windowStart = new Date(
      (now ?? new Date()).getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    let cursorId: string | undefined;
    let batches = 0;
    let postsUpdated = 0;

    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- keyset pagination must await each batch
      const posts = await prisma.post.findMany({
        orderBy: { id: "asc" },
        select: {
          _count: { select: { bookmarks: true, comments: true } },
          aura: true,
          createdAt: true,
          id: true,
          viewCount: true,
        },
        take: BATCH_SIZE,
        where: { createdAt: { gte: windowStart } },
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (posts.length === 0) {
        break;
      }

      const ids = posts.map((post) => post.id);
      const scores = posts.map((post) =>
        computeTrendingScore({
          aura: post.aura,
          bookmarkCount: post._count.bookmarks,
          commentCount: post._count.comments,
          createdAt: post.createdAt,
          viewCount: post.viewCount,
        })
      );

      // eslint-disable-next-line no-await-in-loop -- each batch must persist before advancing the cursor
      await prisma.$executeRaw`
        UPDATE posts AS p
        SET "trendingScore" = v.score
        FROM unnest(
          ${ids}::text[],
          ${scores}::float8[]
        ) AS v(id, score)
        WHERE p.id = v.id
      `;

      batches += 1;
      postsUpdated += posts.length;
      cursorId = posts.at(-1)?.id;
      if (posts.length < BATCH_SIZE) {
        break;
      }
    }

    log.info({ batches, postsUpdated }, "trending scores flushed");
    return { batches, postsUpdated };
  });
}
