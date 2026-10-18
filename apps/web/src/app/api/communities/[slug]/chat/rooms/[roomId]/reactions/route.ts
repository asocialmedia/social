import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  setCommunityChatReaction,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  communityChatAvailabilityResponse,
  communityChatErrorResponse,
} from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ roomId: string; slug: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const unavailable = communityChatAvailabilityResponse(true);
  if (unavailable) {
    return unavailable;
  }
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json({ error: "Sign in to react" }, { status: 401 });
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, actorId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid reaction" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid reaction" }, { status: 400 });
  }
  const input = body as {
    emoji?: unknown;
    messageId?: unknown;
    reacted?: unknown;
  };
  if (
    typeof input.emoji !== "string" ||
    typeof input.messageId !== "string" ||
    typeof input.reacted !== "boolean"
  ) {
    return Response.json({ error: "Invalid reaction" }, { status: 400 });
  }
  try {
    const access = await getCommunityChatRoomAccess(roomId, actorId);
    if (access.communityId !== community.id) {
      return Response.json({ error: "Chat room not found" }, { status: 404 });
    }
    const result = await setCommunityChatReaction({
      actorId,
      emoji: input.emoji,
      messageId: input.messageId,
      reacted: input.reacted,
      roomId,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
