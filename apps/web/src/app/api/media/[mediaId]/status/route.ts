import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import { decideMediaAccess } from "@/lib/media/media-access";
import { mediaJsonError } from "@/lib/media/media-responses";
import { resolveMessageMediaMembership } from "@/lib/media/message-media-access";

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
    return mediaJsonError("Media ID is required", 400);
  }

  const media = await prisma.orm.public.PostMedia.select(
    "altText",
    "commentId",
    "failureCode",
    "id",
    "messageConversationId",
    "postId",
    "rejectedReason",
    "safety",
    "status",
    "userId"
  )
    .where({ id: mediaId })
    .first();
  if (!media) {
    return mediaJsonError("Media not found", 404);
  }

  const session = await getSessionFromApi();
  const viewer = session?.user ?? null;
  const isConversationMember = await resolveMessageMediaMembership(
    media.messageConversationId,
    viewer?.id
  );
  const decision = decideMediaAccess(media, viewer, { isConversationMember });
  if (!decision.allowed) {
    return mediaJsonError("Media not found", decision.status);
  }

  return NextResponse.json({
    altText: media.altText ?? null,
    explicit:
      session?.user && session.user.id === media.userId
        ? ((media.safety as { explicit?: boolean } | null)?.explicit ?? null)
        : null,
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
