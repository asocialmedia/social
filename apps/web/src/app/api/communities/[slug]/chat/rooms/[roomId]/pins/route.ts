import {
  canViewCommunity,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  listCommunityChatPins,
  setCommunityChatPin,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  communityChatAvailabilityResponse,
  communityChatErrorResponse,
} from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ roomId: string; slug: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const unavailable = communityChatAvailabilityResponse(false);
  if (unavailable) {
    return unavailable;
  }
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  try {
    const access = await getCommunityChatRoomAccess(roomId, userId);
    if (access.communityId !== community.id) {
      return Response.json({ error: "Chat room not found" }, { status: 404 });
    }
    const limit =
      Number(new URL(request.url).searchParams.get("limit")) || undefined;
    const messages = await listCommunityChatPins({ limit, roomId, userId });
    return Response.json(
      { messages },
      { headers: { "cache-control": "private, no-store", vary: "Cookie" } }
    );
  } catch (error) {
    return communityChatErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const unavailable = communityChatAvailabilityResponse(true);
  if (unavailable) {
    return unavailable;
  }
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json({ error: "Sign in to manage pins" }, { status: 401 });
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, actorId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid pin update" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid pin update" }, { status: 400 });
  }
  const input = body as { messageId?: unknown; pinned?: unknown };
  if (
    typeof input.messageId !== "string" ||
    typeof input.pinned !== "boolean"
  ) {
    return Response.json({ error: "Invalid pin update" }, { status: 400 });
  }
  try {
    const access = await getCommunityChatRoomAccess(roomId, actorId);
    if (access.communityId !== community.id) {
      return Response.json({ error: "Chat room not found" }, { status: 404 });
    }
    const result = await setCommunityChatPin({
      actorId,
      messageId: input.messageId,
      pinned: input.pinned,
      roomId,
    });
    return Response.json(result);
  } catch (error) {
    return communityChatErrorResponse(error);
  }
}
