import { prisma, redis } from "@asm/db";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient } from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";

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

  const claim = await prisma.media.updateMany({
    // Conditional transition doubles as the attachment guard: a row that
    // already belongs to a post/comment/avatar can never match, so the
    // discard can never yank media out of a live surface. DELETED rows are
    // terminal in the pipeline state machine.
    data: { status: "DELETED" },
    where: {
      commentId: null,
      id: mediaId,
      postId: null,
      status: {
        in: ["UPLOADING", "QUARANTINED", "SCANNING", "PROCESSING", "READY"],
      },
      userId: user.id,
    },
  });
  if (claim.count === 0) {
    // Deliberately opaque: not-owned / attached / already-deleted all look
    // the same to the client.
    return Response.json({ error: "Media not discardable" }, { status: 409 });
  }

  const media = await prisma.media.findUnique({
    select: {
      key: true,
      originalKey: true,
      publishedKey: true,
      size: true,
      thumbnailKey: true,
    },
    where: { id: mediaId },
  });

  if (media) {
    const objectKeys = [
      media.originalKey,
      media.publishedKey,
      media.thumbnailKey,
      // Legacy rows carry their object key in the old column.
      media.key.length > 0 ? media.key : null,
    ].filter((key): key is string => Boolean(key));
    if (objectKeys.length > 0) {
      try {
        // Best-effort parallel deletes: the row is already DELETED so the
        // reaper's object GC remains the backstop for any straggler.
        await Promise.all(
          objectKeys.map((key) =>
            asmobClient.send(
              new DeleteObjectCommand({ Bucket: ASMOB_BUCKET, Key: key })
            )
          )
        );
      } catch (error) {
        console.error(`Failed to delete objects for ${mediaId}:`, error);
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
