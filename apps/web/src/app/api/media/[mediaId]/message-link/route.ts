import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";

// Idempotently (re)binds a message attachment row to its conversation.
//
// Message media is normally bound to the thread at upload initiation, and the
// serving route admits the peer by resolving that link. Rows created before
// that binding existed (or by a client that omitted it) are left unlinked: the
// uploader still renders them because an unlinked row is owner-readable, but
// the peer fails the conversation-access check and every fetch 404s — a
// permanently one-sided message.
//
// The uploader's own client is the only party that can reconstruct the link:
// the media ids live inside the encrypted payload, so the server never sees them.
// A row being viewed in a thread therefore re-asserts its binding here. The
// endpoint is deliberately conservative — the caller must own the row AND be a
// member of the target conversation, and the update only fills a null link or
// confirms the existing one, so it can never move media between threads or
// resurrect quarantined content.
export async function POST(
  request: Request,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const conversationId = (body as { conversationId?: unknown } | null)
    ?.conversationId;
  if (typeof conversationId !== "string" || conversationId.length > 64) {
    return Response.json({ error: "Invalid conversation id" }, { status: 400 });
  }

  // Membership is the same gate the serving route applies to the peer, so a
  // caller cannot link media into a thread they are not part of.
  const membership = await prisma.messageConversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!membership) {
    return Response.json(
      { error: "Not a conversation member" },
      { status: 403 }
    );
  }

  // Conditional update doubles as the ownership + lifecycle guard: only the
  // uploader's own row, only while it is live, and only when the link is null
  // or already this conversation. A row bound to a different thread can never
  // be moved by this call, and REJECTED/DELETED rows stay dead.
  const result = await prisma.media.updateMany({
    data: { messageConversationId: conversationId },
    where: {
      OR: [
        { messageConversationId: null },
        { messageConversationId: conversationId },
      ],
      id: mediaId,
      status: {
        in: ["UPLOADING", "QUARANTINED", "SCANNING", "PROCESSING", "READY"],
      },
      userId: user.id,
    },
  });

  // count 0 means not-owned / not-a-message-row / already linked elsewhere /
  // dead. Deliberately opaque so the endpoint cannot be used to probe rows.
  return NextResponse.json({
    linked: result.count > 0,
    mediaId,
  });
}
