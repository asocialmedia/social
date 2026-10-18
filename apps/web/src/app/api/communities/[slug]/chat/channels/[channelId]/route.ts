import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  updateCommunityChatChannel,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ channelId: string; slug: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { channelId, slug } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json(
      { error: "Sign in to manage channels" },
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
    return Response.json({ error: "Invalid channel update" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid channel update" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const update: {
    archived?: boolean;
    channelType?: "ANNOUNCEMENT" | "TEXT";
    locked?: boolean;
    name?: string;
    slowModeSeconds?: number;
    sortOrder?: number;
    topic?: string | null;
  } = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      return invalid();
    }
    update.name = input.name;
  }
  if (input.topic !== undefined) {
    if (input.topic !== null && typeof input.topic !== "string") {
      return invalid();
    }
    update.topic = input.topic;
  }
  if (input.channelType !== undefined) {
    if (input.channelType !== "TEXT" && input.channelType !== "ANNOUNCEMENT") {
      return invalid();
    }
    update.channelType = input.channelType;
  }
  if (input.locked !== undefined) {
    if (typeof input.locked !== "boolean") {
      return invalid();
    }
    update.locked = input.locked;
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== "boolean") {
      return invalid();
    }
    update.archived = input.archived;
  }
  if (input.sortOrder !== undefined) {
    if (typeof input.sortOrder !== "number") {
      return invalid();
    }
    update.sortOrder = input.sortOrder;
  }
  if (input.slowModeSeconds !== undefined) {
    if (typeof input.slowModeSeconds !== "number") {
      return invalid();
    }
    update.slowModeSeconds = input.slowModeSeconds;
  }
  if (Object.keys(update).length === 0) {
    return invalid();
  }

  try {
    const access = await getCommunityChatRoomAccess(channelId, actorId);
    if (access.communityId !== community.id || access.room.kind !== "CHANNEL") {
      return Response.json(
        { error: "Chat channel not found" },
        { status: 404 }
      );
    }
    const channel = await updateCommunityChatChannel({
      actorId,
      channelId,
      update,
    });
    return Response.json({ channel });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { channelId, slug } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json(
      { error: "Sign in to archive channels" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, actorId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  try {
    const access = await getCommunityChatRoomAccess(channelId, actorId);
    if (access.communityId !== community.id || access.room.kind !== "CHANNEL") {
      return Response.json(
        { error: "Chat channel not found" },
        { status: 404 }
      );
    }
    const channel = await updateCommunityChatChannel({
      actorId,
      channelId,
      update: { archived: true },
    });
    return Response.json({ channel });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}

function invalid() {
  return Response.json({ error: "Invalid channel update" }, { status: 400 });
}
