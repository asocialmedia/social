import {
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

  // Everything happens inside one transaction: reads, the compare-and-set on
  // lastAwardedShareCount, and the payouts. A concurrent flush either wins
  // the CAS (and pays) or sees stale counts and skips - never both.
  await prisma.$transaction(async (tx) => {
    const posts = await tx.post.findMany({
      select: { id: true, lastAwardedShareCount: true, userId: true },
      where: { id: { in: postIds } },
    });

    const totals = await tx.shareStats.groupBy({
      _sum: { shares: true },
      by: ["postId"],
      where: { postId: { in: postIds } },
    });
    const totalByPost = new Map(
      totals.map((row) => [row.postId, row._sum.shares ?? 0])
    );

    let claimed = 0;
    for (const post of posts) {
      const totalShares = totalByPost.get(post.id) ?? 0;
      const { aura } = computeShareMilestoneAura(
        post.lastAwardedShareCount,
        totalShares
      );
      if (aura <= 0) {
        continue;
      }

      // Compare-and-set: only the flush that transitions THIS previously
      // awarded count may pay for it. Losers skip without double-paying.
      // oxlint-disable-next-line no-await-in-loop -- each claim must settle before evaluating the next post's award against committed state
      const claimedRow = await tx.post.updateMany({
        data: { lastAwardedShareCount: totalShares },
        where: {
          id: post.id,
          lastAwardedShareCount: post.lastAwardedShareCount,
        },
      });
      if (claimedRow.count !== 1) {
        continue;
      }

      // Attention milestones are the only positive awards allowed to bypass
      // the daily income cap, so they increment directly here (mirroring
      // view-flush's batched raw-SQL path).
      // oxlint-disable-next-line no-await-in-loop -- sequential within the claiming transaction by design
      await tx.user.update({
        data: { aura: { increment: aura } },
        where: { id: post.userId },
      });
      // oxlint-disable-next-line no-await-in-loop -- ledger row pairs with the payout above
      await tx.auraLog.create({
        data: {
          amount: aura,
          issuerId: post.userId,
          postId: post.id,
          targetUserId: post.userId,
          type: "SHARE_MILESTONE",
          userId: post.userId,
        },
      });
      claimed += 1;
    }

    log.info({ awardedPosts: claimed }, "share milestones awarded");
  });
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

      await prisma.$transaction(
        deltas.map(({ postId, platform, shares, clicks }) =>
          prisma.shareStats.upsert({
            create: { clicks, platform, postId, shares },
            update: {
              clicks: { increment: clicks },
              shares: { increment: shares },
            },
            where: { postId_platform: { platform, postId } },
          })
        )
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
