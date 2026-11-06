import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  updateCommunityChatThreadInvitations,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  communityChatAvailabilityResponse,
  communityChatErrorResponse,
} from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ slug: string; threadId: string }>;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((id: unknown) => typeof id === "string")
  );
}

async function updateInvitations(
  request: Request,
  context: RouteContext,
  operation: "add" | "remove"
) {
  const unavailable = communityChatAvailabilityResponse(true);
  if (unavailable) {
    return unavailable;
  }
  const { slug, threadId } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json(
      { error: "Sign in to manage invitations" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, actorId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid invitation list" }, { status: 400 });
  }
  const input = body as { userIds?: unknown };
  if (!isStringArray(input.userIds) || input.userIds.length > 50) {
    return Response.json({ error: "Choose up to 50 members" }, { status: 400 });
  }
  try {
    const access = await getCommunityChatRoomAccess(threadId, actorId);
    if (
      access.communityId !== community.id ||
      access.room.kind !== "THREAD" ||
      access.room.visibility !== "PRIVATE"
    ) {
      return Response.json(
        { error: "Private thread not found" },
        { status: 404 }
      );
    }
    await updateCommunityChatThreadInvitations({
      actorId,
      roomId: threadId,
      ...(operation === "add"
        ? { addUserIds: input.userIds }
        : { removeUserIds: input.userIds }),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}

export function POST(request: Request, context: RouteContext) {
  return updateInvitations(request, context, "add");
}

export function DELETE(request: Request, context: RouteContext) {
  return updateInvitations(request, context, "remove");
}
