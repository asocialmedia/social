import { Queue } from "bullmq";

import { keys } from "./keys";
import { redis } from "./src/redis";

// High-frequency counters (post views, share stats) are buffered in Redis
// Streams and drained by the worker; those helpers live in src/redis.ts.
// BullMQ is used for the lower-frequency, individual work items: media
// lifecycle, inactive-user cleanup, and the maintenance sweep.

const { REDIS_URL } = keys;

function bullConnection() {
  return { maxRetriesPerRequest: null, url: REDIS_URL };
}

export interface MediaCleanupJobData {
  mediaId: string;
}
export interface PostDeletedJobData {
  postId: string;
  /**
   * Attachment ids captured BEFORE the post row is deleted. The Prisma client
   * removes attachment rows during post deletion (emulated referential
   * action), so a worker that queries by postId afterwards finds nothing.
   */
  mediaIds?: string[];
  /**
   * Every storage object key referenced by the deleted post's attachments -
   * originals, quarantine leftovers, thumbnails, and all derivative variants
   * - also captured before deletion, since keys live on the (vanishing)
   * rows. The worker deletes these directly; row lookups remain only as a
   * legacy fallback for events queued before this field existed.
   */
  objectKeys?: string[];
}

export type ContentEvent =
  | { type: "post-deleted"; postId: string }
  | { type: "notification-created"; recipientId: string }
  | { type: "notification-deleted"; recipientId: string };

// Queues are created lazily and memoized so importing this module from the
// web app does not open Redis connections until something is actually
// enqueued.
const queueInstances = new Map<string, Queue>();

function getQueue(name: string): Queue {
  let queue = queueInstances.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: bullConnection() });
    queueInstances.set(name, queue);
  }
  return queue;
}

const MEDIA_QUEUE = "media";
const CONTENT_EVENTS_QUEUE = "content-events";
const MAINTENANCE_QUEUE = "maintenance";

// The worker increments this when a notification is created, and the web app
// resets it when the user marks notifications as read. This removes the
// 60s polling lag on the bell badge.
const UNREAD_NOTIFICATION_PREFIX = "unread:notif:";

export const unreadNotificationCache = {
  async decrement(userId: string, amount = 1): Promise<number> {
    try {
      // Lua clamps the result at zero so deletes can never drive the badge
      // negative even if the notification was already marked read.
      const script = `
        local current = tonumber(redis.call('get', KEYS[1]) or '0')
        local next = math.max(0, current - tonumber(ARGV[1]))
        if next > 0 then
          redis.call('set', KEYS[1], next)
        else
          redis.call('del', KEYS[1])
        end
        return next
      `;
      return (await redis.eval(
        script,
        1,
        `${UNREAD_NOTIFICATION_PREFIX}${userId}`,
        amount
      )) as number;
    } catch (error) {
      console.error("Error decrementing unread count:", error);
      return 0;
    }
  },

  async get(userId: string): Promise<number | null> {
    try {
      const value = await redis.get(`${UNREAD_NOTIFICATION_PREFIX}${userId}`);
      return value === null ? null : Math.trunc(Number(value));
    } catch (error) {
      console.error("Error getting unread count:", error);
      return null;
    }
  },

  async increment(userId: string, amount = 1): Promise<number> {
    try {
      return await redis.incrby(
        `${UNREAD_NOTIFICATION_PREFIX}${userId}`,
        amount
      );
    } catch (error) {
      console.error("Error incrementing unread count:", error);
      return 0;
    }
  },

  async reset(userId: string): Promise<void> {
    try {
      await redis.del(`${UNREAD_NOTIFICATION_PREFIX}${userId}`);
    } catch (error) {
      console.error("Error resetting unread count:", error);
    }
  },
};

// Unread DMs counter, mirrored off the notification badge: incremented when a
// message is created, decremented when the user reads a conversation, and
// polled every 60s by the nav badge (plus an instant bump over the SSE stream).
const UNREAD_MESSAGE_PREFIX = "unread:messages:";

export const unreadMessageCache = {
  async decrement(userId: string, amount = 1): Promise<number> {
    try {
      const script = `
        local current = tonumber(redis.call('get', KEYS[1]) or '0')
        local next = math.max(0, current - tonumber(ARGV[1]))
        if next > 0 then
          redis.call('set', KEYS[1], next)
        else
          redis.call('del', KEYS[1])
        end
        return next
      `;
      return (await redis.eval(
        script,
        1,
        `${UNREAD_MESSAGE_PREFIX}${userId}`,
        amount
      )) as number;
    } catch (error) {
      console.error("Error decrementing unread message count:", error);
      return 0;
    }
  },

  async get(userId: string): Promise<number | null> {
    try {
      const value = await redis.get(`${UNREAD_MESSAGE_PREFIX}${userId}`);
      return value === null ? null : Math.trunc(Number(value));
    } catch (error) {
      console.error("Error getting unread message count:", error);
      return null;
    }
  },

  async increment(userId: string, amount = 1): Promise<number> {
    try {
      return await redis.incrby(`${UNREAD_MESSAGE_PREFIX}${userId}`, amount);
    } catch (error) {
      console.error("Error incrementing unread message count:", error);
      return 0;
    }
  },

  async reset(userId: string): Promise<void> {
    try {
      await redis.del(`${UNREAD_MESSAGE_PREFIX}${userId}`);
    } catch (error) {
      console.error("Error resetting unread message count:", error);
    }
  },
};

