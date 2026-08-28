import { hackerNewsAPI } from "@asm/aggregator/hackernews";
import {
  deleteObject,
  grantShitposterBadgeIfQualified,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
  unreadNotificationCache,
} from "@asm/db";

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
      // The web client removes attachment rows during prisma.post.delete
      // (emulated referential action), so by the time this job runs neither
      // a postId lookup nor an id lookup can discover anything. New events
      // carry every storage key pre-captured from those vanishing rows and
      // are cleaned directly; row lookups remain only as a fallback for
      // events queued before that field existed.
      const objectKeys = new Set<string>(preCapturedKeys);

      if (objectKeys.size === 0) {
        const media = await prisma.media.findMany({
          select: {
            customThumbnailKey: true,
            derivatives: { select: { key: true } },
            id: true,
            key: true,
            originalKey: true,
            publishedKey: true,
            thumbnailKey: true,
          },
          where: mediaIds.length > 0 ? { id: { in: mediaIds } } : { postId },
        });
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
          for (const derivative of m.derivatives) {
            objectKeys.add(derivative.key);
          }
        }
      }

      // Objects are content-addressed per media id, so cross-post sharing
      // is impossible; deleting by unique keys cannot take out a neighbor.
      await Promise.allSettled([...objectKeys].map((key) => deleteObject(key)));

      if (mediaIds.length > 0) {
        // Rows are normally already gone; harmless no-op sweep.
        await prisma.media.deleteMany({
          where: { id: { in: mediaIds } },
        });
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

export async function processNotificationCreated({
  recipientId,
}: {
  recipientId: string;
}) {
  await withSpan(
    "job.notification-created",
    async () => {
      await unreadNotificationCache.increment(recipientId);
    },
    { "user.id": recipientId }
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

export async function processMediaCleanup(
  { mediaId }: MediaCleanupJobData,
  logger?: WorkerLogger
) {
  const log = resolveLogger(logger);
  await withSpan(
    "job.media-cleanup",
    async () => {
      const media = await prisma.media.findUnique({
        select: {
          commentId: true,
          createdAt: true,
          customThumbnailKey: true,
          id: true,
          key: true,
          postId: true,
          thumbnailKey: true,
        },
        where: { id: mediaId },
      });

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
        await prisma.media.delete({ where: { id: mediaId } });
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
    const result = await prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    log.info({ deleted: result.count }, "expired reset tokens swept");
    return { count: result.count };
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
      const batch = await prisma.user.findMany({
        select: { id: true },
        take: batchSize,
        where: { createdAt: { lt: thirtyDaysAgo }, emailVerified: false },
      });

      if (batch.length === 0) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- batched paginated sweep must await each batch
      const deleted = await prisma.user.deleteMany({
        where: { id: { in: batch.map((user) => user.id) } },
      });
      totalDeleted += deleted.count;

      if (batch.length < batchSize) {
        break;
      }
    }

    log.info({ deleted: totalDeleted }, "inactive user sweep finished");
    return totalDeleted;
  });
}
