import {
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatMessages,
  getCommunityChatRoomAccess,
  sendCommunityChatMessage,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ roomId: string; slug: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const community = await getCommunityBySlug(slug);
  if (!community) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  try {
    const access = await getCommunityChatRoomAccess(roomId, userId);
    if (access.communityId !== community.id) {
      return Response.json({ error: "Chat room not found" }, { status: 404 });
    }
    const page = await getCommunityChatMessages({
      afterSequence: url.searchParams.get("after") ?? undefined,
      aroundMessageId: url.searchParams.get("around") ?? undefined,
      beforeSequence: url.searchParams.get("before") ?? undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
      roomId,
      userId,
    });
    return Response.json(
      { ...page, permissions: access.permissions, room: access.room },
      { headers: { "cache-control": "private, no-store", vary: "Cookie" } }
    );
  } catch (error) {
    return communityChatErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json(
      { error: "Sign in to send a message" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid message" }, { status: 400 });
  }
  const messageInput = body as {
    clientId?: unknown;
    content?: unknown;
    replyToId?: unknown;
  };
  if (
    typeof messageInput.clientId !== "string" ||
    typeof messageInput.content !== "string" ||
    (messageInput.replyToId !== undefined &&
      typeof messageInput.replyToId !== "string")
  ) {
    return Response.json({ error: "Invalid message" }, { status: 400 });
  }
  try {
    const access = await getCommunityChatRoomAccess(roomId, userId);
    if (access.communityId !== community.id) {
      return Response.json({ error: "Chat room not found" }, { status: 404 });
    }
    const result = await sendCommunityChatMessage({
      clientId: messageInput.clientId,
      content: messageInput.content,
      replyToId: messageInput.replyToId,
      roomId,
      userId,
    });
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
