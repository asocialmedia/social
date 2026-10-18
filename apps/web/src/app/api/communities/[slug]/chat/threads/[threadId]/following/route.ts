import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  getCommunityChatThreadFollowing,
  setCommunityChatThreadFollowing,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ slug: string; threadId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { slug, threadId } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json(
      { error: "Sign in to follow threads" },
      { status: 401 }
    );
  }
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, actorId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  try {
    const access = await getCommunityChatRoomAccess(threadId, actorId);
    if (access.communityId !== community.id || access.room.kind !== "THREAD") {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }
    return Response.json(
      await getCommunityChatThreadFollowing({ actorId, threadId })
    );
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { slug, threadId } = await context.params;
  const session = await getSessionFromApi();
  const actorId = session?.user?.id;
  if (!actorId) {
    return Response.json(
      { error: "Sign in to follow threads" },
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
    return Response.json(
      { error: "Invalid thread preference" },
      { status: 400 }
    );
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json(
      { error: "Invalid thread preference" },
      { status: 400 }
    );
  }
  const input = body as { following?: unknown };
  if (typeof input.following !== "boolean") {
    return Response.json(
      { error: "Invalid thread preference" },
      { status: 400 }
    );
  }
  try {
    const access = await getCommunityChatRoomAccess(threadId, actorId);
    if (access.communityId !== community.id || access.room.kind !== "THREAD") {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }
    return Response.json(
      await setCommunityChatThreadFollowing({
        actorId,
        following: input.following,
        threadId,
      })
    );
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
