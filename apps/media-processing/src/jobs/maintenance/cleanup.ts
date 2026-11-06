// Abandoned-draft reaping, ported from the apps/auth media queue. An upload
// that was never attached to a post/comment within the grace period is
// deleted along with its objects. Pipeline rows additionally refund the
// user's storage quota counter.

import { fromPrismaDateTime, prisma } from "@asm/db";
import type { MediaCleanupJobData } from "@asm/media";

import { mediaLogger, withSpan } from "../../log";
import { getS3 } from "../../s3";

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
      const media = await prisma.orm.public.PostMedia.select(
        "commentId",
        "createdAt",
        "id",
        "key",
        "messageConversationId",
        "originalKey",
        "postId",
        "publishedKey",
        "size",
        "status",
        "stickerOperationId",
        "stickerSource",
        "techMetadata",
        "thumbnailKey",
        "userId"
      )
        .include("users", (user) => user.select("id"))
        .include("usersUsers", (user) => user.select("id"))
        .include("communities", (community) => community.select("id"))
        .include("communitiesCommunities", (community) =>
          community.select("id")
        )
        .include("messageConversation", (conversation) =>
          conversation.select("id")
        )
        .include("wallpaperConversations", (conversation) =>
          conversation.select("id")
        )
        .include("messageConversationMembers", (member) =>
          member.select("userId")
        )
        .include("userSticker", (sticker) => sticker.select("id"))
        .include("messageLifecycleLinks", (link) => link.select("id"))
        .where({ id: mediaId })
        .first();

      // Still orphaned after the grace period (never attached to a post, a
      // comment, a profile, a conversation, a community, or a member's chat
      // wallpaper): delete. Every owner projection must be listed here, or a
      // live surface loses its bytes 24h after the upload.
      const metadata = media?.techMetadata;
      if (
        metadata &&
        typeof metadata === "object" &&
        "communityMessageId" in metadata &&
        typeof metadata.communityMessageId === "string"
      ) {
        const message = await prisma.orm.public.CommunityChatMessages.select(
          "deletedAt",
          "payload"
        )
          .where({ id: metadata.communityMessageId })
          .first();
        const payload = message?.payload;
        if (
          message &&
          !message.deletedAt &&
          payload &&
          typeof payload === "object" &&
          "sticker" in payload &&
          payload.sticker &&
          typeof payload.sticker === "object" &&
          "mediaId" in payload.sticker &&
          payload.sticker.mediaId === media?.id
        ) {
          return;
        }
      }
      const preparedStickerDelivery = Boolean(
        media?.stickerOperationId &&
        media.messageLifecycleLinks.length === 0 &&
        Date.now() - fromPrismaDateTime(media.createdAt).getTime() >=
          24 * 60 * 60 * 1000
      );
      if (
        !media ||
        media.postId ||
        media.commentId ||
        (media.messageConversationId && !preparedStickerDelivery) ||
        media.users.length > 0 ||
        media.usersUsers.length > 0 ||
        media.communities.length > 0 ||
        media.communitiesCommunities.length > 0 ||
        (media.messageConversation && !preparedStickerDelivery) ||
        media.wallpaperConversations.length > 0 ||
        (media.messageConversationMembers.length > 0 &&
          !preparedStickerDelivery) ||
        media.userSticker
      ) {
        return;
      }

      const derivatives =
        media.stickerSource || media.stickerOperationId
          ? await prisma.orm.public.PostMediaDerivatives.select("key")
              .where({ mediaId })
              .all()
          : [];
      const derivativeKeys = derivatives.map((derivative) => derivative.key);
      for (const key of new Set([
        media.originalKey,
        media.publishedKey,
        media.key,
        media.thumbnailKey,
        ...derivativeKeys,
      ])) {
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
      await prisma.orm.public.PostMedia.where({ id: mediaId }).delete();
      mediaLogger.info({ mediaId }, "abandoned media cleaned up");
    },
    { "media.id": mediaId }
  );
}
