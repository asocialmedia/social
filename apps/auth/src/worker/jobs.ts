import { hackerNewsAPI } from "@asm/aggregator/hackernews";
import {
  and,
  cleanupExpiredPublishedNotifications,
  cleanupSinglePublishedNotification,
  deleteObject,
  fromPrismaDateTime,
  getTrendingUserIds,
  grantShitposterBadgeIfQualified,
  listDevicePushTokens,
  listPushSubscriptions,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  pruneDevicePushTokens,
  prunePushSubscriptions,
  redis,
  sweepEarlyBadges,
  syncTrendingBadges,
  toPrismaDateTime,
  unreadNotificationCache,
} from "@asm/db";
import { dispatchNotificationPush } from "@asm/notifications/server";

import { resolveLogger, withSpan } from "./log";
import type { WorkerLogger } from "./log";

export interface MediaCleanupJobData {
  mediaId: string;
}
export interface PostDeletedJobData {
  mediaIds?: string[];
  postId: string;
  /** Storage keys captured before deletion; the primary cleanup source. */
  objectKeys?: string[];
}

export async function processPostDeleted(
  {
    postId,
    mediaIds = [],
    objectKeys: preCapturedKeys = [],
  }: PostDeletedJobData,
  logger?: WorkerLogger
) {
  const log = resolveLogger(logger);
  await withSpan(
    "job.post-deleted",
    async () => {
      // The web client removes attachment rows while deleting a post
      // (emulated referential action), so by the time this job runs neither
      // a postId lookup nor an id lookup can discover anything. New events
      // carry every storage key pre-captured from those vanishing rows and
      // are cleaned directly; row lookups remain only as a fallback for
      // events queued before that field existed.
      const objectKeys = new Set<string>(preCapturedKeys);

      if (objectKeys.size === 0) {
        const media = await prisma.orm.public.PostMedia.select(
          "customThumbnailKey",
          "id",
          "key",
          "originalKey",
          "publishedKey",
          "thumbnailKey"
        )
          .include("postMediaDerivatives", (derivatives) =>
            derivatives.select("key")
          )
          .where((candidate) =>
            mediaIds.length > 0
              ? candidate.id.in(mediaIds)
              : candidate.postId.eq(postId)
          )
          .all();
        for (const m of media) {
          for (const key of [
            m.customThumbnailKey,
            m.key,
            m.originalKey,
            m.publishedKey,
            m.thumbnailKey,
          ]) {
            if (key && key.length > 0) {
              objectKeys.add(key);
            }
          }
          for (const derivative of m.postMediaDerivatives) {
            objectKeys.add(derivative.key);
          }
        }
      }

      // Objects are content-addressed per media id, so cross-post sharing
      // is impossible; deleting by unique keys cannot take out a neighbor.
      await Promise.allSettled([...objectKeys].map((key) => deleteObject(key)));

      if (mediaIds.length > 0) {
        // Rows are normally already gone; harmless no-op sweep.
        await prisma.orm.public.PostMedia.where((media) =>
          media.id.in(mediaIds)
        ).deleteAndCount();
      }

      // Clear any buffered view counters for the post.
      await Promise.allSettled([
        redis.srem(POST_VIEWS_SET, postId),
        redis.del(`${POST_VIEWS_KEY_PREFIX}${postId}`),
      ]);

      log.info(
        { objectsDeleted: objectKeys.size, postId },
        "post media cleaned"
      );
    },
    { "post.id": postId }
  );
}

export async function processNotificationCreated(
  {
    notificationId,
    recipientId,
  }: {
    notificationId?: string;
    recipientId: string;
  },
  logger?: WorkerLogger
) {
  const log = resolveLogger(logger);
  await withSpan(
    "job.notification-created",
    async () => {
      await unreadNotificationCache.increment(recipientId);
      // Push fan-out is best-effort and additive: the unread counter above is
      // the durable part, so a push outage must never fail the job. The row is
      // only re-read when the producer captured its id.
      if (!notificationId) {
        return;
      }
      await deliverNotificationPush(notificationId, log);
    },
    { "user.id": recipientId }
  );
}

