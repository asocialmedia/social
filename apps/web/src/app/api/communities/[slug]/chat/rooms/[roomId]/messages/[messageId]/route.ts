import {
  canViewCommunity,
  getCommunityBySlug,
  getCommunityChatMessage,
  getCommunityChatRoomAccess,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

interface RouteContext {
  params: Promise<{ messageId: string; roomId: string; slug: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { messageId, roomId, slug } = await context.params;
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
    const message = await getCommunityChatMessage({
      messageId,
      roomId,
      userId,
    });
    return Response.json(
      { message },
      {
        headers: { "cache-control": "private, no-store", vary: "Cookie" },
      }
    );
  } catch (error) {
    return communityChatErrorResponse(error);
  }
}