export async function enqueuePostDeleted(
  postId: string,
  attachments: { mediaIds?: string[]; objectKeys?: string[] } = {}
): Promise<void> {
  await getQueue(CONTENT_EVENTS_QUEUE).add("post-deleted", {
    ...attachments,
    postId,
  });
}

export async function enqueueNotificationCreated(
  recipientId: string
): Promise<void> {
  await getQueue(CONTENT_EVENTS_QUEUE).add("notification-created", {
    recipientId,
  });
}

export async function enqueueNotificationDeleted(
  recipientId: string
): Promise<void> {
  await getQueue(CONTENT_EVENTS_QUEUE).add("notification-deleted", {
    recipientId,
  });
}

// Checks whether a user has earned the shitposter badge. Deduplicated per user
// with a stable jobId so a burst of posts enqueues a single check. Completed
// jobs are removed immediately so the jobId frees up for the next burst; failed
// jobs are kept briefly for retry/observability.
export async function enqueueShitposterCheck(userId: string): Promise<void> {
  await getQueue(CONTENT_EVENTS_QUEUE).add(
    "shitposter-check",
    { userId },
    {
      jobId: `shitposter-check-${userId}`,
      removeOnComplete: true,
      removeOnFail: 1000,
    }
  );
}

export async function scheduleMediaCleanup(mediaId: string): Promise<void> {
  // Delayed with an idempotency key so re-submitting a post does not enqueue
  // a second cleanup for the same media row. If the media got attached to a
  // post before the delay elapses, the worker skips it.
  await getQueue(MEDIA_QUEUE).add(
    "media-cleanup",
    { mediaId },
    {
      delay: 24 * 60 * 60 * 1000,
      jobId: `media-cleanup-${mediaId}`,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );
}

export async function cancelMediaCleanup(mediaId: string): Promise<void> {
  await getQueue(MEDIA_QUEUE).remove(`media-cleanup-${mediaId}`);
}

// ── Media pipeline jobs ────────────────────────────────────────────────────
// Each stage enqueues the next on success; stable jobIds per (media, stage)
// make duplicate enqueues and worker-crash retries idempotent.

const MEDIA_JOB_DEFAULTS = {
  attempts: 3,
  backoff: { delay: 5000, type: "exponential" as const },
  removeOnComplete: 500,
  removeOnFail: 2000,
};

function mediaJobOptions(stage: string, mediaId: string) {
  return {
    ...MEDIA_JOB_DEFAULTS,
    jobId: `${stage}-${mediaId}`,
  };
}

export async function enqueueMediaScan(
  mediaId: string,
  options?: { backfill?: boolean }
): Promise<void> {
  await getQueue(MEDIA_QUEUE).add(
    "media-scan",
    { backfill: options?.backfill ?? false, mediaId },
    mediaJobOptions("scan", mediaId)
  );
}

export async function enqueueMediaProcess(mediaId: string): Promise<void> {
  await getQueue(MEDIA_QUEUE).add(
    "media-process",
    { mediaId },
    mediaJobOptions("process", mediaId)
  );
}

export async function enqueueMediaAnalyze(mediaId: string): Promise<void> {
  await getQueue(MEDIA_QUEUE).add(
    "media-analyze",
    { mediaId },
    mediaJobOptions("analyze", mediaId)
  );
}

export async function enqueueMediaDeleteCascade(
  mediaId: string
): Promise<void> {
  await getQueue(MEDIA_QUEUE).add(
    "media-delete-cascade",
    { mediaId },
    { ...MEDIA_JOB_DEFAULTS, jobId: undefined, removeOnComplete: true }
  );
}

// Schedules the repeatable maintenance jobs (HN cache refresh every 15 min,
// the trending-score recompute + snapshot publish every 5 min, the weekly
// expired-token sweep, and the daily unverified-user sweep). Idempotent:
// re-running replaces the scheduler definition.
export async function registerMaintenanceSchedulers(): Promise<void> {
  const queue = getQueue(MAINTENANCE_QUEUE);
  await queue.upsertJobScheduler("hn-refresh", { every: 15 * 60 * 1000 });
  await queue.upsertJobScheduler("expired-tokens", {
    every: 7 * 24 * 60 * 60 * 1000,
  });
  await queue.upsertJobScheduler("inactive-users", {
    every: 24 * 60 * 60 * 1000,
  });
  // Five minutes keeps snapshot staleness bounded (view deltas flush on their
  // own cadence, so longer intervals compound ranking lag).
  await queue.upsertJobScheduler("trending-scores", {
    every: 5 * 60 * 1000,
  });
}

export function createBullConnection() {
  return bullConnection();
}
