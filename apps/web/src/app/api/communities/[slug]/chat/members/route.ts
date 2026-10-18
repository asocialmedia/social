import {
  canViewCommunity,
  CommunityChatError,
  getCommunityBySlug,
  searchCommunityChatMembers,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { communityChatErrorResponse } from "@/lib/communities/chat-api";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";
  const community = await getCommunityBySlug(slug);
  if (!community || !(await canViewCommunity(community, userId))) {
    return Response.json({ error: "Community not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || undefined;
  try {
    const page = await searchCommunityChatMembers({
      communityId: community.id,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit,
      query: url.searchParams.get("q") ?? "",
      userId,
    });
    return Response.json(page, {
      headers: { "cache-control": "private, no-store", vary: "Cookie" },
    });
  } catch (error) {
    if (error instanceof CommunityChatError) {
      return communityChatErrorResponse(error);
    }
    return communityChatErrorResponse(error);
  }
}