// Loads a freshly created notification and fans it out to every registered
// endpoint. Isolated so the job body above stays a two-liner and the push
// failure path has one place to live.
async function deliverNotificationPush(
  notificationId: string,
  log: WorkerLogger
): Promise<void> {
  const selectedNotification = await prisma.orm.public.Notifications.where({
    id: notificationId,
  })
    .include("issuer", (issuer) =>
      issuer.select("avatarUrl", "displayName", "id", "username")
    )
    .include("post", (post) =>
      post
        .select("content", "id", "isGust", "parentPostId")
        .include("community", (community) => community.select("slug"))
    )
    .include("comment", (comment) =>
      comment
        .select("id", "parentId")
        .include("parent", (parent) => parent.select("userId"))
    )
    .include("community", (community) =>
      community.select("accentColor", "id", "name", "slug")
    )
    .first();
  if (!selectedNotification) {
    // Deleted (or already cleaned up) between creation and delivery.
    return;
  }
  const { _type, ...notificationFields } = selectedNotification;
  const notification = {
    ...notificationFields,
    createdAt: fromPrismaDateTime(selectedNotification.createdAt),
    type: _type,
  };
  const { issuer } = notification;
  if (!issuer) {
    return;
  }
  await dispatchNotificationPush(
    { ...notification, issuer },
    {
      listDeviceTokens: (userId) =>
        listDevicePushTokens(userId).then((rows) =>
          rows.map((row) => ({
            platform: row.platform,
            provider: row.provider,
            token: row.token,
          }))
        ),
      listSubscriptions: (userId) => listPushSubscriptions(userId),
      logger: {
        error: (message, meta) => log.error(meta ?? {}, message),
        info: (message, meta) => log.info(meta ?? {}, message),
        warn: (message, meta) => log.warn(meta ?? {}, message),
      },
      pruneDeviceTokens: (tokens) => pruneDevicePushTokens(tokens),
      pruneSubscriptions: (endpoints) => prunePushSubscriptions(endpoints),
    }
  );
}

export async function processNotificationDeleted({
  recipientId,
}: {
  recipientId: string;
}) {
  await withSpan(
    "job.notification-deleted",
    async () => {
      await unreadNotificationCache.decrement(recipientId);
    },
    { "user.id": recipientId }
  );
}

export async function processShitposterCheck(
  { userId }: { userId: string },
  logger?: WorkerLogger
): Promise<boolean> {
  const log = resolveLogger(logger);
  return await withSpan(
    "job.shitposter-check",
    async () => {
      const granted = await grantShitposterBadgeIfQualified(userId);
      if (granted) {
        log.info({ userId }, "shitposter badge granted");
      }
      return granted;
    },
    { "user.id": userId }
  );
}

// Periodic reconciliation of the two automated badges that are not tied to a
// single user action:
//  - early: grants the founding-era badge to everyone who has reached the aura
//    threshold before the deadline (a sweep rather than a ledger hook, because
//    aura arrives from many paths).
//  - trending: grants the presence badge to the current trending cohort and
//    releases it from anyone who has dropped off, so the badge tracks the live
//    ranking instead of accumulating.
//
// Both are idempotent, so a missed run or a duplicated one is harmless.
export async function processBadgeSweep(logger?: WorkerLogger): Promise<{
  earlyGranted: number;
  trendingGranted: number;
  trendingRevoked: number;
}> {
  const log = resolveLogger(logger);
  return await withSpan("job.badge-sweep", async () => {
    const earlyGranted = await sweepEarlyBadges();
    const trendingIds = await getTrendingUserIds();
    const trending = await syncTrendingBadges(trendingIds);

    const result = {
      earlyGranted,
      trendingGranted: trending.granted,
      trendingRevoked: trending.revoked,
    };
    log.info(result, "badge sweep finished");
    return result;
  });
}

