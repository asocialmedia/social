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
export interface InactiveUserJobData {
  userId: string;
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

export async function processInactiveUser({ userId }: InactiveUserJobData) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailVerified: true },
  });

  // Only delete if the account is still unverified 30 days later. Verification
  // cancels the job, so this is a safety net.
  if (user && !user.emailVerified) {
    await prisma.user.delete({ where: { id: userId } });
  }
}

export async function processHnRefresh() {
  await hackerNewsAPI.refreshCache();
}

export async function processExpiredTokens() {
  await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
