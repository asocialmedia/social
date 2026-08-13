import { hackerNewsAPI } from "@asm/aggregator/hackernews";
import {
  deleteObject,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
  unreadNotificationCache,
} from "@asm/db";
import { resolveLogger, type WorkerLogger, withSpan } from "./log";

export interface MediaCleanupJobData {
  mediaId: string;
}
export interface PostDeletedJobData {
  postId: string;
}

export async function processPostDeleted(
  { postId }: PostDeletedJobData,
  logger?: WorkerLogger
) {
  const log = resolveLogger(logger);
  await withSpan(
    "job.post-deleted",
    async () => {
      // Load all attachments of the deleted post, delete their objects, then
      // the rows. Fixes the orphaned-media leak caused by onDelete: SetNull.
      const media = await prisma.media.findMany({
        where: { postId },
        select: { id: true, key: true },
      });

      await Promise.allSettled(
        media.map(async (m) => {
          if (m.key) {
            await deleteObject(m.key);
          }
        })
      );

      await prisma.media.deleteMany({
        where: { id: { in: media.map((m) => m.id) } },
      });

      // Clear any buffered view counters for the post.
      await Promise.allSettled([
        redis.srem(POST_VIEWS_SET, postId),
        redis.del(`${POST_VIEWS_KEY_PREFIX}${postId}`),
      ]);

      log.info({ postId, mediaDeleted: media.length }, "post media cleaned");
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

export async function processMediaCleanup(
  { mediaId }: MediaCleanupJobData,
  logger?: WorkerLogger
) {
  const log = resolveLogger(logger);
  await withSpan(
    "job.media-cleanup",
    async () => {
      const media = await prisma.media.findUnique({
        where: { id: mediaId },
        select: { id: true, key: true, postId: true, createdAt: true },
      });

      // Still orphaned after the grace period (never attached to a post):
      // delete.
      if (media && !media.postId) {
        if (media.key) {
          await deleteObject(media.key);
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
      // biome-ignore lint/performance/noAwaitInLoops: batched paginated sweep must await each batch
      const batch = await prisma.user.findMany({
        where: { emailVerified: false, createdAt: { lt: thirtyDaysAgo } },
        select: { id: true },
        take: batchSize,
      });

      if (batch.length === 0) {
        break;
      }

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