export async function processMediaCleanup(
  { mediaId }: MediaCleanupJobData,
  logger?: WorkerLogger
) {
  const log = resolveLogger(logger);
  await withSpan(
    "job.media-cleanup",
    async () => {
      const media = await prisma.orm.public.PostMedia.select(
        "commentId",
        "createdAt",
        "customThumbnailKey",
        "id",
        "key",
        "postId",
        "thumbnailKey"
      )
        .where({ id: mediaId })
        .first();

      // Still orphaned after the grace period (never attached to a post or a
      // comment eddy): delete.
      if (media && !media.postId && !media.commentId) {
        if (media.key) {
          await deleteObject(media.key);
        }
        if (media.thumbnailKey) {
          await deleteObject(media.thumbnailKey);
        }
        if (media.customThumbnailKey) {
          await deleteObject(media.customThumbnailKey);
        }
        await prisma.orm.public.PostMedia.where({ id: mediaId }).delete();
        log.info({ mediaId }, "abandoned media cleaned up");
      }
    },
    { "media.id": mediaId }
  );
}

export async function processHnRefresh() {
  await withSpan("job.hn-refresh", async () => {
    await hackerNewsAPI.refreshCache();
  });
}

export async function processExpiredTokens(
  logger?: WorkerLogger
): Promise<{ count: number }> {
  const log = resolveLogger(logger);
  return await withSpan("job.expired-tokens", async () => {
    const count = await prisma.orm.public.PasswordResetTokens.where((token) =>
      token.expiresAt.lt(toPrismaDateTime(new Date()))
    ).deleteAndCount();
    log.info({ deleted: count }, "expired reset tokens swept");
    return { count };
  });
}

export async function processExpiredUsernameAliases(
  logger?: WorkerLogger
): Promise<{ count: number }> {
  const log = resolveLogger(logger);
  return await withSpan("job.expired-username-aliases", async () => {
    const count = await prisma.orm.public.UsernameAliases.where((alias) =>
      alias.expiresAt.lte(toPrismaDateTime(new Date()))
    ).deleteAndCount();
    log.info({ deleted: count }, "expired username aliases swept");
    return { count };
  });
}

export async function processInactiveUsersSweep(
  logger?: WorkerLogger
): Promise<number> {
  const log = resolveLogger(logger);
  return await withSpan("job.inactive-users", async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const batchSize = 100;
    let totalDeleted = 0;

    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- batched paginated sweep must await each batch
      const batch = await prisma.orm.public.Users.select("id")
        .where((user) =>
          and(
            user.createdAt.lt(toPrismaDateTime(thirtyDaysAgo)),
            user.emailVerified.eq(false)
          )
        )
        .limit(batchSize)
        .all();

      if (batch.length === 0) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- batched paginated sweep must await each batch
      const deletedCount = await prisma.orm.public.Users.where((user) =>
        user.id.in(batch.map((entry) => entry.id))
      ).deleteAndCount();
      totalDeleted += deletedCount;

      if (batch.length < batchSize) {
        break;
      }
    }

    log.info({ deleted: totalDeleted }, "inactive user sweep finished");
    return totalDeleted;
  });
}

export interface PublishedNotificationCleanupJobData {
  notificationId: string;
}

export async function processPublishedNotificationCleanup(
  { notificationId }: PublishedNotificationCleanupJobData,
  logger?: WorkerLogger
): Promise<boolean> {
  const log = resolveLogger(logger);
  return await withSpan(
    "job.cleanup-published-notification",
    async () => {
      const deleted = await cleanupSinglePublishedNotification(notificationId);
      if (deleted) {
        log.info({ notificationId }, "published notification cleaned up");
      }
      return deleted;
    },
    { "notification.id": notificationId }
  );
}

export async function processPublishedNotificationsSweep(
  logger?: WorkerLogger
): Promise<{ batchesProcessed: number; deletedCount: number }> {
  const log = resolveLogger(logger);
  return await withSpan("job.cleanup-published-notifications", async () => {
    const result = await cleanupExpiredPublishedNotifications();
    log.info(
      {
        batches: result.batchesProcessed,
        deleted: result.deletedCount,
      },
      "published notifications sweep finished"
    );
    return result;
  });
}
