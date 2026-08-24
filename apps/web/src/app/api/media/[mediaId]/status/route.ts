import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

import { decideMediaAccess } from "@/lib/media-access";
import { getSessionFromApi } from "@/lib/session";

// Lightweight lifecycle polling for the composer: the frontend uploads
// asynchronously and needs to know when an attachment becomes READY (or was
// rejected) before it can render previews. Owner-only for unlinked media;
// post/comment-linked media is already governed by the serving route.
export async function GET(
  _request: Request,
  context: { params: Promise<{ mediaId: string }> }
): Promise<Response> {
  const { mediaId } = await context.params;
  if (!mediaId) {
    return Response.json({ error: "Media ID is required" }, { status: 400 });
  }

  const media = await prisma.media.findUnique({
    select: {
      commentId: true,
      failureCode: true,
      id: true,
      postId: true,
      rejectedReason: true,
      status: true,
      userId: true,
    },
    where: { id: mediaId },
  });
  if (!media) {
    return Response.json({ error: "Media not found" }, { status: 404 });
  }

  const session = await getSessionFromApi();
  const decision = decideMediaAccess(media, session?.user ?? null);
  if (!decision.allowed) {
    return Response.json(
      { error: "Media not found" },
      { status: decision.status }
    );
  }

  return NextResponse.json({
    failureCode: media.failureCode ?? null,
    mediaId: media.id,
    // Rejected rows report their reason only to the owner, who is the only
    // viewer at that stage anyway.
    rejectedReason:
      session?.user && session.user.id === media.userId
        ? (media.rejectedReason ?? null)
        : null,
    status: media.status,
  });
}
