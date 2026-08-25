// Abandoned-draft reaping, ported from the apps/auth media queue. An upload
// that was never attached to a post/comment within the grace period is
// deleted along with its objects. Pipeline rows additionally refund the
// user's storage quota counter.

import { prisma } from "@asm/db";
import type { MediaCleanupJobData } from "@asm/media";

import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";

async function deleteObject(key: string): Promise<void> {
  try {
    await getS3().delete(key);
  } catch (error) {
    console.error(`Failed to delete object ${key}:`, error);
  }
}

export async function processMediaCleanup(
  jobData: MediaCleanupJobData
): Promise<void> {
  const { mediaId } = jobData;
  await withSpan(
    "job.media-cleanup",
    async () => {
      const media = await prisma.media.findUnique({
        select: {
          avatarOf: { select: { id: true } },
          commentId: true,
          createdAt: true,
          id: true,
          key: true,
          originalKey: true,
          postId: true,
          publishedKey: true,
          size: true,
          status: true,
          thumbnailKey: true,
          userId: true,
        },
        where: { id: mediaId },
      });

      // Still orphaned after the grace period (never attached to a post, a
      // comment, or a profile): delete.
      if (!media || media.postId || media.commentId || media.avatarOf) {
        return;
      }

      for (const key of [
        media.originalKey,
        media.publishedKey,
        media.key,
        media.thumbnailKey,
      ]) {
        if (key) {
          // Best-effort sequential deletes: partial failure must not abort
          // the remaining objects before the row disappears.
          // oxlint-disable-next-line no-await-in-loop -- deliberate ordering
          await deleteObject(key);
        }
      }
      // Refund the quota counter for pipeline rows that finalized.
      if (
        media.userId &&
        media.size > 0 &&
        !["UPLOADING", "REJECTED", "DELETED"].includes(media.status)
      ) {
        try {
          const { redis } = await import("@asm/db");
          await redis.decrby(`user:storage:${media.userId}`, media.size);
        } catch (error) {
          console.error("Failed to refund storage quota:", error);
        }
      }
      await prisma.media.delete({ where: { id: mediaId } });
      mediaLogger.info({ mediaId }, "abandoned media cleaned up");
    },
    { "media.id": mediaId }
  );
}
