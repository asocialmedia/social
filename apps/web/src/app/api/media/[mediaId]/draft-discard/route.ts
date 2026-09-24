import { and, prisma, redis } from "@asm/db";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

// Immediate cleanup for draft uploads the author discarded before posting.
// The abandoned-upload sweep in media-processing is the eventual backstop;
// this makes cancel/remove feel instantaneous and stops orphaned bytes from
// squatting on storage and quota in the meantime.
//
// Safety rails: only the owner may discard, and only rows that are still
// unclaimed drafts (no post, no comment, no avatar link). Anything attached
// to published surfaces is refused - those lifetimes belong to their posts.
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ mediaId: string }> }
): Promise<NextResponse | Response> {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { mediaId } = await context.params;
  if (!mediaId || mediaId.length > 64) {
    return Response.json({ error: "Invalid media id" }, { status: 400 });
  }

  const claim = await prisma.orm.public.PostMedia.where((media) =>
    and(
      media.id.eq(mediaId),
      media.userId.eq(user.id),
      media.postId.isNull(),
      media.commentId.isNull(),
      media.messageConversationId.isNull(),
      media.users.none(),
      media.usersUsers.none(),
      media.communities.none(),
      media.communitiesCommunities.none(),
      media.status.in([
        "UPLOADING",
        "QUARANTINED",
        "SCANNING",
        "PROCESSING",
        "READY",
      ])
    )
  ).updateAndCount({ status: "DELETED" });
  if (claim === 0) {
    // Deliberately opaque: not-owned / attached / already-deleted all look
    // the same to the client.
    return Response.json({ error: "Media not discardable" }, { status: 409 });
  }

  const media = await prisma.orm.public.PostMedia.select(
    "customThumbnailKey",
    "key",
    "originalKey",
    "publishedKey",
    "size",
    "thumbnailKey"
  )
    .where({ id: mediaId })
    .first();

  if (media) {
    // Only immediately delete unfinalized quarantine objects; published
    // artifacts are preserved for the 24h cleanup window so subsequent
    // re-uploads of the same media can be deduplicated instantly. The
    // scheduled media cleanup job reaps any truly abandoned artifacts.
    if (media.originalKey?.startsWith("quarantine/")) {
      try {
        await asmobClient.send(
          new DeleteObjectCommand({
            Bucket: ASMOB_BUCKET,
            Key: media.originalKey,
          })
        );
      } catch (error) {
        console.error(
          `Failed to delete quarantine object for ${mediaId}:`,
          error
        );
      }
    }
    try {
      await redis.decrby(`user:storage:${user.id}`, media.size);
    } catch (error) {
      console.error("Failed to refund storage quota on discard:", error);
    }
  }

  return NextResponse.json({ mediaId, status: "DELETED" });
}
