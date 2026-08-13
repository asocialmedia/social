import { hackerNewsAPI } from "@asm/aggregator/hackernews";
import {
  deleteObject,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
  unreadNotificationCache,
} from "@asm/db";

export interface MediaCleanupJobData {
  mediaId: string;
}
export interface PostDeletedJobData {
  postId: string;
}

export async function processPostDeleted({ postId }: PostDeletedJobData) {
  // Load all attachments of the deleted post, delete their objects, then the
  // rows. Fixes the orphaned-media leak caused by onDelete: SetNull.
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
}

export async function processNotificationCreated({
  recipientId,
}: {
  recipientId: string;
}) {
  await unreadNotificationCache.increment(recipientId);
}

export async function processNotificationDeleted({
  recipientId,
}: {
  recipientId: string;
}) {
  await unreadNotificationCache.decrement(recipientId);
}

export async function processMediaCleanup({ mediaId }: MediaCleanupJobData) {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { id: true, key: true, postId: true, createdAt: true },
  });

  // Still orphaned after the grace period (never attached to a post): delete.
  if (media && !media.postId) {
    if (media.key) {
      await deleteObject(media.key);
    }
    await prisma.media.delete({ where: { id: mediaId } });
  }
}

export async function processHnRefresh() {
  await hackerNewsAPI.refreshCache();
}

export async function processExpiredTokens(): Promise<{ count: number }> {
  return await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}

export async function processInactiveUsersSweep(): Promise<number> {
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

  return totalDeleted;
}
