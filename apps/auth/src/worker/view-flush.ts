import {
  and,
  getBlockingRedisClient,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
  VIEWS_CONSUMER_PREFIX,
  VIEWS_GROUP,
  VIEWS_STREAM,
  computeViewMilestoneAura,
} from "@asm/db";

import { resolveLogger, withSpan } from "./log";
import type { WorkerLogger } from "./log";

const BATCH_SIZE = 500;
const BLOCK_MS = 2000;

// Aura is awarded per milestone tier crossed between the last awarded view
// count and the new total. The tier table lives in the aura economy config;
// this wrapper keeps the historical return shape for callers and tests.
export function computeViewAura(
  lastAwarded: number,
  newTotal: number
): { aura: number; lastAwardedViewCount: number } {
  const { aura } = computeViewMilestoneAura(lastAwarded, newTotal);
  return { aura, lastAwardedViewCount: newTotal };
}

interface ViewDelta {
  delta: number;
  postId: string;
}

interface FlushResult {
  auraAwarded: number;
  deletedKeys: number;
  flushedPosts: number;
}

interface ViewUpdate {
  auraDelta: number;
  id: string;
  lastAwardedViewCount: number;
  userId: string;
  viewCount: number;
}

class ConcurrentUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentUpdateError";
  }
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (error instanceof ConcurrentUpdateError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  if ("sqlState" in error) {
    return error.sqlState === "40001" || error.sqlState === "40P01";
  }
  return error.message.includes("could not serialize");
}

async function runTransactionWithRetry<T>(
  operation: () => Promise<T>,
  attemptsRemaining = 4
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableTransactionConflict(error) || attemptsRemaining <= 1) {
      throw error;
    }
    return await runTransactionWithRetry(operation, attemptsRemaining - 1);
  }
}

