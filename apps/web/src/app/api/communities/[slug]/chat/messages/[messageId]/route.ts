import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatMessageRoomAccess,
  mutateCommunityChatMessage,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  communityChatAvailabilityResponse,
  communityChatErrorResponse,
} from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ messageId: string; slug: string }>;
}

async function readInput(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function handleMutation(
  request: Request,
  context: RouteContext,
  operation: "DELETE" | "EDIT"
) {
  const unavailable = communityChatAvailabilityResponse(true);
  if (unavailable) {
    return unavailable;
  }
  const { messageId, slug } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json(
      { error: "Sign in to manage messages" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, actorId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  const body = await readInput(request);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid message update" }, { status: 400 });
  }
  const input = body as { content?: unknown; revision?: unknown };
  if (
    typeof input.revision !== "number" ||
    !Number.isInteger(input.revision) ||
    input.revision < 1 ||
    (operation === "EDIT" && typeof input.content !== "string")
  ) {
    return Response.json({ error: "Invalid message update" }, { status: 400 });
  }
  try {
    const access = await getCommunityChatMessageRoomAccess(messageId, actorId);
    if (access.communityId !== community.id) {
      return Response.json({ error: "Message not found" }, { status: 404 });
    }
    const message = await mutateCommunityChatMessage({
      actorId,
      content: input.content,
      expectedRevision: input.revision,
      messageId,
      operation,
    });
    return Response.json({ message });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}

export function PATCH(request: Request, context: RouteContext) {
  return handleMutation(request, context, "EDIT");
}

export function DELETE(request: Request, context: RouteContext) {
  return handleMutation(request, context, "DELETE");
}
