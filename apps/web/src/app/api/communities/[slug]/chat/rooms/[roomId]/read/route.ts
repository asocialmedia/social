import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  advanceCommunityChatReadState,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string; slug: string }> }
) {
  const { roomId, slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json(
      { error: "Sign in to save read state" },
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
    return Response.json({ error: "Invalid read position" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Invalid read position" }, { status: 400 });
  }
  const input = body as { readSequence?: unknown };
  if (typeof input.readSequence !== "string") {
    return Response.json({ error: "Invalid read position" }, { status: 400 });
  }
  try {
    const access = await getCommunityChatRoomAccess(roomId, userId);
    if (access.communityId !== community.id) {
      return Response.json({ error: "Chat room not found" }, { status: 404 });
    }
    const result = await advanceCommunityChatReadState({
      readSequence: input.readSequence,
      roomId,
      userId,
    });
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