// Reads the buffered view counters for the given post ids (GETDEL) and applies
// the deltas to Postgres, awarding view-milestone aura in the same batch.
export async function flushViewDeltas(
  postIds: string[],
  logger?: WorkerLogger
): Promise<FlushResult> {
  const log = resolveLogger(logger);
  const result: FlushResult = {
    auraAwarded: 0,
    deletedKeys: 0,
    flushedPosts: 0,
  };

  const uniqueIds = [...new Set(postIds)];
  if (uniqueIds.length === 0) {
    return result;
  }

  return await withSpan(
    "view-flush",
    async () => {
      const pipeline = redis.pipeline();
      for (const postId of uniqueIds) {
        pipeline.getdel(`${POST_VIEWS_KEY_PREFIX}${postId}`);
      }
      const counters = await pipeline.exec();

      const deltas: ViewDelta[] = [];
      for (let index = 0; index < uniqueIds.length; index += 1) {
        const postId = uniqueIds[index];
        const value = counters?.[index]?.[1];
        const delta = Math.trunc(Number(String(value ?? "0")));
        if (delta > 0) {
          deltas.push({ delta, postId });
        }
      }

      if (deltas.length === 0) {
        return result;
      }

      const updates = await runTransactionWithRetry(() =>
        prisma.transaction(async (tx) => {
          const posts = await tx.orm.public.Posts.select(
            "aura",
            "id",
            "lastAwardedViewCount",
            "userId",
            "viewCount"
          )
            .where((post) => post.id.in(deltas.map((delta) => delta.postId)))
            .all();
          const postMap = new Map(posts.map((post) => [post.id, post]));
          const auraByUser = new Map<string, number>();
          const auraAwards: {
            amount: number;
            postId: string;
            userId: string;
          }[] = [];
          let nextUpdatesPromise = Promise.resolve<ViewUpdate[]>([]);

          for (const { postId, delta } of deltas) {
            nextUpdatesPromise = nextUpdatesPromise.then(
              async (nextUpdates) => {
                const post = postMap.get(postId);
                if (!post) {
                  return nextUpdates;
                }
                const newTotal = post.viewCount + delta;
                const { aura, lastAwardedViewCount } = computeViewAura(
                  post.lastAwardedViewCount,
                  newTotal
                );
                const claimed = await tx.orm.public.Posts.where((candidate) =>
                  and(
                    candidate.id.eq(post.id),
                    candidate.aura.eq(post.aura),
                    candidate.viewCount.eq(post.viewCount),
                    candidate.lastAwardedViewCount.eq(post.lastAwardedViewCount)
                  )
                ).updateAndCount({
                  aura: post.aura + aura,
                  lastAwardedViewCount,
                  viewCount: newTotal,
                });
                if (claimed !== 1) {
                  throw new ConcurrentUpdateError("post view state changed");
                }
                nextUpdates.push({
                  auraDelta: aura,
                  id: postId,
                  lastAwardedViewCount,
                  userId: post.userId,
                  viewCount: newTotal,
                });
                if (aura > 0) {
                  auraByUser.set(
                    post.userId,
                    (auraByUser.get(post.userId) ?? 0) + aura
                  );
                  auraAwards.push({
                    amount: aura,
                    postId,
                    userId: post.userId,
                  });
                }
                return nextUpdates;
              }
            );
          }
          const nextUpdates = await nextUpdatesPromise;

          let userUpdates = Promise.resolve();
          for (const [userId, auraDelta] of auraByUser) {
            userUpdates = userUpdates.then(async () => {
              const user = await tx.orm.public.Users.select("aura")
                .where({ id: userId })
                .first();
              if (!user) {
                throw new ConcurrentUpdateError("view milestone user missing");
              }
              const claimed = await tx.orm.public.Users.where((candidate) =>
                and(candidate.id.eq(userId), candidate.aura.eq(user.aura))
              ).updateAndCount({ aura: user.aura + auraDelta });
              if (claimed !== 1) {
                throw new ConcurrentUpdateError("user aura changed");
              }
            });
          }
          await userUpdates;

          if (auraAwards.length > 0) {
            await tx.orm.public.AuraLogs.createAll(
              auraAwards.map((award) => ({
                _type: "POST_VIEWS_MILESTONE" as const,
                amount: award.amount,
                issuerId: award.userId,
                postId: award.postId,
                targetUserId: award.userId,
                userId: award.userId,
              }))
            );
          }

          return nextUpdates;
        })
      );

      if (updates.length === 0) {
        return result;
      }

      result.flushedPosts = updates.length;
      result.auraAwarded = updates.reduce((sum, u) => sum + u.auraDelta, 0);

      const clearedPipeline = redis.pipeline();
      for (const postId of uniqueIds) {
        clearedPipeline.srem(POST_VIEWS_SET, postId);
      }
      await clearedPipeline.exec();
      result.deletedKeys = uniqueIds.length;

      log.info(
        {
          auraAwarded: result.auraAwarded,
          batchSize: uniqueIds.length,
          flushedPosts: result.flushedPosts,
        },
        "view counts flushed"
      );

      return result;
    },
    {
      "batch.size": uniqueIds.length,
    }
  );
}

// Blocks on the view stream and flushes whatever arrives. Returns the number
// of entries consumed. Called in a loop by the worker.
export async function consumeViewStream(
  consumerName: string,
  logger?: WorkerLogger
): Promise<number> {
  const log = resolveLogger(logger);
  const blockingClient = getBlockingRedisClient();
  const entries = await blockingClient.xreadgroup(
    "GROUP",
    VIEWS_GROUP,
    consumerName,
    "COUNT",
    BATCH_SIZE,
    "BLOCK",
    BLOCK_MS,
    "STREAMS",
    VIEWS_STREAM,
    ">"
  );

  if (!entries || entries.length === 0) {
    return 0;
  }

  const [stream] = entries;
  const items = stream?.[1] ?? [];
  const entryIds: string[] = [];
  const postIds: string[] = [];

  for (const [entryId, fields] of items) {
    entryIds.push(entryId);
    if (!fields) {
      continue;
    }
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] === "postId") {
        postIds.push(fields[i + 1] as string);
      }
    }
  }

  await flushViewDeltas(postIds, log);

  if (entryIds.length > 0) {
    await redis.xack(VIEWS_STREAM, VIEWS_GROUP, ...entryIds);
  }

  log.debug(
    { entries: entryIds.length, posts: postIds.length },
    "view stream batch"
  );
  return entryIds.length;
}

export function createViewConsumer() {
  return consumeViewStream.bind(
    null,
    `${VIEWS_CONSUMER_PREFIX}-${process.pid}`
  );
}
