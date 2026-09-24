import {
  and,
  getBlockingRedisClient,
  prisma,
  redis,
  SHARE_CONSUMER_PREFIX,
  SHARE_GROUP,
  SHARE_STREAM,
  computeShareMilestoneAura,
} from "@asm/db";

import { resolveLogger, withSpan } from "./log";
import type { WorkerLogger } from "./log";

const BATCH_SIZE = 500;
const BLOCK_MS = 2000;

const SHARE_STATS_PREFIX = "share:stats:";
const SHARE_CLICKS_PREFIX = "share:clicks:";

interface ShareDelta {
  clicks: number;
  platform: string;
  postId: string;
  shares: number;
}

interface ShareAward {
  amount: number;
  postId: string;
  userId: string;
}

class ConcurrentShareUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentShareUpdateError";
  }
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (error instanceof ConcurrentShareUpdateError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  if ("sqlState" in error) {
    return (
      error.sqlState === "23505" ||
      error.sqlState === "40001" ||
      error.sqlState === "40P01"
    );
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

// Awards view-style attention milestones when a post's TOTAL share count
// crosses a tier. Shares carry no per-user actor (they are aggregated per
// platform), so like view milestones these are attributed to aggregate
// attention, bypass weighting/tapering/capping, and are fully ledgered.
async function awardShareMilestones(
  postIds: string[],
  log: WorkerLogger
): Promise<void> {
  if (postIds.length === 0) {
    return;
  }

  const awardedPosts = await runTransactionWithRetry(() =>
    prisma.transaction(async (tx) => {
      const posts = await tx.orm.public.Posts.select(
        "id",
        "lastAwardedShareCount",
        "userId"
      )
        .where((post) => post.id.in(postIds))
        .all();

      const totals = await tx.orm.public.ShareStats.where((stats) =>
        stats.postId.in(postIds)
      )
        .groupBy("postId")
        .aggregate((aggregate) => ({ shares: aggregate.sum("shares") }));
      const totalByPost = new Map(
        totals.map((row) => [row.postId, row.shares ?? 0])
      );
      let awardsPromise = Promise.resolve<ShareAward[]>([]);

      for (const post of posts) {
        awardsPromise = awardsPromise.then(async (awards) => {
          const totalShares = totalByPost.get(post.id) ?? 0;
          const { aura } = computeShareMilestoneAura(
            post.lastAwardedShareCount,
            totalShares
          );
          if (aura <= 0) {
            return awards;
          }
          const claimed = await tx.orm.public.Posts.where((candidate) =>
            and(
              candidate.id.eq(post.id),
              candidate.lastAwardedShareCount.eq(post.lastAwardedShareCount)
            )
          ).updateAndCount({ lastAwardedShareCount: totalShares });
          if (claimed === 1) {
            awards.push({
              amount: aura,
              postId: post.id,
              userId: post.userId,
            });
          }
          return awards;
        });
      }
      const awards = await awardsPromise;

      const auraByUser = new Map<string, number>();
      for (const award of awards) {
        auraByUser.set(
          award.userId,
          (auraByUser.get(award.userId) ?? 0) + award.amount
        );
      }

      let userUpdates = Promise.resolve();
      for (const [userId, auraDelta] of auraByUser) {
        userUpdates = userUpdates.then(async () => {
          const user = await tx.orm.public.Users.select("aura")
            .where({ id: userId })
            .first();
          if (!user) {
            throw new ConcurrentShareUpdateError(
              "share milestone user missing"
            );
          }
          const claimed = await tx.orm.public.Users.where((candidate) =>
            and(candidate.id.eq(userId), candidate.aura.eq(user.aura))
          ).updateAndCount({ aura: user.aura + auraDelta });
          if (claimed !== 1) {
            throw new ConcurrentShareUpdateError("user aura changed");
          }
        });
      }
      await userUpdates;

      if (awards.length > 0) {
        await tx.orm.public.AuraLogs.createAll(
          awards.map((award) => ({
            _type: "SHARE_MILESTONE" as const,
            amount: award.amount,
            issuerId: award.userId,
            postId: award.postId,
            targetUserId: award.userId,
            userId: award.userId,
          }))
        );
      }

      return awards.length;
    })
  );

  log.info({ awardedPosts }, "share milestones awarded");
}

// Reads and clears the buffered share/click counters for a post+platform and
// applies them to the ShareStats table. Exporting for tests.
export async function flushShareDeltas(
  keys: { postId: string; platform: string }[],
  logger?: WorkerLogger
): Promise<number> {
  const log = resolveLogger(logger);
  if (keys.length === 0) {
    return 0;
  }

  return await withSpan(
    "share-flush",
    async () => {
      const pipeline = redis.pipeline();
      for (const { postId, platform } of keys) {
        pipeline.getdel(`${SHARE_STATS_PREFIX}${postId}:${platform}`);
        pipeline.getdel(`${SHARE_CLICKS_PREFIX}${postId}:${platform}`);
      }
      const counters = await pipeline.exec();

      const deltas: ShareDelta[] = [];
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const shareValue = counters?.[index * 2]?.[1];
        const clickValue = counters?.[index * 2 + 1]?.[1];
        const shares = Math.trunc(Number(String(shareValue ?? "0")));
        const clicks = Math.trunc(Number(String(clickValue ?? "0")));
        if (shares > 0 || clicks > 0) {
          deltas.push({ ...key, clicks, shares });
        }
      }

      if (deltas.length === 0) {
        return 0;
      }

      const shareRowsByKey = new Map<string, ShareDelta>();
      for (const delta of deltas) {
        const key = `${delta.postId}\u0000${delta.platform}`;
        const existing = shareRowsByKey.get(key);
        shareRowsByKey.set(key, {
          clicks: delta.clicks + (existing?.clicks ?? 0),
          platform: delta.platform,
          postId: delta.postId,
          shares: delta.shares + (existing?.shares ?? 0),
        });
      }

      await runTransactionWithRetry(() =>
        prisma.transaction(async (tx) => {
          let statUpdates = Promise.resolve();
          for (const row of shareRowsByKey.values()) {
            statUpdates = statUpdates.then(async () => {
              const existing = await tx.orm.public.ShareStats.select(
                "clicks",
                "shares"
              )
                .where({ platform: row.platform, postId: row.postId })
                .first();
              if (!existing) {
                await tx.orm.public.ShareStats.create({
                  clicks: row.clicks,
                  platform: row.platform,
                  postId: row.postId,
                  shares: row.shares,
                });
                return;
              }
              const claimed = await tx.orm.public.ShareStats.where((stats) =>
                and(
                  stats.postId.eq(row.postId),
                  stats.platform.eq(row.platform),
                  stats.shares.eq(existing.shares),
                  stats.clicks.eq(existing.clicks)
                )
              ).updateAndCount({
                clicks: existing.clicks + row.clicks,
                shares: existing.shares + row.shares,
              });
              if (claimed !== 1) {
                throw new ConcurrentShareUpdateError("share stats changed");
              }
            });
          }
          await statUpdates;
        })
      );

      await awardShareMilestones(
        [...new Set(deltas.map((delta) => delta.postId))],
        log
      );

      log.info(
        {
          flushedRecords: deltas.length,
          posts: new Set(deltas.map((delta) => delta.postId)).size,
        },
        "share stats flushed"
      );

      return deltas.length;
    },
    { "batch.size": keys.length }
  );
}

interface ShareEvent {
  kind: "share" | "click";
  platform: string;
  postId: string;
}

function parseShareEventFields(fields: string[] | null): ShareEvent | null {
  if (!fields) {
    return null;
  }
  const event: Partial<ShareEvent> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1] as string;
    if (key === "postId") {
      event.postId = value;
    }
    if (key === "platform") {
      event.platform = value;
    }
    if (key === "kind") {
      event.kind = value as ShareEvent["kind"];
    }
  }
  if (event.postId && event.platform && event.kind) {
    return event as ShareEvent;
  }
  return null;
}

