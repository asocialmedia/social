import { prisma, scheduleMediaCleanup } from "@asm/db";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

// Immediate cleanup for a message attachment the sender staged but removed
// before sending. Message media is bound to the conversation (not to a message
// row) so the server cannot tell whether an attachment was sent; a normal client
// only calls this for tiles still in the composer, never for media already in a
// sent album.
//
// Safety rails: only the owner may discard, and only rows that still carry a
// conversation link. The conversation link is cleared and nothing else: the row
// becomes an ordinary owner-only orphan, so peers immediately lose access
// (message media is served only to conversation members), while the standard
// cleanup job reclaims its published objects, quota refund, and row after the
// usual grace window. Status is deliberately left untouched so the cleanup job's
// quota refund still applies (it excludes DELETED rows).
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
    data: { messageConversationId: null },
    where: {
      id: mediaId,
      messageConversationId: { not: null },
      status: {
        in: ["UPLOADING", "QUARANTINED", "SCANNING", "PROCESSING", "READY"],
      },
      userId: user.id,
    },
  });
  if (claim.count === 0) {
    // Deliberately opaque: not-owned / not-a-message-draft / already-discarded
    // all look the same to the client.
    return Response.json({ error: "Media not discardable" }, { status: 409 });
  }

  const media = await prisma.media.findUnique({
    select: { originalKey: true },
    where: { id: mediaId },
  });

  // Only the unfinalized quarantine copy is removed now; published artifacts
  // are left for the scheduled cleanup so quick re-uploads still dedupe.
  if (media?.originalKey?.startsWith("quarantine/")) {
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
    await scheduleMediaCleanup(mediaId);
  } catch (error) {
    // The row is already detached; the cleanup job is the only reclaimer, so
    // log loudly if it could not be scheduled.
    console.error("Failed to schedule message discard cleanup:", error);
  }

  return NextResponse.json({ mediaId, status: "DISCARDED" });
}
