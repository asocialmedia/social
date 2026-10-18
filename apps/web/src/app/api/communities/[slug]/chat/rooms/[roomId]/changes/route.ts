import {
  getCommunityBySlug,
  getCommunityChatRoomAccess,
  getCommunityChatRoomChanges,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string; slug: string }> }
) {
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
    const changes = await getCommunityChatRoomChanges({
      afterChangeSequence: url.searchParams.get("after") ?? "0",
      limit: Number(url.searchParams.get("limit")) || undefined,
      roomId,
      userId,
    });
    return Response.json(changes, {
      headers: { "cache-control": "private, no-store", vary: "Cookie" },
    });
  } catch (error) {
    return communityChatErrorResponse(error);
  }
}