// Blocks on the share stream and flushes whatever arrives. Returns the number
// of entries consumed.
export async function consumeShareStream(
  consumerName: string,
  logger?: WorkerLogger
): Promise<number> {
  const log = resolveLogger(logger);
  const blockingClient = getBlockingRedisClient();
  const entries = await blockingClient.xreadgroup(
    "GROUP",
    SHARE_GROUP,
    consumerName,
    "COUNT",
    BATCH_SIZE,
    "BLOCK",
    BLOCK_MS,
    "STREAMS",
    SHARE_STREAM,
    ">"
  );

  if (!entries || entries.length === 0) {
    return 0;
  }

  const [stream] = entries;
  const items = stream?.[1] ?? [];
  const entryIds: string[] = [];
  const events: ShareEvent[] = [];

  for (const [entryId, fields] of items) {
    entryIds.push(entryId);
    const event = parseShareEventFields(fields);
    if (event) {
      events.push(event);
    }
  }

  // One counter pair per post+platform, so dedupe before flushing.
  const seen = new Set<string>();
  const uniqueKeys: { postId: string; platform: string }[] = [];
  for (const event of events) {
    const dedupeKey = `${event.postId}:${event.platform}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      uniqueKeys.push({ platform: event.platform, postId: event.postId });
    }
  }

  await flushShareDeltas(uniqueKeys, log);

  if (entryIds.length > 0) {
    await redis.xack(SHARE_STREAM, SHARE_GROUP, ...entryIds);
  }

  log.debug(
    { entries: entryIds.length, uniqueKeys: uniqueKeys.length },
    "share stream batch"
  );
  return entryIds.length;
}

export function createShareConsumer() {
  return consumeShareStream.bind(
    null,
    `${SHARE_CONSUMER_PREFIX}-${process.pid}`
  );
}
