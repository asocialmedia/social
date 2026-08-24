import {
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

      const posts = await prisma.post.findMany({
        select: {
          id: true,
          lastAwardedViewCount: true,
          userId: true,
          viewCount: true,
        },
        where: { id: { in: deltas.map((d) => d.postId) } },
      });

      const postMap = new Map(posts.map((post) => [post.id, post]));

      const updates: {
        id: string;
        userId: string;
        viewCount: number;
        lastAwardedViewCount: number;
        auraDelta: number;
      }[] = [];

      for (const { postId, delta } of deltas) {
        const post = postMap.get(postId);
        if (!post) {
          continue;
        }
        const newTotal = post.viewCount + delta;
        const { aura, lastAwardedViewCount } = computeViewAura(
          post.lastAwardedViewCount,
          newTotal
        );
        updates.push({
          auraDelta: aura,
          id: postId,
          lastAwardedViewCount,
          userId: post.userId,
          viewCount: newTotal,
        });
      }

      if (updates.length === 0) {
        return result;
      }

      await prisma.$transaction(async (tx) => {
        const postIdsParam = updates.map((u) => u.id);
        const deltasParam = updates.map((u) => u.viewCount);
        const lastAwardedParam = updates.map((u) => u.lastAwardedViewCount);
        const auraDeltaParam = updates.map((u) => u.auraDelta);

        await tx.$executeRaw`
          UPDATE posts AS p
          SET "viewCount" = v.view_count,
              "lastAwardedViewCount" = v.last_awarded_view_count,
              aura = p.aura + v.aura_delta
          FROM unnest(
            ${postIdsParam}::text[],
            ${deltasParam}::int[],
            ${lastAwardedParam}::int[],
            ${auraDeltaParam}::int[]
          ) AS v(id, view_count, last_awarded_view_count, aura_delta)
          WHERE p.id = v.id
        `;

        const auraUsers = updates
          .filter((u) => u.auraDelta > 0)
          .map((u) => ({ auraDelta: u.auraDelta, userId: u.userId }));

        if (auraUsers.length > 0) {
          const userIdsParam = auraUsers.map((u) => u.userId);
          const auraDeltasParam = auraUsers.map((u) => u.auraDelta);
          await tx.$executeRaw`
            UPDATE users AS u
            SET aura = u.aura + v.aura_delta
            FROM unnest(${userIdsParam}::text[], ${auraDeltasParam}::int[])
            AS v(id, aura_delta)
            WHERE u.id = v.id
          `;

          await tx.auraLog.createMany({
            data: updates
              .filter((u) => u.auraDelta > 0)
              .map((u) => ({
                amount: u.auraDelta,
                issuerId: u.userId,
                postId: u.id,
                targetUserId: u.userId,
                type: "POST_VIEWS_MILESTONE",
                userId: u.userId,
              })),
          });
        }
      });

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
