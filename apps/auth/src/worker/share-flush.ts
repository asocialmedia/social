import {
  getBlockingRedisClient,
  prisma,
  redis,
  SHARE_CONSUMER_PREFIX,
  SHARE_GROUP,
  SHARE_STREAM,
} from "@asm/db";
import { resolveLogger, type WorkerLogger, withSpan } from "./log";

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

// Reads and clears the buffered share/click counters for a post+platform and
// applies them to the ShareStats table. Exporting for tests.
export async function flushShareDeltas(
  keys: Array<{ postId: string; platform: string }>,
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
      keys.forEach((key, index) => {
        const shareValue = counters?.[index * 2]?.[1];
        const clickValue = counters?.[index * 2 + 1]?.[1];
        const shares = Number.parseInt(String(shareValue ?? "0"), 10);
        const clicks = Number.parseInt(String(clickValue ?? "0"), 10);
        if (shares > 0 || clicks > 0) {
          deltas.push({ ...key, shares, clicks });
        }
      });

      if (deltas.length === 0) {
        return 0;
      }

      await prisma.$transaction(
        deltas.map(({ postId, platform, shares, clicks }) =>
          prisma.shareStats.upsert({
            where: { postId_platform: { postId, platform } },
            create: { postId, platform, shares, clicks },
            update: {
              shares: { increment: shares },
              clicks: { increment: clicks },
            },
          })
        )
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
  const uniqueKeys: Array<{ postId: string; platform: string }> = [];
  for (const event of events) {
    const dedupeKey = `${event.postId}:${event.platform}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      uniqueKeys.push({ postId: event.postId, platform: event.platform });
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
