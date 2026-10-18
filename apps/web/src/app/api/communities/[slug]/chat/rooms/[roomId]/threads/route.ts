import {
  canViewCommunity,
  CommunityChatError,
  createCommunityChatThread,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  listCommunityChatThreads,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  communityChatAvailabilityResponse,
  communityChatErrorResponse,
} from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ roomId: string; slug: string }>;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((id: unknown) => typeof id === "string")
  );
}

export async function GET(_request: Request, context: RouteContext) {
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
    if (access.communityId !== community.id || access.room.kind !== "CHANNEL") {
      return Response.json(
        { error: "Chat channel not found" },
        { status: 404 }
      );
    }
    const threads = await listCommunityChatThreads(roomId, userId);
    return Response.json(
      { threads },
      { headers: { "cache-control": "private, no-store", vary: "Cookie" } }
    );
  } catch (error) {
    return communityChatErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const unavailable = communityChatAvailabilityResponse(true);
  if (unavailable) {
    return unavailable;
  }
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json(
      { error: "Sign in to create a thread" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid thread details" }, { status: 400 });
  }
  const input = body as {
    clientId?: unknown;
    inviteeUserIds?: unknown;
    name?: unknown;
    sourceMessageId?: unknown;
    starterContent?: unknown;
    visibility?: unknown;
  };
  if (
    typeof input.clientId !== "string" ||
    typeof input.name !== "string" ||
    (input.visibility !== "PUBLIC" && input.visibility !== "PRIVATE") ||
    (input.sourceMessageId !== undefined &&
      typeof input.sourceMessageId !== "string") ||
    (input.starterContent !== undefined &&
      typeof input.starterContent !== "string") ||
    (input.inviteeUserIds !== undefined &&
      (!isStringArray(input.inviteeUserIds) ||
        input.inviteeUserIds.length > 50))
  ) {
    return Response.json({ error: "Invalid thread details" }, { status: 400 });
  }
  try {
    const access = await getCommunityChatRoomAccess(roomId, userId);
    if (access.communityId !== community.id || access.room.kind !== "CHANNEL") {
      return Response.json(
        { error: "Chat channel not found" },
        { status: 404 }
      );
    }
    const thread = await createCommunityChatThread({
      channelId: roomId,
      clientId: input.clientId,
      creatorId: userId,
      inviteeUserIds: input.inviteeUserIds,
      name: input.name,
      sourceMessageId: input.sourceMessageId,
      starterContent: input.starterContent,
      visibility: input.visibility,
    });
    return Response.json({ thread }, { status: 201 });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
